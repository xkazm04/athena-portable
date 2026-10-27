"""One reading of this PC's room, per OS, with the standard library only (ADR 0143, "Probe").

A :class:`Probe` answers "what does this machine have free right now" in the numbers the gate
needs and the Devices surface shows: CPU load across the whole host, RAM total and *available*
(the cache the OS gives back on demand counts as free), each NVIDIA GPU's load and memory, mains or
battery and the charge, and the free space on the volume the brain lives on.

Where each figure comes from:

- **Windows** - ``ctypes`` on ``kernel32``: ``GlobalMemoryStatusEx`` (``ullAvailPhys`` is the
  available figure), ``GetSystemTimes`` (CPU as the busy share of the time between two readings),
  ``GetSystemPowerStatus``.
- **Linux** - ``/proc/meminfo`` (``MemAvailable``), ``/proc/stat`` (the ``cpu`` line, two readings
  apart), ``/sys/class/power_supply`` (a ``Mains`` supply online, or a ``Battery`` discharging).
- **macOS** - ``sysctl hw.memsize`` and ``vm_stat`` for RAM where they answer; CPU and power are
  ``None``.
- **Everywhere** - ``shutil.disk_usage`` on the brain root, ``os.cpu_count`` for the cores, and
  ``nvidia-smi --query-gpu=...`` for the GPUs: at most :data:`GPU_TIMEOUT_S` (67 ms measured on a
  PC with an RTX 4090). A machine with no ``nvidia-smi`` is remembered as such for the life of the
  process, so it is looked up once.

**Every failure is ``None``, never a raise.** The gate fails open on an unknown figure, so a reading
that could not be taken is a reading that holds nothing. ``gpus`` is ``[]`` when ``nvidia-smi``
ran and listed nothing, and ``None`` when it could not run. CPU is ``None`` on the first reading,
because a load is a difference between two.

The OS calls sit behind small reader functions a test replaces (:class:`Readers`), so every
platform's arithmetic is exercised on any OS; only the reader bodies touch the machine.
"""

from __future__ import annotations

import ctypes
import math
import os
import shutil
import subprocess
import sys
import threading
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal, TypeVar

from athena.vitals import GpuView

_T = TypeVar("_T")

__all__ = [
    "GPU_QUERY",
    "GPU_TIMEOUT_S",
    "CpuTimes",
    "Memory",
    "Power",
    "Probe",
    "Reader",
    "Readers",
    "Reading",
    "parse_meminfo",
    "parse_nvidia_smi",
    "parse_power_supply",
    "parse_proc_stat",
    "parse_vm_stat",
    "readers_for",
    "run_command",
    "windows_power",
]

#: The one GPU query: name, memory total and used (MiB), load (%), one CSV row per GPU.
GPU_QUERY: tuple[str, ...] = (
    "--query-gpu=name,memory.total,memory.used,utilization.gpu",
    "--format=csv,noheader,nounits",
)
GPU_TIMEOUT_S = 3.0
#: ``CREATE_NO_WINDOW``: a windowless daemon's child must not flash a console (``transports``).
_NO_WINDOW = 0x08000000 if os.name == "nt" else 0

PowerSource = Literal["mains", "battery"]


@dataclass(frozen=True)
class CpuTimes:
    """Cumulative CPU time since boot, in any unit: what was idle, and all of it."""

    idle: float
    total: float


@dataclass(frozen=True)
class Memory:
    total_mb: int
    free_mb: int


@dataclass(frozen=True)
class Power:
    source: PowerSource | None
    battery_pct: int | None


@dataclass(frozen=True)
class Reading:
    """One reading of the host. Every figure may be ``None``; see the module docstring."""

    at: str
    cpu_pct: float | None
    cores: int | None
    ram_total_mb: int | None
    ram_free_mb: int | None
    gpus: list[GpuView] | None
    power: PowerSource | None
    battery_pct: int | None
    disk_free_mb: int | None

    @property
    def ram_pct(self) -> float | None:
        """``(total - free) / total * 100``, one decimal; ``None`` when either is unknown."""
        if self.ram_total_mb is None or self.ram_free_mb is None or self.ram_total_mb <= 0:
            return None
        used = self.ram_total_mb - self.ram_free_mb
        return round(max(0.0, min(100.0, used * 100.0 / self.ram_total_mb)), 1)


#: A command runner for the readers that shell out: ``argv -> stdout``, ``None`` on any failure.
Reader = Callable[[Sequence[str], float], str | None]


@dataclass(frozen=True)
class Readers:
    """Where one OS's figures come from. Each returns ``None`` when it cannot read."""

    cpu: Callable[[], CpuTimes | None] = lambda: None
    memory: Callable[[], Memory | None] = lambda: None
    power: Callable[[], Power | None] = lambda: None


# --- parsing: pure, and what the tests drive ----------------------------------------------------


def parse_meminfo(text: str | None) -> Memory | None:
    """``/proc/meminfo``: ``MemTotal`` and ``MemAvailable`` (kB). A kernel too old to report
    ``MemAvailable`` (before 3.14) gives ``None`` rather than a ``MemFree`` that undercounts."""
    values: dict[str, int] = {}
    for line in (text or "").splitlines():
        name, _, rest = line.partition(":")
        parts = rest.split()
        if parts and parts[0].isdigit():
            values[name.strip()] = int(parts[0])
    if "MemTotal" not in values or "MemAvailable" not in values:
        return None
    return Memory(total_mb=values["MemTotal"] // 1024, free_mb=values["MemAvailable"] // 1024)


def parse_proc_stat(text: str | None) -> CpuTimes | None:
    """The aggregate ``cpu`` line of ``/proc/stat``: idle is ``idle + iowait``, total is the first
    eight fields (``guest`` is already inside ``user``, so it is not added twice)."""
    for line in (text or "").splitlines():
        parts = line.split()
        if parts and parts[0] == "cpu":
            try:
                fields = [float(value) for value in parts[1:9]]
            except ValueError:
                return None
            if len(fields) < 4:
                return None
            idle = fields[3] + (fields[4] if len(fields) > 4 else 0.0)
            return CpuTimes(idle=idle, total=sum(fields))
    return None


def parse_power_supply(supplies: dict[str, dict[str, str]] | None) -> Power | None:
    """``/sys/class/power_supply/<name>/{type,online,capacity,status}``, read into a dict.

    ``None`` when the directory could not be read at all. A machine that lists supplies but no
    battery runs on mains. A battery that is ``Discharging`` while no mains supply is online is
    ``battery``; with mains online it is ``mains``, with the charge still reported.
    """
    if supplies is None:
        return None
    mains_online = False
    battery_pct: int | None = None
    discharging = False
    has_battery = False
    for entry in supplies.values():
        kind = entry.get("type", "").strip().lower()
        if kind == "mains" and entry.get("online", "").strip() == "1":
            mains_online = True
        elif kind == "battery":
            has_battery = True
            capacity = entry.get("capacity", "").strip()
            if capacity.isdigit() and battery_pct is None:
                battery_pct = max(0, min(100, int(capacity)))
            if entry.get("status", "").strip().lower() == "discharging":
                discharging = True
    if not has_battery:
        return Power(source="mains", battery_pct=None)
    if mains_online:
        return Power(source="mains", battery_pct=battery_pct)
    if discharging:
        return Power(source="battery", battery_pct=battery_pct)
    return Power(source=None, battery_pct=battery_pct)


def parse_vm_stat(memsize: str | None, vm_stat: str | None) -> Memory | None:
    """macOS: ``sysctl -n hw.memsize`` (bytes) and ``vm_stat``'s free, inactive and speculative
    pages as available. ``None`` when either answer is missing or malformed."""
    if not memsize or not memsize.strip().isdigit() or not vm_stat:
        return None
    total = int(memsize.strip())
    page = 4096
    pages: dict[str, int] = {}
    for line in vm_stat.splitlines():
        if "page size of" in line:
            digits = [word for word in line.split() if word.isdigit()]
            if digits:
                page = int(digits[0])
            continue
        name, _, rest = line.partition(":")
        value = rest.strip().rstrip(".")
        if value.isdigit():
            pages[name.strip()] = int(value)
    wanted = ("Pages free", "Pages inactive", "Pages speculative")
    if "Pages free" not in pages:
        return None
    free = sum(pages.get(name, 0) for name in wanted) * page
    return Memory(total_mb=total // 1_048_576, free_mb=min(total, free) // 1_048_576)


def _number(text: str) -> float | None:
    try:
        value = float(text.strip())
    except ValueError:
        return None  # "[N/A]", "[Not Supported]"
    # ``float`` also reads "inf" and "nan": not a figure, and ``int()`` of one raises.
    return value if math.isfinite(value) else None


def parse_nvidia_smi(text: str | None) -> list[GpuView] | None:
    """One GPU per CSV row of :data:`GPU_QUERY`; ``[]`` for no rows, ``None`` for no answer."""
    if text is None:
        return None
    gpus: list[GpuView] = []
    for line in text.splitlines():
        if not line.strip():
            continue
        # The name may hold a comma; the three numbers are always the last three fields.
        parts = line.rsplit(",", 3)
        if len(parts) != 4:
            continue
        name, total, used, util = parts
        vram_total, vram_used = _number(total), _number(used)
        gpus.append(
            {
                "name": name.strip(),
                "util_pct": _number(util),
                "vram_total_mb": None if vram_total is None else int(vram_total),
                "vram_used_mb": None if vram_used is None else int(vram_used),
            }
        )
    return gpus


# --- the readers: the only code here that touches the machine -----------------------------------


def run_command(argv: Sequence[str], timeout: float) -> str | None:  # pragma: no cover - real I/O
    """``argv``'s stdout, or ``None`` when it could not run, timed out or exited non-zero."""
    try:
        done = subprocess.run(
            list(argv),
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            creationflags=_NO_WINDOW,
        )
    except (OSError, subprocess.SubprocessError, ValueError):
        return None
    return done.stdout if done.returncode == 0 else None


def _read_text(path: str) -> str | None:  # pragma: no cover - real I/O
    try:
        with open(path, encoding="ascii", errors="replace") as handle:
            return handle.read()
    except OSError:
        return None


def _power_supplies(root: str = "/sys/class/power_supply") -> dict[str, dict[str, str]] | None:
    try:
        names = os.listdir(root)
    except OSError:
        return None
    supplies: dict[str, dict[str, str]] = {}
    for name in names:
        entry: dict[str, str] = {}
        for key in ("type", "online", "capacity", "status"):
            value = _read_text(os.path.join(root, name, key))
            if value is not None:
                entry[key] = value
        supplies[name] = entry
    return supplies


def _linux_readers() -> Readers:  # pragma: no cover - real I/O
    return Readers(
        cpu=lambda: parse_proc_stat(_read_text("/proc/stat")),
        memory=lambda: parse_meminfo(_read_text("/proc/meminfo")),
        power=lambda: parse_power_supply(_power_supplies()),
    )


def _mac_readers(run: Reader) -> Readers:  # pragma: no cover - real I/O
    return Readers(
        memory=lambda: parse_vm_stat(
            run(["sysctl", "-n", "hw.memsize"], 1.0), run(["vm_stat"], 1.0)
        )
    )


def _windows_readers() -> Readers:  # pragma: no cover - real I/O
    if sys.platform != "win32":
        return Readers()

    class MemoryStatusEx(ctypes.Structure):
        _fields_ = (
            ("dwLength", ctypes.c_uint32),
            ("dwMemoryLoad", ctypes.c_uint32),
            ("ullTotalPhys", ctypes.c_uint64),
            ("ullAvailPhys", ctypes.c_uint64),
            ("ullTotalPageFile", ctypes.c_uint64),
            ("ullAvailPageFile", ctypes.c_uint64),
            ("ullTotalVirtual", ctypes.c_uint64),
            ("ullAvailVirtual", ctypes.c_uint64),
            ("ullAvailExtendedVirtual", ctypes.c_uint64),
        )

    class FileTime(ctypes.Structure):
        _fields_ = (("low", ctypes.c_uint32), ("high", ctypes.c_uint32))

        def value(self) -> int:
            return (int(self.high) << 32) | int(self.low)

    class SystemPowerStatus(ctypes.Structure):
        _fields_ = (
            ("ACLineStatus", ctypes.c_uint8),
            ("BatteryFlag", ctypes.c_uint8),
            ("BatteryLifePercent", ctypes.c_uint8),
            ("SystemStatusFlag", ctypes.c_uint8),
            ("BatteryLifeTime", ctypes.c_uint32),
            ("BatteryFullLifeTime", ctypes.c_uint32),
        )

    try:
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    except OSError:
        return Readers()

    def memory() -> Memory | None:
        status = MemoryStatusEx()
        status.dwLength = ctypes.sizeof(status)
        try:
            if not kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
                return None
        except (OSError, AttributeError):
            return None
        return Memory(
            total_mb=int(status.ullTotalPhys) // 1_048_576,
            free_mb=int(status.ullAvailPhys) // 1_048_576,
        )

    def cpu() -> CpuTimes | None:
        idle, kernel, user = FileTime(), FileTime(), FileTime()
        try:
            if not kernel32.GetSystemTimes(
                ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)
            ):
                return None
        except (OSError, AttributeError):
            return None
        # Kernel time includes the idle time.
        return CpuTimes(idle=float(idle.value()), total=float(kernel.value() + user.value()))

    def power() -> Power | None:
        status = SystemPowerStatus()
        try:
            if not kernel32.GetSystemPowerStatus(ctypes.byref(status)):
                return None
        except (OSError, AttributeError):
            return None
        return windows_power(
            int(status.ACLineStatus), int(status.BatteryFlag), int(status.BatteryLifePercent)
        )

    return Readers(cpu=cpu, memory=memory, power=power)


def windows_power(ac_line: int, battery_flag: int, percent: int) -> Power:
    """``SYSTEM_POWER_STATUS`` read: ``ACLineStatus`` 1 is mains, 0 is battery, 255 unknown;
    ``BatteryFlag`` 128 is "no system battery" and 255 unknown; a percent of 255 is unknown."""
    no_battery = battery_flag == 128
    battery_pct = None if no_battery or battery_flag == 255 or percent > 100 else percent
    source: PowerSource | None = None
    if ac_line == 1 or (ac_line != 0 and no_battery):
        source = "mains"
    elif ac_line == 0:
        source = "battery"
    return Power(source=source, battery_pct=battery_pct)


def readers_for(platform: str = sys.platform, run: Reader | None = None) -> Readers:
    """This OS's readers; every figure ``None`` on a platform nobody wrote one for."""
    if platform == "win32":
        return _windows_readers()
    if platform.startswith("linux"):
        return _linux_readers()
    if platform == "darwin":
        return _mac_readers(run or run_command)
    return Readers()


def _disk_free_mb(root: Path) -> int | None:
    """Free MiB on ``root``'s volume, walking up to the nearest folder that exists."""
    target = root
    while not target.exists() and target.parent != target:
        target = target.parent
    try:
        return int(shutil.disk_usage(target).free // 1_048_576)
    except (OSError, ValueError):
        return None


def _now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


@dataclass
class Probe:
    """Reads this PC. Keeps only what a reading needs from the last one: the CPU times (a load is
    a difference) and the GPUs (read on their own, slower, cadence).

    ``readers``, ``disk``, ``run`` and ``nvidia_smi`` are injected by a test; by default they are
    this OS's. Thread-safe: the sampler and an on-demand ``GET /vitals`` may read at once.
    """

    disk_root: Path
    readers: Readers | None = None
    disk: Callable[[Path], int | None] = _disk_free_mb
    run: Reader = run_command
    #: Where ``nvidia-smi`` is: a path, or ``None`` to look it up on PATH once.
    nvidia_smi: str | None = None
    cores: Callable[[], int | None] = os.cpu_count
    clock: Callable[[], str] = _now_iso
    _lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)
    _last_cpu: CpuTimes | None = field(default=None, init=False, repr=False)
    _gpus: list[GpuView] | None = field(default=None, init=False, repr=False)
    #: ``False`` once ``nvidia-smi`` was looked for and is not there: never looked for again.
    _smi_present: bool | None = field(default=None, init=False, repr=False)

    def __post_init__(self) -> None:
        if self.readers is None:
            self.readers = readers_for()
        if self.nvidia_smi is not None:
            self._smi_present = True

    def read(self, *, gpu: bool = True) -> Reading:
        """One reading. ``gpu=False`` reuses the last GPU figures instead of asking again."""
        readers = self.readers or Readers()
        with self._lock:
            times = _safe(readers.cpu)
            cpu_pct = _load(self._last_cpu, times)
            if times is not None:
                self._last_cpu = times
            if gpu:
                self._gpus = _safe(self._read_gpus)
            gpus = None if self._gpus is None else list(self._gpus)
        memory = _safe(readers.memory)
        power = _safe(readers.power)
        return Reading(
            at=self.clock(),
            cpu_pct=cpu_pct,
            cores=_safe(self.cores),
            ram_total_mb=None if memory is None else memory.total_mb,
            ram_free_mb=None if memory is None else memory.free_mb,
            gpus=gpus,
            power=None if power is None else power.source,
            battery_pct=None if power is None else power.battery_pct,
            disk_free_mb=_safe(lambda: self.disk(self.disk_root)),
        )

    def _read_gpus(self) -> list[GpuView] | None:
        if self._smi_present is False:
            return None
        binary = self.nvidia_smi or shutil.which("nvidia-smi")
        if binary is None:
            self._smi_present = False  # absent: remembered for the life of the process
            return None
        self._smi_present = True
        self.nvidia_smi = binary
        return parse_nvidia_smi(self.run([binary, *GPU_QUERY], GPU_TIMEOUT_S))


def _safe(read: Callable[[], _T | None]) -> _T | None:
    """A reader's answer, or ``None`` for any exception it raised: a probe never raises."""
    try:
        return read()
    except Exception:
        return None


def _load(before: CpuTimes | None, now: CpuTimes | None) -> float | None:
    """The busy share of the time between two readings, 0-100, one decimal."""
    if before is None or now is None:
        return None
    total = now.total - before.total
    idle = now.idle - before.idle
    if total <= 0 or idle < 0:
        return None
    return round(max(0.0, min(100.0, (total - idle) * 100.0 / total)), 1)

"""One reading of the host, per OS, from fakes (ADR 0143, "Probe").

athena/vitals/probe.py. Every platform's arithmetic runs here on any OS: the readers that touch
the machine are replaced by text and numbers recorded from one, and only the one test at the end
reads this machine for real, asserting shapes rather than values.
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import pytest

from athena.vitals.probe import (
    GPU_QUERY,
    GPU_TIMEOUT_S,
    CpuTimes,
    Memory,
    Power,
    Probe,
    Readers,
    parse_meminfo,
    parse_nvidia_smi,
    parse_power_supply,
    parse_proc_stat,
    parse_vm_stat,
    readers_for,
    windows_power,
)

MEMINFO = """MemTotal:       65536000 kB
MemFree:         2048000 kB
MemAvailable:   30720000 kB
Buffers:          100000 kB
"""

PROC_STAT = """cpu  4705 150 1120 16250 520 30 10 0 0 0
cpu0 2000 70 500 8000 250 15 5 0 0 0
intr 1 2 3
"""

SMI = """NVIDIA GeForce RTX 4090, 24564, 1391, 21
Tesla T4, [N/A], 0, [Not Supported]
"""

VM_STAT = """Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               100000.
Pages active:                             500000.
Pages inactive:                           200000.
Pages speculative:                         50000.
"""


class Runner:
    """A command runner that answers from a table and records what it was asked."""

    def __init__(self, answers: dict[str, str | None]) -> None:
        self.answers = answers
        self.calls: list[tuple[list[str], float]] = []

    def __call__(self, argv: Sequence[str], timeout: float) -> str | None:
        self.calls.append((list(argv), timeout))
        return self.answers.get(Path(argv[0]).name)


def _probe(tmp_path: Path, **overrides: object) -> Probe:
    defaults: dict[str, object] = {
        "readers": Readers(),
        "disk": lambda root: 50_000,
        "run": Runner({}),
        "cores": lambda: 16,
        "clock": lambda: "2026-10-24T12:00:00+00:00",
    }
    defaults.update(overrides)
    return Probe(tmp_path, **defaults)  # type: ignore[arg-type]


# -- Linux --------------------------------------------------------------------------------------


def test_linux_meminfo_counts_available_not_free() -> None:
    assert parse_meminfo(MEMINFO) == Memory(total_mb=64000, free_mb=30000)


def test_a_kernel_with_no_memavailable_is_unknown_rather_than_undercounted() -> None:
    assert parse_meminfo("MemTotal: 1000 kB\nMemFree: 10 kB\n") is None
    assert parse_meminfo(None) is None
    assert parse_meminfo("garbage") is None


def test_linux_proc_stat_reads_the_aggregate_line() -> None:
    times = parse_proc_stat(PROC_STAT)
    assert times is not None
    assert times.idle == 16250 + 520
    assert times.total == 4705 + 150 + 1120 + 16250 + 520 + 30 + 10 + 0
    assert parse_proc_stat("intr 1 2") is None
    assert parse_proc_stat("cpu a b c d") is None


def test_linux_power_supply_mains_battery_and_a_desktop() -> None:
    laptop_unplugged = {
        "AC": {"type": "Mains\n", "online": "0\n"},
        "BAT0": {"type": "Battery\n", "capacity": "27\n", "status": "Discharging\n"},
    }
    assert parse_power_supply(laptop_unplugged) == Power("battery", 27)
    laptop_plugged = {
        "AC": {"type": "Mains", "online": "1"},
        "BAT0": {"type": "Battery", "capacity": "80", "status": "Charging"},
    }
    assert parse_power_supply(laptop_plugged) == Power("mains", 80)
    # Supplies listed but no battery: nothing to run on but the mains.
    assert parse_power_supply({}) == Power("mains", None)
    # The directory could not be read at all: unknown.
    assert parse_power_supply(None) is None
    # A battery that says neither, with no mains online: the source is unknown.
    assert parse_power_supply(
        {"BAT0": {"type": "Battery", "capacity": "50", "status": "Full"}}
    ) == (Power(None, 50))


# -- Windows ------------------------------------------------------------------------------------


def test_windows_power_status_flags() -> None:
    # A desktop: on the line, "no system battery" (128), percent unknown (255).
    assert windows_power(1, 128, 255) == Power("mains", None)
    # A laptop unplugged at 22%.
    assert windows_power(0, 0, 22) == Power("battery", 22)
    # AC unknown (255) with no battery: still mains.
    assert windows_power(255, 128, 255) == Power("mains", None)
    # AC unknown with a battery: unknown source, the charge still told.
    assert windows_power(255, 1, 64) == Power(None, 64)
    # Battery status unknown (255): the charge is not believed.
    assert windows_power(1, 255, 90) == Power("mains", None)


# -- macOS --------------------------------------------------------------------------------------


def test_macos_memory_from_sysctl_and_vm_stat() -> None:
    memory = parse_vm_stat(str(32 * 1024**3), VM_STAT)
    assert memory == Memory(total_mb=32768, free_mb=(350_000 * 16384) // 1_048_576)
    assert parse_vm_stat(None, VM_STAT) is None
    assert parse_vm_stat("123", None) is None
    assert parse_vm_stat("123", "nothing useful") is None


def test_macos_readers_ask_sysctl_and_vm_stat_and_nothing_else(tmp_path: Path) -> None:
    runner = Runner({"sysctl": str(16 * 1024**3), "vm_stat": VM_STAT})
    readers = readers_for("darwin", runner)
    assert readers.memory() is not None
    assert readers.cpu() is None and readers.power() is None
    assert [call[0][0] for call in runner.calls] == ["sysctl", "vm_stat"]


def test_an_unknown_platform_reads_nothing() -> None:
    readers = readers_for("sunos5")
    assert (readers.cpu(), readers.memory(), readers.power()) == (None, None, None)


# -- GPUs ---------------------------------------------------------------------------------------


def test_nvidia_smi_rows_parse_with_unknowns_as_none() -> None:
    assert parse_nvidia_smi(SMI) == [
        {
            "name": "NVIDIA GeForce RTX 4090",
            "util_pct": 21.0,
            "vram_total_mb": 24564,
            "vram_used_mb": 1391,
        },
        {"name": "Tesla T4", "util_pct": None, "vram_total_mb": None, "vram_used_mb": 0},
    ]
    assert parse_nvidia_smi("") == [], "it ran and listed nothing"
    assert parse_nvidia_smi(None) is None, "it could not run"


def test_the_gpu_query_is_the_one_line_and_three_seconds(tmp_path: Path) -> None:
    runner = Runner({"nvidia-smi": SMI})
    probe = _probe(tmp_path, run=runner, nvidia_smi="/usr/bin/nvidia-smi")
    reading = probe.read()
    assert reading.gpus is not None and reading.gpus[0]["vram_total_mb"] == 24564
    assert runner.calls == [(["/usr/bin/nvidia-smi", *GPU_QUERY], GPU_TIMEOUT_S)]
    assert GPU_QUERY == (
        "--query-gpu=name,memory.total,memory.used,utilization.gpu",
        "--format=csv,noheader,nounits",
    )
    assert GPU_TIMEOUT_S == 3.0


def test_a_reading_without_the_gpu_reuses_the_last_gpus(tmp_path: Path) -> None:
    runner = Runner({"nvidia-smi": SMI})
    probe = _probe(tmp_path, run=runner, nvidia_smi="nvidia-smi")
    first = probe.read(gpu=True)
    second = probe.read(gpu=False)
    assert len(runner.calls) == 1
    assert second.gpus == first.gpus


def test_no_nvidia_smi_is_looked_for_once_per_process(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    looked: list[str] = []

    def which(name: str) -> None:
        looked.append(name)

    monkeypatch.setattr("athena.vitals.probe.shutil.which", which)
    runner = Runner({})
    probe = _probe(tmp_path, run=runner)
    assert probe.read().gpus is None
    assert probe.read().gpus is None
    assert looked == ["nvidia-smi"], "absence is remembered"
    assert runner.calls == []


def test_a_failing_nvidia_smi_is_none_this_time_and_asked_again(tmp_path: Path) -> None:
    runner = Runner({"nvidia-smi": None})
    probe = _probe(tmp_path, run=runner, nvidia_smi="nvidia-smi")
    assert probe.read().gpus is None
    runner.answers["nvidia-smi"] = SMI
    assert probe.read().gpus is not None


# -- the reading --------------------------------------------------------------------------------


def test_cpu_is_none_until_a_second_reading_then_the_busy_share(tmp_path: Path) -> None:
    times = iter([CpuTimes(idle=100, total=200), CpuTimes(idle=130, total=300)])
    probe = _probe(tmp_path, readers=Readers(cpu=lambda: next(times)))
    assert probe.read(gpu=False).cpu_pct is None
    # 100 ticks passed, 30 of them idle: 70% busy.
    assert probe.read(gpu=False).cpu_pct == 70.0


def test_ram_pct_is_used_over_total(tmp_path: Path) -> None:
    probe = _probe(tmp_path, readers=Readers(memory=lambda: Memory(64000, 16000)))
    reading = probe.read(gpu=False)
    assert (reading.ram_total_mb, reading.ram_free_mb, reading.ram_pct) == (64000, 16000, 75.0)


def test_every_failure_is_none_and_nothing_raises(tmp_path: Path) -> None:
    def boom() -> None:
        raise OSError("no such counter")

    def disk(root: Path) -> int:
        raise PermissionError("no")

    probe = _probe(
        tmp_path,
        readers=Readers(cpu=boom, memory=boom, power=boom),
        disk=disk,
        cores=boom,
    )
    reading = probe.read(gpu=False)
    assert reading.cpu_pct is None
    assert reading.cores is None
    assert reading.ram_total_mb is None and reading.ram_free_mb is None and reading.ram_pct is None
    assert reading.power is None and reading.battery_pct is None
    assert reading.disk_free_mb is None
    assert reading.gpus is None


def test_disk_is_measured_on_the_nearest_folder_that_exists(tmp_path: Path) -> None:
    probe = Probe(tmp_path / "not" / "yet" / "made", readers=Readers(), cores=lambda: 1)
    reading = probe.read(gpu=False)
    assert isinstance(reading.disk_free_mb, int) and reading.disk_free_mb > 0


def test_this_machine_reads_in_the_wire_shape(tmp_path: Path) -> None:
    """The real readers of whatever OS runs the suite: shapes, not values. No GPU is asked."""
    probe = Probe(tmp_path)
    reading = probe.read(gpu=False)
    reading = probe.read(gpu=False)
    for value in (reading.cpu_pct, reading.ram_pct):
        assert value is None or 0.0 <= value <= 100.0
    for count in (reading.cores, reading.ram_total_mb, reading.ram_free_mb, reading.disk_free_mb):
        assert count is None or (isinstance(count, int) and count >= 0)
    assert reading.power in ("mains", "battery", None)
    assert reading.gpus is None

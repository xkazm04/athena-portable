"""Shared plumbing for the avatar-measure scripts (ADR 0120 follow-up).

Everything here is stdlib + numpy so it runs in the face helper's own environment
(``~/.athena-avatar/venvs/t4-hybrid``) without installing anything into it: peak RAM and CPU
times come from Win32 through ctypes, not psutil.
"""

from __future__ import annotations

import ctypes
import json
import os
import platform
import statistics
import sys
import time
import wave
from ctypes import wintypes
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
HELPER_PARENT = REPO / "src" / "athena" / "channels" / "voice"  # the daemon loads face_helper from here
AVATAR_HOME = Path(os.environ.get("ATHENA_AVATAR_HOME", Path.home() / ".athena-avatar"))
JOYVASA = AVATAR_HOME / "models" / "joyvasa"
FACE_PY = AVATAR_HOME / "venvs" / "t4-hybrid" / "Scripts" / "python.exe"
KOKORO_DIR = Path.home() / ".personas" / "companion-tts" / "kokoro"
SHERPA_EXE = Path.home() / ".personas" / "companion-tts" / "bin" / "sherpa-onnx-offline-tts.exe"
GPULOCK = REPO.parent / "spark-athena-avatar" / "spikes" / "avatar" / "tools" / "gpulock.py"
DATA = AVATAR_HOME / "measure"  # rendered audio, motion tracks, checkpoints (never in the repo)
RESULTS = HERE / "results"
SID_AF_HEART = 3


def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(json.dumps(obj, indent=1, ensure_ascii=False) + "\n")


def read_wav(path: Path) -> tuple[bytes, int]:
    with wave.open(str(path), "rb") as w:
        return w.readframes(w.getnframes()), w.getframerate()


def write_wav(path: Path, pcm: bytes, sr: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm)


# --- the process: threads, affinity, memory, CPU time ----------------------------------------------

_k32 = ctypes.WinDLL("kernel32", use_last_error=True) if os.name == "nt" else None
if _k32 is not None:  # handles are pointer-sized: without these the pseudo-handle is truncated
    _k32.GetCurrentProcess.restype = wintypes.HANDLE
    _k32.SetProcessAffinityMask.argtypes = [wintypes.HANDLE, ctypes.c_size_t]
    _k32.K32GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD]


class _PMC(ctypes.Structure):
    _fields_ = [
        ("cb", wintypes.DWORD),
        ("PageFaultCount", wintypes.DWORD),
        ("PeakWorkingSetSize", ctypes.c_size_t),
        ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
        ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t),
        ("PeakPagefileUsage", ctypes.c_size_t),
        ("PrivateUsage", ctypes.c_size_t),
    ]


def memory_mb() -> dict[str, float]:
    """Working set now and at peak, and the peak commit (private bytes), in MB."""
    if _k32 is None:
        return {}
    pmc = _PMC()
    pmc.cb = ctypes.sizeof(_PMC)
    _k32.K32GetProcessMemoryInfo(_k32.GetCurrentProcess(), ctypes.byref(pmc), pmc.cb)
    mb = 1024 * 1024
    return {
        "ws_mb": round(pmc.WorkingSetSize / mb, 1),
        "peak_ws_mb": round(pmc.PeakWorkingSetSize / mb, 1),
        "peak_private_mb": round(pmc.PeakPagefileUsage / mb, 1),
    }


def set_affinity(cpus: list[int]) -> None:
    """Pin this process (and the threads it starts later) to the given logical CPUs."""
    mask = 0
    for c in cpus:
        mask |= 1 << c
    if _k32 is None:
        os.sched_setaffinity(0, set(cpus))  # type: ignore[attr-defined]
        return
    if not _k32.SetProcessAffinityMask(_k32.GetCurrentProcess(), ctypes.c_size_t(mask)):
        raise OSError(ctypes.get_last_error(), "SetProcessAffinityMask failed")


HIGH_PRIORITY_CLASS = 0x80


def set_high_priority() -> None:
    """HIGH priority class for this process: the box is shared (other sessions, a WSL VM), and a
    dedicated laptop running only Athena would not lose its cores to them. Recorded as a caveat."""
    if _k32 is not None:
        _k32.SetPriorityClass.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        _k32.SetPriorityClass(_k32.GetCurrentProcess(), HIGH_PRIORITY_CLASS)


def cpu_s() -> float:
    """This process's user + system CPU seconds."""
    t = os.times()
    return t.user + t.system


class _FT(ctypes.Structure):
    _fields_ = [("lo", wintypes.DWORD), ("hi", wintypes.DWORD)]


def system_times() -> tuple[float, float]:
    """(idle, total) CPU seconds over all logical CPUs, for the machine's background load."""
    if _k32 is None:
        return (0.0, 0.0)
    idle, kern, user = _FT(), _FT(), _FT()
    _k32.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kern), ctypes.byref(user))

    def s(ft: _FT) -> float:
        return ((ft.hi << 32) | ft.lo) / 1e7

    return s(idle), s(kern) + s(user)  # kernel time includes idle


class Meter:
    """Wall, process CPU and machine busy over one block."""

    def __enter__(self) -> Meter:
        self.w0, self.c0, self.s0 = time.perf_counter(), cpu_s(), system_times()
        return self

    def __exit__(self, *exc: Any) -> None:
        self.wall = time.perf_counter() - self.w0
        self.cpu = cpu_s() - self.c0
        i1, t1 = system_times()
        di, dt = i1 - self.s0[0], t1 - self.s0[1]
        self.machine_busy = (1 - di / dt) if dt > 0 else float("nan")

    def row(self) -> dict[str, float]:
        n = os.cpu_count() or 1
        return {
            "wall_s": round(self.wall, 4),
            "cpu_s": round(self.cpu, 3),
            "cores_used": round(self.cpu / self.wall, 2) if self.wall else 0.0,
            "process_cpu_pct_of_machine": round(100 * self.cpu / self.wall / n, 1) if self.wall else 0.0,
            "machine_busy_pct": round(100 * self.machine_busy, 1),
        }


def summary(xs: list[float]) -> dict[str, float]:
    xs = sorted(xs)
    return {
        "n": len(xs),
        "median": round(statistics.median(xs), 4),
        "min": round(xs[0], 4),
        "max": round(xs[-1], 4),
    }


def machine() -> dict[str, Any]:
    return {
        "cpu": "AMD Ryzen 7 7800X3D 8-Core (16 logical)",
        "gpu": "NVIDIA GeForce RTX 4090",
        "ram_gb": 64,
        "os": platform.platform(),
        "python": sys.version.split()[0],
        "date": time.strftime("%Y-%m-%d"),
    }

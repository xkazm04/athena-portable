"""A PC's room, measured with the standard library, and the gate that reads it (ADR 0143).

Every PC's daemon samples its own CPU, RAM, GPU and its memory, power and disk; the
:class:`~athena.vitals.gate.Gate` turns the samples into how many background tasks may run now
(``slots``) and, when none may start, the sentence that says why (``held``). The snapshot rides
the presence probe's authorized hello to every paired PC, is shown on Mind > Devices, and is what
Athena is told in each turn's ``frame.fleet`` block.

Two properties hold everywhere in this package:

- **Unknown is ``None``, never zero.** A figure the probe could not read is ``None``, and a gate
  that needs it fails open: it never holds work on a number it does not have. ``gpus`` is ``[]``
  when the probe ran and found none, ``None`` when it could not run.
- **Every key is always present** in :data:`VitalsView`, the wire shape, so the windows and the
  peers never have to tell "absent" from "unknown".

The modules:

- :mod:`~athena.vitals.probe` - one reading of the host, per OS (ctypes on Windows, ``/proc`` on
  Linux, ``nvidia-smi`` for an NVIDIA GPU), every failure a ``None``;
- :mod:`~athena.vitals.sampler` - the thread that keeps the latest reading fresh;
- :mod:`~athena.vitals.gate` - slots, room and the held reason, with hysteresis.

This module is the seam the other packages build against (device-vitals WP1 implements it; WP2
reads :class:`FleetSource`; WP3's sleep cycle asks :class:`RoomPort`).
"""

from __future__ import annotations

from typing import Literal, Protocol, TypedDict

__all__ = [
    "BATTERY_TASK_FLOOR_PCT",
    "CPU_HOLD_PCT",
    "CPU_HOLD_SAMPLES",
    "CPU_RESUME_PCT",
    "DISK_HOLD_MB",
    "GPU_EVERY_S",
    "RAM_HOLD_PCT",
    "RAM_RESUME_PCT",
    "RAM_ROOM_PCT",
    "SAMPLE_EVERY_S",
    "TASK_CHARGE_DEFAULT_MB",
    "VITALS_STALE_S",
    "DeviceVitals",
    "FleetSource",
    "GpuView",
    "Room",
    "RoomPort",
    "RunsSummary",
    "SleepSummary",
    "VitalsView",
]

#: CPU and RAM are sampled this often; a GPU reading costs a subprocess, so it is taken less often.
SAMPLE_EVERY_S = 5.0
GPU_EVERY_S = 30.0
#: RAM above this holds background work until it falls below the resume line (hysteresis).
RAM_HOLD_PCT = 92.0
RAM_RESUME_PCT = 85.0
#: The share of RAM the slot arithmetic lets tasks fill: ``slots`` counts the tasks whose measured
#: charge fits under it.
RAM_ROOM_PCT = 85.0
#: CPU holds only when it stays above the line for this many samples in a row: a compile spike is
#: not a reason to keep a task waiting.
CPU_HOLD_PCT = 90.0
CPU_HOLD_SAMPLES = 3
CPU_RESUME_PCT = 70.0
#: On battery, tasks wait below this charge; a sleep cycle never runs on battery.
BATTERY_TASK_FLOOR_PCT = 30
#: Less free disk than this on the brain's volume holds work that writes memory.
DISK_HOLD_MB = 1024
#: What one task is charged before the ledger has measured any: the peak working set of a
#: ``claude.exe`` child was 370-570 MB across 7 processes on 2026-10-24 (one Windows PC).
TASK_CHARGE_DEFAULT_MB = 600
#: A peer's vitals older than this are not shown or told: a stale "room ok" is worse than none.
VITALS_STALE_S = 90.0

Room = Literal["ok", "tight", "full"]


class GpuView(TypedDict):
    name: str
    util_pct: float | None
    vram_total_mb: int | None
    vram_used_mb: int | None


class RunsSummary(TypedDict):
    """``Ledger.runs_summary(hours=24)``: how this PC's own runs ended."""

    hours: int
    turns: int
    blank: int
    no_answer: int
    failed: int
    timeout: int
    usage_limit: int
    tasks_empty: int


class SleepSummary(TypedDict):
    state: Literal["never", "idle", "sleeping", "failed"]
    last_at: str | None
    pressure: float


class VitalsView(TypedDict):
    """The wire shape of one PC's vitals: ``GET /vitals``, the hello, ``GET /devices``."""

    at: str
    cpu_pct: float | None
    cores: int | None
    ram_total_mb: int | None
    ram_free_mb: int | None
    ram_pct: float | None
    gpus: list[GpuView] | None
    power: Literal["mains", "battery"] | None
    battery_pct: int | None
    disk_free_mb: int | None
    room: Room | None
    slots: int
    held: str | None
    runs: RunsSummary | None
    sleep: SleepSummary | None


class DeviceVitals(TypedDict):
    """One device as :class:`FleetSource` lists it - this PC first, then its peers."""

    device_id: str
    name: str
    kind: Literal["pc", "phone"]
    self: bool
    presence: Literal["online", "asleep", "unreachable"] | None
    vitals: VitalsView | None


class RoomPort(Protocol):
    """What the sleep cycle asks the gate: may background work that writes memory start now?"""

    def held(self, *, sleep: bool = False) -> str | None:
        """``None`` when it may; otherwise the sentence that says why not. ``sleep=True`` applies
        the sleep cycle's stricter rules (never on battery)."""
        ...

    def vitals(self) -> VitalsView | None:
        """The latest snapshot, or ``None`` before the first sample."""
        ...


class FleetSource(Protocol):
    """Every device Athena can be told about, this PC first; a peer's stale vitals are ``None``."""

    def fleet(self) -> list[DeviceVitals]: ...

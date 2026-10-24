"""The gate: from a reading of this PC to slots, room and the held reason (ADR 0143, "Gate").

Background work - a delegated task, a sleep cycle - must not start a run on a PC that has no room
for it: a run that starts there dies blank (no answer, a wall, an engine killed for memory) and
still costs a turn. So one gate per PC reads the sampler's latest reading and answers three things:

``held``
    The named reason background work waits, as a sentence for a person that begins "Waiting for
    room", or ``None``. It holds on:

    - **RAM** at or above :data:`RAM_HOLD_PCT`, until it falls below :data:`RAM_RESUME_PCT`;
    - **CPU** at or above :data:`CPU_HOLD_PCT` for :data:`CPU_HOLD_SAMPLES` readings in a row (a
      compile spike is not a reason), until it falls below :data:`CPU_RESUME_PCT`;
    - **battery**: a task waits on battery below :data:`BATTERY_TASK_FLOOR_PCT`; a sleep cycle
      waits on any battery (``held(sleep=True)``), because it is pure background;
    - **disk**: less than :data:`DISK_HOLD_MB` free on the brain's volume.

    The two lines of each hold are hysteresis: a PC hovering at the line does not flap.

``slots``
    How many tasks may run at once now: ``min(TASKS_RUNNING_CAP, running + floor(max(0,
    ram_total * RAM_ROOM_PCT / 100 - used) / charge))``, where ``running`` is the tasks running
    plus a running sleep cycle, and ``charge`` is what one run is measured to weigh (the ledger's
    median ``peak_mb``, :meth:`~athena.core.ledger.Ledger.task_charge_mb`). The cap of ADR 0141 is
    the ceiling: the gate only ever lowers it.

``room``
    ``full`` when held, ``tight`` when no further task fits (``slots <= running``), else ``ok``.

**Unknown fails open.** A figure the probe could not read never holds work: unknown RAM leaves the
slots at the cap and ``room`` at ``None`` ("room unknown"); an unknown CPU, battery or disk holds
nothing. Before the first reading there is no view at all.

**What is told.** Each reading that changes ``room``, ``held`` or ``slots`` publishes one
``vitals.changed {room, held, slots}`` on the event bus, and only then: a number that moves is not
news. ``runs`` (the ledger's 24-hour summary) and the task charge are read at most once a minute,
not on every five-second reading.
"""

from __future__ import annotations

import math
import threading
import time
from collections.abc import Callable, Mapping
from contextlib import suppress
from typing import Any, NamedTuple

from athena.vitals import (
    BATTERY_TASK_FLOOR_PCT,
    CPU_HOLD_PCT,
    CPU_HOLD_SAMPLES,
    CPU_RESUME_PCT,
    DISK_HOLD_MB,
    GPU_EVERY_S,
    RAM_HOLD_PCT,
    RAM_RESUME_PCT,
    RAM_ROOM_PCT,
    SAMPLE_EVERY_S,
    TASK_CHARGE_DEFAULT_MB,
    VITALS_STALE_S,
    Room,
    RunsSummary,
    SleepSummary,
    VitalsView,
)
from athena.vitals.probe import Reading

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
    "RUNS_EVERY_S",
    "SAMPLE_EVERY_S",
    "TASKS_RUNNING_CAP",
    "TASK_CHARGE_DEFAULT_MB",
    "VITALS_STALE_S",
    "Gate",
    "TaskRoom",
    "clean_view",
    "slots_for",
]

#: ADR 0141's ceiling, restated rather than imported: the daemon's task table imports this package's
#: protocol, and the cap is the same number on both sides (``tests/vitals`` holds them equal).
TASKS_RUNNING_CAP = 3
#: The ledger's runs summary and the task charge are read at most this often.
RUNS_EVERY_S = 60.0


class TaskRoom(NamedTuple):
    """What a claim asks the gate: the slots now, why a task waits (or ``None``), and whether every
    slot is taken (``running`` - tasks plus a running cycle - is at or past ``slots``)."""

    slots: int
    held: str | None
    full: bool


def slots_for(
    ram_total_mb: int | None, ram_free_mb: int | None, running: int, charge_mb: int
) -> int:
    """The brief's formula. Unknown RAM fails open to the cap."""
    if ram_total_mb is None or ram_free_mb is None or ram_total_mb <= 0:
        return TASKS_RUNNING_CAP
    used = ram_total_mb - ram_free_mb
    spare = max(0.0, ram_total_mb * RAM_ROOM_PCT / 100.0 - used)
    fits = math.floor(spare / max(1, charge_mb))
    return max(0, min(TASKS_RUNNING_CAP, running + fits))


def _pct(value: float) -> str:
    return f"{value:.0f}%"


class Gate:
    """One per PC. Implements :class:`athena.vitals.RoomPort`. Thread-safe.

    ``tasks_running`` and ``extra_running`` count what runs now (the daemon's running tasks, and
    1 while a sleep cycle runs); ``charge_mb``, ``runs`` and ``sleep`` are read for the view.
    Every callable is guarded: one that raises reads as unknown, never as a failed gate.
    """

    def __init__(
        self,
        *,
        tasks_running: Callable[[], int] = lambda: 0,
        extra_running: Callable[[], int] = lambda: 0,
        charge_mb: Callable[[], int] = lambda: TASK_CHARGE_DEFAULT_MB,
        runs: Callable[[], RunsSummary | None] = lambda: None,
        sleep: Callable[[], SleepSummary | None] = lambda: None,
        publish: Callable[..., None] | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.tasks_running = tasks_running
        self.extra_running = extra_running
        self.charge_mb = charge_mb
        self.runs = runs
        self.sleep = sleep
        #: ``vitals.changed`` goes here (the peer bus's ``publish``); ``None`` publishes nothing.
        self.publish = publish
        self._clock = clock
        self._lock = threading.Lock()
        self._reading: Reading | None = None
        self._ram_held = False
        self._cpu_high = 0
        self._cpu_held = False
        self._charge = TASK_CHARGE_DEFAULT_MB
        self._runs: RunsSummary | None = None
        self._slow_at: float | None = None
        self._told: tuple[Room | None, str | None, int] | None = None

    # -- feeding it ----------------------------------------------------------------------------

    def observe(self, reading: Reading) -> None:
        """Take one reading: move the holds, refresh the slow figures when due, and publish
        ``vitals.changed`` when room, held or slots moved."""
        self._refresh_slow()
        with self._lock:
            self._reading = reading
            ram = reading.ram_pct
            if ram is None:
                self._ram_held = False
            elif ram >= RAM_HOLD_PCT:
                self._ram_held = True
            elif ram < RAM_RESUME_PCT:
                self._ram_held = False
            cpu = reading.cpu_pct
            if cpu is None:
                self._cpu_high, self._cpu_held = 0, False
            else:
                self._cpu_high = self._cpu_high + 1 if cpu >= CPU_HOLD_PCT else 0
                if self._cpu_high >= CPU_HOLD_SAMPLES:
                    self._cpu_held = True
                elif cpu < CPU_RESUME_PCT:
                    self._cpu_held = False
        view = self.vitals()
        if view is None:
            return
        told = (view["room"], view["held"], view["slots"])
        with self._lock:
            changed, self._told = told != self._told, told
        if changed and self.publish is not None:
            with suppress(Exception):  # telling never fails a reading
                self.publish("vitals.changed", room=told[0], held=told[1], slots=told[2])

    def _refresh_slow(self, *, force: bool = False) -> None:
        now = self._clock()
        with self._lock:
            due = force or self._slow_at is None or now - self._slow_at >= RUNS_EVERY_S
            if due:
                self._slow_at = now
        if not due:
            return
        charge = _guarded(self.charge_mb)
        runs = _guarded(self.runs)
        with self._lock:
            self._charge = charge if isinstance(charge, int) and charge > 0 else self._charge
            self._runs = runs

    # -- RoomPort ------------------------------------------------------------------------------

    def held(self, *, sleep: bool = False) -> str | None:
        """``None`` when background work may start now; otherwise why not.

        ``sleep=True`` applies the sleep cycle's stricter rule: it never runs on battery.
        """
        with self._lock:
            return self._held(sleep=sleep)

    def _held(self, *, sleep: bool) -> str | None:
        reading = self._reading
        if reading is None:
            return None
        if self._ram_held and reading.ram_pct is not None:
            return (
                f"Waiting for room: RAM is at {_pct(reading.ram_pct)} "
                f"(resumes below {_pct(RAM_RESUME_PCT)})."
            )
        if self._cpu_held and reading.cpu_pct is not None:
            return (
                f"Waiting for room: CPU is at {_pct(reading.cpu_pct)} "
                f"(resumes below {_pct(CPU_RESUME_PCT)})."
            )
        if reading.power == "battery":
            if sleep:
                charge = "" if reading.battery_pct is None else f" at {reading.battery_pct}%"
                return (
                    f"Waiting for room: this PC is on battery{charge}, and sleep waits for mains."
                )
            if reading.battery_pct is not None and reading.battery_pct < BATTERY_TASK_FLOOR_PCT:
                return (
                    f"Waiting for room: the battery is at {reading.battery_pct}% "
                    f"(tasks resume at {BATTERY_TASK_FLOOR_PCT}% or on mains)."
                )
        if reading.disk_free_mb is not None and reading.disk_free_mb < DISK_HOLD_MB:
            return (
                f"Waiting for room: the disk has {reading.disk_free_mb} MB free "
                f"(needs {DISK_HOLD_MB} MB)."
            )
        return None

    def vitals(self) -> VitalsView | None:
        """The latest snapshot, or ``None`` before the first reading."""
        running = self._running()
        sleep = _guarded(self.sleep)
        with self._lock:
            reading = self._reading
            if reading is None:
                return None
            held = self._held(sleep=False)
            charge, runs = self._charge, self._runs
        slots = slots_for(reading.ram_total_mb, reading.ram_free_mb, running, charge)
        return {
            "at": reading.at,
            "cpu_pct": reading.cpu_pct,
            "cores": reading.cores,
            "ram_total_mb": reading.ram_total_mb,
            "ram_free_mb": reading.ram_free_mb,
            "ram_pct": reading.ram_pct,
            "gpus": None if reading.gpus is None else list(reading.gpus),
            "power": reading.power,
            "battery_pct": reading.battery_pct,
            "disk_free_mb": reading.disk_free_mb,
            "room": _room(reading, held, slots, running),
            "slots": slots,
            "held": held,
            "runs": runs,
            "sleep": sleep,
        }

    # -- the task table's question -------------------------------------------------------------

    def task_room(self, tasks_running: int) -> TaskRoom:
        """May one more task start, with ``tasks_running`` tasks running now?

        ``held`` is the gate's reason, or - when every slot the RAM allows is taken while the cap
        is not - a sentence that says so. When the cap itself is the limit, ``held`` is ``None``:
        that is the queue working, not the PC lacking room.
        """
        extra = max(0, _guarded(self.extra_running) or 0)
        running = max(0, tasks_running) + extra
        with self._lock:
            reading = self._reading
            held = self._held(sleep=False)
            charge = self._charge
        if reading is None:
            return TaskRoom(TASKS_RUNNING_CAP, None, running >= TASKS_RUNNING_CAP)
        slots = slots_for(reading.ram_total_mb, reading.ram_free_mb, running, charge)
        full = running >= slots
        if held is None and full and slots < TASKS_RUNNING_CAP and reading.ram_pct is not None:
            held = (
                f"Waiting for room: RAM is at {_pct(reading.ram_pct)}, and another task "
                f"(about {charge} MB) would take it past {_pct(RAM_ROOM_PCT)}."
            )
        return TaskRoom(slots, held, full)

    def _running(self) -> int:
        tasks = _guarded(self.tasks_running) or 0
        extra = _guarded(self.extra_running) or 0
        return max(0, tasks) + max(0, extra)


def _room(reading: Reading, held: str | None, slots: int, running: int) -> Room | None:
    if held is not None:
        return "full"
    if reading.ram_pct is None:
        return None
    return "tight" if slots <= running else "ok"


def _guarded(read: Callable[[], Any]) -> Any:
    try:
        return read()
    except Exception:
        return None


# --- a peer's view, as it arrives on the wire ---------------------------------------------------

_NUMBER_KEYS = ("cpu_pct", "ram_pct")
_INT_KEYS = ("cores", "ram_total_mb", "ram_free_mb", "battery_pct", "disk_free_mb")
_ROOMS = ("ok", "tight", "full")
#: The longest ``held`` sentence or GPU name a peer's view may carry here.
_TEXT_CAP = 300


def _num(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value):
        return None
    return float(value)


def _int(value: Any) -> int | None:
    number = _num(value)
    return None if number is None else int(number)


def _text(value: Any) -> str | None:
    return value[:_TEXT_CAP] if isinstance(value, str) else None


def _counts(value: Any, keys: tuple[str, ...]) -> dict[str, Any] | None:
    if not isinstance(value, Mapping):
        return None
    out: dict[str, Any] = {}
    for key in keys:
        number = _int(value.get(key))
        out[key] = 0 if number is None else max(0, number)
    return out


def clean_view(raw: Any) -> VitalsView | None:
    """A peer's ``vitals`` off its hello, rebuilt key by key into :data:`VitalsView`.

    The peer is trusted (it holds a token this PC minted) but its answer is still data: every key
    is re-typed, an unknown key is dropped, a missing one is ``None``, text is cut, and anything
    that is not an object is ``None``. So what ``GET /devices`` and the fleet prompt carry is the
    wire shape whatever another build sent.
    """
    if not isinstance(raw, Mapping):
        return None
    gpus_raw = raw.get("gpus")
    gpus: list[Any] | None = None
    if isinstance(gpus_raw, list):
        gpus = [
            {
                "name": _text(gpu.get("name")) or "GPU",
                "util_pct": _num(gpu.get("util_pct")),
                "vram_total_mb": _int(gpu.get("vram_total_mb")),
                "vram_used_mb": _int(gpu.get("vram_used_mb")),
            }
            for gpu in gpus_raw[:8]
            if isinstance(gpu, Mapping)
        ]
    power = raw.get("power")
    room = raw.get("room")
    slots = _int(raw.get("slots"))
    runs = _counts(
        raw.get("runs"),
        (
            "hours",
            "turns",
            "blank",
            "no_answer",
            "failed",
            "timeout",
            "usage_limit",
            "tasks_empty",
        ),
    )
    sleep_raw = raw.get("sleep")
    sleep: dict[str, Any] | None = None
    if isinstance(sleep_raw, Mapping) and sleep_raw.get("state") in (
        "never",
        "idle",
        "sleeping",
        "failed",
    ):
        sleep = {
            "state": sleep_raw["state"],
            "last_at": _text(sleep_raw.get("last_at")),
            "pressure": max(0.0, _num(sleep_raw.get("pressure")) or 0.0),
        }
    view: dict[str, Any] = {
        "at": _text(raw.get("at")) or "",
        **{key: _num(raw.get(key)) for key in _NUMBER_KEYS},
        **{key: _int(raw.get(key)) for key in _INT_KEYS},
        "gpus": gpus,
        "power": power if power in ("mains", "battery") else None,
        "room": room if room in _ROOMS else None,
        "slots": 0 if slots is None else max(0, min(TASKS_RUNNING_CAP, slots)),
        "held": _text(raw.get("held")),
        "runs": runs,
        "sleep": sleep,
    }
    ordered = {key: view[key] for key in VitalsView.__annotations__}
    return ordered  # type: ignore[return-value]

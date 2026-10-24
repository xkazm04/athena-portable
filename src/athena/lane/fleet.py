"""What Athena is told about her fleet: each PC's room, in the frame and on request (ADR 0143).

Every PC's daemon measures its own room (``athena.vitals``) and its paired PCs send theirs on the
hello they already exchange. This module turns that list into the two things she reads:

- :class:`FleetPrompt` - the body of the ``frame.fleet`` block, one line per device, this PC
  first, e.g. ``This PC (studio): room ok - RAM 40% of 64 GB, CPU 10%, RTX 4090 1.5/24 GB VRAM,
  mains; 3 task slots. Slept 5 h ago.``
- :func:`devices_executor` - ``core.devices``, the same list whole, as JSON, for the turn that
  needs every figure rather than the summary.

**She advises; she does not dispatch.** Nothing here can start work anywhere. A PC with room is
somewhere the person can open that PC's composer from Devices (the v2.2 dispatch is a non-goal of
ADR 0143), and the constitution says so in the same words.

Three choices are worth stating because they look like omissions:

- **The figures are rounded** - RAM and CPU to 5%, VRAM to half a gigabyte - because the block is
  composed every turn. A line that moved on every sample would tell her nothing new and make two
  frames that say the same thing differ; a rounded one moves when the room did.
- **An unknown figure is left out, never written as zero** (the wire's absent-value rule). A PC
  whose vitals are ``None`` - not heard within ``VITALS_STALE_S``, or asleep, or a phone - says so
  in words and shows no number at all: a stale "room ok" is worse than none.
- **Free text is flattened.** A device's name, a GPU's name and a held reason are the only words
  not written here, and each is cut to one capped line with its control characters gone, so the
  block can ride unfenced like the other daemon-authored blocks without a name opening a heading.
"""

from __future__ import annotations

import json
import math
import re
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from typing import Any

from athena.contracts.registry import ExecResult, ExecutorFn, TurnContext
from athena.core.catalog import DEVICES_CAP
from athena.vitals import DeviceVitals, FleetSource, GpuView, VitalsView

__all__ = [
    "FLEET_CHARS",
    "FLEET_DEVICES",
    "FLEET_LEAD",
    "FleetPrompt",
    "device_line",
    "devices_executor",
]

#: The most devices the block names, and the most characters its lines may take, before the rest
#: are cut and counted in ``(showing N of M)``. Eight PCs is more than any household pairs; the
#: character cap is what keeps a fleet of long names inside ``BUDGETS["frame.fleet"]``.
FLEET_DEVICES = 8
FLEET_CHARS = 900

#: The block's first line: what the lines are, and how to read a gap in them.
FLEET_LEAD = "Each PC's room now, as its daemon measured it; a figure left out is unknown."

#: Caps on the free text a line carries (see the module docstring).
_NAME_CAP = 40
_GPU_CAP = 32
_HELD_CAP = 160
#: More GPUs than this on one PC are counted rather than named.
_GPUS_NAMED = 2
#: Free disk under this is worth a word; above it, disk is not what limits the room.
_DISK_TELL_MB = 10 * 1024

_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f\u2028\u2029]+")
_SPACES = re.compile(r"\s+")
#: Vendor words a GPU's name repeats on every NVIDIA card; the model number is what tells two apart.
_GPU_NOISE = re.compile(r"\b(?:NVIDIA|GeForce)\b\s*", re.IGNORECASE)

Clock = Callable[[], datetime]


def _now() -> datetime:
    return datetime.now(UTC)


# --- one line --------------------------------------------------------------------------------


def _plain(text: str, cap: int) -> str:
    """One line of free text: control characters and runs of whitespace become one space, and the
    result is cut to ``cap`` with an ellipsis. Deterministic, so the same name renders the same."""
    flat = _SPACES.sub(" ", _CONTROL.sub(" ", text)).strip()
    return flat if len(flat) <= cap else flat[: cap - 1].rstrip() + "…"


def _round_to(value: float, step: float) -> float:
    """``value`` to the nearest ``step``, halves up (``round`` would send 42.5 to 40)."""
    return math.floor(value / step + 0.5) * step


def _pct(value: float) -> str:
    return f"{int(_round_to(max(0.0, min(100.0, value)), 5))}%"


def _gb(mb: int, step: float) -> str:
    """Megabytes as gigabytes to the nearest ``step``, ``1.5`` or ``24`` (no trailing ``.0``)."""
    value = _round_to(mb / 1024, step)
    return f"{value:.1f}".removesuffix(".0") if step < 1 else str(int(value))


def _gpu(gpu: GpuView) -> str:
    name = _plain(_GPU_NOISE.sub("", gpu.get("name") or ""), _GPU_CAP) or "GPU"
    total, used = gpu.get("vram_total_mb"), gpu.get("vram_used_mb")
    if total is not None and used is not None:
        return f"{name} {_gb(used, 0.5)}/{_gb(total, 0.5)} GB VRAM"
    if total is not None:
        return f"{name} {_gb(total, 0.5)} GB VRAM"
    return name


def _figures(vitals: VitalsView) -> list[str]:
    """The measured figures, each left out when it is unknown."""
    parts: list[str] = []
    ram_pct, ram_total = vitals.get("ram_pct"), vitals.get("ram_total_mb")
    if ram_pct is not None:
        whole = f" of {max(1, round(ram_total / 1024))} GB" if ram_total else ""
        parts.append(f"RAM {_pct(ram_pct)}{whole}")
    elif ram_total:
        parts.append(f"{max(1, round(ram_total / 1024))} GB RAM")
    cpu = vitals.get("cpu_pct")
    if cpu is not None:
        parts.append(f"CPU {_pct(cpu)}")
    gpus = vitals.get("gpus") or []
    parts.extend(_gpu(gpu) for gpu in gpus[:_GPUS_NAMED])
    if len(gpus) > _GPUS_NAMED:
        parts.append(f"{len(gpus) - _GPUS_NAMED} more GPUs")
    power, battery = vitals.get("power"), vitals.get("battery_pct")
    if power == "mains":
        parts.append("mains")
    elif power == "battery":
        parts.append(f"battery {battery}%" if battery is not None else "on battery")
    disk = vitals.get("disk_free_mb")
    if disk is not None and disk < _DISK_TELL_MB:
        parts.append(f"disk {_gb(disk, 0.5)} GB free")
    return parts


def _held(text: str) -> str:
    """The gate's held sentence, as the tail of a line: ``waiting for room: RAM is at 93% ...``."""
    flat = _plain(text, _HELD_CAP).rstrip(".")
    if flat[:1].isupper() and not flat[1:2].isupper():
        flat = flat[0].lower() + flat[1:]
    return flat


def _slots(slots: int) -> str:
    if slots <= 0:
        return "no task slot free"
    return f"{slots} task slot" + ("" if slots == 1 else "s")


def _ago(iso: str, now: datetime) -> str | None:
    """``5 h``, ``2 days``, ``under an hour``: coarse on purpose, so the line holds for an hour."""
    try:
        then = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return None
    if then.tzinfo is None:
        then = then.replace(tzinfo=UTC)
    hours = int((now - then).total_seconds() // 3600)
    if hours < 1:
        return "under an hour"
    if hours < 48:
        return f"{hours} h"
    return f"{hours // 24} days"


def _sleep(vitals: VitalsView, now: datetime) -> str:
    sleep = vitals.get("sleep")
    if sleep is None:
        return ""
    state = sleep.get("state")
    if state == "sleeping":
        return " Sleeping now."
    if state == "failed":
        return " Last sleep failed."
    last = sleep.get("last_at")
    ago = _ago(last, now) if last else None
    if ago is not None:
        return f" Slept {ago} ago."
    return " Not slept yet." if state == "never" else ""


_SILENT = {
    "asleep": "asleep",
    "unreachable": "unreachable",
    "online": "online, sends no vitals",
}


def device_line(device: DeviceVitals, *, now: datetime | None = None) -> str:
    """One device, one line. This PC is labelled as such; a phone and a silent PC say so in words.

    ``now`` is the clock the sleep age is measured against; ``None`` is the wall clock.
    """
    name = _plain(device.get("name") or "", _NAME_CAP)
    if device.get("self"):
        label = f"This PC ({name})" if name else "This PC"
    else:
        label = name or _plain(device.get("device_id") or "", _NAME_CAP) or "a device"
    if device.get("kind") == "phone":
        return f"{label}: a phone; no vitals."
    vitals = device.get("vitals")
    if vitals is None:
        if device.get("self"):
            return f"{label}: no vitals yet (not measured since the daemon started)."
        why = _SILENT.get(device.get("presence") or "", "not heard lately")
        return f"{label}: no vitals ({why})."
    room = vitals.get("room")
    head = f"{label}: room {room or 'unknown'}"
    figures = _figures(vitals)
    if figures:
        head += " - " + ", ".join(figures)
    held = vitals.get("held")
    tail = _held(held) if held else _slots(int(vitals.get("slots") or 0))
    return f"{head}; {tail}.{_sleep(vitals, now or _now())}"


def _ordered(devices: Sequence[DeviceVitals]) -> list[DeviceVitals]:
    """This PC first, then the rest in the order the source gave them (a stable sort)."""
    return sorted(devices, key=lambda device: not device.get("self"))


# --- the frame block ----------------------------------------------------------------------------


class FleetPrompt:
    """The body of ``frame.fleet`` (implements :class:`athena.lane.ports.FleetPort`).

    ``None`` when there is nothing to tell: no source wired in, an empty fleet, or a fleet in
    which no device has vitals - a block of "no vitals" lines is not worth a turn's tokens. It
    never raises: a source that fails is a turn told nothing about the fleet, not a failed turn.
    """

    def __init__(
        self,
        source: FleetSource | None,
        *,
        clock: Clock = _now,
        max_devices: int = FLEET_DEVICES,
        max_chars: int = FLEET_CHARS,
    ) -> None:
        self.source = source
        self._clock = clock
        self._max_devices = max_devices
        self._max_chars = max_chars

    def prompt_text(self) -> str | None:
        if self.source is None:
            return None
        try:
            devices = _ordered(self.source.fleet())
        except Exception:  # the fleet is advice; a turn must not fail because a peer misread
            return None
        if not any(device.get("vitals") is not None for device in devices):
            return None
        now = self._clock()
        lines: list[str] = []
        used = 0
        for device in devices[: max(self._max_devices, 1)]:
            line = device_line(device, now=now)
            if lines and used + len(line) + 1 > self._max_chars:
                break
            lines.append(line)
            used += len(line) + 1
        footer = f"(showing {len(lines)} of {len(devices)})"
        return "\n".join([FLEET_LEAD, *lines, footer])


# --- core.devices ------------------------------------------------------------------------------

_UNWIRED = "No device vitals are attached to this daemon, so no device's room can be told."


def devices_executor(source: FleetSource | None) -> ExecutorFn:
    """``core.devices``: ``{"devices": [DeviceVitals, ...]}``, this PC first, read-only.

    Whole devices are packed under :data:`~athena.core.catalog.DEVICES_CAP`, so the answer is
    always valid JSON; any left out are counted in a ``note`` that carries ``(showing N of M)``.
    With no source wired in the list is empty and the ``note`` says why, rather than an empty
    list that would read as "you have no devices". A source that fails is ``engine_error``, the
    reason a read whose service behind it failed gives (ADR 0076).
    """

    def run(params: dict[str, Any], ctx: TurnContext) -> ExecResult:
        if source is None:
            return ExecResult(ok=True, output=_dumps({"devices": [], "note": _UNWIRED}))
        try:
            devices = _ordered(source.fleet())
        except Exception as exc:
            return ExecResult.failure("engine_error", f"core.devices: the fleet: {exc}")
        budget = DEVICES_CAP - 120  # the wrapper and a note
        packed: list[DeviceVitals] = []
        used = 0
        for device in devices:
            size = len(_dumps(device)) + 1
            if packed and used + size > budget:
                break
            packed.append(device)
            used += size
        body: dict[str, Any] = {"devices": packed}
        if len(packed) < len(devices):
            footer = f"(showing {len(packed)} of {len(devices)})"
            body["note"] = f"{footer} devices; the rest did not fit"
            return ExecResult(ok=True, output=_dumps(body), shown=len(packed), total=len(devices))
        return ExecResult(ok=True, output=_dumps(body))

    return run


def _dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)

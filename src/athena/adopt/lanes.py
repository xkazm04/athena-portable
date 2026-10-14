"""ADR 0097 (research lanes): a bounded fan-out whose failures stay with the lane that had them.

Personas' ``run_lanes``, for the adopt studio. A *lane* is one piece of research — the public
rule, the person's mail, Athena's memory, a dropped document — and :func:`run_lanes` runs a batch
of them side by side:

- **Bounded.** At most ``max_parallel`` lanes run at once; the rest wait ``queued``.
- **Isolated.** A lane that raises, or runs past its timeout, is that lane's ``failed`` — never the
  session's and never its neighbours'. A lane past its timeout is abandoned, not waited for: its
  slot is freed at once, and whatever it produces later is dropped (it can no longer emit).
- **Ordered harvest.** Results come back in the order the tasks were given, whatever order they
  finished in, and one ``adopt.progress`` line says how the batch went: ``3 of 4 lanes done ·
  1 failed (rules: timeout)`` — the same words the desktop's ``harvestLine`` writes.
- **Cancelled with the session.** ``session.cancelled`` (DELETE, expiry, shutdown) stops the
  harvest at once; a lane that has not started never starts.

Every status change is one ``adopt.lane`` event (``queued -> running -> done | failed |
skipped``). A lane's findings that settle a slot go through ``session.apply_findings`` as
``guessed`` under the lane's source: research never confirms — only the person does.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable, Iterable, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Protocol

from athena.contracts.adopt import (
    AdoptEvent,
    Finding,
    Lane,
    LaneEvent,
    LaneKind,
    LaneStatus,
    Progress,
    Slot,
    SlotSource,
)

__all__ = [
    "DEFAULT_LANE_TIMEOUT_S",
    "MAX_PARALLEL",
    "POLL_S",
    "LaneOutcome",
    "LaneSession",
    "LaneTask",
    "harvest_line",
    "run_lanes",
]

MAX_PARALLEL = 4
#: A lane's whole budget when its task names none: one research leg (240 s) and a margin.
DEFAULT_LANE_TIMEOUT_S = 270.0
#: How often the harvest looks at the clock and at ``session.cancelled``.
POLL_S = 0.05

_SOURCE: dict[str, SlotSource] = {
    "rules": "research",
    "accounts": "account",
    "memory": "memory",
    "document": "document",
}


class LaneSession(Protocol):
    """What a lane batch needs of :class:`~athena.adopt.session.AdoptSession`."""

    cancelled: threading.Event

    def emit(self, event: AdoptEvent) -> AdoptEvent: ...

    def apply_findings(
        self, slot_updates: Iterable[Mapping[str, Any]], *, source: SlotSource = ...
    ) -> list[Slot]: ...

    def count(self, name: str) -> None: ...


@dataclass(frozen=True)
class LaneOutcome:
    """What one lane's body found. ``summary`` is one line for the tray; for a ``failed`` lane
    it is the reason (``timeout``), which the harvest line and the desktop quote. ``updates``
    are ``[{slot_id, value}]``; they are applied as ``guessed``, whatever they say."""

    status: LaneStatus = "done"
    summary: str = ""
    findings: tuple[Finding, ...] = ()
    updates: tuple[Mapping[str, Any], ...] = ()


LaneBody = Callable[[], LaneOutcome]


@dataclass(frozen=True)
class LaneTask:
    id: str
    kind: LaneKind
    title: str
    body: LaneBody
    #: ``None`` takes :func:`run_lanes`' ``timeout_s``.
    timeout_s: float | None = None


@dataclass
class _Slot:
    """One lane's state while the batch runs."""

    task: LaneTask
    lane: Lane
    started: float | None = None
    finished: bool = False
    done_event: threading.Event = field(default_factory=threading.Event)


def run_lanes(
    session: LaneSession,
    tasks: Sequence[LaneTask],
    *,
    max_parallel: int = MAX_PARALLEL,
    timeout_s: float = DEFAULT_LANE_TIMEOUT_S,
    clock: Callable[[], float] = time.monotonic,
) -> list[Lane]:
    """Run ``tasks`` at most ``max_parallel`` at a time; answer every lane, in input order.

    Blocks until every lane is settled or the session is cancelled (then the lanes not settled
    are answered as they stood). Never raises for a lane: a lane is the unit of failure.
    """
    if not tasks:
        return []
    lock = threading.Lock()
    slots = [
        _Slot(task, Lane(id=task.id, kind=task.kind, title=task.title, status="queued"))
        for task in tasks
    ]

    def settle(slot: _Slot, lane: Lane, outcome: LaneOutcome | None = None) -> None:
        """The lane's last word, once: the first of finishing and timing out wins."""
        with lock:
            if slot.finished:
                return
            slot.finished = True
            slot.lane = lane
        if outcome is not None and outcome.updates and lane.status == "done":
            guessed = [{**dict(u), "status": "guessed"} for u in outcome.updates]
            session.apply_findings(guessed, source=_SOURCE.get(lane.kind, "research"))
        session.emit(LaneEvent(lane=lane))
        slot.done_event.set()

    def run_one(slot: _Slot) -> None:
        if session.cancelled.is_set():
            settle(slot, _with(slot.lane, "skipped", "the session was closed"))
            return
        with lock:
            slot.started = clock()
            running = _with(slot.lane, "running", "")
            slot.lane = running
        session.emit(LaneEvent(lane=running))
        box: list[LaneOutcome | BaseException] = []

        def body() -> None:
            try:
                box.append(slot.task.body())
            except BaseException as exc:  # a lane's bug is its own failure
                box.append(exc)

        worker = threading.Thread(target=body, name=f"lane-{slot.task.id}", daemon=True)
        worker.start()
        limit = slot.task.timeout_s if slot.task.timeout_s is not None else timeout_s
        deadline = clock() + limit
        while worker.is_alive():
            if session.cancelled.is_set() or slot.finished:
                return
            worker.join(min(POLL_S, max(0.0, deadline - clock())))
            if worker.is_alive() and clock() >= deadline:
                session.count(f"lane_timeout:{slot.task.kind}")
                settle(slot, _with(slot.lane, "failed", "timeout"))
                return
        got = box[0] if box else RuntimeError("the lane returned nothing")
        if isinstance(got, BaseException):
            session.count(f"lane_failed:{slot.task.kind}")
            settle(slot, _with(slot.lane, "failed", f"error: {type(got).__name__}"))
            return
        settle(slot, _outcome_lane(slot.lane, got), got)

    for slot in slots:
        session.emit(LaneEvent(lane=slot.lane))
    pool = ThreadPoolExecutor(max_workers=max(1, max_parallel), thread_name_prefix="adopt-lanes")
    try:
        for slot in slots:
            pool.submit(run_one, slot)
        for slot in slots:
            while not slot.done_event.wait(POLL_S):
                if session.cancelled.is_set():
                    return [s.lane for s in slots]
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    lanes = [s.lane for s in slots]
    session.emit(Progress(text=harvest_line(lanes)))
    return lanes


def harvest_line(lanes: Sequence[Lane]) -> str:
    """``3 of 4 lanes done · 1 failed (rules: timeout)`` — the desktop's ``harvestLine``."""
    if not lanes:
        return ""
    done = sum(1 for lane in lanes if lane.status == "done")
    failed = [lane for lane in lanes if lane.status == "failed"]
    skipped = sum(1 for lane in lanes if lane.status == "skipped")
    noun = "lane" if len(lanes) == 1 else "lanes"
    parts = [f"{done} of {len(lanes)} {noun} done"]
    if failed:
        why = "; ".join(
            f"{lane.kind}: {lane.summary.strip() or 'no reason given'}" for lane in failed
        )
        parts.append(f"{len(failed)} failed ({why})")
    if skipped:
        parts.append(f"{skipped} skipped")
    return " · ".join(parts)


def _with(lane: Lane, status: LaneStatus, summary: str) -> Lane:
    return Lane(
        id=lane.id,
        kind=lane.kind,
        title=lane.title,
        status=status,
        summary=summary,
        findings=lane.findings,
    )


def _outcome_lane(lane: Lane, outcome: LaneOutcome) -> Lane:
    return Lane(
        id=lane.id,
        kind=lane.kind,
        title=lane.title,
        status=outcome.status,
        summary=outcome.summary,
        findings=tuple(outcome.findings),
    )

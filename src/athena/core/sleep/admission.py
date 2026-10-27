"""Whether a sleep cycle may start now: one owner, one ladder, every refusal named (ADR 0143).

Every trigger - the daemon's check thread, a person's "Sleep now" - asks
:class:`SleepAdmission`, and nothing else decides. The ladder is fixed, and the first step that
answers wins:

1. ``sleeping`` - a cycle already runs in this process (the claim);
2. ``turn_live`` - a turn or a delegated task runs on this PC;
3. ``recent_turn`` - the last turn ended less than :data:`QUIET_AFTER_TURN_S` ago;
4. ``no_room`` - RAM is past the gate's hold line (its own sentence). RAM alone: a busy CPU, a
   battery or a fullish disk never holds a cycle, whose heavy work is a model leg elsewhere;
5. ``floor`` - the last completed or partial cycle finished under :data:`FLOOR_H` hours ago;
6. ``failed_recently`` - a cycle failed under its backoff ago: :data:`FAILED_BACKOFF_H` for one
   failure, doubled for each further failure in a row since the last settled cycle, at most
   :data:`FAILED_BACKOFF_CAP_H` (ADR 0190). A ``running`` row is never counted;
7. ``too_little`` - under :data:`MIN_CHARS` characters wait;
8. admit ``pressure`` - :data:`PRESSURE_CHARS` or more wait;
9. admit ``first`` - no cycle has ever completed;
10. admit ``stale`` - the last completed one is :data:`STALE_H` hours old or more;
11. ``not_yet``.

A person's ``force`` skips 5 to 11 and admits ``forced``; it never skips 1 to 4, which are about
this PC's live work and its memory rather than about whether a cycle is worth it.

**The claim is taken, not checked.** :meth:`SleepAdmission.admit` takes the in-process claim as
its first act and runs the rest of the ladder holding it, so two triggers arriving together give
one admission and one ``sleeping``; a refusal further down gives the claim back before it answers.
:meth:`SleepAdmission.decide` runs the same ladder without taking anything, for a view.

**The floor keys on completion.** Steps 5, 9 and 10 read the newest *settled* cycle. A row a
crashed process left ``running`` is never read here, so one dead process cannot suppress every
cycle after it.

**The window is measured only when it is needed** - after steps 1 to 4 for :meth:`admit`, so a
live turn never pays for the walk - and the measured :class:`~athena.core.sleep.window.Window` is
returned with the verdict: the cycle reads the very read that admitted it.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from athena.core.sleep import (
    FLOOR_H,
    MIN_CHARS,
    PRESSURE_CHARS,
    QUIET_AFTER_TURN_S,
    STALE_H,
)
from athena.core.sleep.book import CycleRow, SleepBook
from athena.core.sleep.window import Boundary, Window
from athena.vitals import RoomPort

#: The refusals, in ladder order, and the admissions.
REFUSALS: tuple[str, ...] = (
    "sleeping",
    "turn_live",
    "recent_turn",
    "no_room",
    "floor",
    "failed_recently",
    "too_little",
    "not_yet",
)
ADMISSIONS: tuple[str, ...] = ("pressure", "first", "stale", "forced")


@dataclass(frozen=True)
class Verdict:
    """One answer of the ladder: ``reason`` is the code, ``text`` the sentence for a person."""

    admit: bool
    reason: str
    text: str

    def view(self) -> dict[str, Any]:
        return {"admit": self.admit, "reason": self.reason, "text": self.text}


class ClaimLease:
    """The claim, held. :meth:`release` gives it back once; a second call does nothing."""

    def __init__(self, lock: threading.Lock) -> None:
        self._lock = lock
        self._mutex = threading.Lock()
        self._released = False

    def release(self) -> None:
        with self._mutex:
            if self._released:
                return
            self._released = True
        self._lock.release()

    def __enter__(self) -> ClaimLease:
        return self

    def __exit__(self, *exc: object) -> None:
        self.release()


class SleepClaim:
    """The in-process single-flight claim. Held in memory, so process death releases it."""

    def __init__(self) -> None:
        self._lock = threading.Lock()

    def held(self) -> bool:
        return self._lock.locked()

    def try_take(self) -> ClaimLease | None:
        """Acquire-or-refuse as one act."""
        return ClaimLease(self._lock) if self._lock.acquire(blocking=False) else None


class TurnWatch(Protocol):
    """What admission asks of the daemon's per-conversation locks (``ThreadLocks``)."""

    def busy_any(self) -> bool: ...

    def last_released(self) -> float | None: ...


@dataclass(frozen=True)
class Admission:
    """What :meth:`SleepAdmission.admit` answers: the verdict, the window it measured (``None``
    when the ladder stopped before measuring), and the claim when admitted - the caller releases
    it when the cycle ends, however it ends."""

    verdict: Verdict
    window: Window | None
    lease: ClaimLease | None


class SleepAdmission:
    """The one owner of "may a cycle start now"."""

    def __init__(
        self,
        *,
        book: SleepBook,
        measure: Callable[[Boundary], Window],
        claim: SleepClaim,
        turns: TurnWatch | None = None,
        running_tasks: Callable[[], int] = lambda: 0,
        room: RoomPort | None = None,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self.book = book
        self.measure = measure
        self.claim = claim
        self.turns = turns
        self.running_tasks = running_tasks
        self.room = room
        self.clock = clock
        self.monotonic = monotonic

    def boundary(self) -> Boundary:
        """Where the next window starts: the last settled cycle's ``consumed_through``, else its
        ``started_at``, else :data:`~athena.core.sleep.FIRST_WINDOW_D` days ago."""
        return boundary_after(self.book.last_settled(), self.clock())

    def decide(self, force: bool = False) -> tuple[Verdict, Window]:
        """The ladder without the claim, and always a measured window: what a view shows."""
        window = self.measure(self.boundary())
        verdict = self._ladder(force, claimed=self.claim.held(), window=lambda: window)
        return verdict, window

    def admit(self, force: bool = False) -> Admission:
        """Take the claim, then run the ladder holding it; give it back on any refusal."""
        lease = self.claim.try_take()
        if lease is None:
            return Admission(_sleeping(), None, None)
        measured: list[Window] = []

        def window() -> Window:
            if not measured:
                measured.append(self.measure(self.boundary()))
            return measured[0]

        try:
            verdict = self._ladder(force, claimed=False, window=window)
        except BaseException:
            lease.release()
            raise
        if not verdict.admit:
            lease.release()
            return Admission(verdict, measured[0] if measured else None, None)
        return Admission(verdict, window(), lease)

    # -- the ladder -----------------------------------------------------------------------------

    def _ladder(self, force: bool, *, claimed: bool, window: Callable[[], Window]) -> Verdict:
        if claimed:
            return _sleeping()
        live = self._live()
        if live is not None:
            return live
        held = self._room()
        if held is not None:
            return held
        now = self.clock()
        if force:
            measured = window()
            return Verdict(
                True,
                "forced",
                f"Sleeping now, as asked, on {_chars(measured.pressure_chars)} characters.",
            )
        settled = self.book.last_settled()
        since = _hours_since(settled.finished_at if settled else None, now)
        if since is not None and since < FLOOR_H:
            # A stamp ahead of this clock (the clock was set back) still holds: never loosened.
            slept = (
                f"Slept {_ago(since)} ago"
                if since >= 0
                else f"The last cycle is stamped {_ago(-since)} ahead of this computer's clock"
            )
            return Verdict(
                False,
                "floor",
                f"{slept}; the next cycle is not before {FLOOR_H} h after one.",
            )
        failures = self.book.failures_since_settled()
        failed = failures.last
        failed_since = _hours_since(failed.finished_at if failed else None, now)
        backoff = failures.backoff_h
        if failed is not None and failed_since is not None and failed_since < backoff:
            if failures.count == 1:
                text = (
                    f"The last cycle failed {_ago(failed_since)} ago; trying again after "
                    f"{backoff} h."
                )
            else:
                cause = _CAUSES.get(str(failed.stats.get("failure") or ""), "it kept failing")
                text = (
                    f"The last cycle failed {_ago(failed_since)} ago, {failures.count} cycles in "
                    f"a row ({cause}); trying again after {backoff} h."
                )
            return Verdict(False, "failed_recently", text)
        measured = window()
        chars = measured.pressure_chars
        # A walk that stopped at its ceiling has not seen the whole window, so it cannot say
        # "too little": the cycle that drains it is what moves the boundary past the rows it saw.
        if measured.counted_all and chars < MIN_CHARS:
            return Verdict(
                False,
                "too_little",
                f"Only {_chars(chars)} characters wait; a cycle needs {_chars(MIN_CHARS)}.",
            )
        if chars >= PRESSURE_CHARS:
            return Verdict(
                True,
                "pressure",
                f"Enough has piled up: {_chars(chars)} of {_chars(PRESSURE_CHARS)} characters.",
            )
        if settled is None:
            return Verdict(True, "first", f"First sleep, on {_chars(chars)} characters.")
        if since is not None and since >= STALE_H:
            return Verdict(
                True,
                "stale",
                f"Last slept {_ago(since)} ago; a cycle runs at least every {STALE_H} h.",
            )
        return Verdict(
            False,
            "not_yet",
            f"{_chars(chars)} of {_chars(PRESSURE_CHARS)} characters wait; sleeping when they "
            f"reach it, or {STALE_H} h after the last cycle.",
        )

    def _live(self) -> Verdict | None:
        """Steps 2 and 3: a live turn or task, then the quiet spell after the last turn."""
        try:
            tasks = self.running_tasks()
        except Exception:
            tasks = 1  # a table that cannot be read is treated as busy: defer, never overlap
        if tasks > 0 or (self.turns is not None and self.turns.busy_any()):
            return Verdict(
                False, "turn_live", "Waiting: a conversation or a task is running on this PC."
            )
        ended = self.turns.last_released() if self.turns is not None else None
        if ended is not None:
            quiet = self.monotonic() - ended
            if quiet < QUIET_AFTER_TURN_S:
                return Verdict(
                    False,
                    "recent_turn",
                    f"Waiting for a quiet spell: a turn ended {int(quiet)} s ago "
                    f"({QUIET_AFTER_TURN_S} s are needed).",
                )
        return None

    def _room(self) -> Verdict | None:
        """Step 4, from the gate: RAM alone. No gate, or an unknown figure, holds nothing."""
        if self.room is None:
            return None
        held = self.room.held(sleep=True)
        return Verdict(False, "no_room", held) if held is not None else None


def boundary_after(settled: CycleRow | None, now: datetime) -> Boundary:
    """The boundary a window starts at, given the newest settled cycle."""
    if settled is not None:
        if settled.consumed_through:
            return Boundary.decode(settled.consumed_through)
        return Boundary(settled.started_at)
    return Boundary.first(now)


#: Why cycles kept failing, by the leg's failure class, for the sentence of a run of them.
_CAUSES = {
    "timeout": "the step took too long",
    "parse_error": "its answer could not be read",
    "engine_error": "the model could not be run",
}


def _sleeping() -> Verdict:
    return Verdict(False, "sleeping", "Already sleeping: one cycle runs at a time.")


def _hours_since(stamp: str | None, now: datetime) -> float | None:
    if not stamp:
        return None
    try:
        then = datetime.fromisoformat(stamp)
    except ValueError:
        return None
    if then.tzinfo is None:
        then = then.replace(tzinfo=UTC)
    return (now - then) / timedelta(hours=1)


def _ago(hours: float) -> str:
    if hours < 1:
        return f"{max(1, int(hours * 60))} min"
    return f"{int(hours)} h"


def _chars(n: int) -> str:
    return f"{n:,}"

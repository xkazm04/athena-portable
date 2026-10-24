"""The sleep cycle, hosted by the daemon: its routes and its check thread (ADR 0143).

:class:`SleepService` is the one object the wiring builds. It owns the claim, the admission and
the episode reader for this daemon's brain, and it is the only thing that starts a cycle - from
its check thread every :data:`~athena.core.sleep.CHECK_EVERY_S`, or from ``POST /sleep/run``.
Both ask the same :class:`~athena.core.sleep.admission.SleepAdmission`.

Routes (``lib/sleep.ts`` reads them):

- ``GET /sleep`` -> ``{"sleep": SleepView}``: state, phase, pressure and threshold, the episodes
  waiting, the admission verdict now, the newest cycle and how many proposals are open;
- ``GET /sleep/cycles?limit=20`` -> ``{"cycles": [CycleView]}``, newest first;
- ``GET /sleep/cycles/<id>`` -> ``{"cycle": CycleView, "journal": str | null}``;
- ``GET /sleep/proposals`` -> ``{"proposals": [ProposalView]}``, the open ones first;
- ``POST /sleep/run {"force": bool}`` -> ``{"admitted", "reason", "text", "cycle_id"}``. A refusal
  is an answer, not an error (200): "not admitted: a turn is live" is a fact a person reads;
- ``POST /sleep/proposals/<id> {"action": "keep"|"forget", "node_id": str|null}`` ->
  ``{"proposal": ProposalView}``.

**A cycle runs off the request.** An admitted ``POST /sleep/run`` writes the ``running`` row,
answers with its id, and runs the cycle on a thread of its own; the claim taken at admission goes
with it and is released when the cycle ends, however it ends. The check thread runs an admitted
cycle on itself, so it never admits a second while one runs.

**Every change is said once on the bus:** ``sleep.changed`` at a cycle's start, at each phase, at
its end, and when a proposal is decided or a sweep closes some. The windows re-read the routes.

**Refusals from the scheduler are kept, not journalled.** The last verdict the check thread got is
held in memory (:attr:`SleepService.last_verdict`); a journal of every "not yet" would bury the
cycles that ran.
"""

from __future__ import annotations

import sqlite3
import sys
import threading
import time
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal

from athena.contracts import ids
from athena.contracts.channel import iso
from athena.core.brain import frontmatter
from athena.core.brain.store import Brain
from athena.core.sleep import CHECK_EVERY_S, PRESSURE_CHARS
from athena.core.sleep.admission import (
    Admission,
    ClaimLease,
    SleepAdmission,
    SleepClaim,
    TurnWatch,
    Verdict,
)
from athena.core.sleep.book import SleepBook
from athena.core.sleep.cycle import SleepCycle
from athena.core.sleep.legs import LegDoor
from athena.core.sleep.proposals import ProposalRefused, decide
from athena.core.sleep.window import Boundary, EpisodeReader, Window
from athena.daemon.routes import Reply, Request, Route, bounded, error
from athena.vitals import RoomPort, SleepSummary

if TYPE_CHECKING:
    from athena.adopt.legs import LedgerSink
    from athena.daemon.tasks import Tasks

SLEEP_PATH = "/sleep"
CYCLES_PATH = "/sleep/cycles"
CYCLE_PREFIX = "/sleep/cycles/"
PROPOSALS_PATH = "/sleep/proposals"
PROPOSAL_PREFIX = "/sleep/proposals/"
RUN_PATH = "/sleep/run"
#: The bus kind every change is published under.
CHANGED = "sleep.changed"
CYCLES_DEFAULT = 20

SleepState = Literal["never", "idle", "sleeping", "failed"]


def sleep_runner(root: Path, ledger: LedgerSink | None) -> LegDoor:
    """The production leg door: the adopt studio's :class:`~athena.adopt.legs.LegRunner`, its
    prompts under ``root / "prompts"``, one row per leg in ``ledger``. A tiers file that will not
    load leaves no tier, and each leg then fails the cycle with that said on its row."""
    from athena.adopt.legs import LegRunner, load_tiers

    try:
        tiers = load_tiers()
    except (OSError, ValueError):
        tiers = {}
    return LegRunner(ledger=ledger, tiers=tiers, prompt_dir=root / "prompts")


def _thread(fn: Callable[[], None]) -> None:
    threading.Thread(target=fn, name="athena-sleep-cycle", daemon=True).start()


class SleepService:
    """This PC's sleep cycle: admission, the cycles it runs, the routes and the check thread."""

    def __init__(
        self,
        *,
        brain: Brain,
        room: RoomPort | None,
        runner: LegDoor,
        threads: TurnWatch | None,
        tasks: Tasks | None,
        device_id: Callable[[], str | None],
        publish: Callable[..., None] | None = None,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        monotonic: Callable[[], float] = time.monotonic,
        spawn: Callable[[Callable[[], None]], None] = _thread,
    ) -> None:
        self.brain = brain
        self.runner = runner
        self.tasks = tasks
        self.publish = publish
        self.clock = clock
        self.spawn = spawn
        self.book = SleepBook(brain)
        self.claim = SleepClaim()
        self.reader = EpisodeReader(brain, device_id)
        self.admission = SleepAdmission(
            book=self.book,
            measure=self._measure,
            claim=self.claim,
            turns=threads,
            running_tasks=self._running_tasks,
            room=room,
            clock=clock,
            monotonic=monotonic,
        )
        #: The last verdict the check thread was given, refusals included.
        self.last_verdict: Verdict | None = None
        self._guard = threading.Lock()
        self._window: Window | None = None
        self._phase: str | None = None
        self._current: str | None = None
        self._generation = 0
        self._wake = threading.Event()
        self._thread: threading.Thread | None = None

    # -- what other packages read ---------------------------------------------------------------

    def running(self) -> bool:
        """Whether a cycle runs in this process now (the vitals gate charges it one task slot)."""
        return self.claim.held()

    def summary(self) -> SleepSummary | None:
        """The vitals line: state, when it last slept, pressure over threshold. ``None`` before the
        first measurement, or when the index cannot be read - never a made-up zero."""
        with self._guard:
            window = self._window
        if window is None:
            return None
        try:
            state = self._state()
            settled = self.book.last_settled()
        except sqlite3.Error:
            return None
        return {
            "state": state,
            "last_at": settled.finished_at if settled else None,
            "pressure": round(window.pressure_chars / PRESSURE_CHARS, 3),
        }

    def view(self) -> dict[str, Any]:
        """``SleepView``, measured now."""
        verdict, window = self.admission.decide(False)
        last = self.book.latest()
        with self._guard:
            phase = self._phase
        return {
            "state": self._state(),
            "phase": phase,
            "pressure_chars": window.pressure_chars,
            "threshold_chars": PRESSURE_CHARS,
            "episodes_waiting": window.episodes_available,
            "verdict": verdict.view(),
            "last": last.view() if last else None,
            "open_proposals": self.book.open_count(),
        }

    # -- starting a cycle -----------------------------------------------------------------------

    def run(self, force: bool = False) -> dict[str, Any]:
        """A person's "Sleep now": admit, and run an admitted cycle off the request."""
        admission = self.admission.admit(force)
        if admission.lease is None or admission.window is None:
            return _answer(admission.verdict, None)
        cycle_id = self._begin(admission)
        lease, window = admission.lease, admission.window

        def work() -> None:
            self._cycle(cycle_id, window, admission.verdict.reason, lease)

        try:
            self.spawn(work)
        except BaseException:
            lease.release()
            self.book.finish(
                cycle_id,
                status="failed",
                finished_at=iso(self.clock()),
                stats={},
                reason="The cycle could not be started on a thread of its own.",
            )
            self._changed()
            raise
        return _answer(admission.verdict, cycle_id)

    def check(self) -> Verdict:
        """One tick of the check thread: sweep the proposals, ask admission, run what it admits."""
        expired, dismissed = self.book.sweep(self.clock())
        if expired or dismissed:
            self._changed()
        admission = self.admission.admit(False)
        self.last_verdict = admission.verdict
        if admission.lease is not None and admission.window is not None:
            cycle_id = self._begin(admission)
            self._cycle(cycle_id, admission.window, admission.verdict.reason, admission.lease)
        return admission.verdict

    def _begin(self, admission: Admission) -> str:
        """The ``running`` row for an admitted cycle. A row that cannot be written gives the claim
        back before the error leaves."""
        assert admission.lease is not None and admission.window is not None
        cycle_id = ids.mint("cycle")
        try:
            self.book.begin(
                cycle_id,
                started_at=iso(self.clock()),
                reason=admission.verdict.reason,
                boundary=admission.window.boundary.encode(),
            )
        except BaseException:
            admission.lease.release()
            raise
        with self._guard:
            self._current = cycle_id
        self._changed()
        return cycle_id

    def _cycle(self, cycle_id: str, window: Window, reason: str, lease: ClaimLease) -> None:
        """Run one cycle and give the claim back, however it ends."""
        try:
            SleepCycle(
                brain=self.brain,
                book=self.book,
                door=self.runner,
                clock=self.clock,
                on_phase=self._on_phase,
            ).run(cycle_id, window, reason)
        finally:
            with self._guard:
                self._current = None
                self._phase = None
            lease.release()
            self._changed()

    def _on_phase(self, phase: str | None) -> None:
        with self._guard:
            self._phase = phase
        if phase is not None:
            self._changed()

    # -- the check thread -----------------------------------------------------------------------

    def start(self, interval_s: float = CHECK_EVERY_S) -> None:
        """Measure once, then :meth:`check` every ``interval_s`` on a daemon thread. A second start
        while one runs is a no-op; :meth:`stop` retires the loop."""
        with self._guard:
            if self._thread is not None and self._thread.is_alive():
                return
            self._generation += 1
            self._wake = threading.Event()
            thread = threading.Thread(
                target=self._loop,
                args=(self._generation, interval_s, self._wake),
                name="athena-sleep",
                daemon=True,
            )
            self._thread = thread
        thread.start()

    def stop(self) -> None:
        with self._guard:
            self._generation += 1
            self._wake.set()
            self._thread = None

    def _loop(self, generation: int, interval_s: float, wake: threading.Event) -> None:
        try:
            # The vitals line has a pressure from the start; no cycle runs at start-up.
            self._measure(self.admission.boundary())
        except Exception as exc:  # a locked index is a line, never a dead loop
            print(f"[sleep] measure failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        while generation == self._generation:
            if wake.wait(interval_s):
                return
            try:
                self.check()
            except Exception as exc:
                print(f"[sleep] check failed: {type(exc).__name__}: {exc}", file=sys.stderr)

    # -- plumbing -------------------------------------------------------------------------------

    def _measure(self, boundary: Boundary) -> Window:
        window = self.reader.read(boundary)
        with self._guard:
            self._window = window
        return window

    def _running_tasks(self) -> int:
        if self.tasks is None:
            return 0
        _, running, _ = self.tasks.listing()
        return running

    def _state(self) -> SleepState:
        if self.claim.held():
            return "sleeping"
        last = self.book.last_finished()
        if last is None:
            return "never"
        return "failed" if last.status == "failed" else "idle"

    def _changed(self) -> None:
        """``sleep.changed`` on the bus. Publishing never fails what it reports."""
        if self.publish is None:
            return
        with self._guard:
            phase, current = self._phase, self._current
        try:
            self.publish(CHANGED, state=self._state(), phase=phase, cycle_id=current)
        except Exception as exc:
            print(f"[sleep] publish failed: {type(exc).__name__}: {exc}", file=sys.stderr)

    # -- routes -----------------------------------------------------------------------------------

    def journal(self, cycle_id: str) -> str | None:
        """A cycle's journal body, or ``None`` when it left none (it failed, or still runs)."""
        if not ids.is_id("cycle", cycle_id):
            return None
        for path in sorted((self.brain.root / "cycles").glob(f"*-{cycle_id}.md")):
            try:
                _, body = frontmatter.parse(path.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError):
                return None
            return body.strip()
        return None

    def routes(self) -> list[Route]:
        """Every ``/sleep`` route, exact paths before their prefixes."""
        return [
            Route("GET", SLEEP_PATH, lambda request: (200, {"ok": True, "sleep": self.view()})),
            Route("GET", CYCLES_PATH, self._cycles),
            Route("GET", PROPOSALS_PATH, self._proposals),
            Route("POST", RUN_PATH, self._run),
            Route("GET", CYCLE_PREFIX, self._cycle_route, prefix=True),
            Route("POST", PROPOSAL_PREFIX, self._decide_route, prefix=True),
        ]

    def _cycles(self, request: Request) -> Reply:
        limit = bounded(request.query.get("limit"), CYCLES_DEFAULT)
        return 200, {"ok": True, "cycles": [row.view() for row in self.book.cycles(limit)]}

    def _cycle_route(self, request: Request) -> Reply:
        cycle_id = request.path[len(CYCLE_PREFIX) :]
        row = self.book.get(cycle_id) if ids.is_id("cycle", cycle_id) else None
        if row is None:
            return error(404, "unknown_ref", f"no cycle {cycle_id!r}")
        return 200, {"ok": True, "cycle": row.view(), "journal": self.journal(cycle_id)}

    def _proposals(self, request: Request) -> Reply:
        return 200, {"ok": True, "proposals": [row.view() for row in self.book.proposals()]}

    def _run(self, request: Request) -> Reply:
        force = request.body.get("force", False)
        if not isinstance(force, bool):
            return error(400, "validator_failed", "force must be true or false")
        return 200, {"ok": True, **self.run(force)}

    def _decide_route(self, request: Request) -> Reply:
        proposal_id = request.path[len(PROPOSAL_PREFIX) :]
        if not ids.is_id("proposal", proposal_id):
            return error(404, "unknown_ref", f"no proposal {proposal_id!r}")
        action = request.body.get("action")
        node_id = request.body.get("node_id")
        if not isinstance(action, str):
            return error(400, "validator_failed", "action must be keep or forget")
        if node_id is not None and not isinstance(node_id, str):
            return error(400, "validator_failed", "node_id must be a string or null")
        try:
            row = decide(self.brain, self.book, proposal_id, action, node_id, clock=self.clock)
        except ProposalRefused as exc:
            return error(exc.status, exc.reason, str(exc))
        self._changed()
        return 200, {"ok": True, "proposal": row.view()}


def _answer(verdict: Verdict, cycle_id: str | None) -> dict[str, Any]:
    return {
        "admitted": verdict.admit and cycle_id is not None,
        "reason": verdict.reason,
        "text": verdict.text,
        "cycle_id": cycle_id,
    }

"""ADR 0097 (in-memory sessions, studio outside the turn lock): one adopt session and the store.

An adopt session is a conversation about one playbook, held in daemon memory and nowhere else:
its slots, the cards asked and the answers given, the briefs drafted, and one append-only log of
``adopt.*`` events with a monotonically increasing ``seq``. A reconnecting surface asks for
everything after the last ``seq`` it saw and then follows the log live.

**Outside the turn lock.** Nothing here takes ``daemon.writing()``. A session has its own lock for
its own state and its own single worker thread (the *actor*) that runs its rounds one at a time,
so an answer that arrives mid-round waits for that round and never for a chat turn, and a chat
turn never waits for it.

**Bounded.** At most :data:`MAX_LIVE` live sessions (a fourth is refused ``busy``), each expiring
after :data:`TTL_S` idle; a reaper thread closes the expired ones. Closing kills the warm CLI
process, tells the research lanes (``on_close``), deletes the session's temp directory (where
dropped documents were kept), and ends every event stream.

**Hooks.** The research lanes and the showcase (WP2) are not this module's. They plug in through
:func:`register_hooks` — ``on_start``, ``on_answer``, ``on_document``, ``on_approve``,
``on_close`` — and touch a session only through :meth:`AdoptSession.emit`,
:meth:`AdoptSession.apply_findings` and :meth:`AdoptSession.run_leg`. A hook runs on the session's
actor and must return quickly; long work belongs on the hook's own thread. A hook that raises is
an ``adopt.error`` and the session goes on.
"""

from __future__ import annotations

import shutil
import threading
import time
from collections.abc import Callable, Iterable, Mapping, Sequence
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

from athena.adopt.cases import case_brief, reopen_slots
from athena.adopt.legs import LegResult, LegRunner, WarmSession
from athena.adopt.slots import MAX_SLOTS, apply_updates, load_playbook_json, mechanical_slots
from athena.contracts.adopt import (
    AdoptEvent,
    Brief,
    Case,
    CaseSlot,
    Error,
    LegKind,
    Question,
    Slot,
    Slots,
    SlotSource,
    Tier,
    Usage,
    Verdict,
)
from athena.contracts.harness import ERROR_REASONS
from athena.contracts.ids import mint

__all__ = [
    "ADOPT_ERROR_REASONS",
    "MAX_LIVE",
    "REAP_INTERVAL_S",
    "SESSION_CLOSED",
    "TTL_S",
    "AdoptSession",
    "Busy",
    "Hooks",
    "IntakeSession",
    "SessionStore",
    "current_hooks",
    "register_hooks",
    "reset_hooks",
]

MAX_LIVE = 3

#: The last event of every session (Director decision, ADR 0097): ``adopt.error`` with this
#: reason is appended before the streams close, so a surface stops reconnecting on it rather
#: than treating a clean close as a dropped connection.
SESSION_CLOSED = "session_closed"

#: Every ``reason`` an ``adopt.error`` may carry: the closed vocabulary of
#: ``contracts.harness.ERROR_REASONS`` plus the one that ends a session.
ADOPT_ERROR_REASONS: tuple[str, ...] = (*ERROR_REASONS, SESSION_CLOSED)
TTL_S = 2 * 60 * 60.0
REAP_INTERVAL_S = 60.0


# --- hooks --------------------------------------------------------------------------------------

SessionHook = Callable[["AdoptSession"], None]
DocumentHook = Callable[["AdoptSession", str, Path], None]
ApproveHook = Callable[["AdoptSession", int], None]


def _noop_session(session: AdoptSession) -> None:
    return None


def _noop_document(session: AdoptSession, doc_id: str, path: Path) -> None:
    return None


def _noop_approve(session: AdoptSession, rev: int) -> None:
    return None


@dataclass
class Hooks:
    """What the research lanes and the showcase are told. Every default does nothing."""

    on_start: SessionHook = _noop_session
    on_answer: SessionHook = _noop_session
    on_document: DocumentHook = _noop_document
    on_approve: ApproveHook = _noop_approve
    on_close: SessionHook = _noop_session


_HOOKS = Hooks()


def register_hooks(
    *,
    on_start: SessionHook | None = None,
    on_answer: SessionHook | None = None,
    on_document: DocumentHook | None = None,
    on_approve: ApproveHook | None = None,
    on_close: SessionHook | None = None,
) -> Hooks:
    """Install the process-wide hooks; a ``None`` argument leaves that hook as it was.

    A session reads the hooks when it is created (:func:`current_hooks`), so registering after a
    session started does not change that session.
    """
    if on_start is not None:
        _HOOKS.on_start = on_start
    if on_answer is not None:
        _HOOKS.on_answer = on_answer
    if on_document is not None:
        _HOOKS.on_document = on_document
    if on_approve is not None:
        _HOOKS.on_approve = on_approve
    if on_close is not None:
        _HOOKS.on_close = on_close
    return current_hooks()


def current_hooks() -> Hooks:
    """A copy of the registered hooks."""
    return replace(_HOOKS)


def reset_hooks() -> None:
    """Every hook back to a no-op (tests)."""
    register_hooks(
        on_start=_noop_session,
        on_answer=_noop_session,
        on_document=_noop_document,
        on_approve=_noop_approve,
        on_close=_noop_session,
    )


# --- one session --------------------------------------------------------------------------------


class Busy(RuntimeError):
    """:data:`MAX_LIVE` sessions are live."""


@dataclass(frozen=True)
class AskedQuestion:
    """A question as asked, and the round it was asked in."""

    round: int
    question: Question


@dataclass(frozen=True)
class GivenAnswer:
    """One answer as recorded: the question, the labels of the chosen options, the free text."""

    round: int
    question_id: str
    question: str
    slot_ids: tuple[str, ...]
    choices: tuple[str, ...]
    text: str
    via: str


#: The question an answer stands under when the person said it without being asked: in the
#: first message (``POST /adopt`` ``intro``) or typed beside a card (``question_id`` ``""``).
UP_FRONT = "(said up front, before any card)"
UNASKED = "(said on their own, not to a question)"


@dataclass(eq=False)
class AdoptSession:
    """One adopt conversation. Thread-safe; every mutation is under :attr:`lock`."""

    id: str
    playbook_id: str
    playbook: dict[str, Any]
    temp_dir: Path
    runner: LegRunner
    hooks: Hooks = field(default_factory=current_hooks)
    clock: Callable[[], float] = time.monotonic

    def __post_init__(self) -> None:
        self.lock = threading.RLock()
        self._cond = threading.Condition(self.lock)
        self._events: list[AdoptEvent] = []
        self._slots: list[Slot] = mechanical_slots(self.playbook)
        self.asked: dict[str, AskedQuestion] = {}
        self.answers: list[GivenAnswer] = []
        #: The card that is waiting for answers (round number), 0 when none is.
        self.round = 0
        #: Cards emitted so far; the next card is ``cards + 1`` (at most ``MAX_ROUNDS``).
        self.cards = 0
        #: Answer posts received.
        self.rounds_done = 0
        self.rev = 0
        self.brief: Brief | None = None
        #: An answer arrived after the brief: the brief at ``rev`` may no longer be approved.
        self.brief_stale = False
        self.approved_rev: int | None = None
        self.docs: dict[str, Path] = {}
        #: Things worth counting that are not events: malformed legs, failed hooks.
        self.counters: dict[str, int] = {}
        self.closed = False
        self._closing = False
        #: Set on close; a lane polls it to stop early.
        self.cancelled = threading.Event()
        self.last_active = self.clock()
        self.warm: WarmSession | None = None
        #: The standing case this session belongs to (ADR 0123): ``""`` until the first approval
        #: mints one, or the reopened case's id from the start.
        self.case_id = ""
        #: The case as last written or as reopened; ``None`` for a fresh conversation.
        self.case: Case | None = None
        #: Per slot id, what the case remembers of it (date, words, fact) for the next save.
        self.slot_meta: dict[str, CaseSlot] = {}
        #: The slots a reopen turned back into guesses: dates and amounts (ADR 0123).
        self.reopened: tuple[str, ...] = ()
        #: Held by a save, so two approvals of one session never mint two cases.
        self.case_lock = threading.Lock()
        self._actor = ThreadPoolExecutor(max_workers=1, thread_name_prefix=f"adopt-{self.id}")

    # -- the event log ---------------------------------------------------------------------------

    def emit(self, event: AdoptEvent) -> AdoptEvent:
        """Append ``event`` with the next ``seq`` and wake every follower. After close, a no-op
        that still answers the event (with ``seq`` 0): a lane finishing late must not raise."""
        with self._cond:
            if self.closed:
                return event
            stamped = replace(event, seq=len(self._events) + 1)
            self._events.append(stamped)
            self._cond.notify_all()
            return stamped

    @property
    def seq(self) -> int:
        with self.lock:
            return len(self._events)

    def events_after(self, after: int) -> list[AdoptEvent]:
        with self.lock:
            return list(self._events[max(0, after) :])

    def wait_after(self, after: int, timeout: float) -> bool:
        """Block until an event past ``after`` exists or the session closed; ``False`` on time."""
        with self._cond:
            return self._cond.wait_for(
                lambda: self.closed or len(self._events) > after, timeout=timeout
            )

    # -- slots -----------------------------------------------------------------------------------

    @property
    def slots(self) -> list[Slot]:
        with self.lock:
            return list(self._slots)

    def set_slots(self, slots: Sequence[Slot]) -> None:
        """Replace the slots and emit ``adopt.slots`` when anything changed."""
        with self.lock:
            if list(slots) == self._slots:
                return
            self._slots = list(slots)
            self.emit(Slots(slots=tuple(self._slots)))

    def apply_findings(
        self, slot_updates: Iterable[Mapping[str, Any]], *, source: SlotSource = "research"
    ) -> list[Slot]:
        """Research, memory, a document or an account filled slots: ``[{slot_id, value,
        status}]`` (status ``guessed`` by default, or ``confirmed``). Never overrides what the
        person confirmed. Emits ``adopt.slots`` when anything changed; answers the slots."""
        with self.lock:
            updated, changed = apply_updates(self._slots, list(slot_updates), source=source)
            if changed:
                self.set_slots(updated)
            return list(self._slots)

    # -- legs ------------------------------------------------------------------------------------

    @property
    def conversation(self) -> str:
        """The ledger's conversation column for this session's legs."""
        return f"conv_{self.id}"

    def run_leg(
        self,
        kind: LegKind,
        system: str,
        prompt: str,
        *,
        json_schema: Mapping[str, Any] | None = None,
        tier: Tier | None = None,
        check: Callable[[dict[str, Any]], str] | None = None,
        allowed_tools: Sequence[str] = (),
        add_dirs: Sequence[str] = (),
        timeout_s: float | None = None,
        warm: bool = False,
    ) -> LegResult:
        """:meth:`LegRunner.run_leg` for this session: run in its temp dir, ledgered under its
        conversation, one ``adopt.usage`` per invocation, and the warm process when ``warm``
        (the interviewer's) is asked for."""
        session = self.warm if warm else None
        return self.runner.run_leg(
            kind,
            system,
            prompt,
            json_schema=json_schema,
            tier=tier,
            session=session,
            check=check,
            allowed_tools=allowed_tools,
            add_dirs=add_dirs,
            cwd=str(self.temp_dir),
            conversation=self.conversation,
            on_usage=self._usage,
            timeout_s=timeout_s,
        )

    def _usage(self, result: LegResult) -> None:
        self.emit(
            Usage(
                leg=result.kind,
                model=result.model,
                effort=result.effort,
                ms=result.ms,
                first_text_ms=result.first_text_ms,
            )
        )

    def count(self, name: str) -> None:
        with self.lock:
            self.counters[name] = self.counters.get(name, 0) + 1

    # -- the actor -------------------------------------------------------------------------------

    def submit(self, fn: Callable[[], None]) -> Future[None]:
        """Run ``fn`` on this session's one worker, after whatever it is already running."""

        def guarded() -> None:
            if self.closed:
                return
            try:
                fn()
            except Exception as exc:  # a loop bug is an event, never a dead actor
                self.count("loop_failed")
                detail = f"the studio failed: {type(exc).__name__}"
                self.emit(Error(reason="unknown", detail=detail))

        try:
            return self._actor.submit(guarded)
        except RuntimeError:  # shut down by close(); nothing more runs
            done: Future[None] = Future()
            done.set_result(None)
            return done

    def drain(self, timeout: float = 10.0) -> None:
        """Wait until the actor has run everything submitted so far (tests, shutdown)."""
        self.submit(lambda: None).result(timeout=timeout)

    def call_hook(self, name: str, *args: Any) -> None:
        hook = getattr(self.hooks, name)
        try:
            hook(self, *args)
        except Exception as exc:
            self.count(f"hook_failed:{name}")
            self.emit(Error(reason="unknown", detail=f"{name} failed: {type(exc).__name__}"))

    # -- lifecycle -------------------------------------------------------------------------------

    def touch(self) -> None:
        with self.lock:
            self.last_active = self.clock()

    def idle_s(self) -> float:
        with self.lock:
            return self.clock() - self.last_active

    def close(self, why: str = "the session was closed") -> None:
        """End the session: lanes told, ``adopt.error {session_closed, why}`` appended as the
        last event, warm process killed, temp dir deleted, streams ended."""
        with self._cond:
            if self._closing:
                return
            self._closing = True
        self.cancelled.set()
        self.call_hook("on_close")
        self.emit(Error(reason=SESSION_CLOSED, detail=why))
        with self._cond:
            self.closed = True
            self._cond.notify_all()
        if self.warm is not None:
            self.warm.close()
        self._actor.shutdown(wait=False, cancel_futures=True)
        shutil.rmtree(self.temp_dir, ignore_errors=True)


@dataclass(eq=False)
class IntakeSession(AdoptSession):
    """The Chores front door's conversation (ADR 0098): an adopt session with no playbook.

    It is the same machine (event log, SSE, one actor, warm process, idle expiry, ledgered
    legs, a place in :data:`MAX_LIVE`); it has no slots and its hooks are the no-ops, so no
    research lane ever starts for it. What it adds is the state of its three rounds.
    """

    #: ``() -> [{id, title, area, job, summary}]``: the library as the model is told of it.
    library: Callable[[], list[dict[str, str]]] = field(default=lambda: [])

    def __post_init__(self) -> None:
        super().__post_init__()
        #: Model rounds started (not retries): the third is always asked for a verdict.
        self.legs = 0
        #: The verdict emitted, once; the session idles after it.
        self.verdict: Verdict | None = None
        self._library: list[dict[str, str]] | None = None

    def library_rows(self) -> list[dict[str, str]]:
        """The library summary, read once per session."""
        with self.lock:
            if self._library is None:
                self._library = self.library()
            return self._library


# --- reopening a case (ADR 0123) ----------------------------------------------------------------


def reopen(session: AdoptSession, case: Case) -> None:
    """Hand ``session`` the standing ``case``: its id, its slots (dates and amounts back to
    guesses), its approved brief as the current draft at the same rev, and the person's own words
    for every slot that carried over confirmed, so the auditor reads why each one stands."""
    slots, reopened = reopen_slots(session.slots, case)
    with session.lock:
        session.case_id = case.id
        session.case = case
        session.slot_meta = {s.id: s for s in case.slots}
        session.reopened = tuple(reopened)
        session._slots = slots[:MAX_SLOTS]
        session.rev = case.approved_rev
        session.brief = case_brief(case, session._slots)
        for slot in session._slots:
            held = session.slot_meta.get(slot.id)
            if slot.status != "confirmed" or held is None or not held.quote:
                continue
            when = held.confirmed_at[:10] or "an earlier approval"
            session.answers.append(
                GivenAnswer(
                    round=0,
                    question_id="",
                    question=f"(from your saved case, confirmed {when}) {slot.label}",
                    slot_ids=(slot.id,),
                    choices=(),
                    text=held.quote,
                    via="memory",
                )
            )


# --- the store ----------------------------------------------------------------------------------


@dataclass
class SessionStore:
    """The live sessions: at most :attr:`max_live`, each expiring after :attr:`ttl_s` idle."""

    root: Path
    runner: LegRunner
    max_live: int = MAX_LIVE
    ttl_s: float = TTL_S
    reap_interval_s: float = REAP_INTERVAL_S
    clock: Callable[[], float] = time.monotonic
    hooks: Callable[[], Hooks] = current_hooks
    #: ``playbook_id -> playbook.json``; the library by default (tests pass a fixture).
    load_playbook: Callable[[str], dict[str, Any]] = load_playbook_json

    def __post_init__(self) -> None:
        self._lock = threading.Lock()
        self._sessions: dict[str, AdoptSession] = {}
        self._reaper: threading.Thread | None = None
        self._stop = threading.Event()
        self._swept = False

    def create(self, playbook_id: str, intro: str = "", case: Case | None = None) -> AdoptSession:
        """A new session, or :class:`Busy`, or :class:`~athena.adopt.slots.PlaybookMissing`.

        ``intro`` is what the person said before the first card; it is kept as an answer to no
        question (round 0), so the first audit and the first card both read it. ``case`` reopens
        a standing case (ADR 0123): its slots, its words and its approved brief are the session's
        from the start (:func:`reopen`)."""
        playbook = self.load_playbook(playbook_id)
        self.reap()
        with self._lock:
            if len(self._sessions) >= self.max_live:
                raise Busy(f"{len(self._sessions)} adopt sessions are live; close one first")
            self._sweep_leftovers()
            sid = mint("session")
            temp_dir = self.root / sid
            temp_dir.mkdir(parents=True, exist_ok=True)
            session = AdoptSession(
                id=sid,
                playbook_id=playbook_id,
                playbook=playbook,
                temp_dir=temp_dir,
                runner=self.runner,
                hooks=self.hooks(),
                clock=self.clock,
            )
            if case is not None:
                reopen(session, case)
            if intro.strip():
                session.answers.append(
                    GivenAnswer(
                        round=0,
                        question_id="",
                        question=UP_FRONT,
                        slot_ids=(),
                        choices=(),
                        text=intro.strip(),
                        via="text",
                    )
                )
            self._sessions[sid] = session
            self._start_reaper()
        return session

    def create_intake(
        self, need: str, library: Callable[[], list[dict[str, str]]]
    ) -> IntakeSession:
        """A new intake session (no playbook), or :class:`Busy`: it takes one of the same
        :attr:`max_live` places an adopt session does. ``need`` is kept as the person's first
        words (round 0)."""
        self.reap()
        with self._lock:
            if len(self._sessions) >= self.max_live:
                raise Busy(f"{len(self._sessions)} adopt sessions are live; close one first")
            self._sweep_leftovers()
            sid = mint("session")
            temp_dir = self.root / sid
            temp_dir.mkdir(parents=True, exist_ok=True)
            session = IntakeSession(
                id=sid,
                playbook_id="",
                playbook={},
                temp_dir=temp_dir,
                runner=self.runner,
                hooks=Hooks(),
                clock=self.clock,
                library=library,
            )
            if need.strip():
                session.answers.append(
                    GivenAnswer(
                        round=0,
                        question_id="",
                        question=UP_FRONT,
                        slot_ids=(),
                        choices=(),
                        text=need.strip(),
                        via="text",
                    )
                )
            self._sessions[sid] = session
            self._start_reaper()
        return session

    def get(self, sid: str) -> AdoptSession | None:
        with self._lock:
            return self._sessions.get(sid)

    def live(self) -> list[AdoptSession]:
        with self._lock:
            return list(self._sessions.values())

    def delete(self, sid: str) -> bool:
        with self._lock:
            session = self._sessions.pop(sid, None)
        if session is None:
            return False
        session.close("the session was closed (DELETE)")
        return True

    def reap(self) -> list[str]:
        """Close every session idle past the TTL; answers their ids."""
        with self._lock:
            expired = [s for s in self._sessions.values() if s.idle_s() >= self.ttl_s]
            for session in expired:
                del self._sessions[session.id]
        hours = self.ttl_s / 3600
        for session in expired:
            session.close(f"the session expired after {hours:g} h idle")
        return [s.id for s in expired]

    def close_all(self) -> None:
        self._stop.set()
        with self._lock:
            sessions = list(self._sessions.values())
            self._sessions.clear()
        for session in sessions:
            session.close("the daemon is shutting down")

    def _start_reaper(self) -> None:
        if self._reaper is not None and self._reaper.is_alive():
            return
        self._reaper = threading.Thread(target=self._reap_loop, name="adopt-reaper", daemon=True)
        self._reaper.start()

    def _reap_loop(self) -> None:
        while not self._stop.wait(self.reap_interval_s):
            self.reap()

    def _sweep_leftovers(self) -> None:
        """Once per process: delete session dirs a previous process left (a crash, a kill)."""
        if self._swept:
            return
        self._swept = True
        if not self.root.is_dir():
            return
        for child in self.root.iterdir():
            live = child.name in self._sessions
            if child.is_dir() and child.name.startswith("sess_") and not live:
                shutil.rmtree(child, ignore_errors=True)

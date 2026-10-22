"""ADR 0097 (studio outside the turn lock): the Adopt studio's routes.

Every route is behind the token like every other, refuses in the one error shape, and **never
takes** ``daemon.writing()``: an adopt session runs while a chat turn runs, and a chat turn never
waits for one (``tests/adopt/test_routes.py`` holds the writer lock and is still answered).

``POST /adopt`` ``{playbook_id, intro?, case_id?}``
    A new session -> ``{ok, session_id, slots, case}``. ``intro`` is what the person says before
    the first card (at most ``loop.ANSWER_TEXT_CAP`` characters); the first audit and card read
    it. The opening, the first card and the research
    lanes follow on the event stream. A fourth live session is refused: ``reason``
    ``budget_exhausted``, ``detail`` starting ``busy:`` (``busy`` is not in ``ERROR_REASONS``).
    ``case_id`` (a ``proj_`` id, ADR 0123) reopens that saved case of this playbook: ``case`` is
    its summary (``null`` without one), and the stream starts with its slots and its approved
    brief. An unknown case is 404 ``unknown_ref``; another playbook's is 400; no brain wired is
    503 ``engine_error``.
``GET /adopt/cases?playbook_id=`` (ADR 0123)
    The saved cases, latest approval first, read from the brain's ``goals/``:
    ``{ok, cases: [CaseSummary], showing, total, footer}`` (at most ``cases.MAX_CASES``).
``GET /adopt/cases/<proj>/runs`` (ADR 0124)
    The case's runs, read-only: ``{ok, case_id, conversation_id, open, receipts, showing, total,
    footer}``. ``open`` is the run since the last receipt, folded now from the approval table, the
    episodes and the ledger of ``conv_proj_…`` (a :class:`~athena.contracts.adopt.Receipt`), or
    ``null`` when nothing ran in it; ``receipts`` are the ones the case file keeps, latest first,
    at most :data:`MAX_RECEIPTS`. An unknown case is 404 ``unknown_ref``.
``POST /adopt/cases/<proj>/done`` (ADR 0124)
    The person pressed done on the active playbook: the open run is folded with ``until`` now and
    appended to the case file's block -> ``{ok, receipt, saved, problem}``. ``receipt`` is
    ``null`` and ``saved`` false when nothing ran since the last receipt; ``problem`` is ``""``
    or why the file was not written. It takes the brain's write lock, never the turn lock.
``GET /adopt/<sid>/events?after=<seq>``
    Server-Sent Events: every event past ``after``, then live, ``event: <kind>`` / ``data:
    <json>``, a ``: heartbeat`` comment every :data:`HEARTBEAT_S` of quiet. When the session
    ends (DELETE, idle expiry, shutdown) the last frame is ``adopt.error`` with reason
    ``session_closed`` and then the stream closes: a surface stops reconnecting on that reason.
``POST /adopt/<sid>/answer`` ``{answers: [{question_id, choice_ids, text}], via}``
    ``question_id`` ``""`` is free text to no question (the composer beside a card).
``POST /adopt/<sid>/documents`` ``{name, mime, data_b64}`` -> ``{ok, doc_id}``
    The bytes are kept in the session's temp dir and handed to ``on_document``; nothing else.
``POST /adopt/<sid>/enough``
``POST /adopt/<sid>/approve`` ``{rev}``
    A rev that is not the current, unanswered brief is refused: ``reason`` ``validator_failed``,
    ``detail`` starting ``stale_rev:``. An approved rev is written to the session's case
    (ADR 0123) -> ``{ok, rev, case_id, case_problem}``: ``case_id`` is the ``proj_`` id, the
    same one for every approval of the case; ``case_problem`` is ``""``, or why the case could
    not be written (the approval itself stands).
``DELETE /adopt/<sid>``
    Lanes told, ``session_closed`` appended, warm process killed, temp dir deleted, streams
    ended.

The Chores front door (ADR 0098) is the same machine without a playbook, under ``/intake``:
``POST /intake`` ``{need?}`` -> ``{ok, session_id}`` (the same budget; a fourth live session of
either kind is ``busy:``), ``GET /intake/<sid>/events``, ``POST /intake/<sid>/answer``,
``POST /intake/<sid>/decide`` (force the verdict now) and ``DELETE /intake/<sid>``. An adopt id
is not an intake id: each prefix answers 404 for the other's sessions.
"""

from __future__ import annotations

import base64
import binascii
import json
import re
from collections.abc import Callable, Iterator, Mapping
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

from athena.adopt import intake, loop
from athena.adopt import receipts as runs
from athena.adopt.cases import MAX_CASES, CaseBook, CaseUnreadable, summary
from athena.adopt.legs import LedgerSink, LegRunner, load_tiers
from athena.adopt.session import AdoptSession, Busy, IntakeSession, SessionStore
from athena.adopt.slots import PlaybookMissing
from athena.contracts import ids
from athena.contracts.adopt import AdoptEvent, Answer
from athena.contracts.channel import now_iso
from athena.daemon.routes import EventStream, Reply, Request, Route, announced, error

if TYPE_CHECKING:
    from athena.daemon.server import AthenaDaemon

__all__ = [
    "ADOPT_PATH",
    "ADOPT_PREFIX",
    "CASES_PATH",
    "CASES_PREFIX",
    "DOCUMENT_CAP",
    "HEARTBEAT_S",
    "INTAKE_PATH",
    "INTAKE_PREFIX",
    "MAX_RECEIPTS",
    "AdoptStudio",
    "adopt_routes",
    "adopt_sse_frame",
    "default_studio",
]

ADOPT_PATH = "/adopt"
ADOPT_PREFIX = "/adopt/"
CASES_PATH = "/adopt/cases"
CASES_PREFIX = "/adopt/cases/"
#: The most stored receipts ``GET /adopt/cases/<proj>/runs`` answers, latest first.
MAX_RECEIPTS = 20
INTAKE_PATH = "/intake"
INTAKE_PREFIX = "/intake/"
HEARTBEAT_S = 15.0
#: The most a dropped document may be, decoded. The documents route has its own 14 MiB body cap
#: (``server.BodyCap``, registered in wiring) so a 10 MB file fits once base64 adds its third.
DOCUMENT_CAP = 10 * 1024 * 1024
NAME_CAP = 80
MIME_CAP = 100
_UNSAFE = re.compile(r"[^A-Za-z0-9._-]+")


@dataclass
class AdoptStudio:
    """The session store, and why the studio cannot start sessions if it cannot."""

    store: SessionStore
    heartbeat_s: float = HEARTBEAT_S
    #: Non-empty when the studio is unusable (no tiers file): ``POST /adopt`` says so.
    problem: str = ""
    #: The library the intake reads, as ``[{id, title, area, job, summary}]``; ``None`` is the
    #: shipped one (:func:`athena.adopt.intake.library_summary`). Tests inject a fixture.
    library: Callable[[], list[dict[str, str]]] | None = None
    #: The saved cases (ADR 0123), over the daemon's brain; ``None`` until wiring binds one.
    cases: CaseBook | None = None

    def close(self) -> None:
        self.store.close_all()


def default_studio(root: Path, ledger: LedgerSink | None) -> AdoptStudio:
    """The production studio: real CLI legs, sessions under ``root``, rows in ``ledger``."""
    try:
        tiers = load_tiers()
    except (OSError, ValueError) as exc:
        runner = LegRunner(ledger=ledger, tiers={}, prompt_dir=root / "prompts")
        return AdoptStudio(SessionStore(root, runner), problem=f"tiers.json: {exc}")
    runner = LegRunner(ledger=ledger, tiers=tiers, prompt_dir=root / "prompts")
    return AdoptStudio(SessionStore(root, runner))


# --- the routes ---------------------------------------------------------------------------------


def start(studio: AdoptStudio, request: Request) -> Reply:
    if studio.problem:
        return error(503, "engine_error", studio.problem)
    playbook_id = request.body.get("playbook_id")
    if not isinstance(playbook_id, str) or not playbook_id:
        return error(400, "validator_failed", "playbook_id is required")
    intro = request.body.get("intro", "")
    if not isinstance(intro, str):
        return error(400, "validator_failed", "intro must be a string")
    if len(intro) > loop.ANSWER_TEXT_CAP:
        return error(
            400,
            "validator_failed",
            f"intro: {len(intro)} characters is more than {loop.ANSWER_TEXT_CAP}",
        )
    case_id = request.body.get("case_id", "")
    if not isinstance(case_id, str):
        return error(400, "validator_failed", "case_id must be a string")
    case = None
    if case_id:
        if not ids.is_id("project", case_id):
            return error(400, "validator_failed", f"case_id is not a project id: {case_id!r}")
        if studio.cases is None:
            return error(503, "engine_error", "no brain is wired, so no case can be opened")
        case = studio.cases.load(case_id)
        if case is None:
            return error(404, "unknown_ref", f"no saved case {case_id!r}")
        if case.playbook_id != playbook_id:
            return error(
                400, "validator_failed", f"case {case_id} is a case of {case.playbook_id!r}"
            )
    try:
        session = studio.store.create(playbook_id, intro, case)
    except PlaybookMissing as exc:
        return error(404, "unknown_ref", str(exc))
    except Busy as exc:
        return error(429, "budget_exhausted", f"busy: {exc}")
    loop.start(session)
    return 200, {
        "ok": True,
        "session_id": session.id,
        "slots": [asdict(slot) for slot in session.slots],
        "case": asdict(summary(case)) if case is not None else None,
    }


def cases(studio: AdoptStudio, request: Request) -> Reply:
    """``GET /adopt/cases?playbook_id=``: the saved cases, read-only (ADR 0123)."""
    if studio.cases is None:
        return error(503, "engine_error", "no brain is wired, so no case can be read")
    playbook_id = request.query.get("playbook_id", "")
    found = studio.cases.cases(playbook_id)
    rows = [asdict(summary(case)) for case in found[:MAX_CASES]]
    return 200, announced(rows, len(found), "cases")


def case_runs(daemon: AthenaDaemon, studio: AdoptStudio, request: Request, tail: str) -> Reply:
    """``GET /adopt/cases/<proj>/runs`` and ``POST /adopt/cases/<proj>/done`` (ADR 0124)."""
    case_id, _, verb = tail.partition("/")
    want = "runs" if request.method == "GET" else "done"
    if verb != want:
        return error(404, "unknown", f"no route for {request.method} {CASES_PREFIX}{tail}")
    if not ids.is_id("project", case_id):
        return error(400, "validator_failed", f"not a case id: {case_id!r}")
    book = studio.cases
    if book is None:
        return error(503, "engine_error", "no brain is wired, so no case can be read")
    if book.load(case_id) is None:
        return error(404, "unknown_ref", f"no saved case {case_id!r}")
    kept = book.receipts(case_id)
    since = kept[-1].until if kept else ""
    if want == "runs":
        current = runs.fold(daemon.brain, daemon.approvals, daemon.ledger, case_id, since=since)
        latest = [runs.as_dict(r) for r in reversed(kept)][:MAX_RECEIPTS]
        reply = announced(latest, len(kept), "receipts")
        reply["case_id"] = case_id
        reply["conversation_id"] = ids.conversation_for_project(case_id)
        reply["open"] = None if runs.empty(current) else runs.as_dict(current)
        return 200, reply
    until = now_iso()
    closed = runs.fold(
        daemon.brain,
        daemon.approvals,
        daemon.ledger,
        case_id,
        since=since,
        until=until,
        closed_by="done",
        closed_at=until,
    )
    if runs.empty(closed):
        return 200, {"ok": True, "receipt": None, "saved": False, "problem": ""}
    try:
        book.append_receipt(case_id, closed)
    except (OSError, ValueError, CaseUnreadable) as exc:
        return 200, {
            "ok": True,
            "receipt": runs.as_dict(closed),
            "saved": False,
            "problem": f"the receipt was not saved: {type(exc).__name__}: {exc}",
        }
    return 200, {"ok": True, "receipt": runs.as_dict(closed), "saved": True, "problem": ""}


def act(studio: AdoptStudio, request: Request, tail: str) -> Reply | EventStream:
    sid, _, verb = tail.partition("/")
    session = studio.store.get(sid)
    if session is None or isinstance(session, IntakeSession):
        return error(404, "unknown_ref", f"no adopt session {sid!r}")
    session.touch()
    if request.method == "DELETE":
        if verb:
            return error(404, "unknown", f"no route for DELETE {ADOPT_PREFIX}{tail}")
        studio.store.delete(sid)
        return 200, {"ok": True}
    if request.method == "GET":
        if verb != "events":
            return error(404, "unknown", f"no route for GET {ADOPT_PREFIX}{tail}")
        return events(studio, session, request)
    if verb == "answer":
        return answer(session, request.body)
    if verb == "documents":
        return document(session, request.body)
    if verb == "enough":
        loop.enough(session)
        return 200, {"ok": True}
    if verb == "approve":
        return approve(session, request.body, studio.cases)
    return error(404, "unknown", f"no route for POST {ADOPT_PREFIX}{tail}")


def events(studio: AdoptStudio, session: AdoptSession, request: Request) -> Reply | EventStream:
    raw = request.query.get("after", "0")
    try:
        after = int(raw)
    except ValueError:
        return error(400, "validator_failed", f"after must be a whole number, got {raw!r}")
    if after < 0:
        return error(400, "validator_failed", "after must be 0 or more")
    return EventStream(_frames(session, after, studio.heartbeat_s))


def answer(
    session: AdoptSession,
    body: Mapping[str, Any],
    receive: Callable[[Any, list[Answer], str], None] = loop.receive_answers,
) -> Reply:
    via = body.get("via", "text")
    if via not in ("text", "voice"):
        return error(400, "validator_failed", "via is 'text' or 'voice'")
    raw = body.get("answers")
    if not isinstance(raw, list):
        return error(400, "validator_failed", "answers must be a list")
    answers: list[Answer] = []
    for index, row in enumerate(raw):
        if not isinstance(row, Mapping):
            return error(400, "validator_failed", f"answers[{index}] must be an object")
        question_id = row.get("question_id")
        choices = row.get("choice_ids", [])
        text = row.get("text", "")
        if not isinstance(question_id, str) or not isinstance(text, str):
            return error(400, "validator_failed", f"answers[{index}]: question_id and text")
        if not isinstance(choices, list) or not all(isinstance(c, str) for c in choices):
            return error(400, "validator_failed", f"answers[{index}].choice_ids: strings")
        answers.append(Answer(question_id=question_id, choice_ids=tuple(choices), text=text))
    problem = loop.check_answers(session, answers)
    if problem:
        return error(400, "validator_failed", problem)
    receive(session, answers, via)
    return 200, {"ok": True}


def document(session: AdoptSession, body: Mapping[str, Any]) -> Reply:
    name, mime, data = body.get("name"), body.get("mime"), body.get("data_b64")
    if not isinstance(name, str) or not name.strip():
        return error(400, "validator_failed", "name is required")
    if not isinstance(mime, str) or not mime or len(mime) > MIME_CAP:
        return error(400, "validator_failed", "mime is required")
    if not isinstance(data, str) or not data:
        return error(400, "validator_failed", "data_b64 is required")
    if len(data) > (DOCUMENT_CAP * 4) // 3 + 4:
        return error(400, "validator_failed", f"a document is at most {DOCUMENT_CAP} bytes")
    try:
        content = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError):
        return error(400, "validator_failed", "data_b64 is not base64")
    if not content or len(content) > DOCUMENT_CAP:
        return error(400, "validator_failed", f"a document is 1 to {DOCUMENT_CAP} bytes")
    safe = _UNSAFE.sub("_", Path(name).name).strip("._")[:NAME_CAP] or "document"
    with session.lock:
        doc_id = f"doc{len(session.docs) + 1}"
        folder = session.temp_dir / "docs"
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"{doc_id}-{safe}"
        path.write_bytes(content)
        session.docs[doc_id] = path
    session.submit(lambda: session.call_hook("on_document", doc_id, path))
    return 200, {"ok": True, "doc_id": doc_id}


def approve(session: AdoptSession, body: Mapping[str, Any], book: CaseBook | None = None) -> Reply:
    rev = body.get("rev")
    if not isinstance(rev, int) or isinstance(rev, bool):
        return error(400, "validator_failed", "rev must be a whole number")
    problem = loop.approve(session, rev)
    if problem:
        return error(409, "validator_failed", problem)
    # The case is written here, on the request, so the reply carries its id (ADR 0123). It takes
    # the brain's own write lock for a few small files, never the turn lock.
    if book is None:
        return 200, {
            "ok": True,
            "rev": rev,
            "case_id": "",
            "case_problem": "no brain is wired, so the case was not saved",
        }
    try:
        case = book.save(session, rev)
    except (OSError, ValueError) as exc:
        session.count("case_failed")
        return 200, {
            "ok": True,
            "rev": rev,
            "case_id": session.case_id,
            "case_problem": f"the case was not saved: {type(exc).__name__}: {exc}",
        }
    return 200, {"ok": True, "rev": rev, "case_id": case.id, "case_problem": ""}


# --- the stream ---------------------------------------------------------------------------------


def adopt_sse_frame(event: AdoptEvent) -> str:
    """One adopt event as one SSE frame; ``json.dumps`` keeps ``data:`` on one line."""
    return f"event: {event.kind}\ndata: {json.dumps(event.to_dict(), sort_keys=True)}\n\n"


def _frames(session: AdoptSession, after: int, heartbeat_s: float) -> Iterator[str]:
    cursor = after
    while True:
        for event in session.events_after(cursor):
            cursor = event.seq
            yield adopt_sse_frame(event)
        if session.closed:
            return
        if not session.wait_after(cursor, heartbeat_s):
            yield ": heartbeat\n\n"


# --- the intake (ADR 0098) ----------------------------------------------------------------------


def intake_start(studio: AdoptStudio, request: Request) -> Reply:
    if studio.problem:
        return error(503, "engine_error", studio.problem)
    need = request.body.get("need", "")
    if not isinstance(need, str):
        return error(400, "validator_failed", "need must be a string")
    if len(need) > loop.ANSWER_TEXT_CAP:
        return error(
            400,
            "validator_failed",
            f"need: {len(need)} characters is more than {loop.ANSWER_TEXT_CAP}",
        )
    try:
        session = studio.store.create_intake(need, studio.library or intake.library_summary)
    except Busy as exc:
        return error(429, "budget_exhausted", f"busy: {exc}")
    intake.start(session)
    return 200, {"ok": True, "session_id": session.id}


def intake_act(studio: AdoptStudio, request: Request, tail: str) -> Reply | EventStream:
    sid, _, verb = tail.partition("/")
    found = studio.store.get(sid)
    if not isinstance(found, IntakeSession):
        return error(404, "unknown_ref", f"no intake session {sid!r}")
    session = found
    session.touch()
    if request.method == "DELETE":
        if verb:
            return error(404, "unknown", f"no route for DELETE {INTAKE_PREFIX}{tail}")
        studio.store.delete(sid)
        return 200, {"ok": True}
    if request.method == "GET":
        if verb != "events":
            return error(404, "unknown", f"no route for GET {INTAKE_PREFIX}{tail}")
        return events(studio, session, request)
    if verb == "answer":
        if session.verdict is not None:
            return error(409, "validator_failed", "decided: the verdict was already given")
        return answer(session, request.body, intake.receive_answers)
    if verb == "decide":
        if not session.answers:
            # No model call: a verdict on nothing would be made up (ADR 0098).
            return error(409, "validator_failed", "nothing_said: say what you need first")
        intake.decide(session)
        return 200, {"ok": True}
    return error(404, "unknown", f"no route for POST {INTAKE_PREFIX}{tail}")


def adopt_routes(daemon: AthenaDaemon, studio: AdoptStudio) -> list[Route]:
    """The studio's routes, exact before prefix, for :meth:`RouteTable.add`."""

    def tail(request: Request) -> str:
        return request.path[len(ADOPT_PREFIX) :]

    def itail(request: Request) -> str:
        return request.path[len(INTAKE_PREFIX) :]

    def ctail(request: Request) -> str:
        return request.path[len(CASES_PREFIX) :]

    return [
        Route("POST", ADOPT_PATH, lambda request: start(studio, request)),
        Route("GET", CASES_PATH, lambda request: cases(studio, request)),
        # Before the session prefix, which would read ``cases`` as a session id.
        Route("GET", CASES_PREFIX, lambda r: case_runs(daemon, studio, r, ctail(r)), prefix=True),
        Route("POST", CASES_PREFIX, lambda r: case_runs(daemon, studio, r, ctail(r)), prefix=True),
        Route("GET", ADOPT_PREFIX, lambda r: act(studio, r, tail(r)), prefix=True),
        Route("POST", ADOPT_PREFIX, lambda r: act(studio, r, tail(r)), prefix=True),
        Route("DELETE", ADOPT_PREFIX, lambda r: act(studio, r, tail(r)), prefix=True),
        Route("POST", INTAKE_PATH, lambda request: intake_start(studio, request)),
        Route("GET", INTAKE_PREFIX, lambda r: intake_act(studio, r, itail(r)), prefix=True),
        Route("POST", INTAKE_PREFIX, lambda r: intake_act(studio, r, itail(r)), prefix=True),
        Route("DELETE", INTAKE_PREFIX, lambda r: intake_act(studio, r, itail(r)), prefix=True),
    ]

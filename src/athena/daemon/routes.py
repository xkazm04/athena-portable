"""The route table and the routes the daemon answers (README §3.2, §3.5; ADR 0011, 0012).

A route is a method, a path and a function from a parsed :class:`Request` to an answer. The table
is a value the daemon owns rather than a chain of ``if`` statements inside the request handler,
for three reasons: the handler stays about HTTP (the token, CORS, closing the connection) and
knows nothing about Athena; a route is added by appending to the table rather than by editing the
handler; and a test can append a route of its own to prove a property of the *server* — that a
slow route does not stall a fast one — without the daemon shipping a debug route to production.

Three routes write today; the read routes land in the next commit.

``POST /manifest``
    A page describes itself. Refused whole on any problem (``manifest_invalid``, 400), merged
    under the writer lock otherwise, replacing that origin's previous set in one assignment. The
    answer is the merged tool list *with its classes*, because the class is the catalog's answer
    and a surface that guessed one would be a second gate.

``POST /run``
    One turn, streamed as Server-Sent Events (:class:`EventStream`, ADR 0012). One turn per
    request, on the session for the request's origin, in the conversation the session or the
    active project names.

``POST /decisions/<id>``
    The user's answer. An approval replays the gate with the approval id and the surface receives
    an ``execute`` instruction for a host tool, or the core tool's own result.

``GET /health``
    What is running and what is waiting on the user, bounded and announced. ``GET /decisions``,
    ``GET /ledger``, ``GET /ledger/rollup`` and ``GET /playbooks`` join it next, on the same
    terms: bounded, announced, and served off ``Brain.read_connection()``.

**Read routes take no lock.** A read reads through a fresh read-only handle per call (ADR 0003)
and what it reports is consistent as of the last completed write. Only a route that *writes*
takes :meth:`~athena.daemon.server.AthenaDaemon.writing`, and for ``/run`` the lock is taken
inside the stream — the turn holds it for its whole length, and ``/health`` still answers.

**Errors are one shape.** ``{"ok": false, "reason": ..., "detail": ...}``, where ``reason`` is a
member of ``contracts.harness.ERROR_REASONS`` — the same closed vocabulary the ledger records and
``gate.js`` speaks, so a surface never has to learn a second set of words for the same refusal.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import (
    AsyncGenerator,
    AsyncIterator,
    Callable,
    Generator,
    Iterable,
    Iterator,
    Mapping,
)
from contextlib import suppress
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any
from urllib.parse import unquote

from athena.contracts import ids
from athena.contracts.channel import ChannelEvent, DecisionRequested, TurnError
from athena.contracts.harness import normalize_reason
from athena.contracts.manifest import HostManifest
from athena.contracts.registry import Lane, TurnContext, parse_origin
from athena.core.approvals import ApprovalError
from athena.core.catalog import CatalogError
from athena.daemon.sessions import conversation_for
from athena.lane.turn_frame import tool_results_from

if TYPE_CHECKING:
    from athena.daemon.server import AthenaDaemon

__all__ = [
    "ANSWER_CAP",
    "DECISION_PREFIX",
    "DECISION_TOOL",
    "DEFAULT_LIMIT",
    "HEALTH_PENDING_LIMIT",
    "MAX_LIMIT",
    "PENDING_CEILING",
    "PENDING_LINES",
    "SSE_CONTENT_TYPE",
    "EventStream",
    "Reply",
    "Request",
    "Route",
    "RouteFn",
    "RouteTable",
    "announced",
    "base_routes",
    "bounded",
    "capped",
    "decide",
    "drain",
    "error",
    "health",
    "manifest",
    "run",
    "sse_frame",
]

#: How many pending approvals ``/health`` counts before it stops counting. The number it reports
#: is the honest total up to here, and the footer says so when it stopped early.
HEALTH_PENDING_LIMIT = 200

#: Default and ceiling for every ``limit`` a read route takes. The ceiling is the bound: a caller
#: asking for more gets the ceiling and the footer says so.
DEFAULT_LIMIT = 20
MAX_LIMIT = 200

#: How far ``GET /decisions`` counts before it stops counting. A card expires in 24 hours, so a
#: real inbox never reaches this; the total is honest up to here and the footer never overstates.
PENDING_CEILING = 500

#: How many waiting cards the turn frame lists, so the model can say what it is waiting for
#: rather than proposing the same action again.
PENDING_LINES = 10

#: ``POST /decisions/<id>`` — the one path matched by prefix rather than by equality.
DECISION_PREFIX = "/decisions/"

#: The frontend tool name a surface renders a decision card as. It rides on the
#: ``decision.requested`` frame rather than replacing it, so a client that renders channel events
#: and a client that renders AG-UI tool calls read the same frame (ADR 0012).
DECISION_TOOL = "athena_decision"

SSE_CONTENT_TYPE = "text/event-stream"

#: How much of a free-text answer beside a decision button reaches the record. The same cap a
#: ``READ`` answer is held to, and it announces what it cut like every other bounded thing here.
ANSWER_CAP = 1600

#: A status and the JSON body that goes with it.
Reply = tuple[int, dict[str, Any]]


@dataclass(frozen=True)
class Request:
    """One parsed request. Everything the handler could learn before a route ran."""

    method: str
    path: str
    query: Mapping[str, str] = field(default_factory=dict)
    #: The decoded JSON body, or ``{}`` for a request that had none. Never ``None``: a body that
    #: would not parse is refused by the handler before a route sees it.
    body: Mapping[str, Any] = field(default_factory=dict)
    #: The ``Origin`` header, or ``""``. CORS is decided from it; trust never is.
    origin: str = ""


@dataclass(frozen=True)
class EventStream:
    """A route's answer as Server-Sent Events, when its length is not known in advance.

    The frames are produced lazily and written as they arrive: a decision card must reach the
    panel while the turn is still running, so a route that collected a whole turn and then
    answered would be a card the user sees after the fact (ADR 0012).
    """

    frames: Iterator[str]
    status: int = 200


RouteFn = Callable[[Request], "Reply | EventStream"]


@dataclass(frozen=True)
class Route:
    """One routed path. ``prefix`` marks the one shape that carries an id in the path."""

    method: str
    path: str
    fn: RouteFn
    prefix: bool = False

    def claims(self, path: str) -> bool:
        """Whether this route's *path* covers ``path``, whatever the method was."""
        if not self.prefix:
            return path == self.path
        return path.startswith(self.path) and len(path) > len(self.path)

    def matches(self, method: str, path: str) -> bool:
        return method == self.method and self.claims(path)

    @property
    def label(self) -> str:
        return f"{self.method} {self.path}<id>" if self.prefix else f"{self.method} {self.path}"

    def tail(self, path: str) -> str:
        """The part of ``path`` past a prefix route's own, percent-decoded."""
        return unquote(path[len(self.path) :]) if self.prefix else ""


def error(status: int, reason: str, detail: str = "") -> Reply:
    """A refusal in the one shape, with ``reason`` collapsed onto ``ERROR_REASONS``."""
    return status, {"ok": False, "reason": normalize_reason(reason) or "unknown", "detail": detail}


def announced(items: list[dict[str, Any]], total: int, key: str) -> dict[str, Any]:
    """The shape every bounded read answers in (README §2 invariant 4).

    ``total`` is the population the page was cut from and never the length of ``items``, which is
    the only way ``footer`` can be true. It is ``""`` when the page is the whole population.
    """
    shown = len(items)
    return {
        "ok": True,
        key: items,
        "showing": shown,
        "total": total,
        "footer": "" if shown >= total else f"(showing {shown} of {total})",
    }


def capped(text: str, limit: int) -> str:
    """``text`` cut to ``limit`` characters, saying what it cut (README §2 invariant 4)."""
    total = len(text)
    if total <= limit:
        return text
    return f"{text[:limit]}\n(showing {limit} of {total})"


def bounded(value: str | None, default: int = DEFAULT_LIMIT) -> int:
    """A query-string ``limit``, clamped into ``1..MAX_LIMIT``. Junk falls back to the default."""
    try:
        asked = int(value if value is not None else default)
    except (TypeError, ValueError):
        return default
    return max(1, min(asked, MAX_LIMIT))


class RouteTable:
    """What the daemon answers. Ordered, first registration wins, one prefix shape allowed."""

    def __init__(self, routes: Iterable[Route] = ()) -> None:
        self._routes: list[Route] = []
        for route in routes:
            self.add(route)

    def __len__(self) -> int:
        return len(self._routes)

    def add(self, route: Route) -> Route:
        """Register ``route``. A duplicate method-and-path pair is a programming error."""
        if self.match(route.method, route.path) is not None:
            raise ValueError(f"{route.method} {route.path} is already routed")
        self._routes.append(route)
        return route

    def match(self, method: str, path: str) -> Route | None:
        for route in self._routes:
            if route.matches(method, path):
                return route
        return None

    def knows(self, path: str) -> bool:
        """Whether any method routes ``path``; the difference between a 404 and a 405."""
        return any(route.claims(path) for route in self._routes)

    def listing(self) -> list[str]:
        """``METHOD /path`` for every route, in registration order."""
        return [route.label for route in self._routes]


# --- the wire ------------------------------------------------------------------------------------


def sse_frame(event: ChannelEvent) -> str:
    """One channel event as one Server-Sent Event frame (ADR 0012).

    ``event:`` carries the event's own ``kind`` so a client can subscribe by name, and ``data:``
    carries the whole event as one line of JSON — ``json.dumps`` escapes every newline it is
    handed, so nothing a page or a model wrote can split a frame in two. A decision card also
    names the frontend tool a surface renders it as; it is an extra key on the same frame rather
    than a second frame, so the two readings can never disagree about what the card said.
    """
    payload = event.to_dict()
    if isinstance(event, DecisionRequested):
        payload["tool"] = DECISION_TOOL
    return f"event: {event.kind}\ndata: {json.dumps(payload, sort_keys=True)}\n\n"


def drain(events: AsyncIterator[ChannelEvent]) -> Iterator[ChannelEvent]:
    """Pull an async stream one event at a time on a private loop.

    Frame by frame, not turn by turn: the handler writes each event as it is produced, and a
    ``run_until_complete`` over the whole generator would buffer a decision card behind the rest
    of the turn. The loop is private to this turn, because the daemon's threads have none.
    """
    loop = asyncio.new_event_loop()
    try:
        while True:
            try:
                yield loop.run_until_complete(events.__anext__())
            except StopAsyncIteration:
                return
    finally:
        # A caller that stopped early (a client hung up) leaves the generator suspended; closing
        # it on the same loop runs its ``finally`` blocks before the loop goes away.
        if isinstance(events, AsyncGenerator):
            with suppress(RuntimeError, StopAsyncIteration):
                loop.run_until_complete(events.aclose())
        loop.close()


# --- GET /health ---------------------------------------------------------------------------------


def health(daemon: AthenaDaemon) -> Reply:
    """What is running, over which brain, for how long, and what is waiting on the user.

    The pending block is bounded and announces itself like every other bounded read in this
    repository (README §2, invariant 4): ``total`` counts the live rows, ``showing`` counts the
    rows this page actually looked at, and ``footer`` is the ``(showing N of M)`` sentence — empty
    when the page is the whole inbox, which is the usual case.
    """
    page = daemon.approvals.pending(HEALTH_PENDING_LIMIT)
    return 200, {
        "ok": True,
        "engine": daemon.engine,
        "model": daemon.model,
        "brain": str(daemon.brain.root),
        "uptime_s": daemon.uptime_s,
        "sessions": len(daemon.sessions),
        "tools": len(daemon.catalog),
        "pending": {
            "showing": page.shown,
            "total": page.total,
            "footer": page.footer(),
        },
        "routes": daemon.routes.listing(),
    }


# --- POST /manifest ------------------------------------------------------------------------------


def manifest(daemon: AthenaDaemon, request: Request) -> Reply:
    """Merge one page's capability manifest, whole or not at all (README §3.3).

    Three things happen together under the writer lock and they are one act: the origin's entries
    replace whatever it had, the app is pinned to the origin its manifest was published from
    (policy rule 3), and the session for that origin is opened or refreshed. A manifest that fails
    any check changes none of the three, so a refused manifest leaves the origin exactly the tools
    it already had — a half-merged origin is a gate with a hole in it.
    """
    try:
        parsed = HostManifest.from_dict(dict(request.body))
    except (AttributeError, TypeError, ValueError) as exc:
        return error(400, "manifest_invalid", f"malformed manifest: {type(exc).__name__}: {exc}")

    problems = parsed.validate()
    if parsed.origin_kind == "host" and not parsed.page_origin.strip():
        # The contract allows an absent ``page_origin`` because a connector has none. A page does
        # not: it is the session key and the thing rule 3 pins to, so the daemon requires it.
        problems = [*problems, "page_origin is required: it is the session this manifest opens"]
    if problems:
        return 400, {
            "ok": False,
            "reason": "manifest_invalid",
            "detail": f"manifest {parsed.app_id!r} is refused whole",
            "app_id": parsed.app_id,
            "problems": problems,
        }

    with daemon.writing():
        try:
            names = daemon.catalog.merge_manifest(parsed)
        except CatalogError as exc:
            return 400, {
                "ok": False,
                "reason": "manifest_invalid",
                "detail": str(exc),
                "app_id": parsed.app_id,
                "problems": [str(exc)],
            }
        daemon.pin(parsed.app_id, parsed.page_origin)
        session = daemon.sessions.touch(parsed.page_origin, parsed.app_id, tools=len(names))

    tools = [
        {
            "name": name,
            "class": daemon.catalog.get(name).cls.value,
            "origin": daemon.catalog.get(name).origin,
            "tier": daemon.catalog.get(name).tier,
        }
        for name in names[:MAX_LIMIT]
    ]
    reply = announced(tools, len(names), "tools")
    reply["app_id"] = parsed.app_id
    reply["origin"] = parsed.page_origin
    reply["registry_origin"] = parsed.registry_origin
    reply["conversation_id"] = session.conversation_id
    return 200, reply


# --- POST /run -----------------------------------------------------------------------------------


def run(daemon: AthenaDaemon, request: Request) -> Reply | EventStream:
    """One turn, on the session for this origin, streamed as SSE (README §3.2).

    Everything that can be refused is refused *before* the stream opens — an origin with no
    session, a project id that is not one — so a caller never has to read a 200 to find out the
    turn never started. Once the headers are out the answer is the lane's own event stream, ending
    in ``turn.finished`` or ``turn.error``, always, because the harness guarantees it.
    """
    body = request.body
    origin = str(body.get("origin", "")).strip()
    session = daemon.sessions.get(origin)
    if session is None:
        return error(
            403,
            "foreign_origin",
            f"{origin!r} has sent no manifest; register the origin before running a turn",
        )
    project_id = str(body.get("project_id", "") or "")
    if project_id and not ids.is_id("project", project_id):
        return error(400, "unknown_ref", f"not a project id: {project_id!r}")

    conversation = conversation_for(session, project_id)
    ctx = TurnContext(
        conversation_id=conversation,
        turn_id=ids.mint("turn"),
        lane=Lane.BROWSER,
        surface=str(body.get("surface") or "panel"),
        session_id=session.origin,
        app_id=session.app_id,
        page_origin=session.origin,
        project_id=project_id or None,
    )
    daemon.sessions.touch(session.origin, session.app_id, tools=session.tools)
    raw_results = body.get("tool_results")
    results = tool_results_from(
        [row for row in raw_results if isinstance(row, Mapping)]
        if isinstance(raw_results, list)
        else []
    )
    host_state = body.get("host_state")
    return EventStream(
        _turn_frames(
            daemon,
            ctx,
            message=str(body.get("message", "")),
            host_state=dict(host_state) if isinstance(host_state, Mapping) else {},
            results=results,
            project=_active_project(body, project_id),
        )
    )


def _active_project(body: Mapping[str, Any], project_id: str) -> dict[str, Any] | None:
    """What the frame says about the project this turn belongs to.

    The surface may send a whole project object; when it sends only an id the frame still names
    it, because "which project am I in" is a question the model answers from the frame and not
    from a conversation id it was never shown.
    """
    given = body.get("active_project")
    if isinstance(given, Mapping):
        return dict(given)
    return {"id": project_id} if project_id else None


def _turn_frames(
    daemon: AthenaDaemon,
    ctx: TurnContext,
    *,
    message: str,
    host_state: Mapping[str, Any],
    results: tuple[Any, ...],
    project: Mapping[str, Any] | None,
) -> Generator[str, None, None]:
    """The turn's frames, with the writer lock held for exactly as long as the turn runs.

    The lock lives here rather than around the route because the route returns before a single
    frame is produced. A turn that dies mid-stream still releases it: the ``with`` block is inside
    the generator, and the handler closes the generator when a client hangs up.
    """
    with daemon.writing():
        try:
            events = daemon.lane.run(
                message,
                ctx,
                host_state=host_state,
                tool_results=results,
                active_project=project,
                pending_decisions=pending_lines(daemon),
            )
            for event in drain(events):
                yield sse_frame(event)
        except Exception as exc:  # a lane bug ends the stream honestly, never silently
            # The type only: an exception's message can quote a request body, and a body may hold
            # anything the caller put in it.
            yield sse_frame(TurnError(reason="unknown", detail=type(exc).__name__))


def pending_lines(daemon: AthenaDaemon, limit: int = PENDING_LINES) -> list[str]:
    """One line per card still waiting on the user, for the turn frame (README §3.2 step 2).

    The daemon owns the inbox, so the daemon supplies these; the lane composes them and the
    composer bounds them. Nothing here is a decision — a pending card is told to the model so it
    can say what it is waiting for, never so it can answer one.
    """
    page = daemon.approvals.pending(limit)
    return [
        f"{row.id}: {row.action} {json.dumps(row.params, sort_keys=True, default=str)}"
        for row in page.rows
    ]


# --- POST /decisions/<id> ------------------------------------------------------------------------


def decide(daemon: AthenaDaemon, request: Request, approval_id: str) -> Reply:
    """The user's answer to one card (README §3.2 step 6).

    The lane resolves the row, replays the gate with the approval id and hands back either an
    ``execute`` instruction — a host tool the page runs, carrying the parameters off the *row* and
    not off this request — or the result of a core tool that ran here. The conversation comes off
    the row too, so a card filed under a project is answered and recorded under that project.
    """
    choice = str(request.body.get("choice", "")).strip()
    if not choice:
        return error(400, "validator_failed", "a decision needs a choice")
    answer = request.body.get("answer")

    try:
        grant = daemon.approvals.describe(approval_id)
    except ApprovalError as exc:
        return error(404, "unknown_ref", str(exc))

    stated = str(request.body.get("origin", "")).strip()
    refusal = _origin_refusal(daemon, grant.origin, stated)
    if refusal is not None:
        return refusal

    ctx = _decision_ctx(daemon, grant.origin, grant.conversation)
    with daemon.writing():
        resolution = daemon.lane.answer_decision(approval_id, choice, ctx)
    if resolution.reason is not None and resolution.reason != "user_denied":
        return error(409, resolution.reason, resolution.detail)

    if answer is not None and str(answer).strip():
        # The user typed something beside the button. It is theirs, so it is recorded as an
        # episode of the same conversation and never mixed into the grant the replay proved —
        # the grant is what the user was shown, and a sentence beside it does not change it.
        daemon.brain.append_episode(
            f"[decision] the user added: {capped(str(answer), ANSWER_CAP)}",
            "user",
            session_id=grant.conversation,
        )

    execute = [] if resolution.execute is None else [_execute_row(resolution.execute)]
    return 200, {
        "ok": True,
        "id": approval_id,
        "status": "approved" if resolution.approved else "declined",
        "choice": choice,
        "conversation_id": grant.conversation,
        "execute": execute,
        "output": "" if resolution.result is None else resolution.result.output,
        "events": [event.to_dict() for event in resolution.events],
    }


def _execute_row(instruction: Any) -> dict[str, Any]:
    """One ``execute`` instruction on the wire: what to run, with which parameters, where."""
    return {
        "call_id": instruction.call_id,
        "name": instruction.name,
        "params": dict(instruction.params),
        "origin": instruction.origin,
        "tier": instruction.tier,
        "approval_id": instruction.approval_id,
    }


def _origin_refusal(daemon: AthenaDaemon, grant_origin: str, stated: str) -> Reply | None:
    """Refuse a surface answering another origin's card.

    An origin on the body is optional — the row already knows which app it belongs to — but when
    one is given it must be a live session for *that* app. A panel that answered a neighbouring
    page's card would be the browser half of ``foreign_origin``, and it is refused with the same
    word the gate uses.
    """
    if not stated:
        return None
    session = daemon.sessions.get(stated)
    if session is None:
        return error(403, "foreign_origin", f"{stated!r} has no session with this daemon")
    try:
        parsed = parse_origin(grant_origin)
    except ValueError as exc:  # pragma: no cover - a row cannot hold an unparseable origin
        return error(500, "unknown", str(exc))
    if parsed.kind == "host" and parsed.id != session.app_id:
        return error(
            403,
            "foreign_origin",
            f"{stated} is pinned to host:{session.app_id} and this card belongs to {grant_origin}",
        )
    return None


def _decision_ctx(daemon: AthenaDaemon, grant_origin: str, conversation: str) -> TurnContext:
    """The context the gate is replayed under.

    It is built from the *card's* origin rather than from the request, so structural policy sees
    the app the card belongs to and the page origin that app's manifest was published from. A card
    for an app whose session has since gone carries no page origin, and rule 3 then compares the
    app alone — which is the honest amount that is still known.
    """
    try:
        parsed = parse_origin(grant_origin)
    except ValueError:  # pragma: no cover - a row cannot hold an unparseable origin
        parsed = None
    app_id = parsed.id if parsed is not None and parsed.kind == "host" else None
    page_origin = None
    if app_id is not None:
        page_origin = next(
            (s.origin for s in daemon.sessions.all() if s.app_id == app_id),
            None,
        )
    return TurnContext(
        conversation_id=conversation,
        turn_id=ids.mint("turn"),
        lane=Lane.BROWSER,
        surface="panel",
        app_id=app_id,
        page_origin=page_origin,
    )


# --- the table -----------------------------------------------------------------------------------


def base_routes(daemon: AthenaDaemon) -> list[Route]:
    """Every route this daemon answers, in the order a reader should meet them.

    The exact paths come before the one prefix path, so the read routes the next commit adds —
    ``GET /decisions`` among them — can never be shadowed by ``POST /decisions/<id>``.
    """
    return [
        Route("GET", "/health", lambda request: health(daemon)),
        Route("POST", "/manifest", lambda request: manifest(daemon, request)),
        Route("POST", "/run", lambda request: run(daemon, request)),
        Route(
            "POST",
            DECISION_PREFIX,
            lambda request: decide(daemon, request, unquote(request.path[len(DECISION_PREFIX) :])),
            prefix=True,
        ),
    ]

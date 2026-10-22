"""The route table and the routes the daemon answers (README §3.2, §3.5; ADR 0011, 0012).

A route is a method, a path and a function from a parsed :class:`Request` to an answer. The table
is a value the daemon owns rather than a chain of ``if`` statements inside the request handler,
for three reasons: the handler stays about HTTP (the token, CORS, closing the connection) and
knows nothing about Athena; a route is added by appending to the table rather than by editing the
handler; and a test can append a route of its own to prove a property of the *server* — that a
slow route does not stall a fast one — without the daemon shipping a debug route to production.

Three routes write, one stops and six read.

``POST /manifest``
    A page describes itself. Refused whole on any problem (``manifest_invalid``, 400), merged
    under the writer lock otherwise, replacing that origin's previous set in one assignment. The
    answer is the merged tool list *with its classes*, because the class is the catalog's answer
    and a surface that guessed one would be a second gate.

``POST /run``
    One turn, streamed as Server-Sent Events (:class:`EventStream`, ADR 0012). One turn per
    request, on the session for the request's origin, in the conversation the session or the
    active project names.

``POST /run/stop``
    End the turn running for one origin (ADR 0115). It takes no lock, because the turn it stops
    holds the writer lock: it cancels the step the turn is on, the harness writes the one
    ``cancelled`` row, and the stream ends in ``turn.error``. ``{"stopped": false}`` when no turn
    is running on that origin. A card already filed is untouched and stays answerable.

``POST /decisions/<id>``
    The user's answer. An approval replays the gate with the approval id and the surface receives
    an ``execute`` instruction for a host tool, or the core tool's own result.

``GET /health``, ``GET /decisions``, ``GET /ledger``, ``GET /ledger/rollup``, ``GET /playbooks``
    What is running, what is waiting on the user, what was spent, and what the brain has
    distilled about one origin. Every one is bounded and carries an honest
    ``showing`` / ``total`` / ``footer``; every one is served off ``Brain.read_connection()``.

``GET /engines``
    Which engines this machine can run, probed in a subprocess and cached for
    :data:`ENGINES_TTL_S` (``?fresh=1`` skips the cache). It reads no brain and takes no lock.

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
import threading
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
from dataclasses import dataclass, field, replace
from typing import TYPE_CHECKING, Any
from urllib.parse import unquote

from athena.contracts import ids
from athena.contracts.channel import ChannelEvent, DecisionRequested, TurnError, cut_text
from athena.contracts.harness import normalize_reason
from athena.contracts.manifest import HostManifest
from athena.contracts.registry import Lane, OpenApp, TurnContext, parse_origin
from athena.core.catalog import CatalogError
from athena.core.ledger import LedgerError
from athena.core.prompt import SinceLastRun
from athena.core.recall import recall as recall_bundle
from athena.daemon.sessions import Session, conversation_for
from athena.harness.engines import EngineStatus
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
    "PLAYBOOK_KINDS",
    "SSE_CONTENT_TYPE",
    "BinaryReply",
    "EventStream",
    "RawRequest",
    "Reply",
    "Request",
    "Route",
    "RouteFn",
    "RouteTable",
    "TurnDoor",
    "announced",
    "base_routes",
    "bounded",
    "capped",
    "decide",
    "decisions",
    "drain",
    "engines",
    "error",
    "event_payload",
    "health",
    "last_run_of",
    "ledger_recent",
    "ledger_rollup",
    "manifest",
    "playbooks",
    "run",
    "sse_frame",
    "stamp_case_turn",
    "stop",
    "turn_context",
    "turn_events",
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

#: How many waiting cards the daemon hands the turn frame, so the model can say what it is waiting
#: for rather than proposing the same action again. The composer names up to its own bound and
#: announces the rest against this count: a ceiling on the count, not the list (ADR 0052).
PENDING_LINES = 100

#: One pending card's line is cut here, so a long letter's body cannot spend the digest's budget.
PENDING_LINE_CAP = 220

#: What a person is told when the app a turn or a card is about has not been seen. One sentence,
#: in the user's words: the machine-readable ``reason`` beside it is the contract, this is not.
NO_PAGE_SENTENCE = "Open the app this is about and focus its tab, then try again."

#: Most origins one request may switch off. A longer list is refused, never cut: a cut list would
#: read the origins past the cap as switched on.
MAX_DISABLED_ORIGINS = 256

#: Most first-sight origins or pinned tools one request may name (ADR 0063). Far past any real
#: table: the shell names one origin per open tab and one name per pin. A longer list is refused,
#: never cut, because a cut list loosens the gate (ADR 0066).
MAX_GATED_NAMES = 4096

#: How long ``GET /engines`` trusts its last probe, and what ``?fresh=1`` skips.
ENGINES_TTL_S = 10.0

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

#: What ``GET /playbooks`` reports: the rules the brain has distilled, never raw episodes. A
#: playbook is a procedural — "when X, do Y" — and a fact is not one.
PLAYBOOK_KINDS: frozenset[str] = frozenset({"procedural"})

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


@dataclass(frozen=True)
class RawRequest(Request):
    """A request to a path in :attr:`AthenaDaemon.raw_paths`: the body as bytes, unparsed."""

    raw: bytes = b""


@dataclass(frozen=True)
class BinaryReply:
    """A route's answer as bytes with a content type, and headers a browser may read.

    The voice studio's preview is the one today (ADR 0028): PCM out, with the provider, the voice
    and the time it took as headers the server exposes to a cross-origin reader.
    """

    status: int
    body: bytes = b""
    content_type: str = "application/octet-stream"
    headers: Mapping[str, str] = field(default_factory=dict)


RouteFn = Callable[[Request], "Reply | EventStream | BinaryReply"]


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
    return cut_text(text, limit)


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
    payload = event_payload(event)
    return f"event: {event.kind}\ndata: {json.dumps(payload, sort_keys=True)}\n\n"


def event_payload(event: ChannelEvent) -> dict[str, Any]:
    """One channel event as the JSON object every transport sends — SSE and the voice socket
    alike — with the frontend tool name riding a decision card (ADR 0012)."""
    payload = event.to_dict()
    if isinstance(event, DecisionRequested):
        payload["tool"] = DECISION_TOOL
    return payload


#: The ``turn.error`` detail of a turn the person stopped. The reason beside it is ``cancelled``.
STOPPED_DETAIL = "you stopped the turn"


class TurnDoor:
    """Where the running turn is stopped from another thread (ADR 0115).

    :func:`drain` runs each step of a turn as a task on the turn's private loop and binds it here;
    :meth:`stop`, called on the stop route's thread, cancels that task through the loop's own
    thread-safe door. A stop that lands between two steps cancels the next one once it is inside
    the turn, never before it starts, so the harness always sees the cancellation and writes the
    one ``cancelled`` row. Nothing here takes the writer lock.
    """

    def __init__(self, origin: str) -> None:
        self.origin = origin
        self.stopped = False
        self._lock = threading.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._step: asyncio.Future[Any] | None = None

    def bind(self, loop: asyncio.AbstractEventLoop, step: asyncio.Future[Any]) -> None:
        """The step the turn is about to run. Called on the turn's own thread."""
        with self._lock:
            self._loop, self._step = loop, step
            if self.stopped:
                # Queued behind the step's first pass, so the cancellation lands inside the turn.
                loop.call_soon(step.cancel)

    def stop(self) -> None:
        """Stop the turn. Safe from any thread; a second call changes nothing."""
        with self._lock:
            self.stopped = True
            loop, step = self._loop, self._step
            if loop is None or step is None or step.done():
                return
            with suppress(RuntimeError):  # the loop closed as the turn ended on its own
                loop.call_soon_threadsafe(step.cancel)


def drain(
    events: AsyncIterator[ChannelEvent], door: TurnDoor | None = None
) -> Iterator[ChannelEvent]:
    """Pull an async stream one event at a time on a private loop.

    Frame by frame, not turn by turn: the handler writes each event as it is produced, and a
    ``run_until_complete`` over the whole generator would buffer a decision card behind the rest
    of the turn. The loop is private to this turn, because the daemon's threads have none.

    Each step is a task bound to ``door``, so a stop cancels the step the turn is waiting in. The
    harness writes the ``cancelled`` row as the cancellation passes through it, and the stream
    then ends in ``turn.error``, not at a socket that simply closes (ADR 0115).
    """
    loop = asyncio.new_event_loop()
    try:
        while True:
            step = asyncio.ensure_future(events.__anext__(), loop=loop)
            if door is not None:
                door.bind(loop, step)
            try:
                event = loop.run_until_complete(step)
            except StopAsyncIteration:
                return
            except asyncio.CancelledError:
                if door is None or not door.stopped:
                    raise
                yield TurnError(reason="cancelled", detail=STOPPED_DETAIL)
                return
            yield event
    finally:
        # A caller that stopped early (a client hung up) leaves the generator suspended; closing
        # it on the same loop runs its ``finally`` blocks before the loop goes away.
        if isinstance(events, AsyncGenerator):
            with suppress(RuntimeError, StopAsyncIteration):
                loop.run_until_complete(events.aclose())
        # A generator the closed one was iterating (the lane's ``async for`` over the harness) is
        # not closed with it: the loop finalises it as a task of its own. Run those to the end too,
        # or the harness never hears the hang-up and the turn has no row.
        with suppress(RuntimeError):
            loop.run_until_complete(loop.shutdown_asyncgens())
            leftover = asyncio.all_tasks(loop)
            if leftover:
                loop.run_until_complete(asyncio.gather(*leftover, return_exceptions=True))
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
        # The WebSocket paths, so a shell knows whether push-to-talk has anywhere to go before
        # it captures a microphone. Empty when no voice backend was configured.
        "sockets": daemon.sockets.listing(),
    }


# --- POST /manifest ------------------------------------------------------------------------------


def manifest(daemon: AthenaDaemon, request: Request) -> Reply:
    """Merge one page's capability manifest, whole or not at all (README §3.3).

    Three things happen together under the writer lock and they are one act: the origin's entries
    replace whatever it had, the app is pinned to the origin its manifest was published from
    (policy rule 3), and the session for that origin is opened or refreshed. A manifest that fails
    any check changes none of the three, so a refused manifest leaves the origin exactly the tools
    it already had — a half-merged origin is a gate with a hole in it.

    This door is a page's. A connector registers in process (``Catalog.merge_connector``), bound
    to its port; a body that says ``origin_kind: connector`` is refused here, or it would replace
    a registered connector's entries with executor-less ones. Every precondition of the pin and
    the session is checked before the merge, and if either still raises after it, the origin and
    the pin are put back before the error leaves.
    """
    try:
        parsed = HostManifest.from_dict(dict(request.body))
    except (AttributeError, TypeError, ValueError) as exc:
        return error(400, "manifest_invalid", f"malformed manifest: {type(exc).__name__}: {exc}")
    try:
        problems = parsed.validate()
    except Exception as exc:
        # ``validate`` reads a page's own structure. Whatever it trips on is that structure being
        # wrong, which is this route's refusal and never the dispatcher's 500.
        return error(400, "manifest_invalid", f"malformed manifest: {type(exc).__name__}: {exc}")
    if parsed.origin_kind != "host":
        problems = [
            *problems,
            f"origin_kind must be 'host' here, got {parsed.origin_kind!r}: a connector registers "
            "in process, never through POST /manifest",
        ]
    if not parsed.page_origin.strip():
        # The contract allows an absent ``page_origin`` because a connector has none. A page does
        # not: it is the session key and the thing rule 3 pins to, so the daemon requires it.
        problems = [*problems, "page_origin is required: it is the session this manifest opens"]
    if parsed.app_id.strip():
        try:
            ids.conversation_for_app(parsed.app_id)
        except ValueError as exc:
            problems = [*problems, f"app_id cannot key a session: {exc}"]
    if problems:
        return 400, {
            "ok": False,
            "reason": "manifest_invalid",
            "detail": f"manifest {parsed.app_id!r} is refused whole",
            "app_id": parsed.app_id,
            "problems": problems,
        }

    with daemon.writing():
        held = daemon.catalog.held(parsed.registry_origin)
        policy = daemon.gate.policy
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
        try:
            daemon.pin(parsed.app_id, parsed.page_origin)
            session = daemon.sessions.touch(parsed.page_origin, parsed.app_id, tools=len(names))
        except BaseException:
            # The checks above should leave nothing for these two to refuse. If one raises anyway,
            # the merge is undone before the error answers, so even a 500 changes none of the three.
            daemon.gate.policy = policy
            daemon.catalog.put_back(parsed.registry_origin, held)
            raise

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
        return error(403, "foreign_origin", NO_PAGE_SENTENCE)
    project_id = str(body.get("project_id", "") or "")
    if project_id and not ids.is_id("project", project_id):
        return error(400, "unknown_ref", f"not a project id: {project_id!r}")
    case_id = str(body.get("case_id", "") or "")
    if case_id and not ids.is_id("project", case_id):
        return error(400, "unknown_ref", f"not a case id: {case_id!r}")

    try:
        ctx = turn_context(
            daemon,
            session,
            project_id,
            case_id=case_id,
            surface=str(body.get("surface") or "panel"),
            disabled_origins=disabled_origins_from(body),
            gated_origins=gated_origins_from(body),
            gated_tools=gated_tools_from(body),
            capture_id=capture_id_from(body),
            tab=tab_from(body),
            tainted_by=tainted_by_from(body),
            open_apps=open_apps_from(body),
        )
    except ListTooLong as exc:
        return error(400, "validator_failed", str(exc))
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


class ListTooLong(ValueError):
    """A request named more origins or tools than the cap allows; the request is refused whole."""


def capture_id_from(body: Mapping[str, Any]) -> str | None:
    """``capture_id`` off a request body: the shell's capture of the focused tab (ADR 0066).

    A value that is not a capture id is read as none, so a malformed field files a card without
    a screenshot and never a card that points at something else.
    """
    raw = body.get("capture_id")
    if isinstance(raw, str) and ids.is_id("capture", raw.strip()):
        return raw.strip()
    return None


def tab_from(body: Mapping[str, Any]) -> tuple[int | None, int | None]:
    """``tab_id`` and ``tab_nav`` off a request body: the tab the surface ran it on (ADR 0103).

    The shell's own tab id and that tab's navigation counter, which a card for a gated call on
    the session's app carries so its approval runs on that document or not at all. A value that
    is not a non-negative integer is read as none - an unbound card behaves as cards always did -
    and a generation without a tab is dropped, because it would bind to nothing.
    """

    def count(key: str) -> int | None:
        raw = body.get(key)
        if isinstance(raw, int) and not isinstance(raw, bool) and raw >= 0:
            return raw
        return None

    tab_id = count("tab_id")
    return (tab_id, count("tab_nav") if tab_id is not None else None)


def disabled_origins_from(body: Mapping[str, Any]) -> frozenset[str]:
    """``disabled_origins`` off a request body: the apps the user switched off for this run.

    The origins table lives in the shell's store, so the shell says it on every request and the
    daemon keeps none of it. A value that is not a list of strings is read as an empty list --
    nothing extra is refused -- because a malformed field must not switch an app *on*; the shell
    is the one that decides, and it sends well-formed JSON. A list longer than the cap raises
    :class:`ListTooLong`: cutting it would read the origins past the cap as switched on.
    """
    return _names_from(body, "disabled_origins", MAX_DISABLED_ORIGINS)


def gated_origins_from(body: Mapping[str, Any]) -> frozenset[str]:
    """``gated_origins`` off a request body: the apps this turn sees for the first time (ADR 0063).

    The host origins (``host:<app_id>``) of open tabs the user's origins table has no row for.
    Every tool of one is ``GATED`` at the gate, whatever its flags say. The shell says the list on
    every request and the daemon keeps none of it. Read the way ``disabled_origins`` is: a value
    that is not a list of strings tightens nothing, which is what a caller that sends no list
    gets -- the classes the manifest's flags imply.
    """
    return _names_from(body, "gated_origins", MAX_GATED_NAMES)


def gated_tools_from(body: Mapping[str, Any]) -> frozenset[str]:
    """``gated_tools`` off a request body: the registry names the user pinned ``GATED`` (ADR 0063).

    ``host.<app_id>.<tool>`` on an origin the user trusts. Read as :func:`gated_origins_from` is.
    """
    return _names_from(body, "gated_tools", MAX_GATED_NAMES)


def tainted_by_from(body: Mapping[str, Any]) -> frozenset[str]:
    """``tainted_by`` off a request body: other tabs whose text was read this exchange (ADR 0105).

    The web origins of the tabs a ``tabs_read`` returned text from since the user's last message.
    While any is named, every host call files a card that names them. Read as
    :func:`gated_origins_from` is: a malformed value tightens nothing, and a list past the cap is
    refused whole, because a cut one would loosen.
    """
    return _names_from(body, "tainted_by", MAX_GATED_NAMES)


def open_apps_from(body: Mapping[str, Any]) -> tuple[OpenApp, ...]:
    """``open_apps`` off a request body: other open tabs whose app the user trusts (ADR 0106).

    Each item is ``{"app": "host:<app_id>", "origin": "https://...", "tab_id": n, "tab_nav": m}``,
    set by the surface from the shell's tab list and the origins table. This list is the one
    request field that lets something through policy - a call of a listed app may be *proposed*,
    and the gate files it as a card bound to that tab - so anything malformed is dropped rather
    than guessed at: an item with no catalog-form ``app``, no web ``origin`` or no tab id is not
    open, and an app named twice is ambiguous about its tab, so both are dropped. Dropping only
    refuses more. A list past the cap is refused whole like the others.
    """
    raw = body.get("open_apps")
    if not isinstance(raw, list):
        return ()
    if len(raw) > MAX_GATED_NAMES:
        raise ListTooLong(
            f"open_apps names {len(raw)} entries; the most one request may name is "
            f"{MAX_GATED_NAMES}"
        )

    def count(value: Any) -> int | None:
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
            return value
        return None

    found: list[OpenApp] = []
    for item in raw:
        if not isinstance(item, Mapping):
            continue
        app, origin, tab_id = item.get("app"), item.get("origin"), count(item.get("tab_id"))
        if not isinstance(app, str) or not isinstance(origin, str) or tab_id is None:
            continue
        try:
            parsed = parse_origin(app.strip())
        except ValueError:
            continue
        if parsed.kind != "host" or not origin.strip().startswith(("http://", "https://")):
            continue
        found.append(OpenApp(str(parsed), origin.strip(), tab_id, count(item.get("tab_nav"))))
    named = [app.origin for app in found]
    return tuple(app for app in found if named.count(app.origin) == 1)


def _names_from(body: Mapping[str, Any], key: str, cap: int) -> frozenset[str]:
    """The non-empty strings of ``body[key]``, stripped; anything else is empty.

    A list longer than ``cap`` raises :class:`ListTooLong` -- these lists only tighten the gate or
    switch an origin off, so a cut one would loosen it.
    """
    raw = body.get(key)
    if not isinstance(raw, list):
        return frozenset()
    if len(raw) > cap:
        raise ListTooLong(f"{key} names {len(raw)} entries; the most one request may name is {cap}")
    return frozenset(item.strip() for item in raw if isinstance(item, str) and item.strip())


def turn_context(
    daemon: AthenaDaemon,
    session: Session,
    project_id: str = "",
    *,
    surface: str = "panel",
    trigger: str = "cli",
    disabled_origins: frozenset[str] = frozenset(),
    gated_origins: frozenset[str] = frozenset(),
    gated_tools: frozenset[str] = frozenset(),
    capture_id: str | None = None,
    tab: tuple[int | None, int | None] = (None, None),
    tainted_by: frozenset[str] = frozenset(),
    open_apps: tuple[OpenApp, ...] = (),
    case_id: str = "",
) -> TurnContext:
    """The context one turn runs under, and the session refreshed for it.

    Shared by ``POST /run`` and the voice gateway, so a spoken turn and a typed one differ in
    exactly the two words the ledger rolls up by — ``surface`` and ``trigger`` — and in nothing
    about which conversation, app or page origin the gate judges them against.
    """
    conversation = conversation_for(session, project_id)
    ctx = TurnContext(
        conversation_id=conversation,
        turn_id=ids.mint("turn"),
        lane=Lane.BROWSER,
        surface=surface,
        trigger=trigger,
        session_id=session.origin,
        app_id=session.app_id,
        page_origin=session.origin,
        project_id=project_id or None,
        case_id=case_id or project_id or None,
        disabled_origins=disabled_origins,
        gated_origins=gated_origins,
        gated_tools=gated_tools,
        capture_id=capture_id,
        tab_id=tab[0],
        tab_nav=tab[1],
        tainted_by=tainted_by,
        open_apps=open_apps,
    )
    daemon.sessions.touch(session.origin, session.app_id, tools=session.tools)
    return ctx


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
    """The turn's frames: :func:`turn_events`, one SSE frame per event (ADR 0012)."""
    for event in turn_events(
        daemon, ctx, message=message, host_state=host_state, results=results, project=project
    ):
        yield sse_frame(event)


def turn_events(
    daemon: AthenaDaemon,
    ctx: TurnContext,
    *,
    message: str,
    host_state: Mapping[str, Any],
    results: tuple[Any, ...],
    project: Mapping[str, Any] | None,
) -> Generator[ChannelEvent, None, None]:
    """One turn's events, with the writer lock held for exactly as long as the turn runs.

    The lock lives here rather than around the route because the route returns before a single
    event is produced. A turn that dies mid-stream still releases it: the ``with`` block is inside
    the generator, and the handler closes the generator when a client hangs up. The voice gateway
    drives the same generator, so a spoken turn holds the lock exactly the way a typed one does.
    """
    with daemon.writing(), daemon.turn_door(ctx.page_origin or "") as door:
        stamped = stamp_case_turn(daemon, ctx)
        try:
            last = last_run_of(daemon, ctx.case_id)
            if last is not None and last.started:
                ctx = replace(ctx, spent_since=last.started)
            events = daemon.lane.run(
                message,
                ctx,
                host_state=host_state,
                tool_results=results,
                active_project=project,
                pending_decisions=pending_lines(daemon),
                since_last_run=last,
            )
            yield from drain(events, door)
        except Exception as exc:  # a lane bug ends the stream honestly, never silently
            # The type only: an exception's message can quote a request body, and a body may hold
            # anything the caller put in it.
            yield TurnError(reason="unknown", detail=type(exc).__name__)
        finally:
            if stamped:
                daemon.case_turns.finish(ctx.turn_id)


def stamp_case_turn(daemon: AthenaDaemon, ctx: TurnContext) -> bool:
    """Stamp ``ctx``'s turn under the case it names, as it begins (ADR 0127); ``False`` for a
    turn under no case. The turn keeps its own conversation: the stamp is what a receipt joins
    the turn's cards and ledger rows by. Called with the writer lock held, so a turn's window
    holds only what that turn wrote."""
    if not ctx.case_id:
        return False
    daemon.case_turns.record(ctx.case_id, ctx.turn_id, ctx.conversation_id)
    return True


def last_run_of(daemon: AthenaDaemon, case_id: str | None) -> SinceLastRun | None:
    """The last run of case ``case_id``'s chore, for this turn's frame (ADR 0126).

    Keyed on the case the turn names (``TurnContext.case_id``), never on its conversation.
    ``None`` for a turn under no case, a daemon with nothing bound, or a case with no stored
    receipt; and ``None`` when the case file cannot be read, because what a past run came to is
    context for this one and a turn never fails for want of it.
    """
    if not case_id or daemon.last_run is None:
        return None
    try:
        return daemon.last_run(case_id)
    except Exception:  # an unreadable case file is no "since last run", never a failed turn
        return None


def pending_lines(daemon: AthenaDaemon, limit: int = PENDING_LINES) -> list[str]:
    """One line per card still waiting on the user, for the turn frame (README §3.2 step 2).

    The daemon owns the inbox, so the daemon supplies these; the lane composes them and the
    composer bounds them. Nothing here is a decision — a pending card is told to the model so it
    can say what it is waiting for, never so it can answer one.
    """
    page = daemon.approvals.pending(limit)
    lines = [
        f"{row.id}: {row.action} {json.dumps(row.params, sort_keys=True, default=str)}"
        for row in page.rows
    ]
    # Every card goes to the composer, which names as many as its bound allows and announces the
    # rest against the true count (ADR 0052); a line is cut, never a card dropped silently.
    return [
        line if len(line) <= PENDING_LINE_CAP else f"{line[: PENDING_LINE_CAP - 1]}…"
        for line in lines
    ]


# --- POST /run/stop ------------------------------------------------------------------------------


def stop(daemon: AthenaDaemon, request: Request) -> Reply:
    """Stop the turn running for ``origin``, if one is (ADR 0115).

    No writer lock: the turn being stopped holds it. A turn on another origin is not this caller's
    to stop, so it runs on and the answer is ``stopped: false``, as when nothing runs at all.
    """
    origin = str(request.body.get("origin", "")).strip()
    return 200, {"ok": True, "stopped": daemon.stop_turn(origin)}


# --- the read routes -----------------------------------------------------------------------------


def ledger_recent(daemon: AthenaDaemon, request: Request) -> Reply:
    """Recent model invocations, newest first (README §2 invariant 6).

    One row per invocation, failures included — that is all the ledger has ever held. The per-call
    record is the episode, and keeping the two apart is what lets this page be believed.
    """
    limit = bounded(request.query.get("limit"))
    page = daemon.ledger.recent(limit)
    rows = [
        {
            "row_id": row.row_id,
            "turn_id": row.turn_id,
            "created_at": row.created_at,
            "engine": row.engine,
            "model": row.model,
            "conversation_id": row.conversation,
            "origin": row.origin,
            "surface": row.surface,
            "trigger": row.trigger,
            "rounds": row.rounds,
            "input_tokens": row.input_tokens,
            "output_tokens": row.output_tokens,
            "cost_usd": row.cost_usd,
            "cost_estimated": row.cost_estimated,
            "ms": row.ms,
            "is_error": row.is_error,
            "error_reason": row.error_reason,
        }
        for row in page.rows
    ]
    return 200, announced(rows, page.total, "rows")


def ledger_rollup(daemon: AthenaDaemon, request: Request) -> Reply:
    """What was spent, summed on one dimension, dearest first.

    ``by`` is a key of ``ledger.ROLLUP_KEYS`` and nothing else reaches SQL; an unknown dimension
    is refused with the list of the ones that exist rather than answered with an empty table.
    """
    by = request.query.get("by", "model")
    try:
        rows = daemon.ledger.rollup(by)
    except LedgerError as exc:
        return error(400, "unknown_ref", str(exc))
    items = [
        {
            "key": row.key,
            "calls": row.calls,
            "errors": row.errors,
            "rounds": row.rounds,
            "input_tokens": row.input_tokens,
            "output_tokens": row.output_tokens,
            "cost_usd": row.cost_usd,
            "unpriced": row.unpriced,
            "ms": row.ms,
        }
        for row in rows[:MAX_LIMIT]
    ]
    reply = announced(items, len(rows), "rollup")
    reply["by"] = by
    return 200, reply


def playbooks(daemon: AthenaDaemon, request: Request) -> Reply:
    """What the brain has distilled about one origin: its rules, never its raw episodes.

    Ordinary recall with the origin as the query, cut to the procedural kind. This route curates
    nothing — the brain is what puts a procedural there and this only asks for it back — and it
    writes nothing, so a panel polling it costs one read connection and no lock.

    ``total`` is how many procedurals *the recall produced*, not how many the brain holds. The
    number is only honest with that sentence attached, which is why the keyword lane is given the
    route's own ceiling: a default page of six would otherwise come back as a total of six.
    """
    origin = request.query.get("origin", "").strip()
    if not origin:
        return error(400, "validator_failed", "playbooks needs an origin to look up")
    limit = bounded(request.query.get("limit"))
    trace = recall_bundle(daemon.brain, origin, episode_budget=0, keyword_slots=MAX_LIMIT)
    found = [memory for memory in trace.items if memory.kind in PLAYBOOK_KINDS]
    page = found[:limit]
    citations = daemon.brain.source_counts([memory.id for memory in page])
    items = [
        {
            "id": memory.id,
            "kind": memory.kind,
            "excerpt": memory.excerpt,
            "path": memory.path,
            "citations": citations[memory.id],
        }
        for memory in page
    ]
    reply = announced(items, len(found), "items")
    reply["origin"] = origin
    return 200, reply


# --- GET /engines --------------------------------------------------------------------------------


def engines(daemon: AthenaDaemon, request: Request) -> Reply:
    """Which engines this machine can run, as a person would say it (setup's Check again button).

    The probe is a subprocess, so it never runs under the writer lock and never touches the
    brain: a slow ``codex --version`` must not hold a turn, and a turn must not hold this. The
    answer is cached for :data:`ENGINES_TTL_S`; ``?fresh=1`` skips the cache.
    """
    fresh = request.query.get("fresh", "") in ("1", "true")
    return 200, {"ok": True, "engines": daemon.engine_rows(fresh=fresh)}


def engine_row(status: EngineStatus) -> dict[str, str]:
    """One probe as the wire says it: ``found``, ``not_found`` or ``not_logged_in``."""
    if not status.available:
        return {"id": status.name, "state": "not_found", "detail": status.detail}
    if status.logged_in is False:
        return {
            "id": status.name,
            "state": "not_logged_in",
            "detail": f"{status.name} is installed but not signed in; sign in with it once.",
        }
    return {"id": status.name, "state": "found", "detail": status.version or status.detail}


# --- the table -----------------------------------------------------------------------------------


def base_routes(daemon: AthenaDaemon) -> list[Route]:
    """Every route this daemon answers, in the order a reader should meet them.

    The exact paths come before the one prefix path, so ``GET /decisions`` is the inbox and
    ``POST /decisions/<id>`` is one answer, and neither can shadow the other.
    """
    return [
        Route("GET", "/health", lambda request: health(daemon)),
        Route("GET", "/engines", lambda request: engines(daemon, request)),
        Route("POST", "/manifest", lambda request: manifest(daemon, request)),
        Route("POST", "/run", lambda request: run(daemon, request)),
        Route("POST", "/run/stop", lambda request: stop(daemon, request)),
        Route("GET", "/decisions", lambda request: decisions(daemon, request)),
        Route("GET", "/ledger", lambda request: ledger_recent(daemon, request)),
        Route("GET", "/ledger/rollup", lambda request: ledger_rollup(daemon, request)),
        Route("GET", "/playbooks", lambda request: playbooks(daemon, request)),
        Route(
            "POST",
            DECISION_PREFIX,
            lambda request: decide(daemon, request, unquote(request.path[len(DECISION_PREFIX) :])),
            prefix=True,
        ),
    ]


# The decision routes live in their own module, which takes the helpers above from this one, so the
# import closes the cycle from the foot: everything it needs is defined by now. ``decide`` and
# ``decisions`` stay attributes of this module, which is where the table (and a test) look them up;
# ``_decision_ctx`` is kept here for the proving tests that replay a card under it.
from athena.daemon.decisions import _decision_ctx as _decision_ctx  # noqa: E402
from athena.daemon.decisions import decide, decisions  # noqa: E402

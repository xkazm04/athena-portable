"""The remote composer: another device's message runs in this device's own panel (ADR 0140, WP3).

Design decision "Remote acts": a phone or another PC does not call this device's hands. It sends a
*message*, this device's window runs the turn exactly as if its person had typed it - its own page,
its own hands, its own gate and its own cards - and the daemon tees that turn's events back to the
device that asked. One mechanism serves the phone and PC to PC, and a turn has one gate, here.

**Why the window, and not the daemon.** Host calls are client-driven (README §3.2 step 5): ``POST
/run`` answers with ``tool.call`` and the window's run loop runs it on the page and carries the
answer on its next request. Nothing but the window can run a turn that touches a page, so the
daemon's part is only to hand the window the message and to copy what the window's runs stream.

The life of one remote message, by ``request_id`` (a ``job_`` id: a job one device hands another):

1. **Offered.** Peer ``POST /peer/message {text, target_app}`` (grant ``chat``) files a
   :class:`RemoteTurn` and publishes ``remote.message`` on the loopback ``/events`` bus, again every
   :data:`OFFER_EVERY_S`, for up to :data:`OFFER_S`. The window takes it with loopback
   ``POST /remote/<request_id>/accept``. Nobody took it in that time - the window is closed, or was
   between two ``/events`` connections for longer than its reconnect - and the answer is ``409
   window_closed``: the asking side says "Athena on <name> is asleep". Re-publishing rather than
   counting subscribers is deliberate: the ``/events`` stream ends after 15 s of quiet and the
   window reconnects a second later, so "is anyone subscribed right now" is wrong for one second
   in fifteen, and a message published into that second would be lost without anyone saying so.
   The window drops a ``request_id`` it has already seen, so the repeats cost nothing.
2. **Teed.** The window sends ``POST /run`` with ``via: {peer_id, request_id}`` - every request of
   that exchange, continuations and the turn after an answered card included - and
   :meth:`RemoteTurns.observer` copies each of those runs' events into the turn's buffer, the same
   JSON ``/run`` streams (:func:`~athena.daemon.routes.event_payload`). The run itself is the
   ordinary one: ``via`` changes nothing about the session, the context or the gate.
3. **Closed**, on the first of:

   - a ``turn.error`` from any of its runs (the window continues nothing after one);
   - a ``turn.finished`` from a run that proposed no host call still unanswered and filed no card
     still unanswered - the window has nothing left to carry, so no continuation will come;
   - the window saying so: ``POST /remote/<request_id>/end {reason, detail}``. The window is the
     only one who knows an exchange ended *without* another request - the continuation budget
     (``MAX_CONTINUATIONS`` in ``stores/run.ts``) ran out, its person pressed Stop, no page was
     open, a card was declined - so it tells, and a reason other than ``finished`` is teed as a
     ``turn.error`` first;
   - :data:`TURN_TTL_S` with nothing new, which is the backstop for a window that went away.

   A run that finished with host calls proposed, or with a card waiting, leaves the turn open: the
   window will run the calls and continue with the same ``via``, or the card will be answered -
   here, or by a peer through ``/peer/decisions`` - and the turn after it continues it.

The asking device reads ``GET /peer/turns/<request_id>?from=<n>`` (grant ``chat``, and only the
peer that sent the message; any other is a 403): every event from index ``n``, each with its SSE
``id:``, and a last ``remote.closed`` frame once the turn is closed. Like ``/events``, a stream
that has carried nothing for :data:`STREAM_QUIET_S` ends with ``retry`` (ADR 0011: every response
ends) and the reader comes back with ``from`` set to the count it has; a reader that missed
nothing is never shown an event twice.

**Approvals** (design decision "Approvals"): the card is this device's gate's, and a peer granted
``approve`` sees it and may answer it. ``GET /peer/decisions`` is the loopback inbox's own listing;
``POST /peer/decisions/<id>`` is the loopback answer's own path, with no origin stated - the row's
own origin decides, as it does for a surface that names none. Answered once, it is spent here.
An approval of a host tool releases an ``execute`` the *page* must run, and the page is this
device's, so the answer is also published as ``remote.decided`` for the window to run it and
continue - otherwise a phone's "yes" would spend the card and run nothing.

**The asking side's loopback routes.** ``POST /devices/<peer_id>/message`` forwards to that peer
with the token this device holds for it (:class:`~athena.peer.client.PeerKeys`), and ``GET
/devices/<peer_id>/turns/<request_id>`` relays that peer's stream to the window. The relay is the
one outbound connection here that is not :func:`~athena.peer.client.call`, because ``call`` reads
a whole JSON answer and a turn's stream must reach the window as it is written; it keeps ``call``'s
discipline - a fixed timeout, ``Connection: close``, a bounded read, nothing logged, an exception
reduced to its type.
"""

from __future__ import annotations

import json
import re
import threading
import time
from collections.abc import Callable, Iterator, Mapping
from contextlib import suppress
from dataclasses import dataclass, field
from functools import partial
from http.client import HTTPConnection, HTTPResponse
from typing import TYPE_CHECKING, Any
from urllib.parse import quote, urlsplit

from athena.contracts import ids
from athena.contracts.channel import (
    ChannelEvent,
    DecisionRequested,
    DecisionResolved,
    ToolCall,
    ToolResult,
    TurnError,
    TurnFinished,
)
from athena.contracts.harness import normalize_reason
from athena.daemon.routes import (
    EventStream,
    Reply,
    Request,
    Route,
    decide,
    decisions,
    error,
    event_payload,
)
from athena.peer.client import CALL_TIMEOUT_S, MAX_ANSWER_BYTES, call
from athena.peer.events import RETRY_MS, event_frame
from athena.peer.listener import PeerRoute, peer_error, peer_of

if TYPE_CHECKING:
    from athena.daemon.server import AthenaDaemon
    from athena.peer.listener import PeerHost
    from athena.peer.registry import PeerRow

__all__ = [
    "CLOSED_KIND",
    "MAX_TEXT_CHARS",
    "OFFER_S",
    "STREAM_QUIET_S",
    "TURN_TTL_S",
    "RemoteTurn",
    "RemoteTurns",
    "loopback_routes",
    "peer_routes",
    "resume_index",
    "wire",
]

#: How long a message is offered to the window before the asker is told it is asleep. Longer than
#: the ``/events`` reconnect (``retry: 1000``), so a window between two streams still takes it.
OFFER_S = 3.0
OFFER_EVERY_S = 0.5
#: How long a turn is kept after its last event. Also how long a closed one stays readable.
TURN_TTL_S = 600.0
#: The longest message a peer may send. A longer one is refused, never cut: a cut instruction is a
#: different instruction.
MAX_TEXT_CHARS = 8000
#: How many remote turns may be held at once; past it a new message is refused (429).
MAX_TURNS = 32
#: How many events one turn's buffer keeps. Past it the rest are counted, not kept, and the
#: closing frame says ``(showing N of M)``.
MAX_EVENTS = 2000
#: A turn stream that carries nothing for this long ends, and its reader comes back with ``from``.
STREAM_QUIET_S = 15.0
#: The relay's socket patience: past the peer's quiet window, so only a dead peer trips it.
RELAY_TIMEOUT_S = STREAM_QUIET_S + 10.0
#: The last frame of a closed turn's stream.
CLOSED_KIND = "remote.closed"
#: The ``end`` reason that says the exchange settled with nothing wrong.
FINISHED = "finished"

_REQUEST_ID = r"job_[0-9a-f]{12}"
_DEVICE_ID = r"dev_[0-9a-f]{12}"


# --- the turns -----------------------------------------------------------------------------------


@dataclass
class RemoteTurn:
    """One message another device sent, and everything its runs here have streamed so far."""

    request_id: str
    peer_id: str
    peer_name: str
    text: str
    target_app: str | None
    touched: float
    state: str = "offered"  # offered | accepted | closed
    events: list[dict[str, Any]] = field(default_factory=list)
    total: int = 0
    #: Host calls the latest run proposed and nothing has answered: the window will continue.
    calls: set[str] = field(default_factory=set)
    #: Cards its runs filed that have not been answered through this module.
    cards: set[str] = field(default_factory=set)
    closed: dict[str, Any] | None = None

    def announcement(self) -> dict[str, Any]:
        """The ``remote.message`` payload's fields. Never a token: the asker is named, not keyed."""
        return {
            "request_id": self.request_id,
            "peer_id": self.peer_id,
            "peer_name": self.peer_name,
            "text": self.text,
            "target_app": self.target_app,
        }


class TooMany(Exception):
    """:data:`MAX_TURNS` remote turns are already held."""


class RemoteTurns:
    """The remote turns this daemon holds, in memory: offered, teed, closed, expired."""

    def __init__(
        self,
        publish: Callable[..., None],
        *,
        clock: Callable[[], float] = time.monotonic,
        offer_s: float = OFFER_S,
        ttl_s: float = TURN_TTL_S,
        quiet_s: float = STREAM_QUIET_S,
    ) -> None:
        self._publish = publish
        self._clock = clock
        self.offer_s = offer_s
        self.ttl_s = ttl_s
        self.quiet_s = quiet_s
        self._cond = threading.Condition()
        self._turns: dict[str, RemoteTurn] = {}

    # -- offered ---------------------------------------------------------------------------------

    def offer(self, peer: PeerRow, text: str, target_app: str | None) -> RemoteTurn | None:
        """Offer a message to the window; the turn once it took it, ``None`` if nobody did."""
        with self._cond:
            self._sweep()
            if len(self._turns) >= MAX_TURNS:
                raise TooMany
            turn = RemoteTurn(
                request_id=ids.mint("job"),
                peer_id=peer.peer_id,
                peer_name=peer.name,
                text=text,
                target_app=target_app,
                touched=self._clock(),
            )
            self._turns[turn.request_id] = turn
        deadline = self._clock() + self.offer_s
        while True:
            self._publish("remote.message", **turn.announcement())
            with self._cond:
                left = deadline - self._clock()
                self._cond.wait_for(
                    lambda: turn.state != "offered", timeout=max(0.0, min(OFFER_EVERY_S, left))
                )
                if turn.state != "offered":
                    return turn
                if self._clock() >= deadline:
                    self._turns.pop(turn.request_id, None)
                    return None

    def accept(self, request_id: str) -> RemoteTurn | None:
        """The window took the message. ``None`` for one never offered, or already given up on."""
        with self._cond:
            turn = self._turns.get(request_id)
            if turn is None or turn.state == "closed":
                return None
            turn.state = "accepted"
            turn.touched = self._clock()
            self._cond.notify_all()
            return turn

    def get(self, request_id: str) -> RemoteTurn | None:
        with self._cond:
            self._sweep()
            return self._turns.get(request_id)

    # -- teed ------------------------------------------------------------------------------------

    def observer(self, via: Any) -> Callable[[ChannelEvent], None] | None:
        """What ``POST /run`` calls with each event of a run carrying ``via``; ``None`` to tee none.

        A ``via`` that names no accepted turn of that peer tees nothing and fails nothing: the run
        is the window's own and goes ahead whatever became of the message it continues.
        """
        if not isinstance(via, Mapping):
            return None
        request_id, peer_id = via.get("request_id"), via.get("peer_id")
        with self._cond:
            turn = self._turns.get(request_id) if isinstance(request_id, str) else None
            if turn is None or turn.peer_id != peer_id or turn.state != "accepted":
                return None
            # A new run of the exchange: the previous run's calls are answered in its request.
            turn.calls.clear()
            turn.touched = self._clock()

        def see(event: ChannelEvent) -> None:
            self._record(turn, event)

        return see

    def _record(self, turn: RemoteTurn, event: ChannelEvent) -> None:
        with self._cond:
            if turn.closed is not None:
                return
            self._append(turn, event_payload(event))
            if isinstance(event, ToolCall) and event.origin != "core":
                turn.calls.add(event.call_id)
            elif isinstance(event, ToolResult):
                turn.calls.discard(event.call_id)
            elif isinstance(event, DecisionRequested):
                turn.cards.add(event.id)
            elif isinstance(event, DecisionResolved):
                turn.cards.discard(event.id)
            if isinstance(event, TurnError):
                self._close(turn, "error")
            elif isinstance(event, TurnFinished) and not turn.calls and not turn.cards:
                self._close(turn, FINISHED)

    def resolved(self, approval_id: str, events: list[dict[str, Any]]) -> None:
        """A card was answered through ``/peer/decisions``: tee it to the turn that filed it."""
        with self._cond:
            for turn in self._turns.values():
                if approval_id in turn.cards and turn.closed is None:
                    turn.cards.discard(approval_id)
                    for payload in events:
                        self._append(turn, payload)

    def end(self, request_id: str, reason: str, detail: str = "") -> bool:
        """The window says the exchange is over. ``False`` for a turn this daemon does not hold."""
        with self._cond:
            turn = self._turns.get(request_id)
            if turn is None:
                return False
            if turn.closed is None:
                if reason != FINISHED:
                    word = normalize_reason(reason) or "unknown"
                    self._append(turn, event_payload(TurnError(reason=word, detail=detail)))
                self._close(turn, FINISHED if reason == FINISHED else "error")
            return True

    def _append(self, turn: RemoteTurn, payload: dict[str, Any]) -> None:
        turn.total += 1
        turn.touched = self._clock()
        if len(turn.events) < MAX_EVENTS:
            turn.events.append(payload)
        self._cond.notify_all()

    def _close(self, turn: RemoteTurn, why: str) -> None:
        shown, total = len(turn.events), turn.total
        turn.state = "closed"
        turn.closed = {
            "kind": CLOSED_KIND,
            "request_id": turn.request_id,
            "reason": why,
            "showing": shown,
            "total": total,
            "footer": "" if shown >= total else f"(showing {shown} of {total})",
        }
        self._cond.notify_all()

    def _sweep(self) -> None:
        """Forget every turn quiet for :attr:`ttl_s`. Called with the condition held."""
        now = self._clock()
        for request_id in [r for r, t in self._turns.items() if now - t.touched >= self.ttl_s]:
            turn = self._turns.pop(request_id)
            if turn.closed is None:
                self._close(turn, "expired")

    # -- read back -------------------------------------------------------------------------------

    def frames(self, turn: RemoteTurn, start: int = 0) -> Iterator[str]:
        """The asker's stream: events from ``start``, then ``remote.closed``, or end on quiet."""
        yield f": athena turn\nretry: {RETRY_MS}\n\n"
        index = max(0, start)
        while True:
            with self._cond:
                self._cond.wait_for(partial(_moved, turn, index), timeout=self.quiet_s)
                batch = turn.events[index:]
                closed = turn.closed
            if not batch and closed is None:
                return
            for offset, payload in enumerate(batch):
                yield f"id: {index + offset}\n{event_frame(payload)}"
            index += len(batch)
            if closed is not None:
                yield event_frame(closed)
                return


def resume_index(query: Mapping[str, str]) -> int:
    """``?from=<n>`` as the index a turn stream resumes at: ASCII digits, else ``0``.

    ``str.isdigit`` alone admits ``"²"``, which ``int`` refuses: that was a 500 from the route.
    """
    start = query.get("from", "0")
    return int(start) if start.isascii() and start.isdigit() else 0


def _moved(turn: RemoteTurn, index: int) -> bool:
    """Whether a reader at ``index`` has something new: an event, or the close."""
    return index < len(turn.events) or turn.closed is not None


# --- the peer routes -----------------------------------------------------------------------------


def _peer_name(host: PeerHost) -> str:
    return host.identity.identity.name


def peer_message(host: PeerHost, turns: RemoteTurns, request: Request) -> Reply:
    row = peer_of(request)
    text, target = request.body.get("text"), request.body.get("target_app")
    if not isinstance(text, str) or not text.strip():
        return peer_error(400, "bad_request", "text is required")
    if len(text) > MAX_TEXT_CHARS:
        return peer_error(400, "bad_request", f"text is longer than {MAX_TEXT_CHARS} characters")
    if target is not None and (not isinstance(target, str) or not target.strip()):
        return peer_error(400, "bad_request", "target_app is an app id or null")
    try:
        turn = turns.offer(row, text, target.strip() if isinstance(target, str) else None)
    except TooMany:
        return peer_error(429, "busy", f"{MAX_TURNS} messages are already waiting here")
    name = _peer_name(host)
    if turn is None:
        return peer_error(
            409, "window_closed", f"Athena on {name} is asleep: open it there", name=name
        )
    return 200, {"ok": True, "request_id": turn.request_id, "name": name}


def peer_turn(turns: RemoteTurns, request: Request, request_id: str) -> Reply | EventStream:
    row = peer_of(request)
    turn = turns.get(request_id)
    if turn is None:
        return peer_error(404, "not_found", "no such message, or it expired")
    if turn.peer_id != row.peer_id:
        # A turn's stream is the asker's alone; another paired device learns nothing of it.
        return peer_error(403, "not_sender", "only the device that sent this message reads it")
    return EventStream(turns.frames(turn, resume_index(request.query)))


def peer_decisions(daemon: AthenaDaemon, request: Request) -> Reply:
    return decisions(daemon, Request(method="GET", path="/decisions", query=request.query))


def peer_decide(
    host: PeerHost, daemon: AthenaDaemon, turns: RemoteTurns, request: Request, approval_id: str
) -> Reply:
    row = peer_of(request)
    choice, answer = request.body.get("choice"), request.body.get("answer")
    if not isinstance(choice, str) or not choice.strip():
        return peer_error(400, "bad_request", "a decision needs a choice")
    body: dict[str, Any] = {"choice": choice}
    if isinstance(answer, str) and answer.strip():
        body["answer"] = answer
    # The loopback answer's own path, with no origin stated: the row's origin decides (decide()).
    status, reply = decide(
        daemon, Request(method="POST", path=f"/decisions/{approval_id}", body=body), approval_id
    )
    if status != 200:
        return status, reply
    events = [e for e in reply.get("events", []) if isinstance(e, dict)]
    turns.resolved(approval_id, events)
    host.publish(
        "remote.decided",
        approval_id=approval_id,
        peer_id=row.peer_id,
        peer_name=row.name,
        status=reply.get("status"),
        execute=reply.get("execute", []),
        output=reply.get("output", ""),
    )
    return status, reply


def peer_routes(host: PeerHost, daemon: AthenaDaemon, turns: RemoteTurns) -> list[PeerRoute]:
    def tail(request: Request, prefix: str) -> str:
        return request.path[len(prefix) :]

    return [
        PeerRoute("POST", "/peer/message", lambda r: peer_message(host, turns, r), grant="chat"),
        PeerRoute(
            "GET",
            "/peer/turns/",
            lambda r: peer_turn(turns, r, tail(r, "/peer/turns/")),
            prefix=True,
            grant="chat",
        ),
        PeerRoute("GET", "/peer/decisions", lambda r: peer_decisions(daemon, r), grant="approve"),
        PeerRoute(
            "POST",
            "/peer/decisions/",
            lambda r: peer_decide(host, daemon, turns, r, tail(r, "/peer/decisions/")),
            prefix=True,
            grant="approve",
        ),
    ]


# --- the loopback routes -------------------------------------------------------------------------


@dataclass(frozen=True)
class ShapedRoute(Route):
    """A loopback route whose path is a pattern, so it claims only the paths it can answer.

    ``POST /devices/<peer_id>/message`` sits beside WP1's ``/devices/*`` routes and whatever a later
    package adds there; a plain prefix ``/devices/`` would shadow every one registered after it.
    """

    shape: str = ""

    def claims(self, path: str) -> bool:
        return re.fullmatch(self.shape, path) is not None

    def part(self, path: str, index: int) -> str:
        found = re.fullmatch(self.shape, path)
        return found.group(index) if found else ""


#: What the asking side says when it was never let in on the other device.
NO_KEY = "this computer holds no key for that device"


def _keyed(host: PeerHost, peer_id: str) -> tuple[str, str] | None:
    """Where ``peer_id`` listens and the token this device calls it with, or ``None``."""
    url, token = host.keys.url(peer_id), host.keys.token(peer_id)
    return None if url is None or token is None else (url, token)


def send_message(host: PeerHost, request: Request, peer_id: str) -> Reply:
    text, target = request.body.get("text"), request.body.get("target_app")
    if not isinstance(text, str) or not text.strip():
        return error(400, "validator_failed", "text is required")
    if len(text) > MAX_TEXT_CHARS:
        return error(400, "validator_failed", f"text is longer than {MAX_TEXT_CHARS} characters")
    keyed = _keyed(host, peer_id)
    if keyed is None:
        return error(404, "unknown_ref", NO_KEY)
    url, token = keyed
    answer = call(
        url,
        "POST",
        "/peer/message",
        {"text": text, "target_app": target if isinstance(target, str) else None},
        token=token,
        timeout=OFFER_S + CALL_TIMEOUT_S,
    )
    if not answer.reached:
        return peer_error(502, "peer_unreachable", "that device did not answer")
    if answer.status != 200:
        word = str(answer.body.get("error") or "unknown")
        extra = {"name": answer.body["name"]} if isinstance(answer.body.get("name"), str) else {}
        return peer_error(answer.status, word, str(answer.body.get("detail") or ""), **extra)
    request_id = answer.body.get("request_id")
    if not isinstance(request_id, str) or not ids.is_id("job", request_id):
        return peer_error(502, "peer_unreachable", "that device answered without a request id")
    return 200, {"ok": True, "request_id": request_id, "peer_id": peer_id}


def relay_turn(
    host: PeerHost, request: Request, peer_id: str, request_id: str
) -> Reply | EventStream:
    keyed = _keyed(host, peer_id)
    if keyed is None:
        return error(404, "unknown_ref", NO_KEY)
    url, token = keyed
    path = f"/peer/turns/{quote(request_id)}?from={resume_index(request.query)}"
    parts = urlsplit(url)
    connection = HTTPConnection(parts.hostname or "", parts.port or 80, timeout=RELAY_TIMEOUT_S)
    try:
        connection.request(
            "GET", path, headers={"Authorization": f"Bearer {token}", "Connection": "close"}
        )
        reply = connection.getresponse()
    except (OSError, ValueError):
        connection.close()
        return peer_error(502, "peer_unreachable", "that device did not answer")
    if reply.status != 200:
        try:
            decoded = json.loads(reply.read(MAX_ANSWER_BYTES) or b"{}")
        except (OSError, ValueError):
            decoded = {}
        finally:
            connection.close()
        body = decoded if isinstance(decoded, dict) else {}
        word = str(body.get("error") or "unknown")
        return peer_error(reply.status, word, str(body.get("detail") or ""))
    return EventStream(_relayed(connection, reply))


def _relayed(connection: HTTPConnection, reply: HTTPResponse) -> Iterator[str]:
    """The peer's frames as they arrive, a frame at a time, until it ends or goes quiet."""
    frame: list[str] = []
    read = 0
    try:
        while True:
            try:
                line = reply.readline(MAX_ANSWER_BYTES)
            except (OSError, ValueError):
                return
            if not line:
                return
            read += len(line)
            if read > 64 * MAX_ANSWER_BYTES:
                return
            text = line.decode("utf-8", errors="replace")
            frame.append(text)
            if text in ("\n", "\r\n"):
                yield "".join(frame)
                frame = []
    finally:
        with suppress(Exception):
            connection.close()


def accept(turns: RemoteTurns, request_id: str) -> Reply:
    turn = turns.accept(request_id)
    if turn is None:
        return error(404, "unknown_ref", "no such message is waiting")
    return 200, {"ok": True, **turn.announcement()}


def end(turns: RemoteTurns, request: Request, request_id: str) -> Reply:
    reason = request.body.get("reason", FINISHED)
    detail = request.body.get("detail", "")
    if not isinstance(reason, str) or not isinstance(detail, str):
        return error(400, "validator_failed", "reason and detail are strings")
    if not turns.end(request_id, reason.strip() or FINISHED, detail[:400]):
        return error(404, "unknown_ref", "no such message")
    return 200, {"ok": True, "request_id": request_id}


def loopback_routes(host: PeerHost, turns: RemoteTurns) -> list[Route]:
    message = ShapedRoute(
        "POST",
        "/devices/<peer_id>/message",
        lambda r: send_message(host, r, message.part(r.path, 1)),
        shape=rf"/devices/({_DEVICE_ID})/message",
    )
    relay = ShapedRoute(
        "GET",
        "/devices/<peer_id>/turns/<request_id>",
        lambda r: relay_turn(host, r, relay.part(r.path, 1), relay.part(r.path, 2)),
        shape=rf"/devices/({_DEVICE_ID})/turns/({_REQUEST_ID})",
    )
    took = ShapedRoute(
        "POST",
        "/remote/<request_id>/accept",
        lambda r: accept(turns, took.part(r.path, 1)),
        shape=rf"/remote/({_REQUEST_ID})/accept",
    )
    ended = ShapedRoute(
        "POST",
        "/remote/<request_id>/end",
        lambda r: end(turns, r, ended.part(r.path, 1)),
        shape=rf"/remote/({_REQUEST_ID})/end",
    )
    return [message, relay, took, ended]


def wire(daemon: AthenaDaemon, host: PeerHost) -> RemoteTurns:
    """Serve the remote composer on both listeners and tee ``POST /run`` by its ``via``."""
    turns = RemoteTurns(host.publish, offer_s=OFFER_S, ttl_s=TURN_TTL_S)
    host.add_routes(peer_routes(host, daemon, turns))
    for route in loopback_routes(host, turns):
        daemon.routes.add(route)
    daemon.via_tee = turns.observer
    return turns

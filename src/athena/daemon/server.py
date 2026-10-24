"""The daemon's socket: threaded, token-checked, one request per connection (README §3.5).

One Athena on 127.0.0.1, beside whatever page is open. The engine, the brain, the gate and the
ledger live in this process; a surface — the shell's panel, a browser extension, ``curl`` —
connects to it over HTTP and speaks JSON. Three decisions are made here and recorded in ADR 0011.

**Threaded, with the writer behind a lock.** The first build served on a single thread because one
SQLite connection had thread affinity, so a forty-second turn stalled ``/health`` and every other
read behind it. Here the brain has one writer connection and hands out a read-only connection per
read (ADR 0003), so the server can be a ``ThreadingHTTPServer``: reads answer concurrently, and
the routes that write queue on :meth:`AthenaDaemon.writing` without taking the reads down with
them.

**One turn per conversation, not per daemon (ADR 0141).** A turn holds its conversation's lock
(:class:`ThreadLocks`) for its length, and nothing else: two conversations run side by side, and a
second ``POST /run`` into a conversation whose turn is running is refused ``thread_busy`` before
a single SSE header is written. :meth:`AthenaDaemon.writing` is now the *short* write lock, taken
around a merge, an answer to a card or a connector act, and never for a turn's length, so a card
is answered while another thread's turn runs.

**One request per connection.** HTTP/1.1 keep-alive on a single-threaded server let one browser
tab starve every other client: after answering, the handler blocked reading the *same* socket, so
the accept loop never came back. Threading fixes the starvation; ``Connection: close`` on every
response is kept anyway, because it means an idle client holds one worker thread for at most one
request, and because the next commit's SSE stream ends at a closed socket rather than at a length
nobody can know in advance. The cost is a TCP handshake per request on loopback.

**The token is on every route, including ``/health``.** There is no unauthenticated route at all.
A page on any origin can reach 127.0.0.1 — CORS stops it reading the *answer*, never the request —
so an open ``/health`` would let any site in the browser fingerprint the daemon: which engine, how
long up, how many approvals are waiting, which routes exist. Nothing here is worth leaking for the
convenience of a liveness probe, and the shell that spawns the daemon already has the token before
it has the port (the ready line names the token file). The one exception is the CORS preflight: a
browser sends ``OPTIONS`` with no custom headers by definition, so requiring the token there would
make every cross-origin request impossible rather than make anything safer. The preflight carries
no body, reads nothing and says only which methods and headers are allowed.

CORS is the browser's fence and the token is ours. ``chrome-extension://`` origins are always
allowed; anything else must be named by ``--allow-origin`` (the shell passes its own UI origins).
An origin that is not allowed gets no CORS headers at all, and the token check is unaffected
either way.

**A WebSocket is a route that keeps its connection.** ``GET`` with ``Upgrade: websocket`` on a
path in :attr:`AthenaDaemon.sockets` is checked for the token exactly like every other request
— from the header, or from the ``athena-token.<token>`` subprotocol a browser page can send when
it cannot set a header — and then handed the socket for as long as the peer keeps it (ADR 0019).
CORS does not fence a WebSocket, so an ``Origin`` that is not allowed is refused outright.

**A few routes speak bytes.** The voice studio (ADR 0028) posts raw PCM to be transcribed and
gets raw PCM back from a preview. A path in :attr:`AthenaDaemon.raw_paths` is handed its body
unparsed as a :class:`RawRequest` — under its own, larger cap — and a route may answer with a
:class:`BinaryReply`, whose own headers are exposed to a cross-origin reader. Everything else about
the request — the token first, CORS, one request per connection — is the same.
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import socket
import sqlite3
import sys
import threading
import time
from collections.abc import Callable, Generator, Iterator, Mapping, Sequence
from contextlib import contextmanager, suppress
from dataclasses import dataclass, field, replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import TYPE_CHECKING, Any, TextIO
from urllib.parse import parse_qs, urlsplit

from athena.channels.voice.backends import BACKENDS as VOICE_BACKENDS
from athena.channels.voice.backends import backend_from_name
from athena.channels.voice.ws import WebSocket, accept_key, protocol_token
from athena.connectors.mcp.config import CONFIG_FILENAME as MCP_CONFIG_FILENAME
from athena.connectors.mcp.config import load_config as load_mcp_config
from athena.connectors.spec import load_builtin
from athena.connectors.vault import Vault
from athena.contracts import ids
from athena.contracts.channel import ChannelEvent
from athena.core.approvals import Approvals
from athena.core.brain import Brain
from athena.core.brain import paths as brain_paths
from athena.core.case_turns import CaseTurns
from athena.core.catalog import Catalog
from athena.core.ledger import Ledger
from athena.daemon.ready import announce, failure_line, ready_line
from athena.daemon.routes import (
    ENGINES_TTL_S,
    SSE_CONTENT_TYPE,
    BinaryReply,
    EventStream,
    RawRequest,
    Reply,
    Request,
    RouteTable,
    TurnDoor,
    base_routes,
    engine_row,
    error,
)
from athena.daemon.sessions import Sessions
from athena.harness.engines import probe_all
from athena.harness.policy import PolicyHook
from athena.harness.tokenfactory import DEFAULT_MODEL as NEBIUS_DEFAULT_MODEL
from athena.harness.tokenfactory import ENGINE as NEBIUS_ENGINE
from athena.harness.tokenfactory import TokenFactoryModel
from athena.lane.browser_lane import BrowserLane

if TYPE_CHECKING:
    from athena.daemon.tasks import Tasks

__all__ = [
    "ALLOWED_METHODS",
    "DEFAULT_HOST",
    "DEFAULT_PORT",
    "EXTENSION_SCHEME",
    "MAX_BODY_BYTES",
    "MAX_RAW_BODY_BYTES",
    "PEER_PORT",
    "TOKEN_FILENAME",
    "TOKEN_HEADER",
    "AthenaDaemon",
    "BodyCap",
    "DaemonConfig",
    "DaemonServer",
    "SocketFn",
    "SocketTable",
    "ThreadLease",
    "ThreadLocks",
    "bound_url",
    "build_handler",
    "build_parser",
    "make_server",
    "new_token",
    "resolve_token",
    "serve",
]

#: The daemon binds the loopback interface and nothing else, ever. ``--host`` is not a flag. The
#: overlay peer listener is a separate socket owned by :mod:`athena.peer.listener` (ADR 0140).
DEFAULT_HOST = "127.0.0.1"
#: The port a daemon takes when nobody asked for one. A sidecar passes ``--port 0`` instead.
DEFAULT_PORT = 17490
TOKEN_HEADER = "X-Athena-Token"
#: The peer listener's default port (``athena.peer.listener.DEFAULT_PEER_PORT`` is this), defined
#: here so the parser does not import the peer package, which imports this module.
PEER_PORT = 17491
#: Where a minted token is kept when ``--token-file`` did not name somewhere else.
TOKEN_FILENAME = "daemon.json"
EXTENSION_SCHEME = "chrome-extension://"
ALLOWED_METHODS = "GET, POST, PUT, DELETE, OPTIONS"
#: The largest body a route may be handed. A manifest is kilobytes; this is a cap on nonsense,
#: refused before anything is read into memory.
MAX_BODY_BYTES = 1_048_576
#: The cap for a raw body (:attr:`AthenaDaemon.raw_paths`): two minutes of 16 kHz PCM16 mono,
#: which is longer than anyone holds a push-to-talk key.
MAX_RAW_BODY_BYTES = 4 * MAX_BODY_BYTES
#: How much of a body the handler has already refused it will read and throw away, so that the
#: refusal reaches the caller instead of aborting the caller's own write. Eight times the cap: an
#: honest client that sent one manifest too many is answered, and a client that keeps talking
#: past this is dropped rather than listened to forever.
DRAIN_LIMIT = 8 * MAX_BODY_BYTES
#: How much of that is read at a time. Nothing oversized is ever held in memory.
DRAIN_CHUNK = 65_536
#: How long a connection may say nothing before the handler gives up on it. An idle socket costs
#: one worker thread, and daemon threads do not hold the process open, but neither is a reason to
#: keep one forever.
IDLE_TIMEOUT_S = 30


#: What a WebSocket route is: the accepted socket and the request that opened it, on the
#: handler thread, for as long as the function keeps it.
SocketFn = Callable[[WebSocket, Request], None]


class SocketTable:
    """The WebSocket paths the daemon upgrades. Ordered, exact, one function per path."""

    def __init__(self) -> None:
        self._by_path: dict[str, SocketFn] = {}

    def __contains__(self, path: object) -> bool:
        return path in self._by_path

    def __len__(self) -> int:
        return len(self._by_path)

    def add(self, path: str, fn: SocketFn) -> None:
        if path in self._by_path:
            raise ValueError(f"{path} is already a socket")
        self._by_path[path] = fn

    def get(self, path: str) -> SocketFn | None:
        return self._by_path.get(path)

    def listing(self) -> list[str]:
        return list(self._by_path)


class ThreadLease:
    """One conversation's turn lock, held (ADR 0141). :meth:`release` gives it back, once.

    A lease outlives the route that took it: ``POST /run`` takes the lock before it answers, so a
    busy thread is refused while the answer can still be JSON, and the stream that follows gives
    it back. Two parties may therefore try to release one lease - the stream's generator as it
    ends, and the handler when a stream never started - and the second does nothing.
    """

    def __init__(self, locks: ThreadLocks, conversation: str) -> None:
        self.conversation = conversation
        self._locks = locks
        self._mutex = threading.Lock()
        self._released = False

    def release(self) -> None:
        with self._mutex:
            if self._released:
                return
            self._released = True
        self._locks._release(self.conversation)


class ThreadLocks:
    """One lock per conversation, held by the turn running in it (ADR 0141).

    The map holds a conversation only while a turn holds its lock or waits for it: an entry counts
    its users and goes when the last one leaves, so a daemon that has talked in a thousand
    conversations holds no lock for any that is quiet. The guard is only ever held around the map,
    never while a lock is waited for.

    The sleep cycle asks two more things of it (ADR 0143), because a cycle never starts beside a
    live turn: whether any conversation's turn runs now (:meth:`busy_any`), and when the last one
    ended (:meth:`last_released`), so it can wait out a quiet spell after it.
    """

    def __init__(self) -> None:
        self._guard = threading.Lock()
        #: conversation -> (its lock, how many holders and waiters it has)
        self._by_conversation: dict[str, tuple[threading.Lock, int]] = {}
        #: ``time.monotonic()`` when a turn last gave its lock back; ``None`` before the first.
        self._last_released: float | None = None

    def __len__(self) -> int:
        with self._guard:
            return len(self._by_conversation)

    def busy(self, conversation: str) -> bool:
        """Whether a turn holds ``conversation`` now. A snapshot; :meth:`try_take` is the test."""
        with self._guard:
            entry = self._by_conversation.get(conversation)
            return entry is not None and entry[0].locked()

    def busy_any(self) -> bool:
        """Whether a turn holds any conversation now. A snapshot, like :meth:`busy`."""
        with self._guard:
            return any(lock.locked() for lock, _ in self._by_conversation.values())

    def last_released(self) -> float | None:
        """``time.monotonic()`` when a turn last ended here, or ``None`` when none has."""
        with self._guard:
            return self._last_released

    def try_take(self, conversation: str) -> ThreadLease | None:
        """The conversation's lock if it is free now, or ``None`` when a turn holds it."""
        with self._guard:
            lock, users = self._by_conversation.get(conversation, (threading.Lock(), 0))
            if not lock.acquire(blocking=False):
                return None
            self._by_conversation[conversation] = (lock, users + 1)
        return ThreadLease(self, conversation)

    @contextmanager
    def take(self, conversation: str) -> Iterator[ThreadLease]:
        """The conversation's lock, waited for: a spoken turn queues behind a typed one in the same
        conversation, as every turn once queued behind every other (ADR 0011)."""
        with self._guard:
            lock, users = self._by_conversation.get(conversation, (threading.Lock(), 0))
            self._by_conversation[conversation] = (lock, users + 1)
        try:
            lock.acquire()
        except BaseException:
            self._leave(conversation)
            raise
        lease = ThreadLease(self, conversation)
        try:
            yield lease
        finally:
            lease.release()

    def _release(self, conversation: str) -> None:
        with self._guard:
            entry = self._by_conversation.get(conversation)
            self._last_released = time.monotonic()
        if entry is not None:
            entry[0].release()
        self._leave(conversation)

    def _leave(self, conversation: str) -> None:
        with self._guard:
            entry = self._by_conversation.get(conversation)
            if entry is None:
                return
            lock, users = entry
            if users <= 1:
                del self._by_conversation[conversation]
            else:
                self._by_conversation[conversation] = (lock, users - 1)


def new_token() -> str:
    """A fresh daemon token. URL-safe, 192 bits."""
    return secrets.token_urlsafe(24)


@dataclass(frozen=True)
class DaemonConfig:
    """What the flags decided. Everything here is a binding or an origin, never a policy."""

    host: str = DEFAULT_HOST
    port: int = DEFAULT_PORT
    #: The token every request must present. Never empty: there is no unauthenticated mode.
    token: str = ""
    engine: str = "claude_code"
    model: str = ""
    #: Origins allowed by CORS besides ``chrome-extension://*``. Empty means extensions only.
    allow_origins: tuple[str, ...] = ()
    #: The file the token was minted into, for the ready line. ``None`` when it came in on the
    #: command line. The path is published; the token is not.
    token_file: str | None = None

    def cors_allows(self, origin: str) -> bool:
        return bool(origin) and (
            origin.startswith(EXTENSION_SCHEME) or origin in self.allow_origins
        )


@dataclass(frozen=True)
class BodyCap:
    """A larger JSON body cap for the paths that start with ``prefix`` and end with ``suffix``.

    Every route is held to :data:`MAX_BODY_BYTES` except where wiring registers one of these:
    the adopt studio's ``/adopt/<sid>/documents``, whose body is a base64 document (ADR 0097).
    Prefix *and* suffix, so the session's other routes under ``/adopt/`` keep the 1 MiB cap.
    """

    prefix: str
    suffix: str
    limit: int

    def covers(self, path: str) -> bool:
        return path.startswith(self.prefix) and path.endswith(self.suffix)


@dataclass
class AthenaDaemon:
    """One Athena, behind a socket: the brain, the catalog, the gate, the lane and the ledger.

    Every route runs against this object. Two locks serialise them (ADR 0141): a turn holds its
    conversation's lock in :attr:`threads` for its length, the right to be the one turn *in that
    conversation*; a route that changes shared state takes :attr:`lock` through :meth:`writing`
    for the few milliseconds the change takes. Neither is the brain's own lock, which guards one
    write at a time and is taken inside both.

    The gate is held by name as well as through the lane because one route changes it: a merged
    manifest pins its app to the origin it was published from (policy rule 3), and a pin is a fact
    about this process rather than a configuration file. Nothing else here touches policy — the
    daemon carries a request to the gate and carries the answer back.
    """

    brain: Brain
    catalog: Catalog
    approvals: Approvals
    ledger: Ledger
    #: The gate with structural policy in front of it. ``athena.wiring`` builds it and hands the
    #: same object to the lane, so the pin a manifest sets is the pin the next turn is judged by.
    gate: PolicyHook
    #: One turn, composed, run and recorded. The daemon owns no part of a turn but the lock.
    lane: BrowserLane
    engine: str = "claude_code"
    model: str = ""
    sessions: Sessions = field(default_factory=Sessions)
    #: The short write lock. Taken by :meth:`writing`, by nothing else, never by a read route and
    #: never for a turn's length (ADR 0141): a turn holds its conversation's lock instead.
    lock: threading.Lock = field(default_factory=threading.Lock)
    #: One lock per conversation, held by the turn running in it (ADR 0141).
    threads: ThreadLocks = field(default_factory=ThreadLocks)
    #: The delegated tasks (ADR 0141), or ``None`` for a daemon built without them. Wiring builds
    #: the table on this brain and adds its routes; ``POST /run`` reads it for ``task_id``.
    tasks: Tasks | None = None
    started: float = field(default_factory=time.monotonic)
    routes: RouteTable = field(init=False)
    #: The WebSocket paths. Empty until wiring registers a channel — ``/voice`` when a voice
    #: backend is configured — so a daemon with no backend has no socket to fail on.
    sockets: SocketTable = field(default_factory=SocketTable)
    #: Exact paths whose body is bytes rather than JSON (:class:`RawRequest`).
    raw_paths: set[str] = field(default_factory=set)
    #: Paths allowed a JSON body larger than :data:`MAX_BODY_BYTES` (:class:`BodyCap`).
    body_caps: list[BodyCap] = field(default_factory=list)
    #: Per-engine binary overrides for ``GET /engines`` (tests; a non-default install).
    engine_executables: Mapping[str, str] = field(default_factory=dict)
    #: Taken only around the engine probe and its cache -- never the writer lock, so a probe
    #: subprocess cannot hold a turn and a turn cannot hold the probe.
    probe_lock: threading.Lock = field(default_factory=threading.Lock)
    _engines: tuple[float, list[dict[str, str]]] | None = field(default=None, repr=False)
    #: The running turns' doors (ADR 0115), one per conversation since a turn holds its
    #: conversation's lock (ADR 0141), and the small lock around the map: never a turn's lock.
    door_lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    _doors: dict[str, TurnDoor] = field(default_factory=dict, repr=False)
    #: Where the last run of a case's chore began (an ISO stamp), by its ``proj_`` id, from the
    #: case file's last receipt, or ``None`` (ADR 0126). Bound by wiring to the adopt package's case
    #: book, so neither the daemon nor the core reads a case file; ``None`` here, every card's "you
    #: approved this exact call" looks back a day. Only the gate uses it; nothing of the receipt
    #: reaches the prompt (ADR 0130).
    last_run_started: Callable[[str], str | None] | None = None
    #: Is this turn the first of a run the person staged from a due chore's review, by its case
    #: and turn id (ADR 0131)? Bound by wiring to the chores clock; ``True`` once per review, and
    #: the turn's ledger rows then say ``trigger_kind='schedule'``. ``None``: never.
    schedule_claim: Callable[[str, str], bool] | None = None
    #: The remote composer's tee (ADR 0140): given a ``POST /run`` body's ``via``, what to call with
    #: each event of that run so the device that sent the message reads it back, or ``None`` to tee
    #: nothing. Bound by wiring to :meth:`athena.peer.remote.RemoteTurns.observer`; ``None`` here,
    #: a ``via`` is ignored. It observes the run and changes nothing about it.
    via_tee: Callable[[Any], Callable[[ChannelEvent], None] | None] | None = None
    #: The turns sent under a case, stamped as each begins (ADR 0127): what a case's receipt is
    #: joined by, whatever conversation each turn talked in. Opened on the daemon's brain.
    case_turns: CaseTurns = field(init=False, repr=False)
    #: Run as each turn starts, inside the writer lock and before the turn is composed: an MCP
    #: server that listed no tools is listed again here (ADR 0123).
    turn_hooks: list[Callable[[], None]] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.routes = RouteTable(base_routes(self))
        self.case_turns = CaseTurns(self.brain)

    def body_limit(self, path: str) -> int:
        """The JSON body cap for ``path``: :data:`MAX_BODY_BYTES` unless a cap covers it."""
        return max([MAX_BODY_BYTES, *(c.limit for c in self.body_caps if c.covers(path))])

    @property
    def uptime_s(self) -> float:
        return round(time.monotonic() - self.started, 3)

    def pin(self, app_id: str, page_origin: str) -> None:
        """Record where one app's manifest was published from (policy rule 3, README §3.4).

        The replacement policy is built with :func:`dataclasses.replace`, so every other field —
        the disabled origins, the lane allow-lists, the connector port — is carried across. A
        policy rebuilt from the three fields a caller happened to remember is how a rule quietly
        stops applying, which is the bug the original repository shipped.
        """
        if not app_id or not page_origin:
            raise ValueError("a pin needs an app id and the origin its manifest came from")
        policy = self.gate.policy
        self.gate.policy = replace(
            policy, pinned_origins={**policy.pinned_origins, app_id: page_origin}
        )

    def engine_rows(self, *, fresh: bool = False) -> list[dict[str, str]]:
        """The engine probes, cached for :data:`ENGINES_TTL_S` unless ``fresh`` (``/engines``)."""
        with self.probe_lock:
            cached = self._engines
            now = time.monotonic()
            if not fresh and cached is not None and now - cached[0] < ENGINES_TTL_S:
                return [dict(row) for row in cached[1]]
            rows = [engine_row(status) for status in probe_all(executables=self.engine_executables)]
            self._engines = (time.monotonic(), rows)
            return [dict(row) for row in rows]

    def before_turn(self) -> None:
        """Run :attr:`turn_hooks`. A hook that raises is logged by type and skipped: what it
        failed to refresh stays as it was, and the turn runs on the catalog it has."""
        for hook in self.turn_hooks:
            try:
                hook()
            except Exception as exc:
                _log_escape("TURN", "before_turn", exc)

    @contextmanager
    def turn_door(self, origin: str, conversation: str = "") -> Iterator[TurnDoor]:
        """The door of the turn about to run for ``origin`` in ``conversation``, open while it runs.

        Taken with the conversation's lock held, so the one door per conversation is always the
        turn holding that lock.
        """
        door = TurnDoor(origin, conversation)
        with self.door_lock:
            self._doors[conversation] = door
        try:
            yield door
        finally:
            with self.door_lock:
                if self._doors.get(conversation) is door:
                    del self._doors[conversation]

    def stop_turn(self, origin: str, conversation: str | None = None) -> bool:
        """Stop ``origin``'s running turn. ``False`` when none of theirs runs (ADR 0115, 0141).

        With ``conversation`` it is that conversation's turn, and only if ``origin`` runs it.
        Without, it is every turn ``origin`` runs *but a delegated task's*: the panel's Stop is
        about the thread the person is looking at, and a task on the same app is stopped by its
        own id (``POST /tasks/<id>/stop``) or by naming its conversation here.
        """
        if not origin:
            return False
        with self.door_lock:
            doors = [
                door
                for door in self._doors.values()
                if door.origin == origin
                and (
                    door.conversation == conversation
                    if conversation
                    else not ids.is_task_conversation(door.conversation)
                )
            ]
        for door in doors:
            door.stop()
        return bool(doors)

    def stop_conversation(self, conversation: str) -> bool:
        """Stop the turn running in ``conversation``, whoever sent it: the daemon's own stop, for
        a task it kills (ADR 0141). Not reachable from a route without the task's id."""
        with self.door_lock:
            door = self._doors.get(conversation)
        if door is None:
            return False
        door.stop()
        return True

    @contextmanager
    def thread(self, conversation: str) -> Iterator[ThreadLease]:
        """``conversation``'s turn lock, waited for (ADR 0141). ``POST /run`` does not wait: it
        takes :meth:`ThreadLocks.try_take` and refuses a busy thread instead."""
        with self.threads.take(conversation) as lease:
            yield lease

    @contextmanager
    def writing(self) -> Iterator[Brain]:
        """The short write lock, around one route that changes something (ADR 0141).

        Reads do not come through here, and neither does a turn: a turn holds its conversation's
        lock, so a merge or an answer to a card waits for another write and never for a turn.
        ``GET /health`` answers while this is held, off its own read-only connection, which is the
        property ``tests/daemon/test_server.py`` asserts against a real socket.
        """
        with self.lock:
            yield self.brain


class DaemonServer(ThreadingHTTPServer):
    """``ThreadingHTTPServer`` that does not wait for its clients on the way out.

    ``block_on_close`` is ``False`` on purpose: the base class would otherwise join every worker
    thread in ``server_close``, and a client that opened a connection and went quiet would hang
    the shutdown for as long as it stayed quiet — the starvation this daemon is built to avoid,
    moved from the accept loop into exit. The threads are daemon threads and hold nothing but a
    socket; the brain is closed by the caller once the server is down.
    """

    daemon_threads = True
    block_on_close = False
    #: The port is this daemon's alone. On POSIX ``SO_REUSEADDR`` only lets a restart rebind a port
    #: its predecessor left in TIME_WAIT. On Windows it lets a second socket bind a port another is
    #: *listening* on: a second daemon would print a ready line beside the first, and any process
    #: asking for reuse could take the shell's requests, token header and all. So Windows binds
    #: with ``SO_EXCLUSIVEADDRUSE`` instead, and the two options cannot be combined.
    allow_reuse_address = sys.platform != "win32"

    def server_bind(self) -> None:
        if sys.platform == "win32":
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def _log_escape(method: str, path: str, exc: BaseException) -> None:
    """One line on stderr for a failure that escaped a route or a socket (the daemon's log).

    The caller gets its 500 or its 1011; without this line the machine kept nothing, because
    stdout is the ready line's and the request log is off. The route and the exception's type
    only, never its message or the query string: either can quote what the caller sent.
    """
    with suppress(Exception):
        print(f"[daemon] {method} {path} raised {type(exc).__name__}", file=sys.stderr, flush=True)


def build_handler(daemon: AthenaDaemon, config: DaemonConfig) -> type[BaseHTTPRequestHandler]:
    """The request handler for one daemon: HTTP, the token, CORS, and nothing about Athena."""

    class Handler(BaseHTTPRequestHandler):
        # HTTP/1.1 so a client's own pipelining expectations are answered honestly, with
        # ``Connection: close`` and 1.0-style close semantics on every response.
        protocol_version = "HTTP/1.1"
        server_version = "athena-daemon"
        timeout = IDLE_TIMEOUT_S

        def log_message(self, format: str, *args: Any) -> None:
            """The ledger is the log. A request line would put a query string on stdout, and
            stdout is the ready line's channel."""
            return

        # -- writing -----------------------------------------------------------------------

        def _cors(self) -> None:
            origin = self.headers.get("Origin") or ""
            if not config.cors_allows(origin):
                return
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Headers", f"Content-Type, {TOKEN_HEADER}")
            self.send_header("Access-Control-Allow-Methods", ALLOWED_METHODS)
            self.send_header("Vary", "Origin")

        def _send(self, status: int, payload: Mapping[str, Any]) -> None:
            body = json.dumps(dict(payload)).encode("utf-8")
            self.send_response(status)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.end_headers()
            # One request per connection (see the module docstring). Set before the write so a
            # client that hangs up mid-body still ends the connection here.
            self.close_connection = True
            self.wfile.write(body)

        def _fail(self, reply: Reply) -> None:
            self._send(*reply)

        def _send_bytes(self, answer: BinaryReply) -> None:
            self.send_response(answer.status)
            self._cors()
            if answer.headers and config.cors_allows(self.headers.get("Origin") or ""):
                # Without this a cross-origin page can read the body and not the provenance.
                self.send_header("Access-Control-Expose-Headers", ", ".join(answer.headers))
            for name, value in answer.headers.items():
                self.send_header(name, value)
            if answer.status != 204:
                self.send_header("Content-Type", answer.content_type)
            self.send_header("Content-Length", str(len(answer.body)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            if answer.body:
                self.wfile.write(answer.body)

        def _stream(self, answer: EventStream) -> None:
            """Write one Server-Sent Event stream, frame by frame (ADR 0012).

            There is no ``Content-Length``: the stream's length is not known when the headers go
            out, which is the other half of why every response says ``Connection: close`` — the
            closed socket is the end of the body. Each frame is flushed as it is produced, so a
            decision card reaches the panel while the turn is still running.

            A client that hangs up mid-turn is ordinary, not an error: the write raises, the loop
            stops, and the generator is *closed* rather than abandoned — which is what runs the
            ``finally`` inside it and gives the conversation's lock back.

            A generator closed before its first frame never runs its body, so a lock the route
            took before answering would be kept forever by a client that hung up during the
            headers. ``answer.release`` is that lock's other way home, called whatever happened
            (ADR 0141); giving a lease back twice does nothing.
            """
            frames = answer.frames
            try:
                self.send_response(answer.status)
                self._cors()
                self.send_header("Content-Type", SSE_CONTENT_TYPE)
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Connection", "close")
                self.end_headers()
                self.close_connection = True
                for frame in frames:
                    self.wfile.write(frame.encode("utf-8"))
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionError):
                pass
            finally:
                try:
                    if isinstance(frames, Generator):
                        frames.close()
                finally:
                    if answer.release is not None:
                        answer.release()

        # -- reading -----------------------------------------------------------------------

        def _authorized(self) -> bool:
            presented = self.headers.get(TOKEN_HEADER) or ""
            return secrets.compare_digest(presented, config.token)

        def _socket_token(self) -> tuple[bool, str | None]:
            """Whether an upgrade carries the token, and the subprotocol to echo if it came
            that way. The header wins when both are present; a wrong header is wrong even if
            the subprotocol is right, so a client cannot probe one while presenting the other."""
            if self.headers.get(TOKEN_HEADER):
                return self._authorized(), None
            carried = protocol_token(self.headers.get("Sec-WebSocket-Protocol") or "")
            if carried is None:
                return False, None
            if not secrets.compare_digest(carried, config.token):
                return False, None
            return True, f"athena-token.{carried}"

        def _upgrade(self) -> None:
            """Hand a WebSocket to its route, or refuse in the one JSON shape (ADR 0019).

            The token is checked before the path, as on every request, so an unauthenticated
            caller learns nothing from a 404 against a 401. An ``Origin`` that CORS would not
            allow is refused with ``foreign_origin``: a WebSocket is not fenced by CORS, so the
            refusal has to be ours. The handler thread is the socket's for the route's whole
            life; ``Connection: close`` is implied, because there is no next request.
            """
            ok, echo = self._socket_token()
            if not ok:
                self._fail(error(401, "foreign_token", f"{TOKEN_HEADER} missing or wrong"))
                return
            origin = self.headers.get("Origin") or ""
            if origin and not config.cors_allows(origin):
                self._fail(error(403, "foreign_origin", f"{origin} may not open a socket"))
                return
            url = urlsplit(self.path)
            fn = daemon.sockets.get(url.path)
            if fn is None:
                self._fail(error(404, "unknown", f"no socket at {url.path}"))
                return
            key = self.headers.get("Sec-WebSocket-Key") or ""
            if not key or (self.headers.get("Sec-WebSocket-Version") or "") != "13":
                self._fail(error(400, "validator_failed", "not a WebSocket 13 upgrade"))
                return
            self.send_response(101)
            self.send_header("Upgrade", "websocket")
            self.send_header("Connection", "Upgrade")
            self.send_header("Sec-WebSocket-Accept", accept_key(key))
            if echo is not None:
                self.send_header("Sec-WebSocket-Protocol", echo)
            self.end_headers()
            self.wfile.flush()
            self.close_connection = True
            # A voice socket idles between utterances for as long as the user does; the
            # per-request idle timeout would cut it off mid-thought.
            self.connection.settimeout(None)
            request = Request(
                method="GET",
                path=url.path,
                query={k: v[0] for k, v in parse_qs(url.query).items() if v},
                origin=origin,
            )
            ws = WebSocket(self.rfile, self.wfile, masked=False)
            try:
                fn(ws, request)
            except Exception as exc:  # a channel's bug closes its socket, never the daemon
                _log_escape("SOCKET", url.path, exc)
                with suppress(Exception):
                    ws.close(1011, "internal error")
            finally:
                with suppress(Exception):
                    ws.close()

        def _body(self, limit: int = MAX_BODY_BYTES) -> dict[str, Any] | None:
            """The decoded JSON object, ``{}`` for no body, ``None`` for anything else."""
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                return None
            if length <= 0:
                return {}
            if length > limit:
                # Refused, but *read past* first. A handler that answers an oversized body and
                # closes without draining it leaves the caller still sending: the write fails
                # (``ConnectionAbortedError`` on Windows) and the caller never reads the
                # refusal, which is indistinguishable from a daemon that died. Bounded and in
                # chunks, so nothing oversized is ever held here.
                self._discard(length, limit)
                return None
            try:
                payload = json.loads(self.rfile.read(length))
            except (json.JSONDecodeError, UnicodeDecodeError):
                return None
            return payload if isinstance(payload, dict) else None

        def _raw_body(self) -> bytes | None:
            """The body as bytes, ``b""`` for none, ``None`` when it is over the raw cap."""
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                return None
            if length <= 0:
                return b""
            if length > MAX_RAW_BODY_BYTES:
                self._discard(length)
                return None
            return self.rfile.read(length)

        def _discard(self, length: int, limit: int = 0) -> None:
            """Read and throw away up to :data:`DRAIN_LIMIT` bytes of a refused body.

            A caller that declared more than that is not drained to the end — the refusal is
            worth one bounded read and not an unbounded one — and the closed connection is what
            it gets instead. A route with a cap larger than the drain allowance (the documents
            route's 14 MiB) drains up to twice its own cap, so that a body a hair over it is
            still answered: on Linux the unread tail resets the connection and the caller's
            write fails before it can read the refusal.
            """
            remaining = min(length, max(DRAIN_LIMIT, 2 * limit))
            while remaining > 0:
                chunk = self.rfile.read(min(DRAIN_CHUNK, remaining))
                if not chunk:
                    return
                remaining -= len(chunk)

        # -- verbs -------------------------------------------------------------------------

        def do_OPTIONS(self) -> None:
            """The CORS preflight, and the one request that does not carry the token.

            A browser sends it with no custom headers by definition, so it could not carry one.
            It reads nothing and answers only with what a cross-origin caller may then try.
            """
            self.send_response(204)
            self._cors()
            self.send_header("Content-Length", "0")
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True

        def do_GET(self) -> None:
            if (self.headers.get("Upgrade") or "").lower() == "websocket":
                self._upgrade()
                return
            self._dispatch("GET")

        def do_POST(self) -> None:
            self._dispatch("POST")

        def do_PUT(self) -> None:
            self._dispatch("PUT")

        def do_DELETE(self) -> None:
            self._dispatch("DELETE")

        def _dispatch(self, method: str) -> None:
            # The token is checked before the path is matched, so an unauthenticated caller
            # cannot map the daemon's routes by comparing a 404 against a 401.
            if not self._authorized():
                self._fail(error(401, "foreign_token", f"{TOKEN_HEADER} missing or wrong"))
                return
            url = urlsplit(self.path)
            route = daemon.routes.match(method, url.path)
            if route is None:
                status = 405 if daemon.routes.knows(url.path) else 404
                self._fail(error(status, "unknown", f"no route for {method} {url.path}"))
                return
            query = {k: v[0] for k, v in parse_qs(url.query).items() if v}
            origin = self.headers.get("Origin") or ""
            request: Request
            if url.path in daemon.raw_paths:
                raw = self._raw_body()
                if raw is None:
                    self._fail(
                        error(400, "validator_failed", f"body over {MAX_RAW_BODY_BYTES} bytes")
                    )
                    return
                request = RawRequest(
                    method=method, path=url.path, query=query, origin=origin, raw=raw
                )
            else:
                body = self._body(daemon.body_limit(url.path))
                if body is None:
                    self._fail(error(400, "parse_error", "body must be a JSON object"))
                    return
                request = Request(
                    method=method, path=url.path, query=query, body=body, origin=origin
                )
            try:
                answer = route.fn(request)
            except Exception as exc:  # a route's bug is a 500, never a dropped connection
                # The type only: an exception's message can quote a request body, and a body
                # may hold anything the caller put in it.
                _log_escape(method, url.path, exc)
                self._fail(error(500, "unknown", type(exc).__name__))
                return
            if isinstance(answer, BinaryReply):
                self._send_bytes(answer)
                return
            if isinstance(answer, EventStream):
                # Nothing has been produced yet: a streaming route returns before its first
                # frame, so everything that could be refused was refused above, as a JSON body -
                # a busy thread among them (ADR 0141).
                self._stream(answer)
                return
            self._send(*answer)

    return Handler


def make_server(daemon: AthenaDaemon, config: DaemonConfig) -> DaemonServer:
    """Bind the socket and return the server *without* serving.

    Binding here rather than inside :func:`serve` is what makes the ready line honest: the caller
    can read the bound port off the returned server and print it before a single request is
    accepted, so a parent that has seen the line knows the port is already listening.
    """
    return DaemonServer((config.host, config.port), build_handler(daemon, config))


def bound_url(server: DaemonServer, config: DaemonConfig) -> str:
    """The URL the daemon is actually listening on — with ``--port 0``, the only place it exists."""
    return f"http://{config.host}:{server.server_address[1]}"


def resolve_token(token: str = "", token_file: str | None = None) -> tuple[str, str | None]:
    """The token to require, and the file it can be read back from.

    An explicit ``--token`` wins and is published nowhere. Otherwise the token is read from
    ``--token-file`` — or ``$ATHENA_HOME/daemon.json`` — and minted into it if it is not there
    yet, so a shell that spawns the daemon and a user running ``curl`` find the same one.
    """
    if token:
        return token, None
    path = Path(token_file) if token_file else brain_paths.athena_home() / TOKEN_FILENAME
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError, OSError):
            data = {}
        if isinstance(data, dict) and isinstance(data.get("token"), str) and data["token"]:
            return str(data["token"]), str(path)
    minted = new_token()
    path.parent.mkdir(parents=True, exist_ok=True)
    # Created owner-only and replaced into place, so no other user ever finds it with the umask's
    # mode, however briefly, and a reader never sees half a token. A filesystem without modes
    # ignores the 0o600; on Windows the user's home directory is the protection, as it is for
    # every other credential a CLI keeps there.
    staging = path.with_name(f"{path.name}.{secrets.token_hex(4)}.tmp")
    descriptor = os.open(staging, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(json.dumps({"token": minted}))
        os.replace(staging, path)
    except BaseException:
        with suppress(OSError):
            staging.unlink()
        raise
    with suppress(OSError):
        path.chmod(0o600)  # belt and braces for a filesystem that ignored the creation mode
    return minted, str(path)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="athena serve",
        description="Run the local daemon on 127.0.0.1.",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help="0 lets the kernel pick a free port; the ready line reports the one it picked",
    )
    parser.add_argument("--token", default="", help="the token to require; overrides --token-file")
    parser.add_argument(
        "--token-file",
        default=None,
        help=f"where the token is kept, minted if absent (default: $ATHENA_HOME/{TOKEN_FILENAME})",
    )
    parser.add_argument("--brain", default=None, help="the brain directory (default: $ATHENA_HOME)")
    parser.add_argument(
        "--allow-origin",
        action="append",
        default=[],
        metavar="ORIGIN",
        help=f"an extra CORS origin; repeatable. {EXTENSION_SCHEME}* is always allowed",
    )
    parser.add_argument(
        "--engine",
        default="claude_code",
        help="which engine a turn will run on: claude_code, codex, or nebius "
        "(Token Factory, needs NEBIUS_API_KEY)",
    )
    parser.add_argument(
        "--model",
        default="",
        help="the model that engine should use; empty is the engine's own default "
        f"(nebius: {NEBIUS_DEFAULT_MODEL})",
    )
    parser.add_argument(
        "--nebius-thinking",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="nebius only: let Nemotron reason before it answers (the default). "
        "--no-nebius-thinking is about 3x faster, but Lightning then often answers with an "
        "op and no prose (ADR 0035)",
    )
    parser.add_argument(
        "--no-connectors",
        action="store_true",
        help="start without the connector vault: no vault routes, no vault connector tools "
        "(the MCP servers of --mcp-config still load)",
    )
    parser.add_argument(
        "--mcp-config",
        default=None,
        metavar="PATH",
        help="the MCP servers whose tools are connector tools (default: "
        f"$ATHENA_HOME/{MCP_CONFIG_FILENAME}, absent is none; given, it must exist)",
    )
    parser.add_argument(
        "--voice-backend",
        default="config",
        choices=list(VOICE_BACKENDS),
        help="who hears and speaks on /voice: config (or auto) is the voice studio's choice, "
        "switchable live; openai pins the provider; none leaves the socket without a backend",
    )
    parser.add_argument(
        "--peer-port",
        type=int,
        default=PEER_PORT,
        help="the overlay peer listener's port (ADR 0140); bound only on the overlay address, "
        "and only while a peer, a pairing window or the beacon needs it",
    )
    parser.add_argument(
        "--no-peer",
        action="store_true",
        help="start without the peer surface: no /devices routes and no peer listener",
    )
    return parser


def _voice_name(daemon: AthenaDaemon) -> str:
    """What the ready line says is behind ``/voice``: the backend's name, or ``none``."""
    from athena.channels.voice.gateway import VOICE_PATH, VoiceGateway

    gateway = daemon.sockets.get(VOICE_PATH)
    backend = gateway.backend if isinstance(gateway, VoiceGateway) else None
    return backend.name if backend is not None else "none"


def serve(argv: Sequence[str] | None = None, *, stream: TextIO | None = None) -> int:
    """Run the daemon until it is interrupted. The exit code of ``athena serve``.

    Everything that can fail — an unreadable token file, a brain root that is not a directory, a
    port already taken — fails *before* the ready line, and says so on the failure line instead.
    A caller therefore never has to distinguish "not started" from "started and silent".
    """
    # Local import, and the only one in this module: ``athena.wiring`` composes an
    # :class:`AthenaDaemon` out of the real classes, so importing it at module scope would make
    # the package graph a cycle. The daemon is a thing wiring builds; ``serve`` is the entry
    # point that asks for one.
    from athena.wiring import build_local

    args = build_parser().parse_args(None if argv is None else list(argv))
    try:
        token, token_file = resolve_token(args.token, args.token_file)
        # ``config`` and ``auto`` are the studio's (ADR 0028) and ``none`` is no backend at all;
        # any other name — ``openai``, or a test harness's — is a pin, built here.
        studied = args.voice_backend in ("config", "auto", "none")
        voice = None if studied else backend_from_name(args.voice_backend)
        vault = None if args.no_connectors else Vault()
        peer = None
        if not args.no_peer:
            from athena.peer.listener import PeerHost

            # ``$ATHENA_HOME/peer``, not beside ``--brain``: one identity per install, however the
            # daemon was started (ADR 0140, "Identity").
            peer = PeerHost(brain_paths.athena_home() / "peer", port=args.peer_port)
        # The ids no MCP server may take are the built-in connectors', vault or no vault, so a
        # configuration means the same thing with and without --no-connectors (ADR 0123).
        mcp = load_mcp_config(
            args.mcp_config or brain_paths.athena_home() / MCP_CONFIG_FILENAME,
            required=args.mcp_config is not None,
            reserved=set(vault.specs) if vault is not None else set(load_builtin()),
        )
        # Reasoning is the one engine setting a flag reaches past ``--model``: the default
        # ``TokenFactoryModel`` reasons, so only the opt-out builds one here (ADR 0035).
        model_fn = (
            TokenFactoryModel(model=args.model or NEBIUS_DEFAULT_MODEL, thinking=False)
            if not args.nebius_thinking and args.engine == NEBIUS_ENGINE
            else None
        )
        local = build_local(
            brain_root=args.brain,
            engine=args.engine,
            model=args.model,
            model_fn=model_fn,
            voice=voice,
            vault=vault,
            voice_off=args.voice_backend == "none",
            peer=peer,
            mcp=mcp,
        )
    except (OSError, ValueError, sqlite3.Error) as exc:
        # ``sqlite3.Error`` is the brain's: a damaged index (``IndexDamagedError``, which names
        # ``athena brain reconcile``) or one another process holds locked past the busy timeout.
        announce(failure_line("unknown", f"{type(exc).__name__}: {exc}"), stream)
        return 1
    # A task that was running when the last daemon died has no window running it any more: its
    # row says ``interrupted`` and its parent thread is told, before anyone can read the list
    # (ADR 0141). Here and not in ``build_local``, which a second Athena in this process also runs.
    if local.daemon.tasks is not None:
        try:
            local.daemon.tasks.sweep()
        except sqlite3.Error as exc:
            local.close()
            announce(failure_line("unknown", f"{type(exc).__name__}: {exc}"), stream)
            return 1
    try:
        config = DaemonConfig(
            port=args.port,
            token=token,
            engine=args.engine,
            model=local.harness.model,
            allow_origins=tuple(args.allow_origin),
            token_file=token_file,
        )
        server = make_server(local.daemon, config)
    except (OSError, ValueError) as exc:
        local.close()
        announce(failure_line("unknown", f"{type(exc).__name__}: {exc}"), stream)
        return 1
    # The socket is bound and nothing has been accepted yet: the port on this line is the port.
    announce(
        ready_line(
            url=bound_url(server, config),
            token_file=config.token_file,
            engine=config.engine,
            brain=str(local.brain.root),
            voice=_voice_name(local.daemon),
        ),
        stream,
    )
    # The chores loop (ADR 0131) runs in the served daemon only: it notices, it never sends.
    if local.adopt is not None and local.adopt.chores is not None:
        local.adopt.chores.start()
    # The peer lifecycle (ADR 0140): binds the overlay listener only while trust needs it.
    if local.peer is not None:
        local.peer.start()
    # This PC's room and her sleep (ADR 0143): the sampler and the check thread run in the served
    # daemon only, so an Athena built in-process never measures or sleeps over a brain it borrowed.
    if local.vitals is not None:
        local.vitals.start()
    if local.sleep is not None:
        local.sleep.start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        local.close()
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised as a subprocess by the tests
    sys.exit(serve())

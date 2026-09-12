"""The daemon's socket: threaded, token-checked, one request per connection (README §3.5).

One Athena on 127.0.0.1, beside whatever page is open. The engine, the brain, the gate and the
ledger live in this process; a surface — the shell's panel, a browser extension, ``curl`` —
connects to it over HTTP and speaks JSON. Three decisions are made here and recorded in ADR 0011.

**Threaded, with the writer behind a lock.** The first build served on a single thread because one
SQLite connection had thread affinity, so a forty-second turn stalled ``/health`` and every other
read behind it. Here the brain has one writer connection and hands out a read-only connection per
read (ADR 0003), so the server can be a ``ThreadingHTTPServer``: reads answer concurrently, and
the routes that write queue on :meth:`AthenaDaemon.writing` — one turn at a time, which was always
the contract — without taking the reads down with them.

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
"""

from __future__ import annotations

import argparse
import json
import secrets
import sys
import threading
import time
from collections.abc import Callable, Generator, Iterator, Mapping, Sequence
from contextlib import contextmanager, suppress
from dataclasses import dataclass, field, replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, TextIO
from urllib.parse import parse_qs, urlsplit

from athena.channels.voice.backends import BACKENDS as VOICE_BACKENDS
from athena.channels.voice.backends import backend_from_name
from athena.channels.voice.ws import WebSocket, accept_key, protocol_token
from athena.connectors.vault import Vault
from athena.core.approvals import Approvals
from athena.core.brain import Brain
from athena.core.brain import paths as brain_paths
from athena.core.catalog import Catalog
from athena.core.ledger import Ledger
from athena.daemon.ready import announce, failure_line, ready_line
from athena.daemon.routes import (
    SSE_CONTENT_TYPE,
    EventStream,
    Reply,
    Request,
    RouteTable,
    base_routes,
    error,
)
from athena.daemon.sessions import Sessions
from athena.harness.policy import PolicyHook
from athena.lane.browser_lane import BrowserLane

__all__ = [
    "ALLOWED_METHODS",
    "DEFAULT_HOST",
    "DEFAULT_PORT",
    "EXTENSION_SCHEME",
    "MAX_BODY_BYTES",
    "TOKEN_FILENAME",
    "TOKEN_HEADER",
    "AthenaDaemon",
    "DaemonConfig",
    "DaemonServer",
    "SocketFn",
    "SocketTable",
    "bound_url",
    "build_handler",
    "build_parser",
    "make_server",
    "new_token",
    "resolve_token",
    "serve",
]

#: The daemon binds the loopback interface and nothing else, ever. ``--host`` is not a flag.
DEFAULT_HOST = "127.0.0.1"
#: The port a daemon takes when nobody asked for one. A sidecar passes ``--port 0`` instead.
DEFAULT_PORT = 17490
TOKEN_HEADER = "X-Athena-Token"
#: Where a minted token is kept when ``--token-file`` did not name somewhere else.
TOKEN_FILENAME = "daemon.json"
EXTENSION_SCHEME = "chrome-extension://"
ALLOWED_METHODS = "GET, POST, OPTIONS"
#: The largest body a route may be handed. A manifest is kilobytes; this is a cap on nonsense,
#: refused before anything is read into memory.
MAX_BODY_BYTES = 1_048_576
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


@dataclass
class AthenaDaemon:
    """One Athena, behind a socket: the brain, the catalog, the gate, the lane and the ledger.

    Every route runs against this object, and the writer lock is the only thing serialising them.
    It is deliberately *not* the brain's own lock: what a turn holds for its duration is the right
    to be the one turn, which is coarser than the right to write one memory.

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
    #: One turn at a time. Taken by :meth:`writing`, by nothing else, and never by a read route.
    lock: threading.Lock = field(default_factory=threading.Lock)
    started: float = field(default_factory=time.monotonic)
    routes: RouteTable = field(init=False)
    #: The WebSocket paths. Empty until wiring registers a channel — ``/voice`` when a voice
    #: backend is configured — so a daemon with no backend has no socket to fail on.
    sockets: SocketTable = field(default_factory=SocketTable)

    def __post_init__(self) -> None:
        self.routes = RouteTable(base_routes(self))

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

    @contextmanager
    def writing(self) -> Iterator[Brain]:
        """The writer lock, around one route that changes something.

        Reads do not come through here. A route that takes this may hold it for the length of a
        turn; ``GET /health`` still answers in the meantime, off its own read-only connection,
        and that is the property ``tests/daemon/test_server.py`` asserts against a real socket.
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

        def _stream(self, answer: EventStream) -> None:
            """Write one Server-Sent Event stream, frame by frame (ADR 0012).

            There is no ``Content-Length``: the stream's length is not known when the headers go
            out, which is the other half of why every response says ``Connection: close`` — the
            closed socket is the end of the body. Each frame is flushed as it is produced, so a
            decision card reaches the panel while the turn is still running.

            A client that hangs up mid-turn is ordinary, not an error: the write raises, the loop
            stops, and the generator is *closed* rather than abandoned — which is what runs the
            ``with daemon.writing()`` inside it and gives the writer lock back.
            """
            self.send_response(answer.status)
            self._cors()
            self.send_header("Content-Type", SSE_CONTENT_TYPE)
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            frames = answer.frames
            try:
                for frame in frames:
                    self.wfile.write(frame.encode("utf-8"))
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionError):
                pass
            finally:
                if isinstance(frames, Generator):
                    frames.close()

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
            except Exception:  # a channel's bug closes its socket, never the daemon
                with suppress(Exception):
                    ws.close(1011, "internal error")
            finally:
                with suppress(Exception):
                    ws.close()

        def _body(self) -> dict[str, Any] | None:
            """The decoded JSON object, ``{}`` for no body, ``None`` for anything else."""
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                return None
            if length <= 0:
                return {}
            if length > MAX_BODY_BYTES:
                # Refused, but *read past* first. A handler that answers an oversized body and
                # closes without draining it leaves the caller still sending: the write fails
                # (``ConnectionAbortedError`` on Windows) and the caller never reads the
                # refusal, which is indistinguishable from a daemon that died. Bounded and in
                # chunks, so nothing oversized is ever held here.
                self._discard(length)
                return None
            try:
                payload = json.loads(self.rfile.read(length))
            except (json.JSONDecodeError, UnicodeDecodeError):
                return None
            return payload if isinstance(payload, dict) else None

        def _discard(self, length: int) -> None:
            """Read and throw away up to :data:`DRAIN_LIMIT` bytes of a refused body.

            A caller that declared more than that is not drained to the end — the refusal is
            worth one bounded read and not an unbounded one — and the closed connection is what
            it gets instead.
            """
            remaining = min(length, DRAIN_LIMIT)
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
            body = self._body()
            if body is None:
                self._fail(error(400, "parse_error", "body must be a JSON object"))
                return
            request = Request(
                method=method,
                path=url.path,
                query={k: v[0] for k, v in parse_qs(url.query).items() if v},
                body=body,
                origin=self.headers.get("Origin") or "",
            )
            try:
                answer = route.fn(request)
            except Exception as exc:  # a route's bug is a 500, never a dropped connection
                # The type only: an exception's message can quote a request body, and a body
                # may hold anything the caller put in it.
                self._fail(error(500, "unknown", type(exc).__name__))
                return
            if isinstance(answer, EventStream):
                # Nothing has been produced yet: a streaming route returns before its first
                # frame, so everything that could be refused was refused above, as a JSON body.
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
    path.write_text(json.dumps({"token": minted}), encoding="utf-8")
    # A filesystem without modes is not a reason to refuse to start; on Windows the user's home
    # directory is the protection, as it is for every other credential a CLI keeps there.
    with suppress(OSError):
        path.chmod(0o600)
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
    parser.add_argument("--engine", default="claude_code", help="which engine a turn will run on")
    parser.add_argument("--model", default="", help="the model that engine should use, if it asks")
    parser.add_argument(
        "--no-connectors",
        action="store_true",
        help="start without the connector vault: no /connectors routes, no connector tools",
    )
    parser.add_argument(
        "--voice-backend",
        default="auto",
        choices=list(VOICE_BACKENDS),
        help="who hears and speaks on /voice: auto picks the provider whose key is set, "
        "none starts the daemon without a voice channel",
    )
    return parser


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
        voice = backend_from_name(args.voice_backend)
        vault = None if args.no_connectors else Vault()
        local = build_local(
            brain_root=args.brain, engine=args.engine, model=args.model, voice=voice, vault=vault
        )
    except (OSError, ValueError) as exc:
        announce(failure_line("unknown", f"{type(exc).__name__}: {exc}"), stream)
        return 1
    try:
        config = DaemonConfig(
            port=args.port,
            token=token,
            engine=args.engine,
            model=args.model,
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
            voice=voice.name if voice is not None else "none",
        ),
        stream,
    )
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

"""The daemon's HTTP surface: threaded, token-guarded, and never keeping a connection (README §3.5).

The first build's daemon was single-threaded behind one SQLite connection, and a long ``/run``
stalled every read — the panel froze for the length of a turn, which looked like a hung
application rather than a busy one. Four decisions answer that here, and they are all structural
rather than careful:

- :class:`ThreadingHTTPServer`, so a request in flight is a thread and not the whole server;
- ``Connection: close`` on every response, so a browser's keep-alive cannot pin a worker thread
  that an SSE stream is already holding open;
- one writer behind a lock and a fresh read-only connection per read request, which is the brain's
  own rule (ADR 0003) and is why a read never waits for a turn;
- the starvation test, written before this module and kept in the same commit.

Everything is loopback. The token is minted by whoever starts the daemon and passed to the surface
out of band; a request without it is refused before any handler runs, and ``/health`` is the one
exception so a shell can tell "not listening yet" from "listening and refusing me".

The router is deliberately tiny — literal segments and ``<name>`` captures, nothing else. A daemon
with fifteen routes does not need a framework, and a framework here would be a dependency in a
package that is meant to run on the standard library alone (invariant 5).
"""

from __future__ import annotations

import json
import re
import secrets
import threading
from collections.abc import Callable, Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlparse

from athena.contracts.channel import ChannelEvent

__all__ = [
    "ALLOWED_ORIGINS",
    "MAX_BODY",
    "Daemon",
    "EventStream",
    "Handler",
    "Request",
    "Response",
    "Router",
    "mint_token",
]

#: A request body larger than this is not a turn. Read before it is parsed, so a surface that
#: streams a gigabyte is disconnected rather than buffered.
MAX_BODY = 4 * 1024 * 1024

#: Who may talk to the daemon from a browser context. The Tauri shell serves the panel from
#: ``tauri://localhost`` on Windows and ``http://localhost:<port>`` in development; a page the user
#: is browsing is never in this list, which is what stops a visited site from driving Athena.
ALLOWED_ORIGINS: tuple[str, ...] = (
    "tauri://localhost",
    "http://localhost",
    "http://127.0.0.1",
)

_SEGMENT = re.compile(r"<([a-z_][a-z0-9_]*)>")


def mint_token() -> str:
    """A fresh session token. URL-safe, so it can ride a query string for the SSE stream."""
    return secrets.token_urlsafe(32)


# --- what a handler sees and returns -----------------------------------------------------------


@dataclass(frozen=True)
class Request:
    """One HTTP request, already read and bounded."""

    method: str
    path: str
    headers: Mapping[str, str]
    body: bytes = b""
    query: Mapping[str, list[str]] = field(default_factory=dict)
    params: Mapping[str, str] = field(default_factory=dict)

    def json(self) -> Any:
        """The body as JSON, or ``{}`` when empty. Raises ``ValueError`` on malformed JSON."""
        if not self.body:
            return {}
        return json.loads(self.body.decode("utf-8"))

    def one(self, name: str, default: str = "") -> str:
        values = self.query.get(name) or []
        return values[0] if values else default


@dataclass(frozen=True)
class Response:
    """One HTTP response. ``body`` is bytes by the time it reaches the handler's caller."""

    status: int = 200
    body: bytes = b""
    content_type: str = "application/json"
    headers: Mapping[str, str] = field(default_factory=dict)

    @classmethod
    def json(cls, payload: Any, status: int = 200) -> Response:
        return cls(status=status, body=json.dumps(payload).encode("utf-8"))

    @classmethod
    def error(cls, status: int, reason: str, detail: str = "") -> Response:
        """A refusal the surface can render. ``reason`` is a member of ``ERROR_REASONS`` when the
        refusal is one the gate could also produce, so one vocabulary covers both paths."""
        return cls.json({"error": reason, "detail": detail}, status)

    @classmethod
    def no_content(cls) -> Response:
        return cls(status=204, body=b"", content_type="text/plain")


@dataclass(frozen=True)
class EventStream:
    """A server-sent-event response. The handler yields channel events; this writes the frames.

    The generator is consumed on the request's own thread, which is why threading is not optional
    here: a turn that streams for ninety seconds holds one thread and nothing else.
    """

    events: Iterable[ChannelEvent]
    #: Sent before the first event so a client that is only checking liveness gets something.
    retry_ms: int = 2000


Handler = Callable[[Request], "Response | EventStream"]


# --- routing --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Route:
    method: str
    pattern: re.Pattern[str]
    handler: Handler
    public: bool = False


class Router:
    """Literal segments and ``<name>`` captures. Nothing else, on purpose."""

    def __init__(self) -> None:
        self.routes: list[Route] = []

    def add(self, method: str, path: str, handler: Handler, *, public: bool = False) -> None:
        self.routes.append(Route(method.upper(), _compile(path), handler, public))

    def get(self, path: str, handler: Handler, *, public: bool = False) -> None:
        self.add("GET", path, handler, public=public)

    def post(self, path: str, handler: Handler, *, public: bool = False) -> None:
        self.add("POST", path, handler, public=public)

    def match(self, method: str, path: str) -> tuple[Route, dict[str, str]] | None:
        """The route for this call, or ``None``. A path that matches another method is not a
        match here; :class:`Daemon` turns that into 405 rather than 404, because the two say
        different things to whoever is writing the client."""
        for route in self.routes:
            found = route.pattern.fullmatch(path)
            if found and route.method == method.upper():
                return route, found.groupdict()
        return None

    def allows(self, path: str) -> list[str]:
        return sorted({r.method for r in self.routes if r.pattern.fullmatch(path)})


def _compile(path: str) -> re.Pattern[str]:
    escaped = re.escape(path)
    for name in _SEGMENT.findall(path):
        escaped = escaped.replace(re.escape(f"<{name}>"), f"(?P<{name}>[^/]+)")
    return re.compile(escaped)


# --- the server -----------------------------------------------------------------------------------


class Daemon:
    """The HTTP daemon. Loopback, threaded, token-guarded, and it never keeps a connection open.

    Construction binds the socket, so :attr:`port` is real before :meth:`start` is called. That
    matters for the sidecar: the shell must be told the port, and a port chosen after the process
    announces itself is a race the shell loses about one time in twenty.
    """

    def __init__(
        self,
        router: Router,
        *,
        token: str | None = None,
        host: str = "127.0.0.1",
        port: int = 0,
        origins: Sequence[str] = ALLOWED_ORIGINS,
    ) -> None:
        self.router = router
        self.token = token or mint_token()
        self.origins = tuple(origins)
        self._server = ThreadingHTTPServer((host, port), _make_handler(self))
        self._server.daemon_threads = True
        self._thread: threading.Thread | None = None

    @property
    def port(self) -> int:
        return int(self._server.server_address[1])

    @property
    def host(self) -> str:
        return str(self._server.server_address[0])

    @property
    def url(self) -> str:
        return f"http://{self.host}:{self.port}"

    def start(self) -> None:
        """Serve in a background thread. Returns once the thread is running."""
        if self._thread is not None:
            return
        self._thread = threading.Thread(target=self._server.serve_forever, name="athena-daemon")
        self._thread.daemon = True
        self._thread.start()

    def stop(self) -> None:
        self._server.shutdown()
        self._server.server_close()
        if self._thread is not None:
            self._thread.join(timeout=5)
            self._thread = None

    def __enter__(self) -> Daemon:
        self.start()
        return self

    def __exit__(self, *exc: object) -> None:
        self.stop()

    # -- the one place a request is authorised ---------------------------------------------------

    def authorised(self, request: Request) -> bool:
        """``Authorization: Bearer`` or ``?token=``, compared in constant time.

        The query string is allowed because ``EventSource`` cannot set a header, and an SSE stream
        the panel cannot open is a panel that shows nothing. It is loopback only, and the token
        lives for one run of the daemon.
        """
        header = request.headers.get("authorization", "")
        supplied = header[7:] if header.lower().startswith("bearer ") else request.one("token")
        return secrets.compare_digest(supplied, self.token)

    def cors(self, origin: str) -> dict[str, str]:
        """The headers for an allowed origin, or none at all for anything else."""
        if not origin or not any(origin.startswith(allowed) for allowed in self.origins):
            return {}
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Headers": "authorization, content-type",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Max-Age": "600",
        }


# --- the handler ----------------------------------------------------------------------------------


def _make_handler(daemon: Daemon) -> type[BaseHTTPRequestHandler]:
    class AthenaHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "athena"
        sys_version = ""

        # A daemon that prints a line per request to stderr is a daemon whose sidecar log is
        # useless on the evening it matters.
        def log_message(self, fmt: str, *args: Any) -> None:
            return

        def do_GET(self) -> None:
            self._dispatch("GET")

        def do_POST(self) -> None:
            self._dispatch("POST")

        def do_OPTIONS(self) -> None:
            """Preflight, answered without a token: a browser cannot send one on a preflight."""
            origin = self.headers.get("Origin", "")
            self._send(Response.no_content(), daemon.cors(origin))

        # -- the pipeline -------------------------------------------------------------------------

        def _dispatch(self, method: str) -> None:
            parsed = urlparse(self.path)
            origin = self.headers.get("Origin", "")
            cors = daemon.cors(origin)
            headers = {key.lower(): value for key, value in self.headers.items()}

            matched = daemon.router.match(method, parsed.path)
            if matched is None:
                allowed = daemon.router.allows(parsed.path)
                if allowed:
                    self._send(
                        Response.error(405, "unknown_ref", f"allowed: {', '.join(allowed)}"),
                        {**cors, "Allow": ", ".join(allowed)},
                    )
                else:
                    self._send(Response.error(404, "unknown_ref", parsed.path), cors)
                return
            route, params = matched

            body = self._read_body()
            if body is None:
                too_big = Response.error(413, "unknown", f"a body may not exceed {MAX_BODY}")
                self._send(too_big, cors)
                return

            request = Request(
                method=method,
                path=parsed.path,
                headers=headers,
                body=body,
                query=parse_qs(parsed.query),
                params=params,
            )
            if not route.public and not daemon.authorised(request):
                self._send(Response.error(401, "foreign_token", "a valid token is required"), cors)
                return

            try:
                answer = route.handler(request)
            except ValueError as exc:
                self._send(Response.error(400, "parse_error", str(exc)), cors)
                return
            except Exception as exc:
                self._send(Response.error(500, "unknown", f"{type(exc).__name__}: {exc}"), cors)
                return

            if isinstance(answer, EventStream):
                self._stream(answer, cors)
            else:
                self._send(answer, cors)

        def _read_body(self) -> bytes | None:
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY:
                return None
            return self.rfile.read(length) if length else b""

        # -- writing ------------------------------------------------------------------------------

        def _send(self, response: Response, cors: Mapping[str, str]) -> None:
            self.send_response(response.status)
            self.send_header("Content-Type", response.content_type)
            self.send_header("Content-Length", str(len(response.body)))
            # Never keep-alive. A pinned worker is how the first build's panel froze.
            self.send_header("Connection", "close")
            for key, value in {**cors, **response.headers}.items():
                self.send_header(key, value)
            self.end_headers()
            if response.body:
                self.wfile.write(response.body)
            self.close_connection = True

        def _stream(self, stream: EventStream, cors: Mapping[str, str]) -> None:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            for key, value in cors.items():
                self.send_header(key, value)
            self.end_headers()
            try:
                self.wfile.write(f"retry: {stream.retry_ms}\n\n".encode())
                self.wfile.flush()
                for frame in _frames(stream.events):
                    self.wfile.write(frame)
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                # The panel closed the tab. Not an error; the turn already ran.
                pass
            finally:
                self.close_connection = True

    return AthenaHandler


def _frames(events: Iterable[ChannelEvent]) -> Iterator[bytes]:
    """One SSE frame per channel event, named by its kind.

    ``event:`` carries the kind so a client can attach one listener per family (README §3.1), and
    ``data:`` is the event's own JSON — the single encoder the contract declares, never a second
    one written here.
    """
    for event in events:
        payload = event.to_json()
        yield f"event: {event.kind}\ndata: {payload}\n\n".encode()

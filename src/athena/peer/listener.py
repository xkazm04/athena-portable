"""The peer listener: a second socket, overlay address only, up only while trusted (ADR 0140).

The loopback daemon (:mod:`athena.daemon.server`) stays exactly what it was - ``127.0.0.1``, one
``X-Athena-Token``, no ``--host`` flag. Other devices reach this one through a *separate*
``ThreadingHTTPServer`` in the same process, which this module owns, and which differs from the
loopback one in the three ways the device-pairing standard asks for.

**Admission by address class, before anything is read.** :meth:`PeerServer.verify_request` runs on
the accept thread, before a handler exists: the remote address is classified
(:func:`~athena.peer.classify.peer_class`) and anything that is not ``overlay`` - or ``loopback``
on a listener built with ``admit_loopback``, which only the tests are - is written one fixed
:data:`REFUSAL` (a bodiless 403) and closed. No request line, header, token or body of a refused
connection is ever read, so a refusal costs the same whatever was sent and teaches nothing.

**Per-peer bearer tokens, one door for grants.** An admitted request presents ``Authorization:
Bearer <token>``; :meth:`~athena.peer.registry.PeerRegistry.authenticate` compares its SHA-256 with
every row's fingerprint. Each :class:`PeerRoute` names the grant it needs, and the handler checks
it in one place before the route runs - ``403 grant_missing`` with the grant named - so no route
can forget to. The token is checked before the path is matched (an unknown path is a 401 to a
stranger and a 404 only to a peer), and before any body is read. A route marked ``open`` - the two
pairing steps and WP4's static phone page - runs without a token; it was still address-gated.

**Bound only while it is needed.** :meth:`PeerHost.reconcile` binds the listener while at least
one live peer row exists, a pairing window or an unclaimed approval is open, or the beacon is on,
and closes it when none holds. The lifecycle tick (every :data:`TICK_S`) reaps expired rows,
expires windows, retries a pair-back delivery and polls an outgoing join, then reconciles. With no
overlay address (``overlay.state`` ``absent`` or ``logged_out``) the listener stays down, whatever
is wanted.

**The route seam.** The peer routes live in a :class:`~athena.daemon.routes.RouteTable` of
:class:`PeerRoute` on :attr:`PeerHost.routes`. A later work package adds its own from its own
module with one registration line in :func:`athena.wiring._wire_peer`::

    host.add_routes(replicate.peer_routes(host))     # WP2: /peer/brain/*
    host.add_routes(remote.peer_routes(host, daemon)) # WP3: /peer/message, /peer/turns/, ...
    host.add_routes(mobile.peer_routes(host))         # WP4: GET /m/ (open=True, prefix=True)

and a loopback route (``POST /devices/<peer_id>/message``) the same way on ``daemon.routes``.
:class:`PeerRequest` carries the authenticated row (``peer``) and the remote address (``client``)
to the route; :meth:`PeerHost.publish` is the ``/events`` bus; :attr:`PeerHost.keys` and
:func:`~athena.peer.client.call` are how a route or a puller calls another device back.
"""

from __future__ import annotations

import json
import sys
import threading
import time
from collections.abc import Callable, Generator, Iterable, Mapping
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

from athena.connectors.seal import SealPort, select_seal
from athena.contracts.harness import normalize_reason
from athena.daemon.routes import (
    SSE_CONTENT_TYPE,
    BinaryReply,
    EventStream,
    Reply,
    Request,
    Route,
    RouteTable,
)
from athena.daemon.server import IDLE_TIMEOUT_S, PEER_PORT, BodyCap, DaemonServer
from athena.peer.classify import peer_class
from athena.peer.client import PeerKeys, call
from athena.peer.events import EventBus
from athena.peer.identity import IdentityStore, now_iso
from athena.peer.overlay import Overlay, OverlayProbe, TailscaleProbe
from athena.peer.pairing import WINDOW_TTL_S, PairingBook, PairingRecord
from athena.peer.registry import PeerRegistry, PeerRow

__all__ = [
    "DEFAULT_PEER_PORT",
    "MAX_PEER_BODY_BYTES",
    "OVERLAY_TTL_S",
    "REFUSAL",
    "TICK_S",
    "Join",
    "PeerHost",
    "PeerRequest",
    "PeerRoute",
    "PeerServer",
    "build_peer_handler",
    "peer_error",
]

#: The peer port. Fixed, unlike the loopback daemon's, because the firewall rule names it.
DEFAULT_PEER_PORT = PEER_PORT
#: Every peer JSON body is held to this unless a :class:`BodyCap` on the host widens one path.
MAX_PEER_BODY_BYTES = 65_536
TICK_S = 2.0
#: How long an overlay answer is trusted before ``tailscale`` is asked again.
OVERLAY_TTL_S = 30.0
#: The whole answer to a connection from a refused address. Fixed bytes, no body, then close.
REFUSAL = b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"

#: A peer error word, and the member of ``ERROR_REASONS`` it collapses onto in ``reason``.
PEER_REASONS: dict[str, str] = {
    "unauthorized": "foreign_token",
    "grant_missing": "foreign_token",
    "wrong_code": "foreign_token",
    "wrong_nonce": "foreign_token",
    "wrong_secret": "foreign_token",
    "foreign_origin": "foreign_origin",
    "claim_spent": "approval_spent",
    "pairing_expired": "expired",
    "pairing_declined": "user_denied",
    "pairing_unknown": "unknown_ref",
    "pairing_resolved": "approval_spent",
    "window_taken": "validator_failed",
    "kind_mismatch": "validator_failed",
    "grant_not_requested": "validator_failed",
    "bad_request": "validator_failed",
    "parse_error": "parse_error",
    "not_found": "unknown",
    "peer_unreachable": "outcome_unknown",
}


def peer_error(status: int, word: str, detail: str = "", **extra: Any) -> Reply:
    """A refusal in the daemon's one shape, plus the peer's own ``error`` word and any extras.

    ``reason`` stays a member of ``ERROR_REASONS`` (the daemon's contract); ``error`` is the finer
    word a peer acts on (``claim_spent``, ``grant_missing``), so neither reader has to learn the
    other's vocabulary.
    """
    reason = normalize_reason(PEER_REASONS.get(word, "unknown")) or "unknown"
    return status, {"ok": False, "reason": reason, "detail": detail, "error": word, **extra}


@dataclass(frozen=True)
class PeerRoute(Route):
    """A route on the peer listener: the grant it needs, or ``open`` for no token at all."""

    grant: str | None = None
    open: bool = False


@dataclass(frozen=True)
class PeerRequest(Request):
    """A peer request: the authenticated row (``None`` on an open route) and the remote address."""

    peer: PeerRow | None = None
    client: str = ""


def peer_of(request: Request) -> PeerRow:
    """The authenticated peer of a request that needed a token. A route bug if there is none."""
    if not isinstance(request, PeerRequest) or request.peer is None:
        raise RuntimeError("this peer route requires a token")
    return request.peer


# --- the socket ----------------------------------------------------------------------------------


class PeerServer(DaemonServer):
    """The loopback daemon's server, with the address check in front of every connection."""

    admit_loopback = False

    def verify_request(self, request: Any, client_address: Any) -> bool:
        address = str(client_address[0]) if client_address else ""
        klass = peer_class(address)
        if klass == "overlay" or (klass == "loopback" and self.admit_loopback):
            return True
        with suppress(OSError):
            request.settimeout(1.0)
            request.sendall(REFUSAL)
        return False


def build_peer_handler(host: PeerHost) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "athena-peer"
        timeout = IDLE_TIMEOUT_S

        def log_message(self, format: str, *args: Any) -> None:
            return  # a request line could carry anything; nothing here logs one

        # -- writing ---------------------------------------------------------------------------

        def _head(self, status: int, content_type: str, length: int | None) -> None:
            self.send_response(status)
            if status != 204:
                self.send_header("Content-Type", content_type)
            if length is not None:
                self.send_header("Content-Length", str(length))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True

        def _send(self, status: int, payload: Mapping[str, Any]) -> None:
            body = json.dumps(dict(payload)).encode("utf-8")
            self._head(status, "application/json", len(body))
            self.wfile.write(body)

        def _send_bytes(self, answer: BinaryReply) -> None:
            self.send_response(answer.status)
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
            self._head(answer.status, SSE_CONTENT_TYPE, None)
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

        # -- reading ---------------------------------------------------------------------------

        def _bearer(self) -> str:
            header = self.headers.get("Authorization") or ""
            scheme, _, value = header.partition(" ")
            return value.strip() if scheme.lower() == "bearer" else ""

        def _body(self, limit: int) -> dict[str, Any] | None:
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                return None
            if length <= 0:
                return {}
            if length > limit:
                # Drained (bounded) so the caller reads the refusal instead of a reset.
                remaining = min(length, 2 * limit)
                while remaining > 0:
                    chunk = self.rfile.read(min(65_536, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                return None
            try:
                payload = json.loads(self.rfile.read(length))
            except (json.JSONDecodeError, UnicodeDecodeError):
                return None
            return payload if isinstance(payload, dict) else None

        # -- verbs -----------------------------------------------------------------------------

        def do_GET(self) -> None:
            self._dispatch("GET")

        def do_POST(self) -> None:
            self._dispatch("POST")

        def do_PUT(self) -> None:
            self._dispatch("PUT")

        def do_DELETE(self) -> None:
            self._dispatch("DELETE")

        def _dispatch(self, method: str) -> None:
            origin = self.headers.get("Origin") or ""
            if origin and origin not in host.own_origins():
                # Browsers name their page honestly; a page on any other site is not a peer.
                self._send(*peer_error(403, "foreign_origin", "not this device's own page"))
                return
            url = urlsplit(self.path)
            route = host.routes.match(method, url.path)
            row = host.registry.authenticate(self._bearer())
            if route is None:
                if row is None:
                    self._send(*peer_error(401, "unauthorized", "a peer token is required"))
                else:
                    status = 405 if host.routes.knows(url.path) else 404
                    self._send(*peer_error(status, "not_found", f"no {method} {url.path}"))
                return
            if not isinstance(route, PeerRoute) or not route.open:
                if row is None:
                    self._send(*peer_error(401, "unauthorized", "a peer token is required"))
                    return
                grant = route.grant if isinstance(route, PeerRoute) else None
                if grant is not None and grant not in row.grants:
                    self._send(*peer_error(403, "grant_missing", f"needs {grant}", grant=grant))
                    return
            body = self._body(host.body_limit(url.path))
            if body is None:
                self._send(*peer_error(400, "parse_error", "body must be a small JSON object"))
                return
            if row is not None:
                host.registry.touch(row.peer_id)
            request = PeerRequest(
                method=method,
                path=url.path,
                query={k: v[0] for k, v in parse_qs(url.query).items() if v},
                body=body,
                origin=origin,
                peer=row,
                client=str(self.client_address[0]),
            )
            try:
                answer = route.fn(request)
            except Exception as exc:  # a route's bug is a 500, never a dropped connection
                _log(f"{method} {url.path} raised {type(exc).__name__}")
                self._send(*peer_error(500, "unknown", type(exc).__name__))
                return
            if isinstance(answer, BinaryReply):
                self._send_bytes(answer)
            elif isinstance(answer, EventStream):
                self._stream(answer)
            else:
                self._send(*answer)

    return Handler


def _log(line: str) -> None:
    """One line on stderr, the daemon's log. Never a token, a nonce, a secret or a body."""
    with suppress(Exception):
        print(f"[peer] {line}", file=sys.stderr, flush=True)


# --- the host ------------------------------------------------------------------------------------


@dataclass
class Join:
    """This PC asking another to let it in (``POST /devices/join``), polled until it resolves."""

    join_id: str
    url: str
    code: str
    claim_secret: str
    name: str
    device_id: str | None
    started: datetime
    expires_at: datetime
    state: str = "pending"

    def view(self) -> dict[str, Any]:
        return {
            "join_id": self.join_id,
            "address": self.url.removeprefix("http://"),
            "name": self.name,
            "state": self.state,
            "expires_at": now_iso(self.expires_at),
        }


class PeerHost:
    """Everything peer-shaped this daemon holds: identity, peers, pairings, keys, the listener."""

    def __init__(
        self,
        root: Path,
        *,
        port: int = DEFAULT_PEER_PORT,
        probe: OverlayProbe | None = None,
        seal: SealPort | None = None,
        admit_loopback: bool = False,
        now: Callable[[], datetime] | None = None,
        tick_s: float = TICK_S,
    ) -> None:
        from athena.peer.routes import peer_routes

        self.root = root
        self.port = port
        self.probe: OverlayProbe = probe or TailscaleProbe()
        self.admit_loopback = admit_loopback
        self._now = now or (lambda: datetime.now(UTC))
        self.tick_s = tick_s
        self.identity = IdentityStore(root)
        self.registry = PeerRegistry(root, now=self._now)
        self.pairings = PairingBook(now=self._now)
        self.keys = PeerKeys(root, seal or (lambda: select_seal(root / "keys")))
        self.bus = EventBus()
        self.routes = RouteTable()
        self.body_caps: list[BodyCap] = []
        self.beacon = False
        self.joins: dict[str, Join] = {}
        self.bind_error: str | None = None
        self._lock = threading.RLock()
        self._server: PeerServer | None = None
        self._serve_thread: threading.Thread | None = None
        self._tick_thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._overlay: tuple[float, Overlay] | None = None
        self.add_routes(peer_routes(self))

    # -- the seam ------------------------------------------------------------------------------

    def add_routes(self, routes: Iterable[Route]) -> None:
        for route in routes:
            self.routes.add(route)

    def publish(self, kind: str, /, **fields: Any) -> None:
        self.bus.publish(kind, **fields)

    def body_limit(self, path: str) -> int:
        return max([MAX_PEER_BODY_BYTES, *(c.limit for c in self.body_caps if c.covers(path))])

    def now(self) -> datetime:
        return self._now()

    # -- the overlay and the socket ------------------------------------------------------------

    def overlay(self, *, fresh: bool = False) -> Overlay:
        with self._lock:
            cached = self._overlay
            if not fresh and cached is not None and time.monotonic() - cached[0] < OVERLAY_TTL_S:
                return cached[1]
        answer = self.probe()
        with self._lock:
            self._overlay = (time.monotonic(), answer)
        return answer

    @property
    def bound(self) -> tuple[str, int] | None:
        server = self._server  # one attribute read; no lock, so a handler never waits on a probe
        if server is None:
            return None
        address = server.server_address
        return str(address[0]), int(address[1])

    def base_url(self) -> str | None:
        """``http://<overlay-ip>:<port>`` while the listener is bound, else ``None``."""
        bound = self.bound
        if bound is None:
            return None
        host, port = bound
        return f"http://{f'[{host}]' if ':' in host else host}:{port}"

    def own_origins(self) -> set[str]:
        base = self.base_url()
        return {base} if base else set()

    def wanted(self) -> bool:
        return self.registry.live_count() > 0 or self.pairings.active() or self.beacon

    def reconcile(self) -> None:
        """Bind the listener if it is wanted and the overlay is up; close it if not wanted."""
        with self._lock:
            want = self.wanted()
            if not want:
                self._close_server()
                return
            overlay = self.overlay()
            address = overlay.address if overlay.state == "up" else None
            bound = self.bound
            if bound is not None and (address is None or bound[0] != address):
                self._close_server()
                bound = None
            if bound is None and address is not None:
                self._bind(address)

    def _bind(self, address: str) -> None:
        try:
            server = PeerServer((address, self.port), build_peer_handler(self))
        except OSError as exc:
            if self.bind_error != type(exc).__name__:
                _log(f"listener could not bind port {self.port}: {type(exc).__name__}")
            self.bind_error = type(exc).__name__
            return
        server.admit_loopback = self.admit_loopback
        self.bind_error = None
        self._server = server
        self._serve_thread = threading.Thread(
            target=server.serve_forever, name="athena-peer", daemon=True
        )
        self._serve_thread.start()

    def _close_server(self) -> None:
        server, thread = self._server, self._serve_thread
        self._server, self._serve_thread = None, None
        if server is None:
            return
        server.shutdown()
        server.server_close()
        if thread is not None:
            thread.join(timeout=5)

    # -- the lifecycle -------------------------------------------------------------------------

    def start(self) -> None:
        """Reconcile now, then tick every :attr:`tick_s` until :meth:`close`."""
        self.tick()
        if self._tick_thread is not None:
            return
        self._tick_thread = threading.Thread(target=self._ticking, name="peer-tick", daemon=True)
        self._tick_thread.start()

    def _ticking(self) -> None:
        while not self._stop.wait(self.tick_s):
            try:
                self.tick()
            except Exception as exc:  # the tick's bug must not end the tick
                _log(f"tick raised {type(exc).__name__}")

    def tick(self) -> None:
        changed = False
        for record in self.pairings.sweep():
            if record.peer_id is not None and self.registry.revoke(record.peer_id):
                changed = True
        if self.registry.reap():
            changed = True
        for record in self.pairings.undelivered():
            if self.deliver(record):
                changed = True
        if self._poll_joins():
            changed = True
        if changed:
            self.publish("peer.changed", peer_id=None)
        self.reconcile()

    def close(self) -> None:
        self._stop.set()
        thread = self._tick_thread
        if thread is not None:
            thread.join(timeout=5)
        with self._lock:
            self._close_server()
        self.bus.close()

    # -- acts the routes share -----------------------------------------------------------------

    def admit(self, record: PairingRecord) -> PeerRow:
        """File an approved record's peer under its id, with the token the approval minted."""
        assert record.peer_id is not None
        return self.registry.admit(
            record.peer_id,
            name=record.name,
            kind=record.kind,
            grants=record.granted,
            token=record.token,
            expires_days=record.expires_days,
        )

    def revoke(self, peer_id: str) -> bool:
        gone = self.registry.revoke(peer_id)
        self.keys.forget(peer_id)
        if gone:
            self.publish("peer.changed", peer_id=peer_id)
        self.reconcile()
        return gone

    def deliver(self, record: PairingRecord) -> bool:
        """Hand an approved pair-back token to the PC that asked for it. ``True`` on delivery."""
        if record.peer_id is None or not record.deliver_to or not record.token:
            return False
        presented = self.keys.token(record.peer_id)
        if presented is None:
            return False
        bound = self.bound
        port = bound[1] if bound is not None else self.port
        answer = call(
            record.deliver_to,
            "POST",
            "/peer/pair/back",
            {"token": record.token, "port": port},
            token=presented,
        )
        if answer.status == 200:
            self.pairings.delivered(record.pairing_id)
            return True
        return False

    def join(
        self, address: str, port: int, code: str, requested_grants: list[str]
    ) -> tuple[int, dict[str, Any]]:
        """Ask the PC at ``address`` to let this one in, with the code its person read out."""
        klass = peer_class(address)
        if not (klass == "overlay" or (klass == "loopback" and self.admit_loopback)):
            return peer_error(400, "bad_request", "the address must be on the private overlay")
        url = f"http://{f'[{address}]' if ':' in address else address}:{port}"
        me = self.identity.identity
        answer = call(
            url,
            "POST",
            "/peer/pair/request",
            {
                "code": code,
                "name": me.name,
                "kind": "pc",
                "device_id": me.device_id,
                "requested_grants": requested_grants,
            },
        )
        if not answer.reached:
            return peer_error(502, "peer_unreachable", "that computer did not answer")
        if answer.status != 200:
            word = str(answer.body.get("error") or "unknown")
            return peer_error(answer.status, word, str(answer.body.get("detail") or ""))
        now = self._now()
        joined = Join(
            join_id=str(answer.body.get("pairing_id") or ""),
            url=url,
            code=code,
            claim_secret=str(answer.body.get("claim_secret") or ""),
            name=str(answer.body.get("name") or ""),
            device_id=str(answer.body.get("device_id") or "") or None,
            started=now,
            expires_at=now + timedelta(seconds=2 * WINDOW_TTL_S),
        )
        with self._lock:
            self.joins[joined.join_id] = joined
        return 200, {"ok": True, "join": joined.view()}

    def join_views(self) -> list[dict[str, Any]]:
        with self._lock:
            return [joined.view() for joined in self.joins.values()]

    def _poll_joins(self) -> bool:
        """Claim every outgoing join that has been answered. ``True`` if anything changed."""
        changed = False
        now = self._now()
        with self._lock:
            joins = list(self.joins.values())
        for joined in joins:
            if joined.state != "pending":
                if now - joined.expires_at > timedelta(seconds=WINDOW_TTL_S):
                    with self._lock:
                        self.joins.pop(joined.join_id, None)
                continue
            if now >= joined.expires_at:
                joined.state = "expired"
                changed = True
                continue
            answer = call(
                joined.url,
                "POST",
                "/peer/pair/claim",
                {"code": joined.code, "claim_secret": joined.claim_secret},
            )
            if answer.status == 200:
                self._joined(joined, answer.body)
                changed = True
            elif answer.status in (403, 410) and answer.body.get("error") != "wrong_secret":
                joined.state = str(answer.body.get("state") or "expired")
                changed = True
        return changed

    def _joined(self, joined: Join, body: Mapping[str, Any]) -> None:
        device_id = str(body.get("device_id") or joined.device_id or "")
        token = str(body.get("token") or "")
        if not device_id or not token:
            joined.state = "expired"
            return
        self.keys.keep(device_id, joined.url, token)
        joined.state = "claimed"
        back = body.get("pair_back")
        if isinstance(back, dict):
            record = self.pairings.file_pair_back(
                device_id=device_id,
                name=back.get("name") or joined.name,
                requested_grants=list(back.get("requested_grants") or []),
                deliver_to=joined.url,
            )
            self.publish("pair.requested", pending=record.pending_view())

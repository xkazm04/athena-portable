"""The loopback ``/devices`` routes: the window's view of pairing and its one mint door (ADR 0140).

These are routes on the loopback daemon, behind ``X-Athena-Token`` and its 1 MiB JSON cap
(:class:`~athena.daemon.server.BodyCap`), like every other route there. The person in this
device's own chrome is the only one who reaches them, which is what makes
``POST /devices/pending/<pairing_id>`` the one door a peer token is minted through.

``GET /devices``
    ``{self: {device_id, name, vitals}, peers: [row without its fingerprint, plus ``memory``:
    WP2's replication status or ``null``, ``presence`` (``online`` / ``asleep`` /
    ``unreachable``) with ``presence_at``, both ``null`` before the probe's first verdict, and
    ``vitals``, the peer's room off its hello or ``null`` (ADR 0143), and ``link`` ``{state,
    since, evidence}``, the one link state :func:`athena.peer.link.derive` earns from named
    evidence (ADR 0140 "Link state")], pending: [{pairing_id,
    name, kind, requested_grants, expires_at, pair_back}], beacon: {on, url}, overlay: {state},
    listener: {up, address, port, error}, joining: [{join_id, address, name, state,
    expires_at}]}``. Absent values are ``null``, never omitted.
``PUT /devices/self`` ``{name}``
    Rename this device.
``POST /devices/pairing`` ``{kind}``
    Open a window: ``{pairing_id, code, url, expires_at}``. ``url`` is
    ``http://<overlay-ip>:<peer-port>/m/#claim=<pairing_id>.<nonce>`` for the phone's QR, or
    ``null`` while the listener cannot bind (no overlay).
``POST /devices/pending/<pairing_id>`` ``{choice, grants, expires_days}``
    ``approve`` (grants may only narrow what was asked; absent means as asked) or ``decline``.
``DELETE /devices/<peer_id>``
    Revoke, at once, with no confirmation: the next request with that peer's token is a 401.
``PUT /devices/beacon`` ``{on}``
    Keep the listener up for the phone page; ``url`` is ``http://<overlay-ip>:<peer-port>/m/``.
``POST /devices/join`` ``{address, port, code, requested_grants}``
    This PC asks the PC at ``address`` (an overlay address) to let it in, with the code that PC's
    person read out; the tick then polls the claim and files the pair-back request here.
``GET /events``
    Server-Sent Events: every kind :mod:`athena.peer.events` names (``pair.requested``,
    ``peer.changed``, ``pair.opened``, ``remote.message``, ...).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from urllib.parse import unquote

from athena.daemon.routes import EventStream, Reply, Request, Route, error
from athena.peer.listener import DEFAULT_PEER_PORT, PeerHost, peer_error
from athena.peer.pairing import PairingRefused
from athena.peer.registry import GRANTS, KINDS, PeerRow
from athena.peer.replicate import memory_view

if TYPE_CHECKING:
    from athena.daemon.server import AthenaDaemon

__all__ = ["DEVICES_PREFIX", "PENDING_PREFIX", "device_routes", "devices"]

DEVICES_PREFIX = "/devices/"
PENDING_PREFIX = "/devices/pending/"
#: The longest an approval may be given for. ``null`` is "until revoked".
MAX_EXPIRES_DAYS = 3650


def devices(host: PeerHost) -> Reply:
    me = host.identity.identity
    bound = host.bound
    base = host.base_url()
    return 200, {
        "ok": True,
        # ``vitals``: this PC's own snapshot (ADR 0143), ``null`` before its first reading.
        "self": {"device_id": me.device_id, "name": me.name, "vitals": _own_vitals(host)},
        # ``memory``: WP2's replication status for the peer, ``null`` until it has been pulled.
        # ``presence`` / ``presence_at``: the presence probe's verdict, ``null`` until its first.
        # ``vitals``: the peer's off its last hello; ``null`` for a phone, before the first hello,
        # and once older than ``VITALS_STALE_S`` (ADR 0143).
        # ``link``: ``{state, since, evidence}`` from the row, the key, the hello and ``memory``.
        "peers": [_peer(host, row) for row in host.registry.rows()],
        "pending": [record.pending_view() for record in host.pairings.pending()],
        "beacon": {"on": host.beacon, "url": f"{base}/m/" if host.beacon and base else None},
        "overlay": {"state": host.overlay().state},
        "listener": {
            "up": bound is not None,
            "address": bound[0] if bound else None,
            "port": bound[1] if bound else host.port,
            "error": host.bind_error,
        },
        "joining": host.join_views(),
    }


def _peer(host: PeerHost, row: PeerRow) -> dict[str, Any]:
    memory = memory_view(host, row.peer_id)
    return {**row.view(), "memory": memory, **host.presence.view(row.peer_id, memory)}


def _own_vitals(host: PeerHost) -> Any:
    try:
        return host.presence.own_vitals()
    except Exception:
        return None


def rename(host: PeerHost, request: Request) -> Reply:
    try:
        renamed = host.identity.rename(request.body.get("name"))
    except ValueError as exc:
        return error(400, "validator_failed", str(exc))
    host.publish("peer.changed", peer_id=None)
    return 200, {"ok": True, "self": {"device_id": renamed.device_id, "name": renamed.name}}


def open_pairing(host: PeerHost, request: Request) -> Reply:
    kind = request.body.get("kind")
    if kind not in KINDS:
        return error(400, "validator_failed", f"kind must be one of {', '.join(KINDS)}")
    record = host.pairings.open_window(str(kind))
    host.reconcile()
    base = host.base_url()
    return 200, {
        "ok": True,
        "pairing_id": record.pairing_id,
        "code": record.code,
        "url": f"{base}/m/#claim={record.pairing_id}.{record.nonce}" if base else None,
        "expires_at": record.pending_view()["expires_at"],
    }


def answer_pending(host: PeerHost, request: Request, pairing_id: str) -> Reply:
    body = request.body
    choice = body.get("choice")
    if choice not in ("approve", "decline"):
        return error(400, "validator_failed", "choice must be approve or decline")
    try:
        if choice == "decline":
            record = host.pairings.decline(pairing_id)
            host.publish("peer.changed", peer_id=None)
            return 200, {"ok": True, "state": record.state, "peer": None}
        days = body.get("expires_days")
        if days is not None and (
            isinstance(days, bool) or not isinstance(days, int) or not 1 <= days <= MAX_EXPIRES_DAYS
        ):
            return error(400, "validator_failed", f"expires_days is null or 1..{MAX_EXPIRES_DAYS}")
        grants = body.get("grants")
        if grants is not None and not isinstance(grants, list):
            return error(400, "validator_failed", f"grants is a list of {', '.join(GRANTS)}")
        current = host.pairings.get(pairing_id)
        asked = list(current.requested_grants) if current is not None else []
        record = host.pairings.approve(pairing_id, asked if grants is None else grants, days)
    except PairingRefused as refusal:
        return peer_error(refusal.status, refusal.error, refusal.detail, state=refusal.state)
    except ValueError as exc:
        return error(400, "validator_failed", str(exc))
    row = host.admit(record)
    host.reconcile()
    if record.direction == "pair_back":
        host.deliver(record)
    host.publish("peer.changed", peer_id=row.peer_id)
    return 200, {"ok": True, "state": record.state, "peer": row.view()}


def revoke(host: PeerHost, peer_id: str) -> Reply:
    if not host.revoke(peer_id):
        return error(404, "unknown_ref", "no such peer")
    return 200, {"ok": True, "revoked": peer_id}


def beacon(host: PeerHost, request: Request) -> Reply:
    on = request.body.get("on")
    if not isinstance(on, bool):
        return error(400, "validator_failed", "on must be true or false")
    host.beacon = on
    host.reconcile()
    base = host.base_url()
    host.publish("peer.changed", peer_id=None)
    return 200, {"ok": True, "beacon": {"on": on, "url": f"{base}/m/" if on and base else None}}


def join(host: PeerHost, request: Request) -> Reply:
    body = request.body
    address, code = body.get("address"), body.get("code")
    port = body.get("port", DEFAULT_PEER_PORT)
    grants = body.get("requested_grants", list(GRANTS))
    if not isinstance(address, str) or not isinstance(code, str) or not code.strip():
        return error(400, "validator_failed", "address and code are required")
    if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
        return error(400, "validator_failed", "port must be a port number")
    if not isinstance(grants, list) or any(g not in GRANTS for g in grants):
        return error(400, "validator_failed", f"requested_grants is a list of {', '.join(GRANTS)}")
    return host.join(address.strip(), port, code, [str(g) for g in grants])


def events(host: PeerHost) -> EventStream:
    return EventStream(host.bus.frames())


def device_routes(daemon: AthenaDaemon, host: PeerHost) -> list[Route]:
    """The loopback routes, exact paths before the two prefix shapes."""

    def tail(request: Request, prefix: str) -> str:
        return unquote(request.path[len(prefix) :])

    return [
        Route("GET", "/devices", lambda request: devices(host)),
        Route("PUT", "/devices/self", lambda request: rename(host, request)),
        Route("POST", "/devices/pairing", lambda request: open_pairing(host, request)),
        Route("PUT", "/devices/beacon", lambda request: beacon(host, request)),
        Route("POST", "/devices/join", lambda request: join(host, request)),
        Route("GET", "/events", lambda request: events(host)),
        Route(
            "POST",
            PENDING_PREFIX,
            lambda request: answer_pending(host, request, tail(request, PENDING_PREFIX)),
            prefix=True,
        ),
        Route(
            "DELETE",
            DEVICES_PREFIX,
            lambda request: revoke(host, tail(request, DEVICES_PREFIX)),
            prefix=True,
        ),
    ]

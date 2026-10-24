"""The routes another device calls on the peer listener (ADR 0140, "Data & API").

``GET /peer/hello`` (token)
    ``{device_id, name, beacon, window_open, setup_phase}`` - who this is and what it is doing.
    ``setup_phase`` is ``null`` until this device's person opens a setup conversation, then one
    word from :meth:`athena.peer.setup.SetupState.phase` (WP4).

``POST /peer/pair/request`` (open, address-gated)
    ``{pairing_id, nonce}`` from a phone's QR, or ``{code}`` typed on a PC, plus ``name``,
    ``kind``, ``device_id`` (a PC's own ``dev_`` id; ``null`` for a phone) and
    ``requested_grants``. Files the window's one pending record and publishes ``pair.requested``.
    Answers ``{pairing_id, claim_secret, state: "pending", expires_at, device_id, name}`` - the
    last two this device's, so the requester can say whom it is waiting on.

``POST /peer/pair/claim`` (open, address-gated)
    ``{pairing_id, nonce}`` or ``{code, claim_secret}``. ``202 {"state": "pending"}`` until a person
    answers; once approved, ``{token, peer_id, device_id, name, pair_back}`` exactly once; then
    ``410 claim_spent``, which is logged by pairing id and nothing else. ``pair_back`` is
    ``{device_id, name, requested_grants}`` when the claimer is a PC - this device asking to be let
    in there in return, with the grants its person just gave - and ``null`` for a phone.

``POST /peer/pair/back`` (token)
    ``{token, port}`` - the token the other PC's person minted for this device, delivered by that
    PC after its own approval. Sealed as this device's key for that peer (:class:`PeerKeys`), with
    the reach address taken from the connection itself, never from the body.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from athena.peer.listener import PeerRequest, PeerRoute, _log, peer_error, peer_of
from athena.peer.pairing import PairingRefused

if TYPE_CHECKING:
    from athena.daemon.routes import Reply, Request
    from athena.peer.listener import PeerHost

__all__ = ["peer_routes"]

#: The longest token ``/peer/pair/back`` accepts. A minted one is 43 characters.
MAX_TOKEN_CHARS = 256


def hello(host: PeerHost, request: Request) -> Reply:
    me = host.identity.identity
    return 200, {
        "ok": True,
        "device_id": me.device_id,
        "name": me.name,
        "beacon": host.beacon,
        "window_open": host.pairings.window_open(),
        "setup_phase": host.setup_phase(),
    }


def _text(body: Any, key: str) -> str:
    value = body.get(key)
    return value if isinstance(value, str) else ""


def _refused(refusal: PairingRefused) -> Reply:
    if refusal.status == 202:
        return 202, {"ok": True, "state": "pending"}
    return peer_error(refusal.status, refusal.error, refusal.detail, state=refusal.state)


def pair_request(host: PeerHost, request: Request) -> Reply:
    body = request.body
    grants = body.get("requested_grants")
    device_id = body.get("device_id")
    if grants is not None and not isinstance(grants, list):
        return peer_error(400, "bad_request", "requested_grants must be a list")
    if device_id is not None and not isinstance(device_id, str):
        return peer_error(400, "bad_request", "device_id must be a string or null")
    try:
        record, secret = host.pairings.request(
            pairing_id=_text(body, "pairing_id"),
            nonce=_text(body, "nonce"),
            code=_text(body, "code"),
            claim_secret=_text(body, "claim_secret"),
            name=body.get("name"),
            kind=_text(body, "kind"),
            device_id=device_id,
            requested_grants=list(grants or []),
        )
    except PairingRefused as refusal:
        return _refused(refusal)
    except ValueError as exc:
        return peer_error(400, "bad_request", str(exc))
    view = record.pending_view()
    host.publish("pair.requested", pending=view)
    me = host.identity.identity
    return 200, {
        "ok": True,
        "pairing_id": record.pairing_id,
        "claim_secret": secret,
        "state": record.state,
        "expires_at": view["expires_at"],
        "device_id": me.device_id,
        "name": me.name,
    }


def pair_claim(host: PeerHost, request: Request) -> Reply:
    body = request.body
    try:
        record = host.pairings.claim(
            pairing_id=_text(body, "pairing_id"),
            nonce=_text(body, "nonce"),
            code=_text(body, "code"),
            claim_secret=_text(body, "claim_secret"),
        )
    except PairingRefused as refusal:
        if refusal.error == "claim_spent":
            pairing = _text(body, "pairing_id") or "(by code)"
            _log(f"claim_spent: a second claim of {pairing} was refused")
        return _refused(refusal)
    row = host.registry.get(record.peer_id or "")
    if row is None:
        # Revoked between the approval and the claim: the token admits nobody, so it is not given.
        return peer_error(410, "pairing_expired", "the approval was withdrawn", state="expired")
    me = host.identity.identity
    pair_back = None
    if record.kind == "pc" and record.device_id is not None:
        pair_back = {
            "device_id": me.device_id,
            "name": me.name,
            "requested_grants": list(record.granted),
        }
    host.publish("peer.changed", peer_id=row.peer_id)
    return 200, {
        "ok": True,
        "token": record.token,
        "peer_id": row.peer_id,
        "device_id": me.device_id,
        "name": me.name,
        "pair_back": pair_back,
    }


def pair_back(host: PeerHost, request: Request) -> Reply:
    row = peer_of(request)
    if row.kind != "pc":
        return peer_error(403, "bad_request", "only a computer pairs back")
    token = request.body.get("token")
    port = request.body.get("port")
    if not isinstance(token, str) or not 20 <= len(token) <= MAX_TOKEN_CHARS:
        return peer_error(400, "bad_request", "token must be a minted peer token")
    if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
        return peer_error(400, "bad_request", "port must be a port number")
    client = request.client if isinstance(request, PeerRequest) else ""
    url = f"http://{f'[{client}]' if ':' in client else client}:{port}"
    host.keys.keep(row.peer_id, url, token)
    host.publish("peer.changed", peer_id=row.peer_id)
    return 200, {"ok": True}


def peer_routes(host: PeerHost) -> list[PeerRoute]:
    return [
        PeerRoute("GET", "/peer/hello", lambda request: hello(host, request)),
        PeerRoute(
            "POST", "/peer/pair/request", lambda request: pair_request(host, request), open=True
        ),
        PeerRoute("POST", "/peer/pair/claim", lambda request: pair_claim(host, request), open=True),
        PeerRoute("POST", "/peer/pair/back", lambda request: pair_back(host, request)),
    ]

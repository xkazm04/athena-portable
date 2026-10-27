"""The whole ceremony over real sockets: the window's /devices, another device's /peer (ADR 0140).

athena/peer/devices.py and routes.py, wired by athena.wiring as ``athena serve`` wires them.
"""

from __future__ import annotations

import json
import threading
from datetime import UTC, datetime, timedelta
from http.client import HTTPConnection

import pytest

from athena.contracts import ids
from athena.daemon.server import TOKEN_HEADER
from athena.peer.listener import Join, PeerRoute
from athena.peer.overlay import Overlay

from .conftest import TOKEN, Device, Probe


def _claim_parts(url: str) -> tuple[str, str]:
    pairing_id, nonce = url.split("#claim=", 1)[1].split(".", 1)
    return pairing_id, nonce


def _phone_token(device: Device, grants: list[str] | None = None) -> tuple[str, str]:
    """Pair a phone through the QR path; its token and peer id."""
    opened = device.ui("/devices/pairing", method="POST", body={"kind": "phone"})
    assert opened.status == 200
    url = opened.body["url"]
    assert url.startswith(f"http://127.0.0.1:{device.peer_port}/m/#claim=")
    pairing_id, nonce = _claim_parts(url)
    asked = device.peer(
        "/peer/pair/request",
        method="POST",
        body={
            "pairing_id": pairing_id,
            "nonce": nonce,
            "name": "Phone",
            "kind": "phone",
            "device_id": None,
            "requested_grants": ["chat", "approve"],
        },
    )
    assert asked.status == 200, asked.body
    approved = device.ui(
        f"/devices/pending/{pairing_id}",
        method="POST",
        body={"choice": "approve", "grants": grants, "expires_days": None},
    )
    assert approved.status == 200, approved.body
    claimed = device.peer(
        "/peer/pair/claim", method="POST", body={"pairing_id": pairing_id, "nonce": nonce}
    )
    assert claimed.status == 200, claimed.body
    assert claimed.body["pair_back"] is None, "a phone is never asked to pair back"
    return claimed.body["token"], claimed.body["peer_id"]


def _disk(device: Device) -> str:
    return "".join(p.read_text(encoding="utf-8") for p in device.root.rglob("*") if p.is_file())


def test_devices_reports_every_field_with_null_for_absent(device: Device) -> None:
    answer = device.ui("/devices")
    assert answer.status == 200
    body = answer.body
    assert set(body) >= {"self", "peers", "pending", "beacon", "overlay", "listener", "joining"}
    assert body["self"]["device_id"].startswith("dev_")
    assert body["peers"] == [] and body["pending"] == []
    assert body["beacon"] == {"on": False, "url": None}
    assert body["overlay"] == {"state": "up"}
    assert body["listener"]["up"] is False and body["listener"]["address"] is None


def test_case5_every_peer_row_carries_link_with_every_key_and_revoke_takes_it(
    device: Device,
) -> None:
    _, phone = _phone_token(device)
    rows = device.ui("/devices").body["peers"]
    assert [row["peer_id"] for row in rows] == [phone]
    link = rows[0]["link"]
    assert set(link) == {"state", "since", "evidence"}
    assert set(link["evidence"]) == {"key", "hello", "hello_at", "overlay", "memory"}
    assert link["state"] == "phone" and isinstance(link["since"], str)
    assert all(value is None for value in link["evidence"].values()), "null for absent"

    assert device.ui(f"/devices/{phone}", method="DELETE").status == 200
    assert device.ui("/devices").body["peers"] == [], "the link went with its row"


def test_the_overlay_state_is_reported_when_absent(device: Device, probe: Probe) -> None:
    probe.overlay = Overlay("absent")
    device.host._overlay = None
    assert device.ui("/devices").body["overlay"] == {"state": "absent"}
    opened = device.ui("/devices/pairing", method="POST", body={"kind": "phone"})
    assert opened.status == 200 and opened.body["url"] is None


def test_rename_and_beacon(device: Device) -> None:
    assert device.ui("/devices/self", method="PUT", body={"name": "Study PC"}).status == 200
    assert device.ui("/devices").body["self"]["name"] == "Study PC"
    assert device.ui("/devices/self", method="PUT", body={"name": "  "}).status == 400
    on = device.ui("/devices/beacon", method="PUT", body={"on": True})
    assert on.body["beacon"]["url"] == f"http://127.0.0.1:{device.peer_port}/m/"
    off = device.ui("/devices/beacon", method="PUT", body={"on": False})
    assert off.body["beacon"] == {"on": False, "url": None}
    assert device.host.bound is None


def test_a_phone_pairs_says_hello_and_cannot_claim_twice(
    device: Device, capsys: pytest.CaptureFixture[str]
) -> None:
    token, peer_id = _phone_token(device, grants=["chat"])
    hello = device.peer("/peer/hello", token=token)
    assert hello.status == 200
    assert hello.body["device_id"] == device.host.identity.identity.device_id
    assert hello.body["setup_phase"] is None and hello.body["beacon"] is False

    rows = device.ui("/devices").body["peers"]
    assert [row["peer_id"] for row in rows] == [peer_id]
    assert rows[0]["grants"] == ["chat"] and "token_sha256" not in rows[0]
    assert token not in _disk(device), "the token's plaintext is never on disk"

    window = next(iter(device.host.pairings._records.values()))
    again = device.peer(
        "/peer/pair/claim",
        method="POST",
        body={"pairing_id": window.pairing_id, "nonce": window.nonce},
    )
    assert again.status == 410 and again.body["error"] == "claim_spent"
    assert again.body["reason"] == "approval_spent"
    logged = capsys.readouterr().err
    assert "claim_spent" in logged and token not in logged and window.nonce not in logged


def test_revoke_is_immediate(device: Device) -> None:
    token, peer_id = _phone_token(device)
    assert device.peer("/peer/hello", token=token).status == 200
    device.host.beacon = True  # keep the listener up, so the 401 is the token's and not the port's
    assert device.ui(f"/devices/{peer_id}", method="DELETE").status == 200
    assert device.peer("/peer/hello", token=token).status == 401
    assert device.ui(f"/devices/{peer_id}", method="DELETE").status == 404


def test_a_route_needing_a_grant_the_peer_lacks_is_403_grant_missing(device: Device) -> None:
    device.host.add_routes(
        [PeerRoute("GET", "/peer/test/memory", lambda request: (200, {"ok": True}), grant="memory")]
    )
    token, _ = _phone_token(device, grants=["chat"])
    refused = device.peer("/peer/test/memory", token=token)
    assert refused.status == 403
    assert refused.body["error"] == "grant_missing" and refused.body["grant"] == "memory"


def test_approve_cannot_widen_the_requested_grants(device: Device) -> None:
    opened = device.ui("/devices/pairing", method="POST", body={"kind": "phone"})
    pairing_id, nonce = _claim_parts(opened.body["url"])
    device.peer(
        "/peer/pair/request",
        method="POST",
        body={
            "pairing_id": pairing_id,
            "nonce": nonce,
            "name": "P",
            "kind": "phone",
            "requested_grants": ["chat"],
        },
    )
    pending = device.ui("/devices").body["pending"]
    assert [p["pairing_id"] for p in pending] == [pairing_id]
    assert pending[0]["requested_grants"] == ["chat"] and pending[0]["pair_back"] is False
    wider = device.ui(
        f"/devices/pending/{pairing_id}",
        method="POST",
        body={"choice": "approve", "grants": ["chat", "memory"], "expires_days": None},
    )
    assert wider.status == 409 and wider.body["error"] == "grant_not_requested"
    assert device.ui("/devices").body["peers"] == []


def test_events_streams_a_pair_request(device: Device) -> None:
    connection = HTTPConnection("127.0.0.1", device.port, timeout=10)
    connection.request("GET", "/events", headers={TOKEN_HEADER: TOKEN})
    reply = connection.getresponse()
    assert reply.status == 200
    assert reply.readline().startswith(b": athena events")
    assert reply.readline() == b"retry: 1000\n"
    reply.readline()

    def ask() -> None:
        opened = device.ui("/devices/pairing", method="POST", body={"kind": "phone"})
        pairing_id, nonce = _claim_parts(opened.body["url"])
        device.peer(
            "/peer/pair/request",
            method="POST",
            body={"pairing_id": pairing_id, "nonce": nonce, "name": "P", "kind": "phone"},
        )

    threading.Thread(target=ask).start()
    event = reply.readline().decode().strip()
    data = json.loads(reply.readline().decode().removeprefix("data: "))
    connection.close()
    assert event == "event: pair.requested"
    assert data["kind"] == "pair.requested" and data["pending"]["name"] == "P"
    assert "nonce" not in data and "claim_secret" not in data


def test_a_quiet_event_stream_ends_so_every_response_ends(device: Device) -> None:
    frames = list(device.host.bus.frames(quiet_s=0.05))
    assert frames == [": athena events\nretry: 1000\n\n"]


def test_two_pcs_pair_both_ways_with_two_human_approvals(device: Device, other: Device) -> None:
    a, b = device, other
    code = a.ui("/devices/pairing", method="POST", body={"kind": "pc"}).body["code"]

    joined = b.ui(
        "/devices/join",
        method="POST",
        body={
            "address": "127.0.0.1",
            "port": a.peer_port,
            "code": code,
            "requested_grants": ["chat", "memory"],
        },
    )
    assert joined.status == 200, joined.body
    assert joined.body["join"]["state"] == "pending"

    pending = a.ui("/devices").body["pending"]
    assert [p["name"] for p in pending] == [b.host.identity.identity.name]
    b.host.tick()  # A has not answered, so B keeps waiting
    assert b.ui("/devices").body["joining"][0]["state"] == "pending"

    # A's person approves B, narrowed to memory, for thirty days.
    approved = a.ui(
        f"/devices/pending/{pending[0]['pairing_id']}",
        method="POST",
        body={"choice": "approve", "grants": ["memory"], "expires_days": 30},
    )
    assert approved.status == 200
    assert approved.body["peer"]["peer_id"] == b.host.identity.identity.device_id
    assert approved.body["peer"]["expires"] is not None

    # B claims on its tick, keeps A's token sealed, and files A's ask to be let in return.
    b.host.tick()
    a_id = a.host.identity.identity.device_id
    b_token_for_a = b.host.keys.token(a_id)
    assert b_token_for_a is not None
    view = b.ui("/devices").body
    assert view["joining"][0]["state"] == "claimed"
    assert view["peers"] == [], "nothing is admitted on B until B's person says so"
    back = view["pending"]
    assert len(back) == 1 and back[0]["pair_back"] is True
    assert back[0]["requested_grants"] == ["memory"]
    assert a.peer("/peer/hello", token=b_token_for_a).status == 200

    # B's person approves A; B delivers that token to A over A's listener.
    answered = b.ui(
        f"/devices/pending/{back[0]['pairing_id']}",
        method="POST",
        body={"choice": "approve", "grants": ["memory"], "expires_days": None},
    )
    assert answered.status == 200
    assert b.host.pairings.undelivered() == []
    b_id = b.host.identity.identity.device_id
    a_token_for_b = a.host.keys.token(b_id)
    assert a_token_for_b is not None
    assert a.host.keys.url(b_id) == f"http://127.0.0.1:{b.peer_port}"
    assert b.peer("/peer/hello", token=a_token_for_b).status == 200

    for side in (a, b):
        assert b_token_for_a not in _disk(side) and a_token_for_b not in _disk(side)


def test_a_join_to_a_lan_address_is_refused_before_any_call(device: Device) -> None:
    answer = device.ui(
        "/devices/join", method="POST", body={"address": "192.168.1.20", "code": "ABCDEF"}
    )
    assert answer.status == 400


def _join(device_id: str | None) -> Join:
    started = datetime(2026, 10, 24, 12, 0, tzinfo=UTC)
    return Join(
        join_id="pair_0123456789ab",
        url="http://100.64.0.9:17491",
        code="ABCDEF",
        claim_secret="s",
        name="Desk",
        device_id=device_id,
        started=started,
        expires_at=started + timedelta(minutes=10),
    )


@pytest.mark.parametrize(
    ("named_first", "claimed_as"),
    [("named", "../../not-a-device"), ("named", "other"), (None, "../../not-a-device")],
)
def test_a_claim_answer_files_a_key_only_under_the_device_the_request_named(
    device: Device, named_first: str | None, claimed_as: str
) -> None:
    # The answering PC names itself twice: in the request answer (``Join.device_id``) and in the
    # claim. A key is filed only under a real device id, and only the one it named first - never
    # under a string that is not an id, and never over another paired device's key.
    host = device.host
    named, other = ids.mint("device"), ids.mint("device")
    host.keys.keep(other, "http://100.64.0.2:17491", "the-other-pcs-own-token")
    joined = _join(named if named_first else None)
    answer_id = other if claimed_as == "other" else claimed_as
    host._joined(joined, {"device_id": answer_id, "token": "t" * 43, "pair_back": None})
    assert joined.state == "expired"
    assert host.keys.known() == [other]
    assert host.keys.token(other) == "the-other-pcs-own-token"
    assert host.keys.url(other) == "http://100.64.0.2:17491"


@pytest.mark.parametrize("in_claim", [True, False])
def test_a_claim_answer_from_the_device_it_named_is_filed(device: Device, in_claim: bool) -> None:
    host = device.host
    named = ids.mint("device")
    joined = _join(named)
    body = {"device_id": named if in_claim else None, "token": "t" * 43, "pair_back": None}
    host._joined(joined, body)
    assert joined.state == "claimed"
    assert host.keys.token(named) == "t" * 43

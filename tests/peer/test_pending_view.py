"""The approval card's facts: who asked from where, and whom approving would replace (ADR 0140).

athena/peer/pairing.py ``pending_view`` and ``PeerHost.pending_view``: the device-pairing standard
asks the mint gate to show the channel-stamped identity beside the claimed name, and a request that
names an already-paired device id would silently replace that row. Both facts reach only the
loopback ``/devices`` and ``/events`` (the window's person), never the requester's answer.
"""

from __future__ import annotations

from athena.contracts import ids
from athena.peer.registry import mint_token

from .conftest import Device


def _ask(device: Device, kind: str, **body: object) -> dict[str, object]:
    opened = device.ui("/devices/pairing", method="POST", body={"kind": kind})
    asked = device.peer(
        "/peer/pair/request",
        method="POST",
        body={
            "code": opened.body["code"],
            "name": "Desk",
            "kind": kind,
            "requested_grants": ["chat"],
            **body,
        },
    )
    assert asked.status == 200, asked.body
    return asked.body


def test_a_pending_request_shows_the_socket_address_not_the_one_the_body_claims(
    device: Device,
) -> None:
    answer = _ask(device, "phone", device_id=None, address="10.9.9.9", client="10.9.9.9")
    (pending,) = device.ui("/devices").body["pending"]
    assert pending["address"] == "127.0.0.1", "the channel's address, never the payload's"
    assert pending["replaces"] is None
    assert "address" not in answer and "replaces" not in answer, "the requester learns nothing new"


def test_a_request_naming_a_paired_device_shows_the_row_approving_it_would_replace(
    device: Device,
) -> None:
    desk = ids.mint("device")
    device.host.registry.admit(
        desk, name="Desk", kind="pc", grants=["chat"], token=mint_token(), expires_days=None
    )
    _ask(device, "pc", device_id=desk)
    (pending,) = device.ui("/devices").body["pending"]
    assert pending["replaces"] == {"peer_id": desk, "name": "Desk"}
    assert pending["address"] == "127.0.0.1"


def test_a_request_from_a_device_not_paired_here_replaces_nothing(device: Device) -> None:
    _ask(device, "pc", device_id=ids.mint("device"))
    (pending,) = device.ui("/devices").body["pending"]
    assert pending["replaces"] is None


def test_the_published_event_carries_both_facts(device: Device) -> None:
    inbox = device.host.bus.subscribe()
    desk = ids.mint("device")
    device.host.registry.admit(
        desk, name="Old Desk", kind="pc", grants=["chat"], token=mint_token(), expires_days=None
    )
    _ask(device, "pc", device_id=desk)
    seen = []
    while not inbox.empty():
        seen.append(inbox.get_nowait())
    pending = next(e for e in seen if e.get("kind") == "pair.requested")["pending"]
    assert pending["address"] == "127.0.0.1"
    assert pending["replaces"]["name"] == "Old Desk"

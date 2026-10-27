"""The peer audit trail: every mint, claim, revoke, lapse and pre-trust refusal leaves one row.

athena/peer/audit.py, written by devices.py, routes.py and listener.py; driven over real sockets
as ``athena serve`` wires them (ADR 0140, the device-pairing standard's "the ledger gets
everything").
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from athena.peer import audit as audit_module
from athena.peer.audit import AUDIT_FILENAME, COALESCE_S, AuditLog
from athena.peer.pairing import WINDOW_TTL_S

from .conftest import Clock, Device


def _rows(device: Device) -> list[dict[str, Any]]:
    path = device.root / AUDIT_FILENAME
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def _acts(device: Device) -> list[str]:
    return [row["act"] for row in _rows(device)]


def _window(device: Device, kind: str = "phone") -> tuple[str, str, str]:
    opened = device.ui("/devices/pairing", method="POST", body={"kind": "phone"})
    assert opened.status == 200
    pairing_id, nonce = opened.body["url"].split("#claim=", 1)[1].split(".", 1)
    return pairing_id, nonce, opened.body["code"]


def _ask(device: Device, pairing_id: str, nonce: str) -> None:
    asked = device.peer(
        "/peer/pair/request",
        method="POST",
        body={
            "pairing_id": pairing_id,
            "nonce": nonce,
            "name": "Phone",
            "kind": "phone",
            "device_id": None,
            "requested_grants": ["chat"],
        },
    )
    assert asked.status == 200, asked.body


def test_every_trust_change_and_refusal_writes_exactly_one_row_and_no_secret(
    device: Device, clock: Clock
) -> None:
    # approve + claim + claim_spent
    pairing_id, nonce, code = _window(device)
    _ask(device, pairing_id, nonce)
    assert (
        device.ui(
            f"/devices/pending/{pairing_id}", method="POST", body={"choice": "approve"}
        ).status
        == 200
    )
    claim = {"pairing_id": pairing_id, "nonce": nonce}
    claimed = device.peer("/peer/pair/claim", method="POST", body=claim)
    assert claimed.status == 200
    token, peer_id = claimed.body["token"], claimed.body["peer_id"]
    assert device.peer("/peer/pair/claim", method="POST", body=claim).status == 410
    # decline
    second, second_nonce, _ = _window(device)
    _ask(device, second, second_nonce)
    assert (
        device.ui(f"/devices/pending/{second}", method="POST", body={"choice": "decline"}).status
        == 200
    )
    # the pre-trust refusals: a wrong code, a wrong nonce, a stranger with no token
    third, third_nonce, _ = _window(device)
    wrong_code = device.peer("/peer/pair/request", method="POST", body={"code": "ZZZZZZ"})
    assert wrong_code.status == 403
    wrong_nonce = device.peer(
        "/peer/pair/request", method="POST", body={"pairing_id": third, "nonce": "nope"}
    )
    assert wrong_nonce.status == 403
    assert device.peer("/peer/hello").status == 401
    # revoke
    assert device.ui(f"/devices/{peer_id}", method="DELETE").status == 200
    # lapse: an approval nobody claims
    fourth, fourth_nonce, _ = _window(device)
    _ask(device, fourth, fourth_nonce)
    assert (
        device.ui(f"/devices/pending/{fourth}", method="POST", body={"choice": "approve"}).status
        == 200
    )
    clock.advance(WINDOW_TTL_S + 1)
    device.host.tick()

    rows = _rows(device)
    acts = [row["act"] for row in rows]
    assert acts == [
        "approve",
        "claim",
        "claim_spent",
        "decline",
        "refusal",
        "refusal",
        "refusal",
        "revoke",
        "approve",
        "lapse",
    ]
    assert [row.get("cause") for row in rows if row["act"] == "refusal"] == [
        "wrong_code",
        "wrong_nonce",
        "unauthorized",
    ]
    assert all(row["at"] and row["act"] for row in rows)
    assert {row["peer_id"] for row in rows if row["act"] in ("approve", "claim", "revoke")} >= {
        peer_id
    }
    on_disk = (device.root / AUDIT_FILENAME).read_text(encoding="utf-8")
    for secret in (token, nonce, code, third_nonce, "ZZZZZZ", "nope"):
        assert secret not in on_disk, "an audit row carried a secret"


def test_a_flood_of_the_same_refusal_is_one_row_and_a_count(device: Device, clock: Clock) -> None:
    _window(device)
    for _ in range(30):
        assert device.peer("/peer/hello").status == 401
    assert _acts(device) == ["refusal"]
    clock.advance(COALESCE_S + 1)
    assert device.peer("/peer/hello").status == 401
    rows = _rows(device)
    assert [row["act"] for row in rows] == ["refusal", "refusal"]
    assert rows[1]["repeats"] == 29


def test_free_text_a_stranger_sent_does_not_reach_the_file_as_an_id(tmp_path: Path) -> None:
    now = datetime(2026, 10, 24, tzinfo=UTC)
    log = AuditLog(tmp_path, now=lambda: now)
    log.refusal("wrong_nonce", address="100.64.0.9", pairing_id="my-password-hunter2")
    log.refusal("wrong_nonce", address="100.64.0.8", pairing_id="pair_0123456789ab")
    text = (tmp_path / AUDIT_FILENAME).read_text(encoding="utf-8")
    assert "hunter2" not in text and "pair_0123456789ab" in text


def test_the_file_rotates_once_and_a_dead_disk_never_raises(
    tmp_path: Path, monkeypatch: Any
) -> None:
    monkeypatch.setattr(audit_module, "MAX_BYTES", 400)
    log = AuditLog(tmp_path, now=lambda: datetime(2026, 10, 24, tzinfo=UTC))
    for index in range(40):
        log.record("revoke", peer_id=f"dev_{index:012d}")
    assert (tmp_path / "audit.1.jsonl").exists()
    assert (tmp_path / AUDIT_FILENAME).stat().st_size < 400 + 200
    blocked = tmp_path / "file"
    blocked.write_text("x", encoding="utf-8")
    AuditLog(blocked / "peer", now=lambda: datetime.now(UTC) + timedelta(0)).record("revoke")

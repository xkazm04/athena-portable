"""peers.json: fingerprints only, written whole, revoked at once, reaped by the tick (ADR 0140).

athena/peer/registry.py and identity.py.
"""

from __future__ import annotations

import json
from pathlib import Path

from athena.contracts import ids
from athena.peer.identity import IdentityStore
from athena.peer.registry import PeerRegistry, fingerprint, mint_token

from .conftest import Clock

ROW_KEYS = {"peer_id", "name", "kind", "grants", "token_sha256", "created", "expires", "last_seen"}


def _admit(registry: PeerRegistry, token: str, days: int | None = None) -> str:
    peer_id = ids.mint("device")
    registry.admit(
        peer_id,
        name="Study PC",
        kind="pc",
        grants=["memory", "chat"],
        token=token,
        expires_days=days,
    )
    return peer_id


def test_a_row_has_exactly_the_designed_fields_and_never_the_token(tmp_path: Path) -> None:
    token = mint_token()
    registry = PeerRegistry(tmp_path)
    _admit(registry, token)

    text = (tmp_path / "peers.json").read_text(encoding="utf-8")
    assert token not in text
    rows = json.loads(text)
    assert set(rows[0]) == ROW_KEYS
    assert rows[0]["token_sha256"] == fingerprint(token)
    assert rows[0]["grants"] == ["chat", "memory"]  # ladder order
    assert rows[0]["expires"] is None and rows[0]["last_seen"] is None
    assert not list(tmp_path.glob("*.tmp")), "the temporary sibling was replaced into place"


def test_authenticate_finds_the_row_and_revoke_drops_it_at_once(tmp_path: Path) -> None:
    token = mint_token()
    registry = PeerRegistry(tmp_path)
    peer_id = _admit(registry, token)
    row = registry.authenticate(token)
    assert row is not None and row.peer_id == peer_id
    assert registry.authenticate(mint_token()) is None
    assert registry.authenticate("") is None

    assert registry.revoke(peer_id)
    assert registry.authenticate(token) is None
    assert PeerRegistry(tmp_path).rows() == []  # and the disk agrees


def test_an_expired_row_stops_authenticating_and_the_reap_removes_it_from_disk(
    tmp_path: Path,
) -> None:
    clock = Clock()
    token = mint_token()
    registry = PeerRegistry(tmp_path, now=clock)
    peer_id = _admit(registry, token, days=1)
    assert registry.authenticate(token) is not None

    clock.advance(86_401)
    assert registry.authenticate(token) is None
    assert peer_id in (tmp_path / "peers.json").read_text(encoding="utf-8")
    assert registry.reap() == [peer_id]
    assert peer_id not in (tmp_path / "peers.json").read_text(encoding="utf-8")


def test_last_seen_is_written_at_most_once_a_minute(tmp_path: Path) -> None:
    clock = Clock()
    registry = PeerRegistry(tmp_path, now=clock)
    peer_id = _admit(registry, mint_token())
    registry.touch(peer_id)
    first = registry.get(peer_id)
    assert first is not None and first.last_seen is not None
    clock.advance(30)
    registry.touch(peer_id)
    assert registry.get(peer_id) == first
    clock.advance(31)
    registry.touch(peer_id)
    later = registry.get(peer_id)
    assert later is not None and later.last_seen != first.last_seen


def test_an_unreadable_file_admits_nobody_and_is_kept(tmp_path: Path) -> None:
    (tmp_path / "peers.json").write_text("{not json", encoding="utf-8")
    registry = PeerRegistry(tmp_path)
    assert registry.rows() == []
    assert (tmp_path / "peers.json.unreadable").read_text(encoding="utf-8") == "{not json"


def test_the_device_identity_is_minted_once_and_renamed_in_place(tmp_path: Path) -> None:
    store = IdentityStore(tmp_path)
    assert not (tmp_path / "device.json").exists(), "nothing is written until someone asks"
    first = store.identity
    assert ids.is_id("device", first.device_id) and first.name

    again = IdentityStore(tmp_path).identity
    assert again == first
    renamed = store.rename("  Study\nPC  ")
    assert renamed.name == "Study PC" and renamed.device_id == first.device_id
    data = json.loads((tmp_path / "device.json").read_text(encoding="utf-8"))
    assert data == {"device_id": first.device_id, "name": "Study PC", "created": first.created}

"""The vault: admission by probe, the one outbound door, the switches, and no secret surface."""

from __future__ import annotations

import json
import threading
from collections.abc import Mapping
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

import pytest

from athena.connectors.seal import FileSeal
from athena.connectors.spec import ConnectorSpec
from athena.connectors.vault import (
    HostRefused,
    NeedsReauth,
    NotConnected,
    UrllibTransport,
    Vault,
    VaultError,
    redact,
)

from .conftest import FakeProvider

TOKEN = "ntn_test_token_0123456789"


# -- admission ------------------------------------------------------------------------------------


def test_a_pasted_token_is_probed_before_it_is_sealed(vault: Vault, provider: FakeProvider) -> None:
    record = vault.connect_token("notion", TOKEN)
    assert record.status == "connected"
    assert record.identity == "Test User"
    assert record.health == "healthy" and record.health_at
    assert record.seal == "file"
    probe = provider.seen[0]
    assert probe.method == "GET" and probe.path == "/v1/users/me"
    assert probe.headers["Authorization"] == f"Bearer {TOKEN}"
    assert probe.headers["Notion-Version"] == "2022-06-28"
    assert vault.is_live("notion")


def test_a_refused_token_seals_nothing(tmp_path: Path, specs: dict[str, ConnectorSpec]) -> None:
    provider = FakeProvider(script=lambda *_: (401, {"message": "invalid token"}))
    vault = Vault(
        tmp_path / "c", specs=specs, transport=provider, seal=FileSeal(tmp_path / "c" / "s")
    )
    with pytest.raises(VaultError, match="refused the credential with 401"):
        vault.connect_token("notion", TOKEN)
    assert not vault.is_live("notion")
    assert vault.record("notion").status == "disconnected"
    assert list((tmp_path / "c" / "s").glob("*")) == []


def test_the_record_on_disk_never_carries_a_value(notion: Vault, tmp_path: Path) -> None:
    text = (tmp_path / "connectors" / "connections.json").read_text(encoding="utf-8")
    assert TOKEN not in text
    assert json.loads(text)["notion"]["status"] == "connected"
    # and neither does the view a surface reads
    assert TOKEN not in json.dumps(notion.views())


def test_a_token_service_does_not_take_oauth_and_vice_versa(vault: Vault) -> None:
    with pytest.raises(VaultError, match="connects with a pasted token"):
        vault.connect_oauth("notion", client_id="x", client_secret="y", open_browser=False)
    with pytest.raises(VaultError, match="connects with OAuth"):
        vault.connect_token("gmail", "ya29.something")


def test_the_records_survive_a_restart(
    notion: Vault, tmp_path: Path, provider: FakeProvider
) -> None:
    again = Vault(
        tmp_path / "connectors",
        specs=notion.specs,
        transport=provider,
        seal=FileSeal(tmp_path / "connectors" / "sealed"),
    )
    assert again.is_live("notion")
    assert again.record("notion").identity == "Test User"
    status, _ = again.request("notion", "GET", "https://api.notion.com/v1/users/me")
    assert status == 200


# -- the outbound door ----------------------------------------------------------------------------


def test_the_credential_rides_every_request_and_only_to_the_specs_hosts(
    notion: Vault, provider: FakeProvider
) -> None:
    status, _ = notion.request("notion", "POST", "https://api.notion.com/v1/search", {"query": "x"})
    assert status == 200
    sent = provider.seen[-1]
    assert sent.headers["Authorization"] == f"Bearer {TOKEN}"
    assert sent.json == {"query": "x"}
    with pytest.raises(HostRefused):
        notion.request("notion", "GET", "https://evil.example/v1/users/me")
    with pytest.raises(HostRefused, match=r"api\.notion\.com"):
        notion.request("notion", "GET", "http://api.notion.com/v1/users/me")  # not https
    assert len(provider.seen) == 2, "a refused host never reached the transport"


def test_a_disconnected_or_switched_off_connector_is_refused_before_the_wire(
    vault: Vault, provider: FakeProvider
) -> None:
    with pytest.raises(NotConnected):
        vault.request("notion", "GET", "https://api.notion.com/v1/users/me")
    vault.connect_token("notion", TOKEN)
    vault.set_enabled("notion", False)
    assert not vault.is_live("notion")
    with pytest.raises(NotConnected):
        vault.request("notion", "GET", "https://api.notion.com/v1/users/me")
    assert len(provider.seen) == 1, "only the probe went out"


def test_a_provider_error_body_is_returned_redacted(
    tmp_path: Path, specs: dict[str, ConnectorSpec]
) -> None:
    def script(
        method: str, url: str, headers: Mapping[str, str], body: bytes | None
    ) -> tuple[int, Any]:
        if url.endswith("/users/me"):
            return 200, {"name": "n"}
        return 500, f"boom Bearer {TOKEN} and again {TOKEN}".encode()

    provider = FakeProvider(script=script)
    vault = Vault(
        tmp_path / "c", specs=specs, transport=provider, seal=FileSeal(tmp_path / "c" / "s")
    )
    vault.connect_token("notion", TOKEN)
    status, text = vault.request("notion", "GET", "https://api.notion.com/v1/pages/1")
    assert status == 500
    assert TOKEN not in text
    assert "[redacted]" in text


def test_redact_strips_bearer_tokens_and_known_prefixes() -> None:
    assert redact("x Bearer abcdefghijklmnop y", []) == "x Bearer [redacted] y"
    assert redact("key ntn_abcdefghijklmnop", []) == "key [redacted]"
    assert redact("a secret", ["secret"]) == "a [redacted]"


def test_a_response_over_the_cap_is_refused(
    tmp_path: Path, specs: dict[str, ConnectorSpec]
) -> None:
    def script(
        method: str, url: str, headers: Mapping[str, str], body: bytes | None
    ) -> tuple[int, Any]:
        if url.endswith("/users/me"):
            return 200, {"name": "n"}
        return 200, b"x" * (1_048_576 + 1)

    vault = Vault(
        tmp_path / "c",
        specs=specs,
        transport=FakeProvider(script=script),
        seal=FileSeal(tmp_path / "s"),
    )
    vault.connect_token("notion", TOKEN)
    with pytest.raises(VaultError, match="more than"):
        vault.request("notion", "GET", "https://api.notion.com/v1/pages/1")


# -- the switches ---------------------------------------------------------------------------------


def test_writes_are_off_by_default_and_the_allowlist_is_normalised(notion: Vault) -> None:
    record = notion.record("notion")
    assert record.writes_enabled is False and record.allowlist == []
    notion.set_writes("notion", True)
    notion.set_allowlist("notion", [" Abc-DEF ", "abc-def", "", "xyz"])
    record = notion.record("notion")
    assert record.writes_enabled is True
    assert record.allowlist == ["abc-def", "xyz"]


def test_a_listener_hears_every_change(vault: Vault) -> None:
    heard: list[str] = []
    vault.on_change(heard.append)
    vault.connect_token("notion", TOKEN)
    vault.set_writes("notion", True)
    vault.disconnect("notion")
    assert heard == ["notion", "notion", "notion"]


# -- disconnect -----------------------------------------------------------------------------------


def test_disconnect_destroys_the_sealed_value_and_keeps_the_switches(
    notion: Vault, tmp_path: Path
) -> None:
    notion.set_writes("notion", True)
    notion.set_allowlist("notion", ["page1"])
    record = notion.disconnect("notion")
    assert record.status == "disconnected" and record.identity == ""
    assert record.writes_enabled is True and record.allowlist == ["page1"]
    assert not notion.is_live("notion")
    assert list((tmp_path / "connectors" / "sealed").glob("*")) == []
    with pytest.raises(NotConnected):
        notion.request("notion", "GET", "https://api.notion.com/v1/users/me")


def test_probe_records_a_broken_credential_with_its_time(
    tmp_path: Path, specs: dict[str, ConnectorSpec]
) -> None:
    calls = {"n": 0}

    def script(
        method: str, url: str, headers: Mapping[str, str], body: bytes | None
    ) -> tuple[int, Any]:
        calls["n"] += 1
        return (200, {"name": "n"}) if calls["n"] == 1 else (401, {"message": "gone"})

    vault = Vault(
        tmp_path / "c",
        specs=specs,
        transport=FakeProvider(script=script),
        seal=FileSeal(tmp_path / "s"),
    )
    vault.connect_token("notion", TOKEN)
    record = vault.probe("notion")
    assert record.health == "broken" and record.health_at
    assert "401" in record.health_detail and TOKEN not in record.health_detail


# -- the grant ------------------------------------------------------------------------------------


def test_an_expired_grant_with_no_refresh_needs_reauth(
    tmp_path: Path, specs: dict[str, ConnectorSpec]
) -> None:
    provider = FakeProvider()
    vault = Vault(tmp_path / "c", specs=specs, transport=provider, seal=FileSeal(tmp_path / "s"))
    # Admit a grant the way the OAuth exchange would, but already at its floor and with no refresh.
    vault._admit(specs["gmail"], "ya29.access", refresh="", expires_in=1)
    assert vault.is_live("gmail")
    with pytest.raises(NeedsReauth, match="reconnected in Connectors"):
        vault.request("gmail", "GET", "https://gmail.googleapis.com/gmail/v1/users/me/profile")
    assert vault.record("gmail").status == "needs_reauth"
    assert not vault.is_live("gmail")


def test_the_transport_follows_no_redirect_so_the_credential_stays_on_the_pinned_host() -> None:
    hits: list[str] = []

    class Target(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            hits.append(self.headers.get("Authorization", ""))
            self.send_response(200)
            self.end_headers()

        def log_message(self, *args: Any) -> None:
            pass

    target = HTTPServer(("127.0.0.1", 0), Target)

    class Bounce(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            self.send_response(302)
            self.send_header("Location", f"http://127.0.0.1:{target.server_port}/stolen")
            self.end_headers()

        def log_message(self, *args: Any) -> None:
            pass

    first = HTTPServer(("127.0.0.1", 0), Bounce)
    threads = [threading.Thread(target=s.serve_forever, daemon=True) for s in (target, first)]
    for thread in threads:
        thread.start()
    try:
        status, _, _ = UrllibTransport()(
            "GET",
            f"http://127.0.0.1:{first.server_port}/",
            {"Authorization": "Bearer secret"},
            None,
            5.0,
        )
    finally:
        for server in (target, first):
            server.shutdown()
            server.server_close()
    assert status == 302
    assert hits == [], "the second host received a request"


# -- the records file (ADR 0021; the craft-1 and robustness-1 findings) ---------------------------

UNREADABLE = {
    "truncated": b'{"notion": {"status": "conn',
    "empty": b"",
    "nul": b"\x00\x00\x00\x00",
    "not-an-object": b"[]",
}


def _vault_over(tmp_path: Path, specs: dict[str, ConnectorSpec], provider: FakeProvider) -> Vault:
    return Vault(
        tmp_path / "connectors",
        specs=specs,
        transport=provider,
        seal=FileSeal(tmp_path / "connectors" / "sealed"),
    )


@pytest.mark.parametrize("name", sorted(UNREADABLE))
def test_an_unreadable_records_file_is_kept_and_said_aloud(
    name: str, tmp_path: Path, specs: dict[str, ConnectorSpec], provider: FakeProvider
) -> None:
    root = tmp_path / "connectors"
    root.mkdir()
    (root / "connections.json").write_bytes(UNREADABLE[name])
    vault = _vault_over(tmp_path, specs, provider)
    copies = sorted(root.glob("connections.json.unreadable-*"))
    assert len(copies) == 1 and copies[0].read_bytes() == UNREADABLE[name]
    assert "could not be read" in vault.records_notice and copies[0].name in vault.records_notice
    assert all(v["records_notice"] == vault.records_notice for v in vault.views())
    assert not vault.is_live("notion")


def test_the_switches_set_afterwards_do_not_destroy_the_copy(
    tmp_path: Path, specs: dict[str, ConnectorSpec], provider: FakeProvider
) -> None:
    root = tmp_path / "connectors"
    root.mkdir()
    (root / "connections.json").write_bytes(UNREADABLE["truncated"])
    vault = _vault_over(tmp_path, specs, provider)
    vault.set_writes("notion", True)
    vault.set_allowlist("notion", ["page1"])
    (copy,) = root.glob("connections.json.unreadable-*")
    assert copy.read_bytes() == UNREADABLE["truncated"]
    assert json.loads((root / "connections.json").read_text(encoding="utf-8"))["notion"][
        "writes_enabled"
    ]
    again = _vault_over(tmp_path, specs, provider)
    assert again.records_notice and copy.name in again.records_notice, "the copy stays in view"


def test_a_readable_file_gives_no_notice(notion: Vault) -> None:
    assert notion.records_notice == ""
    assert all(v["records_notice"] == "" for v in notion.views())


def test_a_crash_during_the_write_leaves_the_previous_file(
    notion: Vault, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "connectors" / "connections.json"
    before = path.read_bytes()

    def boom(*_: object) -> None:
        raise OSError("disk went away")

    monkeypatch.setattr("athena.connectors.vault.os.replace", boom)
    with pytest.raises(VaultError, match="could not be saved"):
        notion.set_writes("notion", True)
    assert path.read_bytes() == before
    assert list(path.parent.glob("*.tmp")) == [], "no temp file is left behind"


# -- the switches belong to the account (ADR 0062) ------------------------------------------------


def _accounts(tmp_path: Path, specs: dict[str, ConnectorSpec], names: list[str]) -> Vault:
    """A vault whose probe answers with the next name in ``names`` each time it is asked."""
    asked = {"n": 0}

    def script(
        method: str, url: str, headers: Mapping[str, str], body: bytes | None
    ) -> tuple[int, Any]:
        who = names[min(asked["n"], len(names) - 1)]
        asked["n"] += 1
        return 200, {"name": who}

    return Vault(
        tmp_path / "connectors",
        specs=specs,
        transport=FakeProvider(script=script),
        seal=FileSeal(tmp_path / "connectors" / "sealed"),
    )


def test_a_connect_as_a_different_account_turns_writes_off_and_empties_the_list(
    tmp_path: Path, specs: dict[str, ConnectorSpec]
) -> None:
    vault = _accounts(tmp_path, specs, ["A", "B"])
    vault.connect_token("notion", TOKEN)
    vault.set_writes("notion", True)
    vault.set_allowlist("notion", ["page1"])
    vault.disconnect("notion")
    assert vault.record("notion").writes_enabled, "ADR 0021: the disconnect keeps them"
    record = vault.connect_token("notion", TOKEN)
    assert record.identity == "B"
    assert record.writes_enabled is False and record.allowlist == []
    assert "Connected as B" in record.health_detail and "set under A" in record.health_detail
    assert "writes are off" in record.health_detail and "emptied" in record.health_detail


def test_a_reconnect_as_the_same_account_keeps_the_switches(
    tmp_path: Path, specs: dict[str, ConnectorSpec]
) -> None:
    vault = _accounts(tmp_path, specs, ["A"])
    vault.connect_token("notion", TOKEN)
    vault.set_writes("notion", True)
    vault.set_allowlist("notion", ["page1"])
    vault.disconnect("notion")
    record = vault.connect_token("notion", TOKEN)
    assert record.writes_enabled is True and record.allowlist == ["page1"]
    assert record.health_detail == ""


def test_the_identity_is_kept_across_a_restart_and_a_disconnect(
    tmp_path: Path, specs: dict[str, ConnectorSpec]
) -> None:
    vault = _accounts(tmp_path, specs, ["A", "B"])
    vault.connect_token("notion", TOKEN)
    vault.set_allowlist("notion", ["page1"])
    vault.disconnect("notion")
    again = _accounts(tmp_path, specs, ["B"])
    assert again.record("notion").switches_identity == "A"
    assert again.connect_token("notion", TOKEN).allowlist == []


def test_switches_set_before_any_connect_have_no_identity_and_are_reset(
    tmp_path: Path, specs: dict[str, ConnectorSpec]
) -> None:
    vault = _accounts(tmp_path, specs, ["A"])
    vault.set_writes("notion", True)
    vault.set_allowlist("notion", ["page1"])
    record = vault.connect_token("notion", TOKEN)
    assert record.writes_enabled is False and record.allowlist == []
    assert "without a known account" in record.health_detail


def test_a_legacy_record_is_reset_on_connect_but_adopted_when_loaded_live(
    tmp_path: Path, specs: dict[str, ConnectorSpec]
) -> None:
    root = tmp_path / "connectors"
    root.mkdir()
    legacy = {
        "status": "connected",
        "identity": "A",
        "writes_enabled": True,
        "allowlist": ["page1"],
    }
    gone = {**legacy, "status": "disconnected", "identity": ""}
    (root / "connections.json").write_text(json.dumps({"notion": legacy}), encoding="utf-8")
    live = _accounts(tmp_path, specs, ["A"])
    assert live.record("notion").switches_identity == "A"
    assert live.record("notion").writes_enabled is True
    assert live.connect_token("notion", TOKEN).allowlist == ["page1"], "the same account"
    (root / "connections.json").write_text(json.dumps({"notion": gone}), encoding="utf-8")
    off = _accounts(tmp_path, specs, ["A"])
    assert off.record("notion").switches_identity == ""
    assert off.connect_token("notion", TOKEN).writes_enabled is False


def test_a_probe_that_names_no_account_never_matches(
    tmp_path: Path, specs: dict[str, ConnectorSpec]
) -> None:
    vault = _accounts(tmp_path, specs, ["A", ""])
    vault.connect_token("notion", TOKEN)
    vault.set_writes("notion", True)
    vault.disconnect("notion")
    record = vault.connect_token("notion", TOKEN)
    assert record.writes_enabled is False and "did not name" in record.health_detail

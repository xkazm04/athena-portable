"""The vault: admission by probe, the one outbound door, the switches, and no secret surface."""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import pytest

from athena.connectors.seal import FileSeal
from athena.connectors.spec import ConnectorSpec
from athena.connectors.vault import (
    HostRefused,
    NeedsReauth,
    NotConnected,
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

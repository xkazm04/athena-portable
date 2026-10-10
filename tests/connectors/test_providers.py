"""Gmail's search says what it dropped; Notion refuses an id that is not one (connectors/providers/;
README §4; ADR 0021, ADR 0062)."""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import pytest

from athena.connectors.providers import gmail, notion
from athena.connectors.seal import FileSeal
from athena.connectors.service import check_egress
from athena.connectors.spec import load_builtin
from athena.connectors.vault import Vault

from .conftest import FakeProvider

PAGE = "0123456789abcdef0123456789abcdef"
HYPHENATED = "01234567-89ab-cdef-0123-456789abcdef"
TOKEN = "ntn_test_token_0123456789"


def _gmail(statuses: dict[str, int], ids: list[str]) -> Callable[[str, str, Any], tuple[int, Any]]:
    def request(method: str, url: str, body: Any) -> tuple[int, Any]:
        path = urlsplit(url).path
        if path.endswith("/messages"):
            return 200, {"messages": [{"id": i} for i in ids]}
        message_id = path.rsplit("/", 1)[1]
        status = statuses.get(message_id, 200)
        if status >= 300:
            return status, {"error": "no"}
        return 200, {
            "id": message_id,
            "snippet": "s",
            "payload": {"headers": [{"name": "Subject", "value": f"subject {message_id}"}]},
        }

    return request


def test_search_mail_announces_the_reads_it_dropped_and_their_status() -> None:
    request = _gmail({"b": 429, "c": 500}, ["a", "b", "c", "d"])
    ok, text = gmail.execute(request, "search_mail", {"query": "x"})
    assert ok
    assert "subject a" in text and "subject d" in text and "subject b" not in text
    assert text.endswith("(showing 2 of 4; 2 reads failed, answered 429, 500)")


def test_search_mail_with_every_read_failed_says_so_and_never_no_messages() -> None:
    request = _gmail({"a": 503, "b": 503}, ["a", "b"])
    ok, text = gmail.execute(request, "search_mail", {"query": "x"})
    assert ok is False
    assert "all 2 reads failed" in text and "503" in text
    assert "No messages matched" not in text


def test_search_mail_with_no_hits_still_says_none_matched() -> None:
    ok, text = gmail.execute(_gmail({}, []), "search_mail", {"query": "x"})
    assert ok and text == "No messages matched."


def test_search_mail_with_all_reads_ok_adds_no_note() -> None:
    ok, text = gmail.execute(_gmail({}, ["a", "b"]), "search_mail", {"query": "x"})
    assert ok and "showing" not in text


# -- Notion ids -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad",
    [
        "x/../users",
        f"{PAGE}?x=1",
        f"{PAGE}#frag",
        PAGE[:31],
        PAGE + "0",
        "",
        "../" + PAGE,
        "z" * 32,
        f"{PAGE}/children",
    ],
)
def test_a_notion_id_that_is_not_32_hex_characters_is_refused(bad: str) -> None:
    with pytest.raises(ValueError):
        notion.normalize_id(bad)


def test_a_hyphenated_or_upper_case_uuid_is_accepted() -> None:
    assert notion.normalize_id(HYPHENATED) == PAGE
    assert notion.normalize_id(f"  {HYPHENATED.upper()} ") == PAGE


def test_a_refused_id_makes_no_request() -> None:
    calls: list[str] = []

    def request(method: str, url: str, body: Any) -> tuple[int, Any]:
        calls.append(url)
        return 200, {}

    with pytest.raises(ValueError):
        notion.execute(request, "read_page", {"page_id": "x/../users"})
    with pytest.raises(ValueError):
        notion.execute(request, "append_to_page", {"page_id": f"{PAGE}#f", "text": "t"})
    with pytest.raises(ValueError):
        notion.execute(request, "create_page", {"parent_page_id": f"{PAGE}?a", "title": "t"})
    assert calls == []


def test_an_accepted_id_reaches_the_url_quoted_whole() -> None:
    calls: list[str] = []

    def request(method: str, url: str, body: Any) -> tuple[int, Any]:
        calls.append(url)
        return 200, {"results": []}

    ok, _ = notion.execute(request, "read_page", {"page_id": HYPHENATED})
    assert ok
    assert calls[0].endswith(f"/pages/{PAGE}")
    assert calls[1].endswith(f"/blocks/{PAGE}/children?page_size=100")


def test_the_egress_allow_list_comparison_is_unchanged() -> None:
    spec = load_builtin()["notion"]
    tool = next(t for t in spec.tools if t.name == "append_to_page")
    allowed = [HYPHENATED]
    assert check_egress(spec, tool, {"page_id": PAGE, "text": "t"}, allowed) is None
    assert check_egress(spec, tool, {"page_id": HYPHENATED.upper(), "text": "t"}, allowed) is None
    assert check_egress(spec, tool, {"page_id": "f" * 32, "text": "t"}, allowed) is not None


# -- Notion identity (ADR 0062, amended) ----------------------------------------------------------


def _bot(tmp_path: Path, bots: list[Mapping[str, Any]]) -> Vault:
    asked = {"n": 0}

    def script(
        method: str, url: str, headers: Mapping[str, str], body: bytes | None
    ) -> tuple[int, Any]:
        bot = bots[min(asked["n"], len(bots) - 1)]
        asked["n"] += 1
        return 200, dict(bot)

    root = tmp_path / "connectors"
    return Vault(
        root,
        specs=load_builtin(),
        transport=FakeProvider(script=script),
        seal=FileSeal(root / "sealed"),
    )


def _arm(vault: Vault) -> None:
    vault.connect_token("notion", TOKEN)
    vault.set_writes("notion", True)
    vault.set_allowlist("notion", [PAGE])
    vault.disconnect("notion")


def test_the_spec_names_the_key_field_and_gmail_has_none() -> None:
    specs = load_builtin()
    assert specs["notion"].probe.key_field == "id"
    assert specs["notion"].probe.identity_field == "name"
    assert specs["gmail"].probe.key_field == ""


def test_two_workspaces_with_a_bot_of_the_same_name_are_not_one_account(tmp_path: Path) -> None:
    vault = _bot(tmp_path, [{"id": "bot-1", "name": "Athena"}, {"id": "bot-2", "name": "Athena"}])
    _arm(vault)
    record = vault.connect_token("notion", TOKEN)
    assert record.writes_enabled is False and record.allowlist == []
    assert "set under Athena" in record.health_detail and "emptied" in record.health_detail


def test_the_same_bot_id_keeps_the_switches_whatever_its_name_says(tmp_path: Path) -> None:
    vault = _bot(tmp_path, [{"id": "bot-1", "name": "Athena"}, {"id": "bot-1", "name": "Renamed"}])
    _arm(vault)
    record = vault.connect_token("notion", TOKEN)
    assert record.writes_enabled is True and record.allowlist == [PAGE]
    assert record.identity == "Renamed" and record.health_detail == ""


def test_the_workspace_name_is_shown_and_never_compared(tmp_path: Path) -> None:
    named = {"id": "bot-1", "name": "Athena", "bot": {"workspace_name": "Acme"}}
    other = {"id": "bot-1", "name": "Athena", "bot": {"workspace_name": "Acme Two"}}
    vault = _bot(tmp_path, [named, other])
    first = vault.connect_token("notion", TOKEN)
    assert first.identity == "Athena (Acme)"
    vault.set_writes("notion", True)
    vault.disconnect("notion")
    assert vault.connect_token("notion", TOKEN).writes_enabled is True


def test_a_probe_with_no_id_resets_the_switches(tmp_path: Path) -> None:
    vault = _bot(tmp_path, [{"id": "bot-1", "name": "Athena"}, {"name": "Athena"}])
    _arm(vault)
    record = vault.connect_token("notion", TOKEN)
    assert record.writes_enabled is False and record.allowlist == []
    assert "could not be confirmed" in record.health_detail


def test_a_record_keyed_by_name_resets_once_and_says_why(tmp_path: Path) -> None:
    root = tmp_path / "connectors"
    root.mkdir()
    legacy = {
        "status": "disconnected",
        "switches_identity": "Athena",
        "writes_enabled": True,
        "allowlist": [PAGE],
    }
    (root / "connections.json").write_text(json.dumps({"notion": legacy}), encoding="utf-8")
    vault = _bot(tmp_path, [{"id": "bot-1", "name": "Athena"}])
    record = vault.connect_token("notion", TOKEN)
    assert record.writes_enabled is False and record.allowlist == []
    assert "known only by its name" in record.health_detail
    vault.set_writes("notion", True)
    vault.disconnect("notion")
    assert vault.connect_token("notion", TOKEN).writes_enabled is True


def test_gmail_stays_keyed_on_the_address(tmp_path: Path) -> None:
    root = tmp_path / "connectors"
    root.mkdir()
    legacy = {
        "status": "disconnected",
        "switches_identity": "me@example.test",
        "writes_enabled": True,
        "allowlist": ["a@example.test"],
    }
    (root / "connections.json").write_text(json.dumps({"gmail": legacy}), encoding="utf-8")
    vault = _bot(tmp_path, [{"emailAddress": "me@example.test"}])
    vault._admit(vault.spec("gmail"), "tok")
    kept = vault.record("gmail")
    assert kept.identity == "me@example.test" and kept.account == "me@example.test"
    assert kept.writes_enabled is True and kept.allowlist == ["a@example.test"]

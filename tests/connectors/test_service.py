"""The port: registration follows connection, the writes switch, the egress gate, fenced reads,
and the catalog classing a connector's tools as it classes a page's (connectors/service.py)."""

from __future__ import annotations

import base64
from collections.abc import Mapping
from email import message_from_bytes
from email.utils import getaddresses
from pathlib import Path
from typing import Any

import pytest

from athena.connectors.providers import gmail
from athena.connectors.service import READ_CAP, Service, check_egress, services_for
from athena.connectors.spec import ConnectorSpec
from athena.connectors.vault import Vault
from athena.contracts.registry import ToolClass
from athena.core.catalog import CoreServices, build_catalog
from athena.core.fence import is_fenced

from .conftest import FakeProvider

PAGE = "0123456789abcdef0123456789abcdef"


def catalog_with(vault: Vault) -> Any:
    catalog = build_catalog(CoreServices(sources_alive=lambda s: True))
    for cid, service in services_for(vault).items():
        catalog.merge_connector(cid, service)
    return catalog


def test_an_unconnected_connector_registers_nothing_and_a_connected_one_its_tools(
    vault: Vault,
) -> None:
    catalog = catalog_with(vault)
    assert [n for n in catalog.entries if n.startswith("connector.")] == []
    vault.connect_token("notion", "ntn_test_token_0123456789")
    catalog = catalog_with(vault)
    names = sorted(n for n in catalog.entries if n.startswith("connector."))
    assert names == [
        "connector.notion.append_to_page",
        "connector.notion.create_page",
        "connector.notion.read_page",
        "connector.notion.search",
    ]
    # The class is the catalog's decision from the spec's own flags, not the connector's — and
    # the manifest rule classes a reversible read AUTO, as it does a page's; the cap and the
    # fence are the service's.
    assert catalog.get("connector.notion.search").cls is ToolClass.AUTO
    assert catalog.get("connector.notion.append_to_page").cls is ToolClass.GATED
    assert catalog.get("connector.notion.create_page").origin == "connector:notion"


def test_a_read_comes_back_fenced_and_capped(notion: Vault, provider: FakeProvider) -> None:
    long_title = "t" * 3000

    def script(
        method: str, url: str, headers: Mapping[str, str], body: bytes | None
    ) -> tuple[int, Any]:
        if url.endswith("/search"):
            return 200, {
                "results": [
                    {
                        "object": "page",
                        "id": "p1",
                        "properties": {
                            "Name": {"type": "title", "title": [{"plain_text": long_title}]}
                        },
                    }
                ]
            }
        return 200, {"name": "n"}

    provider.script = script
    result = Service(notion.specs["notion"], notion).call("search", {"query": "x"})
    assert result.ok and result.tier == 3
    assert is_fenced(result.output, "notion")
    assert f"(showing {READ_CAP} of" in result.output
    assert long_title not in result.output


def test_a_write_is_refused_while_writes_are_off_then_by_the_allowlist_then_runs(
    notion: Vault, provider: FakeProvider
) -> None:
    service = Service(notion.specs["notion"], notion)
    refused = service.call("append_to_page", {"page_id": PAGE, "text": "hello"})
    assert not refused.ok and refused.error == "validator_failed"
    assert "switched off" in refused.output
    notion.set_writes("notion", True)
    refused = service.call("append_to_page", {"page_id": PAGE, "text": "hello"})
    assert not refused.ok and "no allowed pages" in refused.output
    notion.set_allowlist("notion", ["0123456789ab-cdef-0123-4567-89abcdef"])
    refused = service.call(
        "append_to_page", {"page_id": "ffffffffffffffffffffffffffffffff", "text": "x"}
    )
    assert not refused.ok and "not on Notion's allow-list" in refused.output
    assert all(s.path != f"/v1/blocks/{PAGE}/children" for s in provider.seen), "nothing left"
    ran = service.call("append_to_page", {"page_id": PAGE, "text": "hello"})
    assert ran.ok and "appended 5 characters" in ran.output
    assert (
        provider.seen[-1].method == "PATCH"
        and provider.seen[-1].path == f"/v1/blocks/{PAGE}/children"
    )


def test_gmail_recipients_are_matched_on_the_address_inside_a_display_name(
    specs: dict[str, ConnectorSpec],
) -> None:
    gmail = specs["gmail"]
    send = gmail.tool("send_mail")
    assert send is not None
    params = {
        "to": ["Ada <ada@example.test>"],
        "cc": ["bob@example.test"],
        "subject": "s",
        "body": "b",
    }
    assert check_egress(gmail, send, params, ["ADA@example.test"]) is not None
    assert check_egress(gmail, send, params, ["ada@example.test", "bob@example.test"]) is None
    assert "not on Gmail's allow-list" in (
        check_egress(gmail, send, params, ["ada@example.test"]) or ""
    )


def test_a_provider_refusal_is_ok_false_with_a_reason_and_no_value(
    notion: Vault, provider: FakeProvider
) -> None:
    provider.script = lambda *_: (403, {"message": "forbidden"})
    result = Service(notion.specs["notion"], notion).call("read_page", {"page_id": PAGE})
    assert not result.ok and result.error == "engine_error"
    assert "403" in result.output and "ntn_" not in result.output


def test_a_grant_that_is_gone_says_reconnect(
    tmp_path: Path, specs: dict[str, ConnectorSpec]
) -> None:
    vault = Vault(tmp_path / "c", specs=specs, transport=FakeProvider(), seal_preference="file")
    vault._admit(specs["gmail"], "ya29.access", refresh="", expires_in=1)
    result = Service(specs["gmail"], vault).call("search_mail", {"query": "x"})
    assert not result.ok and "reconnected in Connectors" in result.output


def test_an_unknown_tool_is_unknown_ref(notion: Vault) -> None:
    result = Service(notion.specs["notion"], notion).call("delete_everything", {})
    assert not result.ok and result.error == "unknown_ref"


def _egress(
    specs: dict[str, ConnectorSpec], params: dict[str, Any], allow: list[str]
) -> str | None:
    gmail = specs["gmail"]
    send = gmail.tool("send_mail")
    assert send is not None
    return check_egress(gmail, send, {"subject": "s", "body": "b", **params}, allow)


@pytest.mark.parametrize(
    "value",
    [
        "evil@x.com, <ok@me.com>",
        "ok@me.com; evil@x.com",
        "ok@me.com, ok@me.com",
        "ok@me.com\r\nBcc: evil@x.com",
        "ok@me.com\nevil@x.com",
        "not an address",
        "",
    ],
)
def test_a_recipient_item_that_is_not_one_address_is_refused_by_name(
    specs: dict[str, ConnectorSpec], value: str
) -> None:
    reason = _egress(specs, {"to": [value]}, ["ok@me.com", "evil@x.com"])
    assert reason is not None and repr(value) in reason and "one address per item" in reason
    assert _egress(specs, {"to": ["ok@me.com"], "cc": [value]}, ["ok@me.com", "evil@x.com"])


def test_a_display_name_stays_legal_even_with_a_comma_in_it(
    specs: dict[str, ConnectorSpec],
) -> None:
    assert _egress(specs, {"to": ["Ok <ok@me.com>"]}, ["ok@me.com"]) is None
    assert _egress(specs, {"to": ['"Doe, Jane" <jane@x.com>']}, ["jane@x.com"]) is None
    assert _egress(specs, {"to": ['"Doe, Jane" <jane@x.com>']}, ["ok@me.com"]) is not None


def test_the_headers_hold_exactly_the_addresses_that_were_allowed() -> None:
    body = gmail.build_send_body(
        to=["Ok <ok@me.com>", '"Doe, Jane" <jane@x.com>'],
        cc=["Bo <bo@x.com>"],
        subject="s",
        body="b",
    )
    raw = base64.urlsafe_b64decode(body["raw"] + "==")
    message = message_from_bytes(raw)
    assert [a for _, a in getaddresses([message["To"]])] == ["ok@me.com", "jane@x.com"]
    assert [a for _, a in getaddresses([message["Cc"]])] == ["bo@x.com"]
    with pytest.raises(ValueError, match="exactly one address"):
        gmail.build_send_body(to=["evil@x.com, <ok@me.com>"], subject="s", body="b")


def _gmail_ready(vault: Vault) -> Service:
    vault._admit(vault.specs["gmail"], "ya29.access", refresh="", expires_in=3600)
    vault.set_writes("gmail", True)
    vault.set_allowlist("gmail", ["ok@me.com"])
    return Service(vault.specs["gmail"], vault)


def test_a_subject_with_a_line_break_is_refused_before_any_request(
    vault: Vault, provider: FakeProvider
) -> None:
    service = _gmail_ready(vault)
    before = len(provider.seen)
    for subject in ("hi\nBcc: evil@x.com", "hi\r\nthere"):
        result = service.call("send_mail", {"to": ["ok@me.com"], "subject": subject, "body": "b"})
        assert not result.ok and result.error == "validator_failed"
        assert "one line" in result.output
    assert len(provider.seen) == before, "nothing left"


def test_a_valueerror_from_a_provider_is_a_failure_not_an_escape(vault: Vault) -> None:
    def boom(request: Any, tool: str, params: Mapping[str, Any]) -> tuple[bool, str]:
        raise ValueError("bad header")

    vault._admit(vault.specs["gmail"], "ya29.access", refresh="", expires_in=3600)
    result = Service(vault.specs["gmail"], vault, provider=boom).call("search_mail", {"query": "x"})
    assert not result.ok and result.error == "engine_error" and "bad header" in result.output

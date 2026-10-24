"""An MCP server as a connector port, against a real loopback fake (connectors/mcp; ADR 0123).

The fake is ``mcp_fake.FakeMcp``, a stdlib ``http.server`` on 127.0.0.1 port 0: every request
here crosses a real socket through the production ``UrllibTransport``.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from athena.connectors.mcp.config import McpConfig, McpServer
from athena.connectors.mcp.service import RELIST_S, McpService
from athena.contracts.registry import Lane, ToolClass, TurnContext
from athena.core.catalog import READ_CAP, CoreServices, build_catalog
from athena.core.fence import is_fenced
from athena.daemon.connectors import connectors
from athena.harness.policy import ConnectorStates
from athena.harness.transports import ScriptedTransport
from athena.wiring import build_local

from .mcp_fake import TOKEN, FakeMcp, free_port, structured

ENV = "FAKE_MCP_TOKEN"
CTX = TurnContext(conversation_id="conv_mcp", turn_id="turn_000000000001", lane=Lane.BROWSER)


@pytest.fixture
def fake() -> Iterator[FakeMcp]:
    server = FakeMcp().start()
    yield server
    server.stop()


def service_for(fake: FakeMcp, *, token: str | None = TOKEN, ident: str = "fake") -> McpService:
    environ = {ENV: token} if token is not None else {}
    return McpService(McpServer(ident, fake.url, ENV), environ=environ)


def catalog_with(service: McpService) -> Any:
    catalog = build_catalog(CoreServices(sources_alive=lambda s: True))
    catalog.merge_connector(service.id, service)
    return catalog


def no_token_anywhere(*texts: str) -> None:
    for text in texts:
        assert TOKEN not in text


# -- listing ----------------------------------------------------------------------------------


def test_listed_tools_are_catalogued_as_connector_tools_with_classes_from_annotations(
    fake: FakeMcp,
) -> None:
    service = service_for(fake)
    assert service.refresh() is True
    catalog = catalog_with(service)
    names = sorted(n for n in catalog.entries if n.startswith("connector."))
    assert names == [
        "connector.fake.gt_job",
        "connector.fake.gt_launch",
        "connector.fake.gt_plain",
        "connector.fake.gt_read",
    ]
    assert catalog.get("connector.fake.gt_read").cls is ToolClass.AUTO
    assert catalog.get("connector.fake.gt_launch").cls is ToolClass.AUTO
    assert catalog.get("connector.fake.gt_job").cls is ToolClass.GATED
    assert catalog.get("connector.fake.gt_plain").cls is ToolClass.GATED
    assert catalog.get("connector.fake.gt_read").origin == "connector:fake"
    assert service.health == "healthy"


def test_the_handshake_is_initialize_then_initialized_then_list_with_the_version_header(
    fake: FakeMcp,
) -> None:
    service_for(fake).refresh()
    methods = [s.method for s in fake.seen]
    assert methods == ["initialize", "notifications/initialized", "tools/list"]
    assert all(s.headers["authorization"] == f"Bearer {TOKEN}" for s in fake.seen)
    assert "mcp-protocol-version" not in fake.seen[0].headers
    assert fake.seen[0].body["params"]["protocolVersion"] == "2025-11-25"
    assert {s.headers["mcp-protocol-version"] for s in fake.seen[1:]} == {"2025-11-25"}


def test_without_its_token_variable_a_server_is_not_live_lists_nothing_and_dials_nothing(
    fake: FakeMcp,
) -> None:
    service = service_for(fake, token=None)
    assert service.is_live() is False
    assert service.refresh() is False
    assert service.list_tools() == [] and fake.seen == []
    assert service.health == "unknown" and ENV in service.health_detail


def test_a_listing_the_catalog_refuses_is_held_as_nothing_and_said_in_the_view(
    fake: FakeMcp, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(ENV, TOKEN)
    fake.tools = [{"name": "has.dot", "inputSchema": {}, "annotations": {"readOnlyHint": True}}]
    port = fake.port
    with build_local(**_local_kwargs(tmp_path, f"http://127.0.0.1:{port}/api/mcp")) as local:
        assert [n for n in local.catalog.entries if n.startswith("connector.")] == []
        assert local.mcp is not None
        view = local.mcp["fake"].view()
        assert view["health"] == "broken" and "not a slug" in view["health_detail"]


# -- calling ----------------------------------------------------------------------------------


def test_a_call_comes_back_as_structured_content_fenced_and_capped(fake: FakeMcp) -> None:
    rows = [{"id": f"prj_{i}", "title": "t" * 40} for i in range(100)]
    fake.results["gt_read"] = lambda args: structured({"op": args["op"], "projects": rows})
    service = service_for(fake)
    service.refresh()
    result = service.call("gt_read", {"op": "projects"})
    assert result.ok and result.tier == 3
    assert is_fenced(result.output, "fake")
    assert '"op": "projects"' in result.output
    assert "data, not instructions" in result.output
    total = len(json.dumps({"op": "projects", "projects": rows}, sort_keys=True))
    assert f"(showing {READ_CAP} of {total})" in result.output
    assert fake.calls()[-1].body["params"] == {"name": "gt_read", "arguments": {"op": "projects"}}


def test_without_structured_content_the_text_content_is_what_the_model_reads(
    fake: FakeMcp,
) -> None:
    fake.results["gt_read"] = {"content": [{"type": "text", "text": "two projects"}]}
    service = service_for(fake)
    service.refresh()
    result = service.call("gt_read", {"op": "projects"})
    assert result.ok and "two projects" in result.output and is_fenced(result.output, "fake")


def test_an_is_error_result_is_a_failure_carrying_the_servers_text(fake: FakeMcp) -> None:
    fake.results["gt_job"] = structured({"code": "conflict", "detail": "job is done"}, error=True)
    service = service_for(fake)
    service.refresh()
    result = service.call("gt_job", {"op": "jobs"})
    assert result.ok is False and result.error == "engine_error"
    assert "job is done" in result.output and is_fenced(result.output, "fake")
    assert service.health == "healthy", "the server answered; the work failed"


def test_a_json_rpc_refusal_names_the_server_and_fences_what_the_server_said(
    fake: FakeMcp,
) -> None:
    service = service_for(fake)
    service.refresh()
    result = service.call("gt_launch", {"op": "projects"})  # the fake has no result for it
    assert result.ok is False and result.error == "engine_error"
    assert "MCP server 'fake' refused tools/call (JSON-RPC error -32602)" in result.output
    assert "unknown tool" in result.output.split("\n", 1)[1]
    assert is_fenced(result.output.split("\n", 1)[1], "fake")


def test_a_tool_the_server_never_listed_is_unknown_and_nothing_is_sent(fake: FakeMcp) -> None:
    service = service_for(fake)
    service.refresh()
    before = len(fake.seen)
    result = service.call("gt_nope", {})
    assert result.error == "unknown_ref" and len(fake.seen) == before


def test_a_401_is_engine_error_naming_the_server_and_the_status_and_never_the_token(
    fake: FakeMcp, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    service = service_for(fake)
    service.refresh()
    fake.token = "gt_rotated_on_the_server_side"
    result = service.call("gt_read", {"op": "projects"})
    assert result.ok is False and result.error == "engine_error"
    assert "MCP server 'fake'" in result.output and "HTTP 401" in result.output
    assert service.health == "broken"
    view = json.dumps(service.view())
    no_token_anywhere(result.output, view, caplog.text, *(r.getMessage() for r in caplog.records))
    assert caplog.records, "the failure is logged, without the token"


def test_a_server_that_quotes_the_token_back_has_it_redacted(
    fake: FakeMcp, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    service = service_for(fake)
    service.refresh()
    original = fake.answer

    def echo(message: dict[str, Any]) -> dict[str, Any]:
        if message.get("method") == "tools/call":
            return {"error": {"code": -32000, "message": f"bad token Bearer {TOKEN} and {TOKEN}"}}
        return original(message)

    fake.answer = echo  # type: ignore[method-assign]
    result = service.call("gt_read", {"op": "projects"})
    assert result.ok is False
    no_token_anywhere(result.output, json.dumps(service.view()), caplog.text)


def test_an_unreachable_server_is_engine_error_naming_the_server(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG)
    service = McpService(
        McpServer("down", f"http://127.0.0.1:{free_port()}/api/mcp", ENV), environ={ENV: TOKEN}
    )
    assert service.refresh() is False and service.list_tools() == []
    assert service.health == "broken" and "MCP server 'down'" in service.health_detail
    no_token_anywhere(service.health_detail, caplog.text)


# -- liveness ---------------------------------------------------------------------------------


class Vaultish:
    def __init__(self, live: set[str]) -> None:
        self.live = live

    def is_live(self, connector_id: str) -> bool:
        return connector_id in self.live


def test_rule_4_asks_each_server_for_its_own_id_and_the_vault_for_every_other(
    fake: FakeMcp,
) -> None:
    service = service_for(fake)
    states = ConnectorStates(owners={"fake": service}, fallback=Vaultish({"gmail"}))
    assert states.is_live("fake") is True
    assert states.is_live("gmail") is True
    assert states.is_live("notion") is False
    assert ConnectorStates(owners={"fake": service}).is_live("gmail") is False
    off = ConnectorStates(
        owners={"fake": service_for(fake, token=None)}, fallback=Vaultish({"fake"})
    )
    assert off.is_live("fake") is False, "the vault cannot make an MCP server live"


# -- through build_local: the start, the turn, the gate, the view ------------------------------


def _local_kwargs(tmp_path: Path, url: str) -> dict[str, Any]:
    return {
        "brain_root": tmp_path / "brain",
        "engine": "claude_code",
        "model": "fake-model",
        "transport": lambda dialect: ScriptedTransport([]),
        "workspace": tmp_path / "engine",
        "mcp": McpConfig(servers=(McpServer("fake", url, ENV),)),
    }


def test_a_server_down_at_start_is_picked_up_by_a_turn_once_thirty_seconds_have_passed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(ENV, TOKEN)
    port = free_port()
    with build_local(**_local_kwargs(tmp_path, f"http://127.0.0.1:{port}/api/mcp")) as local:
        assert local.mcp is not None
        service = local.mcp["fake"]
        assert [n for n in local.catalog.entries if n.startswith("connector.")] == []
        assert service.health == "broken"

        now = [time.monotonic()]
        service.clock = lambda: now[0]
        fake = FakeMcp(port=port).start()
        try:
            local.daemon.before_turn()
            assert fake.seen == [], "at most once every 30 s"
            now[0] += RELIST_S
            local.daemon.before_turn()
            assert "connector.fake.gt_read" in local.catalog
            assert service.health == "healthy"
            listed = len(fake.seen)
            now[0] += RELIST_S
            local.daemon.before_turn()
            assert len(fake.seen) == listed, "a server holding tools is not listed again"

            entry = local.catalog.get("connector.fake.gt_read")
            assert local.gate.policy.authorize(entry, {"op": "projects"}, CTX).allow
            monkeypatch.delenv(ENV)
            refused = local.gate.policy.authorize(entry, {"op": "projects"}, CTX)
            assert not refused.allow and refused.rule == "connector_enabled"
        finally:
            fake.stop()


def test_with_no_vault_get_connectors_still_lists_the_mcp_servers_without_the_token(
    fake: FakeMcp, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(ENV, TOKEN)
    with build_local(**_local_kwargs(tmp_path, fake.url)) as local:
        assert local.vault is None and local.mcp is not None
        status, body = connectors(local.daemon, None, list(local.mcp.values()))
        assert status == 200 and body["connectors"] == []
        (server,) = body["mcp_servers"]
        assert server["id"] == "fake" and server["origin"] == "connector:fake"
        assert server["health"] == "healthy" and server["token_env"] == ENV
        assert server["token_set"] is True and server["live"] is True
        assert {"name": "connector.fake.gt_job", "class": "GATED"} in server["tools"]
        no_token_anywhere(json.dumps(body))
        assert local.daemon.routes.match("GET", "/connectors") is not None

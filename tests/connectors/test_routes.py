"""``/connectors`` over a real socket: no secret on the wire, a connect the next turn can see,
a disconnect the next call refuses (daemon/connectors.py; README §4; ADR 0021)."""

from __future__ import annotations

import json
import threading
from collections.abc import Iterator
from pathlib import Path

import pytest

from athena.connectors.vault import Vault
from athena.daemon.server import DaemonConfig, bound_url, make_server
from athena.harness.transports import ScriptedTransport
from athena.wiring import build_local
from daemon.conftest import ENGINE, MODEL, TOKEN, Live

from .conftest import FakeProvider

NTN = "ntn_test_token_0123456789"


@pytest.fixture
def provider() -> FakeProvider:
    return FakeProvider()


@pytest.fixture
def live(tmp_path: Path, provider: FakeProvider) -> Iterator[Live]:
    transport = ScriptedTransport([])
    vault = Vault(
        tmp_path / "connectors",
        transport=provider,
        seal_preference="file",
        open_browser=lambda url: None,
    )
    with build_local(
        brain_root=tmp_path / "brain",
        engine=ENGINE,
        model=MODEL,
        transport=lambda dialect: transport,
        workspace=tmp_path / "engine",
        vault=vault,
    ) as local:
        config = DaemonConfig(port=0, token=TOKEN, engine=ENGINE, model=MODEL)
        server = make_server(local.daemon, config)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield Live(
                daemon=local.daemon,
                config=config,
                server=server,
                url=bound_url(server, config),
                transport=transport,
            )
        finally:
            server.shutdown()
            server.server_close()


def test_the_list_names_both_specs_and_no_secret(live: Live) -> None:
    reply = live.request("/connectors")
    assert reply.status == 200
    ids = [c["id"] for c in reply.body["connectors"]]
    assert ids == ["gmail", "notion"]
    notion = reply.body["connectors"][1]
    assert notion["connection"]["status"] == "disconnected"
    assert notion["live"] is False
    assert "guide" in notion and "token" not in json.dumps(notion["connection"])
    assert "GET /connectors" in live.request("/health").body["routes"]


def test_a_connect_is_in_the_catalog_at_once_and_a_disconnect_refuses_the_next_call(
    live: Live, provider: FakeProvider
) -> None:
    before = live.request("/health").body["tools"]
    reply = live.request("/connectors/notion/connect", method="POST", json_body={"token": NTN})
    assert reply.status == 200
    assert reply.body["connector"]["connection"]["identity"] == "Test User"
    assert reply.body["connector"]["live"] is True
    assert NTN not in reply.text
    assert live.request("/health").body["tools"] == before + 4
    assert "connector.notion.search" in live.daemon.catalog

    reply = live.request(
        "/connectors/notion/settings",
        method="POST",
        json_body={"writes_enabled": True, "allowlist": "a1, b2"},
    )
    assert reply.body["connector"]["connection"]["allowlist"] == ["a1", "b2"]

    reply = live.request("/connectors/notion/disconnect", method="POST")
    assert reply.body["connector"]["connection"]["status"] == "disconnected"
    assert live.request("/health").body["tools"] == before
    assert "connector.notion.search" not in live.daemon.catalog


def test_a_wrong_token_is_a_409_in_the_gates_vocabulary(live: Live, provider: FakeProvider) -> None:
    provider.script = lambda *_: (401, {"message": "no"})
    reply = live.request("/connectors/notion/connect", method="POST", json_body={"token": "bad"})
    assert reply.status == 409
    assert reply.body["reason"] == "validator_failed"
    assert "bad" not in reply.body["detail"]


def test_an_unknown_connector_or_act_is_404(live: Live) -> None:
    assert live.request("/connectors/slack/connect", method="POST", json_body={}).status == 404
    assert live.request("/connectors/notion/dance", method="POST", json_body={}).status == 404


def test_oauth_connect_answers_a_flow_with_the_authorize_url(live: Live) -> None:
    reply = live.request(
        "/connectors/gmail/connect",
        method="POST",
        json_body={"client_id": "cid", "client_secret": "sec", "open_browser": False},
    )
    assert reply.status == 200
    flow = reply.body["flow"]
    assert flow["phase"] == "awaiting_consent"
    assert flow["authorize_url"].startswith("https://accounts.google.com/")
    assert "sec" not in json.dumps(reply.body).replace("secret", "")
    polled = live.request("/connectors/gmail/flow", method="POST")
    assert polled.body["flow"]["id"] == flow["id"]

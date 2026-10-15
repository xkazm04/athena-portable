"""``/connectors`` over a real socket: no secret on the wire, a connect the next turn can see,
a disconnect the next call refuses (daemon/connectors.py; README §4; ADR 0021)."""

from __future__ import annotations

import json
import threading
import urllib.parse
import urllib.request
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

import pytest

from athena.connectors.vault import Vault
from athena.daemon.connectors import connectors
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
def routed(tmp_path: Path, provider: FakeProvider) -> Vault:
    """The vault behind the routes, so a test can put a grant in place before it asks."""
    return Vault(
        tmp_path / "connectors",
        transport=provider,
        seal_preference="file",
        open_browser=lambda url: None,
    )


@pytest.fixture
def live(tmp_path: Path, routed: Vault) -> Iterator[Live]:
    transport = ScriptedTransport([])
    vault = routed
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
    assert reply.body["records_notice"] == ""


def test_an_unreadable_records_file_is_in_the_list_in_plain_words(
    live: Live, tmp_path: Path
) -> None:
    root = tmp_path / "damaged"
    root.mkdir()
    (root / "connections.json").write_bytes(b"{")
    vault = Vault(root, seal_preference="file")
    status, body = connectors(live.daemon, vault)
    assert status == 200
    assert "could not be read" in body["records_notice"]
    assert "connections.json.unreadable-" in body["records_notice"]


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


# -- reconnect through the kept client (ADR 0117) --------------------------------------------------

KEPT_ID = "kept-client.apps.googleusercontent.com"
KEPT_SECRET = "kept-secret-0451"


def _lose(routed: Vault) -> None:
    """Gmail admitted with a client pair, then marked as needing to be reconnected."""
    routed._admit(
        routed.spec("gmail"),
        "ya29.live",
        refresh="1//r",
        expires_in=3600,
        client=(KEPT_ID, KEPT_SECRET),
    )
    routed.record("gmail").status = "needs_reauth"


def test_case_2_a_reconnect_route_starts_a_flow_and_no_client_value_crosses_it(
    live: Live, routed: Vault
) -> None:
    refused = live.request(
        "/connectors/gmail/connect",
        method="POST",
        json_body={"reuse_client": True, "open_browser": False},
    )
    assert refused.status == 409
    assert refused.body["reason"] == "validator_failed"
    assert "client id" in refused.body["detail"]

    _lose(routed)
    listed = live.request("/connectors")
    assert listed.body["connectors"][0]["client_kept"] is True
    reply = live.request(
        "/connectors/gmail/connect",
        method="POST",
        json_body={"reuse_client": True, "open_browser": False},
    )
    assert reply.status == 200
    assert reply.body["flow"]["phase"] == "awaiting_consent"
    assert reply.body["connector"]["client_kept"] is True
    polled = live.request("/connectors/gmail/flow", method="POST")
    for said in (reply.text, polled.text, live.request("/connectors").text):
        assert KEPT_ID not in said and KEPT_SECRET not in said
    flow = routed.flows.for_connector("gmail")
    try:
        assert flow is not None
        assert parse_qs(urlsplit(flow.authorize_url).query)["client_id"] == [KEPT_ID]
    finally:
        routed.close()


def test_case_5_a_pasted_pair_in_the_body_wins_over_the_kept_one(
    live: Live, routed: Vault, provider: FakeProvider
) -> None:
    _lose(routed)
    posted: list[dict[str, str]] = []

    def google(method: str, url: str, headers: Any, body: bytes | None) -> Any:
        if urlsplit(url).path == "/token":
            posted.append({k: v[0] for k, v in parse_qs((body or b"").decode("ascii")).items()})
            return 200, {"access_token": "ya29.pasted", "expires_in": 3600}
        return 200, {"emailAddress": "me@example.test"}

    provider.script = google
    reply = live.request(
        "/connectors/gmail/connect",
        method="POST",
        json_body={
            "client_id": "pasted.apps.googleusercontent.com",
            "client_secret": "pasted-secret",
            "reuse_client": True,
            "open_browser": False,
        },
    )
    assert reply.status == 200
    url = reply.body["flow"]["authorize_url"]
    asked = parse_qs(urlsplit(url).query)
    assert asked["client_id"] == ["pasted.apps.googleusercontent.com"]
    callback = (
        f"{asked['redirect_uri'][0]}?state={urllib.parse.quote(asked['state'][0])}&code=the-code"
    )
    with urllib.request.urlopen(callback, timeout=5) as answered:
        answered.read()
    flow = routed.flows.for_connector("gmail")
    assert flow is not None and flow.wait(5) and flow.phase == "done", flow and flow.detail
    assert (posted[-1]["client_id"], posted[-1]["client_secret"]) == (
        "pasted.apps.googleusercontent.com",
        "pasted-secret",
    )

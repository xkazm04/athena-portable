"""Connectors: absent without the vault, and honest about themselves with it (README §4).

Two daemons, and the difference between them is one flag. With ``--no-connectors`` there is no
``/connectors`` route at all and no connector name the model can address — a tier-3 name is not
refused politely, it is absent, which is the same thing the capability block says because the
block is generated from the catalog the dispatcher looks names up in.

With the vault on and nothing connected, the routes are there, every spec reports its own
connection record — three-valued health, no credential field to leak — and a connector tool is
still unaddressable: ``Service.list_tools`` yields nothing for a connector that is not live, so
the name never enters the catalog, and ``connector_enabled`` (``harness/policy.py`` rule 4) would
refuse it with the same ``unknown_ref`` if it had. Nothing here dials anything: no ``connect`` and
no ``probe`` is called, and the record shows it was never probed.
"""

from __future__ import annotations

from .conftest import APP_ID, Spawn, claude_round, op

SEARCH_MAIL = "connector.gmail.search_mail"


def test_without_the_vault_there_are_no_connector_routes_and_no_connector_name_to_address(
    spawn: Spawn,
) -> None:
    daemon = spawn.scripted(
        [claude_round("Searching your mail.\n" + op(SEARCH_MAIL, query="invoice"))],
        connectors=False,
    )
    daemon.register()

    health = daemon.request("/health").body
    assert not [label for label in health["routes"] if "/connectors" in label]
    assert daemon.request("/connectors").status == 404
    assert daemon.request("/connectors").body["reason"] == "unknown"
    assert daemon.request("/connectors/gmail/connect", method="POST").status == 404
    assert not (daemon.home / "connectors").exists(), "no vault directory was created"

    reply = daemon.run("search my mail for invoices")

    results = [payload for kind, payload in reply.frames() if kind == "tool.result"]
    assert len(results) == 1
    assert results[0]["ok"] is False
    assert results[0]["error"] == "unknown_ref"
    assert "not a name you can address here" in results[0]["output"]
    assert results[0]["name"] == SEARCH_MAIL
    # The call never became a ``tool.call``: an op the catalog does not know is dropped before
    # the gate, so nothing was attempted anywhere.
    assert [kind for kind, _ in reply.frames()] == [
        "text.delta",
        "tool.result",
        "turn.summary",
        "turn.finished",
    ]


def test_with_the_vault_on_and_nothing_connected_each_connector_reports_its_health_honestly(
    spawn: Spawn,
) -> None:
    daemon = spawn.scripted(
        [claude_round("Searching your mail.\n" + op(SEARCH_MAIL, query="invoice"))],
        connectors=True,
    )
    tools_before = daemon.request("/health").body["tools"]
    daemon.register()

    reply = daemon.request("/connectors")

    assert reply.status == 200
    body = reply.body
    assert body["ok"] is True
    assert (body["showing"], body["total"], body["footer"]) == (2, 2, "")
    by_id = {row["id"]: row for row in body["connectors"]}
    assert sorted(by_id) == ["gmail", "notion"]
    gmail = by_id["gmail"]
    assert gmail["label"]
    assert gmail["auth"] in {"token", "oauth"}
    assert gmail["api_hosts"], "the hosts the broker will ever dial are declared in the spec"
    assert [tool["name"] for tool in gmail["tools"]] == [
        "search_mail",
        "read_mail",
        "send_mail",
    ]
    assert gmail["live"] is False
    connection = gmail["connection"]
    assert connection["status"] == "disconnected"
    assert connection["identity"] == ""
    assert connection["writes_enabled"] is False, "writes are off by default"
    assert connection["health"] == "unknown"
    assert connection["health_at"] == "", "nothing was probed, so nothing was dialed"
    assert not [key for key in connection if "token" in key or "secret" in key]
    assert (daemon.home / "connectors").is_dir(), "the vault lives under ATHENA_HOME, never ~"

    # The routes exist and refuse an unknown connector without reaching for a network.
    assert daemon.request("/connectors/nope/probe", method="POST").status == 404
    assert daemon.request("/connectors/nope/probe", method="POST").body["reason"] == "unknown_ref"
    flow = daemon.request("/connectors/gmail/flow", method="POST")
    assert flow.status == 200
    assert flow.body["flow"] is None
    assert daemon.request("/connectors/gmail/nonsense", method="POST").status == 404

    # Nothing was merged into the catalog, so the model was never told the name...
    assert daemon.request("/health").body["tools"] == tools_before + 2

    # ...and a proposal for one is refused rather than attempted.
    results = [
        payload for kind, payload in daemon.run("search my mail").frames() if kind == "tool.result"
    ]
    assert len(results) == 1
    assert results[0]["error"] == "unknown_ref"
    assert daemon.request("/connectors").body["connectors"][0]["connection"]["health_at"] == ""
    assert daemon.request("/decisions").body["total"] == 0
    assert daemon.request("/ledger").body["rows"][0]["origin"] == f"host:{APP_ID}"

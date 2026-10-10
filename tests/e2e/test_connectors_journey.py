"""J6, connect then use: the whole connector path through the daemon's real routes (uat J6).

``tests/e2e/test_connectors.py`` proves what an unconnected vault says. This proves the other half
with nothing connected at the start and nothing real at the end: a person pastes a client id and
secret, presses Connect, and the flow completes; Athena searches and reads a mail; the person turns
writes on and allows one recipient; a reply is proposed and files a card; the person approves it
and exactly one message is sent, to exactly that address.

The daemon is ``serve_scripted.py --fake-providers``: the engine is a recorded transcript and the
vault is the production ``Vault`` with ``fake_providers.py`` handed in as its transport and as the
browser at the consent page. The specs, the host pin and the gate are the real ones. The fake logs
every request the vault made to ``ATHENA_HOME/fake-providers/log.ndjson``, and every test ends by
asserting that each of them was answered by the fake at a pinned production host.
"""

from __future__ import annotations

import json
import re
import time
from typing import Any

from .conftest import APP_ID, Daemon, Spawn, claude_round, op
from .fake_providers import (
    CONTROL,
    DIRNAME,
    GMAIL_HOSTS,
    LOG,
    MAIL_ID,
    NOTION_HOSTS,
    SHARED_PAGE,
    SHARED_TITLE,
)

CLIENT_ID = "journey-client-id.apps.example"
CLIENT_SECRET = "journey-client-secret-value"
NOTION_TOKEN = "ntn_journey_token_0123456789"
MIRA = "mira@studio.example"
OTHER = "jonas@audit.example"
DANA = "dana@client.example"
STRANGER = "stranger@elsewhere.example"

SEND = "connector.gmail.send_mail"
SEARCH = "connector.gmail.search_mail"
READ = "connector.gmail.read_mail"
NOTION_READ = "connector.notion.read_page"

REPLY = {
    "to": [DANA],
    "subject": "Re: Invoice 7 is overdue",
    "body": "Hi Dana, here is the payment link again. Thank you.",
}


# -- the fake, seen from the test ----------------------------------------------------------------


def log(daemon: Daemon) -> list[dict[str, Any]]:
    path = daemon.home / DIRNAME / LOG
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def sent(daemon: Daemon) -> list[dict[str, Any]]:
    return [entry["sent"] for entry in log(daemon) if "sent" in entry]


def control(daemon: Daemon, **state: Any) -> None:
    path = daemon.home / DIRNAME / CONTROL
    path.parent.mkdir(parents=True, exist_ok=True)
    current = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    path.write_text(json.dumps({**current, **state}), encoding="utf-8")


def assert_every_request_was_answered_by_the_fake(daemon: Daemon) -> None:
    """Nothing the vault asked for was left for a real host: each request is at a pinned
    production host of the specs, and the fake knew the route."""
    asked = [entry for entry in log(daemon) if "status" in entry]
    assert asked, "the vault made no request at all"
    pinned = {*GMAIL_HOSTS, *NOTION_HOSTS}
    assert [e for e in asked if e["host"] not in pinned] == []
    assert [e for e in asked if not e["answered"]] == []
    assert [e for e in asked if e["status"] == 599] == []


# -- the routes, as the panel uses them ----------------------------------------------------------


def connector(daemon: Daemon, connector_id: str) -> dict[str, Any]:
    rows = daemon.request("/connectors").body["connectors"]
    return next(row for row in rows if row["id"] == connector_id)


def connect_gmail(daemon: Daemon) -> dict[str, Any]:
    """Paste the pair, press Connect, and wait for the flow the consent page completes."""
    reply = daemon.request(
        "/connectors/gmail/connect",
        method="POST",
        json_body={"client_id": CLIENT_ID, "client_secret": CLIENT_SECRET},
    )
    assert reply.status == 200, reply.text
    assert CLIENT_SECRET not in reply.text
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        flow = daemon.request("/connectors/gmail/flow", method="POST").body["flow"]
        if flow and flow["phase"] in ("done", "failed"):
            assert flow["phase"] == "done", flow
            return connector(daemon, "gmail")
        time.sleep(0.1)
    raise AssertionError("the consent flow did not finish")


def settings(daemon: Daemon, connector_id: str, **body: Any) -> dict[str, Any]:
    reply = daemon.request(f"/connectors/{connector_id}/settings", method="POST", json_body=body)
    assert reply.status == 200, reply.text
    return dict(reply.body["connector"])


def results(reply: Any) -> list[dict[str, Any]]:
    return [payload for kind, payload in reply.frames() if kind == "tool.result"]


def cards(reply: Any) -> list[dict[str, Any]]:
    return [payload for kind, payload in reply.frames() if kind == "decision.requested"]


def ready_for_a_chase(spawn: Spawn, rounds: list[list[str]]) -> Daemon:
    daemon = spawn.scripted(rounds, fake_providers=True)
    daemon.register()
    record = connect_gmail(daemon)["connection"]
    assert record["status"] == "connected" and record["identity"] == MIRA
    return daemon


def test_connect_then_read_then_a_gated_send_that_goes_to_exactly_one_allowed_address(
    spawn: Spawn,
) -> None:
    daemon = spawn.scripted(
        [
            claude_round("Looking.\n" + op(SEARCH, query="invoice overdue")),
            claude_round("Reading it.\n" + op(READ, message_id=MAIL_ID)),
            claude_round("Dana asks for the payment link again."),
            claude_round("I will reply to her.\n" + op(SEND, "answer Dana", **REPLY)),
        ],
        fake_providers=True,
    )
    daemon.register()
    assert connector(daemon, "gmail")["live"] is False

    gmail = connect_gmail(daemon)
    record = gmail["connection"]
    assert record["status"] == "connected" and record["identity"] == MIRA
    assert gmail["live"] is True and record["writes_enabled"] is False
    assert CLIENT_SECRET not in json.dumps(daemon.request("/connectors").body)
    assert (daemon.home / "connectors" / "sealed").is_dir()
    assert record["seal"] == "file", "the journey never touches DPAPI or the keyring"

    first = daemon.run("find the overdue invoice mail and read it")
    got = results(first)
    assert [r["name"] for r in got] == [SEARCH, READ]
    assert all(r["ok"] for r in got)
    assert MAIL_ID in got[0]["output"]
    assert "Invoice 7 is overdue" in got[0]["output"]
    assert "Can you resend the link" in got[1]["output"]
    fence = re.match(r"<<<gmail:(\w+)\n", got[1]["output"])
    assert fence, "a read comes back inside the nonce-tagged fence"
    assert "data, not instructions" in got[1]["output"]
    assert got[1]["output"].rstrip().endswith(f"gmail:{fence.group(1)}>>>")
    assert sent(daemon) == []

    on = settings(daemon, "gmail", writes_enabled=True, allowlist=DANA)["connection"]
    assert on["writes_enabled"] is True and on["allowlist"] == [DANA]

    second = daemon.run("reply to Dana with the payment link")
    filed = cards(second)
    assert len(filed) == 1
    card = filed[0]
    assert card["action"] == SEND
    assert card["params"] == REPLY
    assert DANA in json.dumps(card)
    assert sent(daemon) == [], "a card is a question; nothing left yet"

    pending = daemon.request("/decisions").body
    assert pending["total"] == 1 and pending["pending"][0]["id"] == card["id"]

    answered = daemon.decide(card["id"], "approve")
    assert answered.status == 200, answered.text
    assert answered.body["status"] == "approved"
    assert f"sent to {DANA}" in answered.body["output"]
    assert daemon.request("/decisions").body["total"] == 0

    delivered = sent(daemon)
    assert len(delivered) == 1
    assert delivered[0]["to"] == DANA
    assert delivered[0]["from_account"] == MIRA
    assert delivered[0]["subject"] == REPLY["subject"]
    assert delivered[0]["body"].strip() == REPLY["body"]

    rows = daemon.request("/ledger").body["rows"]
    assert len(rows) == 2, "one row per model invocation sequence: the read turn and the send turn"
    assert all(row["origin"] == f"host:{APP_ID}" for row in rows)
    assert connector(daemon, "gmail")["connection"]["last_used_at"]
    assert_every_request_was_answered_by_the_fake(daemon)


def test_a_recipient_off_the_list_is_refused_by_name_and_nothing_is_sent(spawn: Spawn) -> None:
    stranger = {**REPLY, "to": [STRANGER]}
    daemon = ready_for_a_chase(
        spawn, [claude_round("Sending.\n" + op(SEND, "answer a stranger", **stranger))]
    )
    settings(daemon, "gmail", writes_enabled=True, allowlist=DANA)

    filed = cards(daemon.run("send the payment link to the stranger"))
    assert len(filed) == 1 and filed[0]["params"]["to"] == [STRANGER]

    answered = daemon.decide(filed[0]["id"], "approve")

    assert answered.status == 200
    assert STRANGER in answered.body["output"] and "allow-list" in answered.body["output"]
    refusal = next(e for e in answered.body["events"] if e["kind"] == "tool.result")
    assert refusal["ok"] is False and refusal["error"] == "validator_failed"
    assert sent(daemon) == []
    assert_every_request_was_answered_by_the_fake(daemon)


def test_a_decline_runs_nothing_and_is_recorded_as_the_users_own_decision(spawn: Spawn) -> None:
    daemon = ready_for_a_chase(spawn, [claude_round("Replying.\n" + op(SEND, "answer", **REPLY))])
    settings(daemon, "gmail", writes_enabled=True, allowlist=DANA)
    filed = cards(daemon.run("reply to Dana"))
    assert len(filed) == 1

    declined = daemon.decide(filed[0]["id"], "decline")

    assert declined.status == 200
    assert declined.body["status"] == "declined"
    assert declined.body["execute"] == [] and declined.body["output"] == ""
    assert sent(daemon) == []
    assert not [e for e in log(daemon) if e["path"].endswith("/messages/send")]
    rows = [r for r in daemon.request("/ledger").body["rows"] if r["trigger"] == "decision"]
    assert len(rows) == 1
    assert rows[0]["error_reason"] == "user_denied" and rows[0]["rounds"] == 0
    assert daemon.request("/decisions").body["total"] == 0
    assert_every_request_was_answered_by_the_fake(daemon)


def test_a_grant_revoked_mid_run_shows_needs_reauth_and_the_next_call_is_refused(
    spawn: Spawn,
) -> None:
    daemon = ready_for_a_chase(
        spawn,
        [
            claude_round("Looking.\n" + op(SEARCH, query="invoice")),
            claude_round("It could not be read."),
            claude_round("Looking again.\n" + op(SEARCH, query="invoice")),
        ],
    )
    control(daemon, gmail_revoked=True)

    results_of_the_turn = results(daemon.run("find the invoice mail"))

    assert len(results_of_the_turn) == 1 and results_of_the_turn[0]["ok"] is False
    assert "reconnected in Connectors" in results_of_the_turn[0]["output"]
    gmail = connector(daemon, "gmail")
    assert gmail["connection"]["status"] == "needs_reauth"
    assert gmail["live"] is False
    assert [e["status"] for e in log(daemon) if e["path"].endswith("/messages")] == [401]

    # Not live, so the name is no longer one the model can address, and nothing is dialled.
    asked = len(log(daemon))
    again = results(daemon.run("try once more"))
    assert again and again[0]["ok"] is False and again[0]["error"] == "unknown_ref"
    assert len(log(daemon)) == asked
    assert_every_request_was_answered_by_the_fake(daemon)


def test_a_notion_page_that_was_never_shared_is_answered_honestly(spawn: Spawn) -> None:
    daemon = spawn.scripted(
        [
            claude_round("Reading.\n" + op(NOTION_READ, page_id=SHARED_PAGE)),
            claude_round("Those are the notes."),
            claude_round("Reading.\n" + op(NOTION_READ, page_id="f" * 32)),
            claude_round("I cannot see that page."),
            claude_round("Reading.\n" + op(NOTION_READ, page_id=SHARED_PAGE)),
            claude_round("Notion refused me."),
        ],
        fake_providers=True,
    )
    daemon.register()
    reply = daemon.request(
        "/connectors/notion/connect", method="POST", json_body={"token": NOTION_TOKEN}
    )
    assert reply.status == 200 and NOTION_TOKEN not in reply.text
    assert connector(daemon, "notion")["connection"]["identity"] == "Fake Integration"

    shared = results(daemon.run("read the shared notes"))[0]
    assert shared["ok"] is True and SHARED_TITLE in shared["output"]

    hidden = results(daemon.run("read the other page"))[0]
    assert hidden["ok"] is False
    assert "404" in hidden["output"] and "page read" in hidden["output"]
    assert SHARED_TITLE not in hidden["output"], "nothing is invented for a page it cannot see"

    control(daemon, notion_mode="401")
    refused = results(daemon.run("read the notes again"))[0]
    assert refused["ok"] is False and "401" in refused["output"]
    assert NOTION_TOKEN not in refused["output"]
    assert_every_request_was_answered_by_the_fake(daemon)


def test_a_connect_as_a_second_account_turns_writes_off_and_a_send_to_the_first_is_refused(
    spawn: Spawn,
) -> None:
    daemon = ready_for_a_chase(spawn, [claude_round("Replying.\n" + op(SEND, "answer", **REPLY))])
    settings(daemon, "gmail", writes_enabled=True, allowlist=DANA)

    # The same account again: the switches are the person's and are kept (ADR 0021).
    daemon.request("/connectors/gmail/disconnect", method="POST")
    kept = connect_gmail(daemon)["connection"]
    assert kept["writes_enabled"] is True and kept["allowlist"] == [DANA]

    # A different account: they were set under mira, so they are not carried to jonas (ADR 0062).
    after = daemon.request("/connectors/gmail/disconnect", method="POST").body["connector"]
    assert after["connection"]["writes_enabled"] is True, "a disconnect alone keeps them"
    control(daemon, gmail_account=OTHER)
    record = connect_gmail(daemon)["connection"]
    assert record["identity"] == OTHER
    assert record["writes_enabled"] is False and record["allowlist"] == []
    assert OTHER in record["health_detail"] and MIRA in record["health_detail"]
    assert "writes are off" in record["health_detail"] and "emptied" in record["health_detail"]

    filed = cards(daemon.run("reply to Dana"))
    assert len(filed) == 1
    answered = daemon.decide(filed[0]["id"], "approve")
    assert "switched off" in answered.body["output"]
    assert sent(daemon) == []
    assert_every_request_was_answered_by_the_fake(daemon)

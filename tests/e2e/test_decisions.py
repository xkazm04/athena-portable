"""``POST /decisions/<id>``: the gated path, closed over HTTP (README §3.2 step 6; ADR 0010).

A card is answered once, by the user, and the answer is proved against the row before anything is
allowed to happen. What comes back for a host tool is an ``execute`` instruction carrying the
parameters *the row* holds, because that is what keeps an approved card from being spent on a
neighbouring call — and because a host tool has no executor anywhere in this process, so the page
is what runs it.

What the two answers leave behind differs, and deliberately: a **decline** writes a ledger row of
zero rounds carrying ``user_denied`` (README §2 invariant 6 — a decision the user made is part of
the record), while an **approval** writes no ledger row at all, because no model was invoked and
the harness already charged the turn that raised the card. The approval's record is the episode,
which is read back here through ``core.recall`` rather than asserted through a reimplementation of
the brain.
"""

from __future__ import annotations

from .conftest import APP_ID, PAGE_ORIGIN, Daemon, Spawn, claude_round, op

GATED_ROUND = claude_round(
    "I will need your approval for that.\n"
    + op("host.invoices.pay", "the invoice the user named", invoice="7")
)
RECALL_ROUNDS = [
    claude_round("Checking the record.\n" + op("core.recall", query="decision")),
    claude_round("That is what the record says."),
]


def _card(daemon: Daemon) -> str:
    """Run one turn that proposes the gated call, and return the id of the card it filed."""
    daemon.register()
    reply = daemon.run("pay invoice 7")
    cards = [payload for kind, payload in reply.frames() if kind == "decision.requested"]
    assert len(cards) == 1, "the turn did not file exactly one card"
    return str(cards[0]["id"])


def test_approving_a_card_replays_the_grant_as_an_execute_for_exactly_that_action(
    spawn: Spawn,
) -> None:
    daemon = spawn.scripted([GATED_ROUND, *RECALL_ROUNDS])
    approval_id = _card(daemon)

    reply = daemon.decide(approval_id, "approve", origin=PAGE_ORIGIN)

    assert reply.status == 200
    body = reply.body
    assert body["ok"] is True
    assert body["id"] == approval_id
    assert body["status"] == "approved"
    assert body["choice"] == "approve"
    assert body["conversation_id"] == f"conv_{APP_ID}"
    assert len(body["execute"]) == 1
    instruction = body["execute"][0]
    assert instruction["name"] == f"host.{APP_ID}.pay"
    assert instruction["params"] == {"invoice": "7"}
    assert instruction["origin"] == f"host:{APP_ID}"
    assert instruction["tier"] == 1
    assert instruction["approval_id"] == approval_id
    assert instruction["call_id"]
    # Empty because a host tool has no executor anywhere in this process (ADR 0010): the page
    # runs it on ``execute`` and the answer arrives in the next turn's frame.
    assert body["output"] == ""
    assert [event["kind"] for event in body["events"]] == ["decision.resolved", "tool.call"]
    assert daemon.request("/decisions").body["total"] == 0

    # The ledger is unchanged by an approval: one row for the turn that raised the card, and no
    # row for answering it, because answering a card invokes no model.
    ledger = daemon.request("/ledger").body
    assert ledger["total"] == 1
    assert [row["trigger"] for row in ledger["rows"]] == ["cli"]

    # The record of the grant is the episode, read back through the catalog's own READ tool.
    recalled = [
        payload
        for kind, payload in daemon.run("what did I just approve?").frames()
        if kind == "tool.result"
    ]
    assert len(recalled) == 1
    assert f"the user approved host.{APP_ID}.pay" in recalled[0]["output"]


def test_a_second_answer_to_the_same_card_is_refused_and_the_first_answer_stands(
    spawn: Spawn,
) -> None:
    daemon = spawn.scripted([GATED_ROUND])
    approval_id = _card(daemon)
    first = daemon.decide(approval_id, "approve")
    assert first.status == 200

    second = daemon.decide(approval_id, "decline")

    assert second.status == 409
    assert second.body["reason"] == "pending_approval"
    assert second.body["ok"] is False
    # The card is neither back in the inbox nor answerable again.
    assert daemon.request("/decisions").body["total"] == 0
    assert daemon.decide(approval_id, "approve").status == 409


def test_an_answer_that_tampers_with_the_parameters_cannot_move_them(spawn: Spawn) -> None:
    """The execute is built from the row, so what this request says about parameters is ignored.

    That is the whole promise of README §3.2 step 6 and ADR 0010 ("built from the **row's**
    parameters rather than the caller's"), and it is why the ``validator_failed`` branch of
    ``GateHook._check_grant`` — the gate's guard for a replay that arrives with parameters the
    user never granted — is unreachable from this route by construction: nothing a caller sends
    reaches the replay. The route's own refusals are asserted beside it: a choice the card never
    offered, and no choice at all.
    """
    daemon = spawn.scripted([GATED_ROUND])
    approval_id = _card(daemon)

    tampered = daemon.decide(
        approval_id,
        "approve",
        params={"invoice": "999"},
        action=f"host.{APP_ID}.chase",
        origin=PAGE_ORIGIN,
    )

    assert tampered.status == 200
    assert tampered.body["execute"][0]["params"] == {"invoice": "7"}
    assert tampered.body["execute"][0]["name"] == f"host.{APP_ID}.pay"


def test_a_choice_the_card_never_offered_is_refused_and_leaves_the_row_pending(
    spawn: Spawn,
) -> None:
    daemon = spawn.scripted([GATED_ROUND])
    approval_id = _card(daemon)

    assert daemon.decide(approval_id, "sure, go ahead").status == 409
    assert daemon.request("/decisions").body["pending"][0]["id"] == approval_id

    empty = daemon.request(f"/decisions/{approval_id}", method="POST", json_body={})
    assert empty.status == 400
    assert empty.body["reason"] == "validator_failed"

    unknown = daemon.request(
        "/decisions/apr_000000000000", method="POST", json_body={"choice": "approve"}
    )
    assert unknown.status == 404
    assert unknown.body["reason"] == "unknown_ref"
    assert daemon.request("/decisions").body["total"] == 1


def test_declining_a_card_runs_nothing_and_is_recorded_as_the_users_own_decision(
    spawn: Spawn,
) -> None:
    daemon = spawn.scripted([GATED_ROUND, *RECALL_ROUNDS])
    approval_id = _card(daemon)

    reply = daemon.decide(approval_id, "decline", origin=PAGE_ORIGIN)

    assert reply.status == 200
    assert reply.body["ok"] is True
    assert reply.body["status"] == "declined"
    assert reply.body["execute"] == [], "a decline instructs the page to do nothing"
    assert reply.body["output"] == ""
    assert [event["kind"] for event in reply.body["events"]] == ["decision.resolved"]
    assert daemon.request("/decisions").body["total"] == 0

    decisions = [
        row for row in daemon.request("/ledger").body["rows"] if row["trigger"] == "decision"
    ]
    assert len(decisions) == 1
    row = decisions[0]
    assert row["error_reason"] == "user_denied", "the user's answer, from the closed reason set"
    assert row["rounds"] == 0, "no model was invoked to answer a card"
    assert row["origin"] == f"host:{APP_ID}"
    assert row["conversation_id"] == f"conv_{APP_ID}"
    assert row["cost_usd"] is None, "no invocation, so no cost is claimed"
    # ``is_error`` is how a row with no invocation behind it is kept out of the spend, and the
    # reason beside it is what act 4 reads: a decline is the user's decision, not a failure.
    assert row["is_error"] is True

    recalled = [
        payload
        for kind, payload in daemon.run("what did I just decline?").frames()
        if kind == "tool.result"
    ]
    assert f"the user declined host.{APP_ID}.pay" in recalled[0]["output"]

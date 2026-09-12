"""``POST /run``: one turn over HTTP, on a recorded engine (README §3.2; ADR 0010, 0012).

Two turns are proved here and they are the two halves of §3.2. An ``AUTO`` host tool **leaves** the
daemon as a ``tool.call``: the page runs it, because the lane holds no executor for one, and the
answer rides the next request's ``tool_results`` into the record. A ``GATED`` one stops at the
gate: a card, a refusal that names ``pending_approval``, and a row waiting on the user.

The framing itself is asserted, not just the events: ``event:`` carries the event's own kind,
``data:`` is one line of JSON, frames are separated by a blank line, there is no
``Content-Length`` — the closed connection is the end of the body — and the last frame is
``turn.finished``.
"""

from __future__ import annotations

import json

from athena.daemon.routes import DECISION_TOOL

from .conftest import APP_ID, ENGINE, MODEL, PAGE_ORIGIN, Spawn, claude_round, op

#: What the page says it did. It has to come back out of the brain to prove it was carried.
MARKER = "chase-note-drafted-for-INV-7"


def test_an_auto_host_tool_leaves_as_an_instruction_and_its_answer_is_carried_into_the_next_turn(
    spawn: Spawn,
) -> None:
    daemon = spawn.scripted(
        [
            claude_round("Chasing it.\n" + op("host.invoices.chase", "31 days late", invoice="7")),
            claude_round("Let me see what the page said.\n" + op("core.recall", query="chase")),
            claude_round("The page has drafted it."),
        ]
    )
    daemon.register()

    first = daemon.run("chase invoice 7")

    # -- the framing ---------------------------------------------------------------------------
    assert first.status == 200
    assert first.header("Content-Type") == "text/event-stream"
    assert first.header("Cache-Control") == "no-cache"
    assert first.header("Connection") == "close"
    assert not first.has_header("Content-Length"), "an SSE stream has no length to declare"
    assert first.text.endswith("\n\n")
    for block in first.text.split("\n\n"):
        if not block:
            continue
        name, _, data = block.partition("\n")
        assert name.startswith("event: ")
        assert data.startswith("data: ")
        assert "\n" not in data, "one JSON object on one line, so nothing can split a frame"
        assert json.loads(data[len("data: ") :])["kind"] == name[len("event: ") :]

    # -- the sequence --------------------------------------------------------------------------
    frames = first.frames()
    assert [kind for kind, _ in frames] == [
        "text.delta",
        "tool.call",
        "turn.summary",
        "turn.finished",
    ]
    call = frames[1][1]
    assert call["name"] == f"host.{APP_ID}.chase"
    assert call["params"] == {"invoice": "7"}
    assert call["origin"] == f"host:{APP_ID}"
    assert call["tier"] == 1
    assert frames[-1][1]["text"] == "Chasing it."

    # One row per model invocation, and this turn was one (README §2 invariant 6).
    ledger = daemon.request("/ledger").body
    assert (ledger["showing"], ledger["total"], ledger["footer"]) == (1, 1, "")
    row = ledger["rows"][0]
    assert (row["engine"], row["model"]) == (ENGINE, MODEL)
    assert (row["origin"], row["surface"], row["trigger"]) == (f"host:{APP_ID}", "panel", "cli")
    assert (row["rounds"], row["is_error"], row["error_reason"]) == (1, False, None)
    assert row["input_tokens"] == 1840

    # -- the page answers, and the answer is in the record --------------------------------------
    second = daemon.run(
        "(the tools you called have answered; continue)",
        tool_results=[
            {
                "call_id": call["call_id"],
                "name": f"host.{APP_ID}.chase",
                "ok": True,
                "output": MARKER,
                "tier": 1,
                "ms": 12,
            }
        ],
    )

    kinds = [kind for kind, _ in second.frames()]
    assert kinds == [
        "text.delta",
        "tool.call",
        "tool.result",
        "text.delta",
        "turn.summary",
        "turn.finished",
    ]
    recalled = second.frames()[2][1]
    assert recalled["name"] == "core.recall"
    assert recalled["ok"] is True
    # The carried result became a system episode of this conversation, so recall — a READ that
    # ran inside the turn, in this process — reads it back out.
    assert MARKER in recalled["output"]
    assert f"host.{APP_ID}.chase returned" in recalled["output"]

    rows = daemon.request("/ledger").body
    assert rows["total"] == 2
    assert rows["rows"][0]["rounds"] == 2, "two provider rounds are still one turn and one row"
    assert daemon.request("/decisions").body["total"] == 0, "nothing gated happened"


def test_a_gated_call_stops_at_the_gate_with_a_card_a_refusal_and_a_row_the_user_must_answer(
    spawn: Spawn,
) -> None:
    daemon = spawn.scripted(
        [
            claude_round(
                "I will need your approval for that.\n"
                + op("host.invoices.pay", "the invoice the user named", invoice="7")
            )
        ]
    )
    daemon.register()

    reply = daemon.run("pay invoice 7")

    frames = reply.frames()
    assert [kind for kind, _ in frames] == [
        "text.delta",
        "tool.call",
        "decision.requested",
        "tool.result",
        "turn.summary",
        "turn.finished",
    ]
    card = frames[2][1]
    assert card["action"] == f"host.{APP_ID}.pay"
    assert card["params"] == {"invoice": "7"}
    assert card["rationale"] == "the invoice the user named"
    assert card["origin"] == f"host:{APP_ID}"
    # The AG-UI convention a panel renders the card as, on the same frame as the event itself, so
    # the two readings can never disagree about what the card said.
    assert card["tool"] == DECISION_TOOL
    assert [option["id"] for option in card["options"]] == ["approve", "decline"]
    assert card["id"].startswith("apr_")

    refusal = frames[3][1]
    assert refusal["ok"] is False
    assert refusal["error"] == "pending_approval"
    assert card["id"] in refusal["output"]
    assert refusal["call_id"] == frames[1][1]["call_id"], "the refusal answers that call"

    # -- the card is the approval table, not a second list beside it ----------------------------
    inbox = daemon.request("/decisions").body
    assert (inbox["showing"], inbox["total"], inbox["footer"]) == (1, 1, "")
    row = inbox["pending"][0]
    assert row["id"] == card["id"]
    assert row["action"] == f"host.{APP_ID}.pay"
    assert row["params"] == {"invoice": "7"}
    assert row["rationale"] == "the invoice the user named"
    assert row["options"] == ["approve", "decline"]
    assert row["origin"] == f"host:{APP_ID}"
    assert row["conversation_id"] == f"conv_{APP_ID}"
    assert row["surface"] == "panel"
    assert row["created_at"] and row["expires_at"]

    assert daemon.request("/health").body["pending"] == {"showing": 1, "total": 1, "footer": ""}
    # Nothing executed: the turn ended without an execute instruction and the row is still
    # waiting on the user, which is the only state from which one can be issued.
    assert daemon.request("/ledger").body["rows"][0]["is_error"] is False
    assert daemon.request("/decisions").body["pending"][0]["id"] == card["id"]


def test_a_turn_from_an_origin_that_sent_no_manifest_is_refused_before_the_stream_opens(
    spawn: Spawn,
) -> None:
    """Everything refusable is refused as a JSON body, so a caller never reads a 200 to find out
    the turn never started."""
    daemon = spawn.scripted([claude_round("never reached")])

    reply = daemon.run("do something", origin="https://not-registered.example")

    assert reply.status == 403
    assert reply.body["reason"] == "foreign_origin"
    assert "json" in reply.header("Content-Type")
    assert daemon.request("/ledger").body["total"] == 0
    assert daemon.run("do something", origin=PAGE_ORIGIN).status == 403

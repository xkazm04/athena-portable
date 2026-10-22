"""Your runs come back to the chore (ADR 0124): a case's turns, cards and cost, as a receipt.

One case, two portals: every turn sent with the case's ``project_id`` lands in
``conv_proj_…``, whichever origin it came from, and so does every ledger row and every card. The
receipt route folds that conversation, and its counts are the approval table's own; its cost is the
ledger's rollup by conversation. Pressing done appends the receipt to the case file, which is
still there after the index is deleted and rebuilt from disk.
"""

from __future__ import annotations

import shutil
from datetime import UTC, datetime, timedelta
from pathlib import Path

from athena.adopt.cases import CaseBook, render_case
from athena.contracts import ids
from athena.contracts.adopt import Case
from athena.contracts.channel import iso, now_iso
from athena.core.brain import Brain, reconcile_from_disk
from athena.daemon.server import AthenaDaemon
from athena.harness.transports import ScriptedTransport

from .conftest import (
    APP_ID,
    OTHER_APP_ID,
    OTHER_PAGE_ORIGIN,
    PAGE_ORIGIN,
    Live,
    claude_round,
    op,
)


def _case(daemon: AthenaDaemon) -> str:
    """A saved case, as an approve writes it (ADR 0123)."""
    case_id = ids.mint("project")
    stamp = now_iso()
    case = Case(
        id=case_id,
        playbook_id="invoice-chase",
        title="Chase the invoices",
        approved_rev=1,
        approved_at=stamp,
        episode_id="",
        created=stamp,
        brief_md="Chase every overdue invoice.",
        command="Chase every overdue invoice.",
    )
    daemon.brain.write_goal(
        case_id,
        case.title,
        render_case(case),
        session_id=ids.conversation_for_project(case_id),
        created=stamp,
    )
    return case_id


def _cards(reply_frames: list[tuple[str, dict[str, object]]]) -> list[str]:
    return [str(payload["id"]) for kind, payload in reply_frames if kind == "decision.requested"]


def test_a_case_run_across_two_origins_is_one_conversation_and_one_honest_receipt(
    live: Live, daemon: AthenaDaemon, tmp_path: Path
) -> None:
    case_id = _case(daemon)
    conv = f"conv_{case_id}"
    assert live.register().status == 200
    assert live.register(OTHER_APP_ID, OTHER_PAGE_ORIGIN).status == 200

    # Turn 1, on the invoices tab: three cards.
    live.script(
        claude_round(
            "These need your approval.\n"
            + op("host.invoices.pay", invoice="7", amount_usd=120)
            + "\n"
            + op("host.invoices.pay", invoice="8", amount_usd=30)
            + "\n"
            + op("host.invoices.pay", invoice="9", amount_usd=55)
        )
    )
    first = live.run("pay the late ones", project_id=case_id)
    approved, declined, lapsed = _cards(first.frames())

    # One approved, one declined, one left to expire.
    ran = live.request(f"/decisions/{approved}", method="POST", json_body={"choice": "approve"})
    assert ran.status == 200 and ran.body["status"] == "approved"
    no = live.request(f"/decisions/{declined}", method="POST", json_body={"choice": "decline"})
    assert no.status == 200 and no.body["status"] == "declined"
    assert daemon.approvals.expire_due(datetime.now(UTC) + timedelta(hours=25)) == [lapsed]

    # Turn 2, on the other tab, same case: one card left waiting.
    live.script(claude_round("One more here.\n" + op("host.crm.pay", invoice="10")))
    second = live.run("and this one", origin=OTHER_PAGE_ORIGIN, project_id=case_id)
    assert len(_cards(second.frames())) == 1

    # Turn 3, back on invoices: the approved payment's answer never came.
    live.script(claude_round("I will not retry that unasked."))
    call = ran.body["execute"][0]
    third = live.run(
        "did it go through?",
        origin=PAGE_ORIGIN,
        project_id=case_id,
        tool_results=[
            {
                "call_id": call["call_id"],
                "name": call["name"],
                "ok": False,
                "output": "",
                "error": "outcome_unknown: no answer within 20 s",
                "tier": 1,
            }
        ],
    )
    assert third.status == 200

    # Every ledger row and every card of those turns is the case's conversation.
    with daemon.brain.read_connection() as con:
        ledger_convs = {r[0] for r in con.execute("SELECT conversation_id FROM companion_turn")}
        card_convs = {r[0] for r in con.execute("SELECT conversation_id FROM companion_approval")}
        by_status = dict(
            con.execute(
                "SELECT status, count(*) FROM companion_approval WHERE conversation_id = ? "
                "GROUP BY status",
                (conv,),
            ).fetchall()
        )
    assert ledger_convs == {conv} and card_convs == {conv}
    assert by_status == {"approved": 1, "declined": 1, "expired": 1, "pending": 1}

    reply = live.request(f"/adopt/cases/{case_id}/runs")
    assert reply.status == 200, reply.body
    run = reply.body["open"]
    assert reply.body["conversation_id"] == conv and reply.body["receipts"] == []
    assert {k: run[k] for k in by_status} == by_status
    assert run["consumed"] == 1  # the gate let the approved card through at its replay
    assert (run["asked_usd"], run["asked_cards"]) == (120.0, 1)
    assert run["cards_total"] == 4 and run["cards_footer"] == ""
    assert [c["status"] for c in run["cards"]] == ["approved", "declined", "expired", "pending"]
    assert run["cards"][0]["params"] == {"amount_usd": "120", "invoice": "7"}
    assert run["notes_total"] == 1 and "may have completed" in run["notes"][0]["text"]

    rollup = live.request("/ledger/rollup?by=conversation").body["rollup"]
    (row,) = [r for r in rollup if r["key"] == conv]
    assert (run["calls"], run["errors"], run["ms"]) == (row["calls"], row["errors"], row["ms"])
    assert abs(run["cost_usd"] - row["cost_usd"]) < 1e-9 and run["cost_usd"] > 0
    assert run["first_at"] <= run["last_at"] and run["until"] == "" and run["since"] == ""

    # Done: the receipt is appended to the case file, and the open run is empty again.
    done = live.request(f"/adopt/cases/{case_id}/done", method="POST", json_body={})
    assert done.status == 200 and done.body["saved"] is True, done.body
    assert done.body["receipt"]["approved"] == 1 and done.body["receipt"]["closed_by"] == "done"
    after = live.request(f"/adopt/cases/{case_id}/runs").body
    assert after["open"] is None and after["total"] == 1
    assert after["receipts"][0]["asked_usd"] == 120.0
    again = live.request(f"/adopt/cases/{case_id}/done", method="POST", json_body={})
    assert again.body == {"ok": True, "receipt": None, "saved": False, "problem": ""}

    # Delete the index and rebuild from disk: the cards and the ledger are gone, the receipt is not.
    copy = tmp_path / "copied-brain"
    shutil.copytree(daemon.brain.root, copy, ignore=shutil.ignore_patterns("index.sqlite*"))
    with Brain(copy) as brain:
        reconcile_from_disk(brain)
        book = CaseBook(brain)
        assert [c.id for c in book.cases()] == [case_id]
        (kept,) = book.receipts(case_id)
    assert (kept.approved, kept.declined, kept.expired, kept.pending) == (1, 1, 1, 1)
    assert kept.asked_usd == 120.0 and kept.notes_total == 1 and kept.calls == row["calls"]
    text = (copy / "goals" / f"{case_id}.md").read_text(encoding="utf-8")
    assert "## Your runs" in text and "$120.00 asked, from 1 card you approved" in text


def test_the_receipt_routes_refuse_what_is_not_a_saved_case(live: Live) -> None:
    assert live.request("/adopt/cases/proj_nothex/runs").status == 400
    assert live.request("/adopt/cases/proj_0123456789ab/runs").status == 404
    assert live.request("/adopt/cases/proj_0123456789ab/elsewhere").status == 404
    missing = live.request("/adopt/cases/proj_0123456789ab/done", method="POST", json_body={})
    assert missing.status == 404 and missing.body["reason"] == "unknown_ref"


def test_a_case_with_no_run_says_so(live: Live, daemon: AthenaDaemon) -> None:
    case_id = _case(daemon)
    body = live.request(f"/adopt/cases/{case_id}/runs").body
    assert body["open"] is None and body["receipts"] == [] and body["total"] == 0


# --- the second run starts where the last stopped (ADR 0126) ------------------------------------


def test_a_turn_under_a_case_with_a_stored_run_carries_it_and_dates_an_old_yes(
    live: Live, daemon: AthenaDaemon, transport: ScriptedTransport
) -> None:
    from athena.adopt import receipts as runs

    case_id = _case(daemon)
    bare_case = _case(daemon)
    conv = ids.conversation_for_project(case_id)
    assert live.register().status == 200
    then = datetime.now(UTC) - timedelta(days=20)
    params = {"invoice": "7", "amount_usd": 120}
    row = daemon.approvals.create(
        "host.invoices.pay",
        params,
        origin="host:invoices",
        conversation=conv,
        surface="panel",
        now=then,
    )
    daemon.approvals.resolve(row.id, "approve", now=then)
    assert daemon.approvals.consume(row.id, now=then)
    lapsed = daemon.approvals.create(
        "host.invoices.pay",
        {"invoice": "8"},
        origin="host:invoices",
        conversation=conv,
        surface="panel",
        now=then,
    )
    assert daemon.approvals.expire_due(then + timedelta(days=2)) == [lapsed.id]
    receipt = runs.fold(
        daemon.brain,
        daemon.approvals,
        daemon.ledger,
        case_id,
        since=iso(then - timedelta(hours=1)),
        until=iso(then + timedelta(days=3)),
        closed_by="done",
        closed_at=iso(then + timedelta(days=3)),
    )
    CaseBook(daemon.brain).append_receipt(case_id, receipt)

    again = "Paying it.\n" + op("host.invoices.pay", invoice="7", amount_usd=120)
    live.script(*(claude_round(again) for _ in range(4)))

    # The case rides as case_id, which routes nothing: the turn stays in the tab's conversation.
    under = live.run("pay the late ones", case_id=case_id)
    assert {r.conversation for r in daemon.ledger.recent(5).rows} == {f"conv_{APP_ID}"}
    frame = transport.requests[-1].stdin
    assert "## Since last run of this chore" in frame
    block = frame[frame.index("## Since last run of this chore") :]
    block = block[: block.index("(showing ")]
    assert "untrusted" in block, "the receipt's params came from pages: fenced"
    assert block.index("expired unanswered") < block.index("approved ")
    assert "invoice=8" in block and "amount_usd=120, invoice=7" in block
    assert "(showing 2 of 2)" in frame
    local = then.astimezone()
    day = f"{local.strftime('%b')} {local.day}"
    (card,) = [p for kind, p in under.frames() if kind == "decision.requested"]
    assert f"You approved this exact call on {day} at {local.strftime('%H:%M')}" in str(
        card["rationale"]
    )

    # No project: today's frame and today's day-long lookback, so a 20-day-old yes says nothing.
    loose = live.run("pay the late ones")
    assert "Since last run" not in transport.requests[-1].stdin
    (card,) = [p for kind, p in loose.frames() if kind == "decision.requested"]
    assert "You approved this exact call" not in str(card["rationale"])

    # A case with no stored run: no block, and the day-long lookback.
    fresh = live.run("pay the late ones", case_id=bare_case)
    assert "Since last run" not in transport.requests[-1].stdin
    (card,) = [p for kind, p in fresh.frames() if kind == "decision.requested"]
    assert "You approved this exact call" not in str(card["rationale"])

    # A project_id alone names its case too (the voice path sends only that).
    routed = live.run("pay the late ones", project_id=case_id)
    assert "## Since last run of this chore" in transport.requests[-1].stdin
    assert routed.status == 200
    assert live.run("x", case_id="proj_nothex").status == 400

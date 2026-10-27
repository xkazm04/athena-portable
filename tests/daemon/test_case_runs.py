"""Your runs come back to the chore (ADR 0124), joined by the turns stamped under it (ADR 0127).

One case, two portals: every turn sent with the case's ``case_id`` keeps its own tab's
conversation, ``conv_<app>``, exactly as a turn under no case does, and the daemon stamps it under
the case. The receipt route folds the cards, ledger rows and episodes of those turn ids; its counts
are a direct ``SELECT`` over them, its cost the ledger's sum over them. Pressing done appends the
receipt to the case file, which is still there after the index is deleted and rebuilt from disk.
"""

from __future__ import annotations

import re
import shutil
from datetime import UTC, datetime, timedelta
from pathlib import Path

from athena.adopt.cases import CaseBook, parse_case, render_case
from athena.contracts import ids
from athena.contracts.adopt import Case
from athena.contracts.channel import iso, now_iso
from athena.core.brain import Brain, frontmatter, reconcile_from_disk
from athena.core.case_turns import CaseTurns
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


def _in(turn_ids: list[str]) -> str:
    """A direct ``turn_id IN (?, ...)`` over ``turn_ids``, written out, not the module's own."""
    return "turn_id IN (" + ", ".join("?" for _ in turn_ids) + ")"


def test_a_case_run_across_two_origins_keeps_each_conversation_and_one_honest_receipt(
    live: Live, daemon: AthenaDaemon, tmp_path: Path
) -> None:
    case_id = _case(daemon)
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
    first = live.run("pay the late ones", case_id=case_id)
    approved, declined, lapsed = _cards(first.frames())

    # One approved, one declined, one left to expire.
    ran = live.request(f"/decisions/{approved}", method="POST", json_body={"choice": "approve"})
    assert ran.status == 200 and ran.body["status"] == "approved"
    no = live.request(f"/decisions/{declined}", method="POST", json_body={"choice": "decline"})
    assert no.status == 200 and no.body["status"] == "declined"
    assert daemon.approvals.expire_due(datetime.now(UTC) + timedelta(hours=25)) == [lapsed]

    # Turn 2, on the other tab, same case: one card left waiting.
    live.script(claude_round("One more here.\n" + op("host.crm.pay", invoice="10")))
    second = live.run("and this one", origin=OTHER_PAGE_ORIGIN, case_id=case_id)
    assert len(_cards(second.frames())) == 1

    # Turn 3, back on invoices: the approved payment's answer never came.
    live.script(claude_round("I will not retry that unasked."))
    call = ran.body["execute"][0]
    third = live.run(
        "did it go through?",
        origin=PAGE_ORIGIN,
        case_id=case_id,
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

    # A turn under no case, in the same tab: in no run, whatever it files or costs.
    live.script(claude_round("Here.\n" + op("host.invoices.pay", invoice="11")))
    assert live.run("unrelated").status == 200

    # Each tab kept its own conversation; no turn, card or ledger row is conv_proj_.
    turns = daemon.case_turns.of_case(case_id)
    turn_ids = [t.turn_id for t in turns]
    # The three turns and the two answers: a card's answer is stamped under its turn's case.
    assert len(turns) == 5
    assert {t.conversation for t in turns} == {f"conv_{APP_ID}", f"conv_{OTHER_APP_ID}"}
    assert all(t.ended_at >= t.started_at for t in turns)
    where = _in(turn_ids)
    with daemon.brain.read_connection() as con:
        convs = {
            r[0]
            for table in ("companion_turn", "companion_approval")
            for r in con.execute(f"SELECT conversation_id FROM {table}")
        }
        by_status = dict(
            con.execute(
                f"SELECT status, count(*) FROM companion_approval WHERE {where} GROUP BY status",
                turn_ids,
            ).fetchall()
        )
        consumed = con.execute(
            f"SELECT count(*) FROM companion_approval WHERE {where} AND consumed_at IS NOT NULL",
            turn_ids,
        ).fetchone()[0]
        calls, errors, cost, ms = con.execute(
            "SELECT count(*), sum(is_error), sum(coalesce(cost_usd, 0)), sum(ms) "
            f"FROM companion_turn WHERE {where}",
            turn_ids,
        ).fetchone()
        everything = con.execute("SELECT count(*) FROM companion_turn").fetchone()[0]
        cards = con.execute("SELECT count(*) FROM companion_approval").fetchone()[0]
    assert convs == {f"conv_{APP_ID}", f"conv_{OTHER_APP_ID}"}
    assert by_status == {"approved": 1, "declined": 1, "expired": 1, "pending": 1}
    assert everything > calls and cards == 5  # the turn under no case is not the case's

    reply = live.request(f"/adopt/cases/{case_id}/runs")
    assert reply.status == 200, reply.body
    run = reply.body["open"]
    assert "conversation_id" not in reply.body and reply.body["receipts"] == []
    assert run["conversation_id"] == "" and run["turns"] == 5
    assert {k: run[k] for k in by_status} == by_status
    assert run["consumed"] == consumed == 1  # the gate let the approved card through
    assert (run["asked_usd"], run["asked_cards"]) == (120.0, 1)
    assert run["cards_total"] == 4 and run["cards_footer"] == ""
    assert [c["status"] for c in run["cards"]] == ["approved", "declined", "expired", "pending"]
    assert run["cards"][0]["params"] == {"amount_usd": "120", "invoice": "7"}
    assert run["notes_total"] == 1 and "may have completed" in run["notes"][0]["text"]
    assert (run["calls"], run["errors"], run["ms"]) == (calls, errors, ms)
    assert abs(run["cost_usd"] - cost) < 1e-9 and run["cost_usd"] > 0
    assert run["first_at"] == turns[0].started_at <= run["last_at"]
    assert run["until"] == "" and run["since"] == ""

    # Done: the receipt is appended to the case file, and the open run is empty again.
    done = live.request(f"/adopt/cases/{case_id}/done", method="POST", json_body={})
    assert done.status == 200 and done.body["saved"] is True, done.body
    assert done.body["receipt"]["approved"] == 1 and done.body["receipt"]["closed_by"] == "done"
    after = live.request(f"/adopt/cases/{case_id}/runs").body
    assert after["open"] is None and after["total"] == 1
    assert after["receipts"][0]["asked_usd"] == 120.0
    again = live.request(f"/adopt/cases/{case_id}/done", method="POST", json_body={})
    assert again.body == {"ok": True, "receipt": None, "saved": False, "problem": ""}

    # A restart opens the same table: the stamps are in the index, not in the process.
    assert [t.turn_id for t in CaseTurns(daemon.brain).of_case(case_id)] == turn_ids

    # Delete the index and rebuild from disk: the cards and the ledger are gone, the receipt is not.
    copy = tmp_path / "copied-brain"
    shutil.copytree(daemon.brain.root, copy, ignore=shutil.ignore_patterns("index.sqlite*"))
    with Brain(copy) as brain:
        reconcile_from_disk(brain)
        book = CaseBook(brain)
        assert [c.id for c in book.cases()] == [case_id]
        (kept,) = book.receipts(case_id)
    assert (kept.approved, kept.declined, kept.expired, kept.pending) == (1, 1, 1, 1)
    assert kept.asked_usd == 120.0 and kept.notes_total == 1 and kept.calls == calls
    assert kept.turns == 5 and kept.cost_usd == run["cost_usd"]
    text = (copy / "goals" / f"{case_id}.md").read_text(encoding="utf-8")
    assert "## Your runs" in text and "$120.00 asked, from 1 card you approved" in text
    _, extra = parse_case(frontmatter.parse(text)[1])
    assert [r["turns"] for r in extra["receipts"]] == [5]


def test_a_reconcile_keeps_an_open_runs_turns(live: Live, daemon: AthenaDaemon) -> None:
    """The case-turn table is runtime state, like the cards it joins: a rebuild of the index
    from disk leaves it, so an open run's receipt is the same after one."""
    case_id = _case(daemon)
    assert live.register().status == 200
    live.script(claude_round("Here.\n" + op("host.invoices.pay", invoice="7", amount_usd=5)))
    assert live.run("pay it", case_id=case_id).status == 200
    before = live.request(f"/adopt/cases/{case_id}/runs").body["open"]
    reconcile_from_disk(daemon.brain)
    after = live.request(f"/adopt/cases/{case_id}/runs").body["open"]
    assert after == before and after["turns"] == 1 and after["pending"] == 1


def test_a_case_id_leaves_the_conversation_exactly_as_it_was(
    live: Live, daemon: AthenaDaemon
) -> None:
    """Verdicts unchanged by construction: a turn's conversation, and so the history its frame is
    built from, is the same with and without ``case_id`` (ADR 0127). Only the stamp differs."""
    case_id = _case(daemon)
    assert live.register().status == 200
    assert live.register(OTHER_APP_ID, OTHER_PAGE_ORIGIN).status == 200
    live.script(*(claude_round("Fine.") for _ in range(4)))
    for origin in (PAGE_ORIGIN, OTHER_PAGE_ORIGIN):
        assert live.run("look", origin=origin).status == 200
        assert live.run("look", origin=origin, case_id=case_id).status == 200
    rows = daemon.ledger.recent(4).rows[::-1]
    plain, under = rows[0::2], rows[1::2]
    assert [r.conversation for r in plain] == [r.conversation for r in under]
    assert [r.conversation for r in plain] == [f"conv_{APP_ID}", f"conv_{OTHER_APP_ID}"]
    assert [daemon.case_turns.case_of(r.turn_id or "") for r in plain] == [None, None]
    assert [daemon.case_turns.case_of(r.turn_id or "") for r in under] == [case_id, case_id]


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


# --- an old yes is dated on the card; the receipt stays out of the prompt (ADR 0126, 0130) ------


def test_a_turn_under_a_case_with_a_stored_run_dates_an_old_yes_and_composes_no_receipt(
    live: Live, daemon: AthenaDaemon, transport: ScriptedTransport
) -> None:
    from athena.adopt import receipts as runs

    case_id = _case(daemon)
    bare_case = _case(daemon)
    conv = f"conv_{APP_ID}"
    assert live.register().status == 200
    then = datetime.now(UTC) - timedelta(days=20)
    # Run 1, twenty days ago: one turn stamped under the case filed both cards (ADR 0127).
    turn = ids.mint("turn")
    daemon.case_turns.record(case_id, turn, conv, now=then)
    daemon.case_turns.finish(turn, now=then)
    params = {"invoice": "7", "amount_usd": 120}
    row = daemon.approvals.create(
        "host.invoices.pay",
        params,
        origin="host:invoices",
        conversation=conv,
        surface="panel",
        turn_id=turn,
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
        turn_id=turn,
        now=then,
    )
    assert daemon.approvals.expire_due(then + timedelta(days=2)) == [lapsed.id]
    receipt = runs.fold(
        daemon.brain,
        daemon.approvals,
        daemon.ledger,
        daemon.case_turns,
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
    # ADR 0130: the last run's receipt is not composed into the turn, in any wording.
    assert "Since last run" not in frame
    assert "expired unanswered" not in frame and "invoice=8" not in frame
    local = then.astimezone()
    day = f"{local.strftime('%b')} {local.day}"
    (card,) = [p for kind, p in under.frames() if kind == "decision.requested"]
    assert f"You approved this exact call on {day} at {local.strftime('%H:%M')}" in str(
        card["rationale"]
    )

    # No case: today's day-long lookback, so a 20-day-old yes says nothing.
    loose = live.run("pay the late ones")
    assert "Since last run" not in transport.requests[-1].stdin
    (card,) = [p for kind, p in loose.frames() if kind == "decision.requested"]
    assert "You approved this exact call" not in str(card["rationale"])

    # A case with no stored run: the day-long lookback.
    fresh = live.run("pay the late ones", case_id=bare_case)
    assert "Since last run" not in transport.requests[-1].stdin
    (card,) = [p for kind, p in fresh.frames() if kind == "decision.requested"]
    assert "You approved this exact call" not in str(card["rationale"])

    # A project_id alone names its case too (the voice path sends only that): dated, no block.
    routed = live.run("pay the late ones", project_id=case_id)
    assert routed.status == 200
    assert "Since last run" not in transport.requests[-1].stdin
    (card,) = [p for kind, p in routed.frames() if kind == "decision.requested"]
    assert f"on {day} at" in str(card["rationale"])
    assert live.run("x", case_id="proj_nothex").status == 400

    # Outside a case, a yes inside the last day is today's line: the clock time, no date.
    recent = daemon.approvals.create(
        "host.invoices.pay",
        {"invoice": "9"},
        origin="host:invoices",
        conversation=conv,
        surface="panel",
    )
    daemon.approvals.resolve(recent.id, "approve")
    assert daemon.approvals.consume(recent.id)
    live.script(claude_round("Paying it.\n" + op("host.invoices.pay", invoice="9")))
    today = live.run("pay invoice 9")
    (card,) = [p for kind, p in today.frames() if kind == "decision.requested"]
    assert re.search(
        r"You approved this exact call at \d\d:\d\d and it may already have run\.",
        str(card["rationale"]),
    ), card


def test_the_runs_route_says_how_many_of_the_whole_history_it_shows(
    live: Live, daemon: AthenaDaemon
) -> None:
    from athena.adopt import receipts as runs
    from athena.contracts.adopt import Receipt

    case_id = _case(daemon)
    book = CaseBook(daemon.brain)
    stamp = datetime(2026, 1, 5, 9, 0, tzinfo=UTC)
    for n in range(1, 31):
        day = iso(stamp + timedelta(days=7 * n))
        book.append_receipt(
            case_id,
            Receipt(
                case_id=case_id, conversation_id="", until=day, closed_by="done", closed_at=day
            ),
        )
    body = live.request(f"/adopt/cases/{case_id}/runs").body
    assert body["showing"] == runs.KEPT_RECEIPTS == len(body["receipts"])
    assert body["total"] == 30
    assert body["footer"] == f"(showing {runs.KEPT_RECEIPTS} of 30)"

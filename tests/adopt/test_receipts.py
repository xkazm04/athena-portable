"""A case's receipts (ADR 0124): folded from the conversation, kept in the case file."""

from __future__ import annotations

from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from pathlib import Path

from athena.adopt import receipts as runs
from athena.adopt.cases import CaseBook, parse_case, render_case
from athena.contracts import ids
from athena.contracts.adopt import Case
from athena.contracts.channel import iso
from athena.core.approvals import APPROVE_TOKEN, Approvals
from athena.core.brain import Brain, frontmatter
from athena.core.ledger import Ledger
from athena.lane.browser_lane import MAY_HAVE_COMPLETED, marked
from athena.proving.playbooks import bench

T0 = datetime(2026, 10, 1, 9, 0, tzinfo=UTC)


def _brain(tmp_path: Path) -> tuple[Brain, Approvals, Ledger, str]:
    brain = Brain(tmp_path / "brain")
    case_id = ids.mint("project")
    case = Case(
        id=case_id,
        playbook_id="demo",
        title="Demo",
        approved_rev=1,
        approved_at=iso(T0),
        episode_id="",
        created=iso(T0),
    )
    brain.write_goal(
        case_id,
        "Demo",
        render_case(case),
        session_id=ids.conversation_for_project(case_id),
        created=iso(T0),
    )
    return brain, Approvals(brain), Ledger(brain), case_id


def test_the_asked_dollars_follow_the_benchs_own_amount_rule() -> None:
    assert runs.AMOUNT_PARAMS == bench.AMOUNT_PARAMS
    assert runs.card_amount({"amount_usd": 12, "amount_disputed_usd": 3}) == 12.0
    assert runs.card_amount({"amount_disputed_usd": 3.5}) == 3.5
    assert runs.card_amount({"amount_usd": True}) is None
    assert runs.card_amount({"amount_usd": "12"}) is None


def test_two_runs_split_at_the_first_receipt_and_only_approved_cards_ask(tmp_path: Path) -> None:
    brain, approvals, ledger, case_id = _brain(tmp_path)
    conv = ids.conversation_for_project(case_id)

    def card(n: int, amount: float, at: datetime) -> str:
        params = {"invoice": str(n), "amount_usd": amount, "note": "x" * 300}
        row = approvals.create(
            "host.invoices.pay",
            params,
            origin="host:invoices",
            conversation=conv,
            surface="panel",
            now=at,
        )
        return row.id

    a = card(1, 40.0, T0)
    b = card(2, 99.0, T0 + timedelta(minutes=1))
    approvals.resolve(a, APPROVE_TOKEN, now=T0 + timedelta(minutes=2))
    approvals.resolve(b, "decline", now=T0 + timedelta(minutes=2))
    ledger.record(
        engine="claude",
        model="m",
        conversation=conv,
        origin="host:invoices",
        surface="panel",
        trigger="cli",
        cost_usd=0.5,
        ms=2000,
        now=T0,
    )
    brain.append_episode(
        marked(
            f"host.invoices.pay {MAY_HAVE_COMPLETED}: ", origin="host:invoices", project_id=case_id
        ),
        "system",
        session_id=conv,
        created=T0 + timedelta(minutes=3),
    )
    first = runs.fold(brain, approvals, ledger, case_id, until=iso(T0 + timedelta(hours=1)))
    assert (first.approved, first.declined, first.asked_usd, first.asked_cards) == (1, 1, 40.0, 1)
    assert first.calls == 1 and first.cost_usd == 0.5 and first.notes_total == 1
    assert first.first_at == iso(T0)
    shown = first.cards[0]
    assert list(shown.params) == ["amount_usd", "invoice", "note"]
    assert len(shown.params["note"]) == runs.PARAM_TEXT_CAP and shown.amount_usd == 40.0

    book = CaseBook(brain)
    book.append_receipt(case_id, first)
    # The second run starts where the first stopped.
    card(3, 7.0, T0 + timedelta(hours=2))
    since = book.receipts(case_id)[-1].until
    second = runs.fold(brain, approvals, ledger, case_id, since=since)
    assert (second.pending, second.approved, second.asked_usd, second.calls) == (1, 0, None, 0)
    assert not runs.empty(second) and second.notes_total == 0
    assert runs.empty(
        runs.fold(brain, approvals, ledger, case_id, since=iso(T0 + timedelta(days=9)))
    )


def test_a_stored_receipt_reads_back_whole_and_junk_is_passed_over(tmp_path: Path) -> None:
    brain, approvals, ledger, case_id = _brain(tmp_path)
    folded = runs.fold(brain, approvals, ledger, case_id, closed_by="done", closed_at=iso(T0))
    assert runs.receipt_of(asdict(folded)) == folded
    assert runs.receipt_of({"schema": 2, "case_id": case_id}) is None
    assert runs.receipt_of({"schema": 1, "case_id": "nope"}) is None
    assert runs.stored({"receipts": [asdict(folded), "junk", {"n": 1}]}) == [folded]
    assert runs.stored({"receipts": "not a list"}) == []


def test_an_appended_receipt_keeps_the_case_and_says_itself_in_words(tmp_path: Path) -> None:
    brain, approvals, ledger, case_id = _brain(tmp_path)
    path = brain.root / "goals" / f"{case_id}.md"
    before, _ = parse_case(frontmatter.parse(path.read_text(encoding="utf-8"))[1])
    receipt = runs.fold(brain, approvals, ledger, case_id, closed_by="done", closed_at=iso(T0))
    CaseBook(brain).append_receipt(case_id, receipt)
    meta, body = frontmatter.parse(path.read_text(encoding="utf-8"))
    case, extra = parse_case(body)
    assert case == before and list(meta) == ["id", "type", "title", "session", "created"]
    assert [r["closed_by"] for r in extra["receipts"]] == ["done"]
    assert "## Your runs\n\n- run closed 2026-10-01: 0 approved (0 let through)" in body

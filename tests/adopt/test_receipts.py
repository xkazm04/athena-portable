"""A case's receipts (ADR 0124): joined by the turns stamped under it (ADR 0127), kept in
the case file."""

from __future__ import annotations

from dataclasses import asdict, replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

from athena.adopt import receipts as runs
from athena.adopt.cases import CaseBook, parse_case, render_case
from athena.contracts import ids
from athena.contracts.adopt import Case
from athena.contracts.channel import iso
from athena.core.approvals import APPROVE_TOKEN, Approvals
from athena.core.brain import Brain, frontmatter
from athena.core.case_turns import CaseTurns
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
    turns = CaseTurns(brain)
    conv = "conv_invoices"
    # Run 1 is one turn on the invoices tab, stamped under the case (ADR 0127).
    one = ids.mint("turn")
    turns.record(case_id, one, conv, now=T0)
    turns.finish(one, now=T0 + timedelta(minutes=5))

    def card(n: int, amount: float, at: datetime, turn: str) -> str:
        params = {"invoice": str(n), "amount_usd": amount, "note": "x" * 300}
        row = approvals.create(
            "host.invoices.pay",
            params,
            origin="host:invoices",
            conversation=conv,
            surface="panel",
            turn_id=turn,
            now=at,
        )
        return row.id

    def note(at: datetime, session: str = conv) -> None:
        brain.append_episode(
            marked(
                f"host.invoices.pay {MAY_HAVE_COMPLETED}: ",
                origin="host:invoices",
                project_id=case_id,
            ),
            "system",
            session_id=session,
            created=at,
        )

    a = card(1, 40.0, T0, one)
    b = card(2, 99.0, T0 + timedelta(minutes=1), one)
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
        turn_id=one,
        now=T0 + timedelta(minutes=4),
    )
    # The same tab's turn under no case: its card, row and note are in no run.
    card(9, 500.0, T0 + timedelta(minutes=10), ids.mint("turn"))
    ledger.record(
        engine="claude",
        model="m",
        conversation=conv,
        origin="host:invoices",
        surface="panel",
        trigger="cli",
        cost_usd=7.0,
        turn_id=ids.mint("turn"),
        now=T0 + timedelta(minutes=10),
    )
    note(T0 + timedelta(minutes=3))  # while run 1's turn ran: its note
    note(T0 + timedelta(minutes=10))  # after it ended, in the same tab: not its
    note(T0 + timedelta(minutes=3), session="conv_crm")  # another tab: not its
    first = runs.fold(brain, approvals, ledger, turns, case_id, until=iso(T0 + timedelta(hours=1)))
    assert (first.approved, first.declined, first.asked_usd, first.asked_cards) == (1, 1, 40.0, 1)
    assert first.calls == 1 and first.cost_usd == 0.5 and first.notes_total == 1
    assert first.turns == 1 and first.conversation_id == ""
    assert first.first_at == iso(T0) and first.last_at == iso(T0 + timedelta(minutes=5))
    shown = first.cards[0]
    assert list(shown.params) == ["amount_usd", "invoice", "note"]
    assert len(shown.params["note"]) == runs.PARAM_TEXT_CAP and shown.amount_usd == 40.0

    book = CaseBook(brain)
    book.append_receipt(case_id, first)
    # The second run starts where the first stopped. Its ledger row is written before its card
    # and its card's answer could come any day: both are its turn's, so both are in it.
    two = ids.mint("turn")
    turns.record(case_id, two, "conv_crm", now=T0 + timedelta(hours=2))
    ledger.record(
        engine="claude",
        model="m",
        conversation="conv_crm",
        origin="host:crm",
        surface="panel",
        trigger="cli",
        cost_usd=0.1,
        turn_id=two,
        now=T0 + timedelta(hours=2),
    )
    card(3, 7.0, T0 + timedelta(hours=2, minutes=1), two)
    since = book.receipts(case_id)[-1].until
    second = runs.fold(brain, approvals, ledger, turns, case_id, since=since)
    assert (second.pending, second.approved, second.asked_usd, second.calls) == (1, 0, None, 1)
    assert not runs.empty(second) and second.notes_total == 0 and second.turns == 1
    # A turn that never ended claims no note written after its start.
    note(T0 + timedelta(hours=2, minutes=2), session="conv_crm")
    assert runs.fold(brain, approvals, ledger, turns, case_id, since=since).notes_total == 0
    assert second.first_at == iso(T0 + timedelta(hours=2))
    assert runs.empty(
        runs.fold(brain, approvals, ledger, turns, case_id, since=iso(T0 + timedelta(days=9)))
    )


def test_a_stored_receipt_reads_back_whole_and_junk_is_passed_over(tmp_path: Path) -> None:
    brain, approvals, ledger, case_id = _brain(tmp_path)
    turns = CaseTurns(brain)
    folded = runs.fold(
        brain, approvals, ledger, turns, case_id, closed_by="done", closed_at=iso(T0)
    )
    assert runs.receipt_of(asdict(folded)) == folded
    assert runs.receipt_of(asdict(replace(folded, turns=3))) == replace(folded, turns=3)
    # A receipt kept before ADR 0127 has no turn count and names its conv_proj_: it reads back.
    old = {k: v for k, v in asdict(folded).items() if k != "turns"}
    old["conversation_id"] = ids.conversation_for_project(case_id)
    assert runs.receipt_of(old) == replace(folded, conversation_id=old["conversation_id"])
    assert runs.receipt_of({"schema": 2, "case_id": case_id}) is None
    assert runs.receipt_of({"schema": 1, "case_id": "nope"}) is None
    assert runs.stored({"receipts": [asdict(folded), "junk", {"n": 1}]}) == [folded]
    assert runs.stored({"receipts": "not a list"}) == []


def test_an_appended_receipt_keeps_the_case_and_says_itself_in_words(tmp_path: Path) -> None:
    brain, approvals, ledger, case_id = _brain(tmp_path)
    path = brain.root / "goals" / f"{case_id}.md"
    before, _ = parse_case(frontmatter.parse(path.read_text(encoding="utf-8"))[1])
    receipt = runs.fold(
        brain, approvals, ledger, CaseTurns(brain), case_id, closed_by="done", closed_at=iso(T0)
    )
    CaseBook(brain).append_receipt(case_id, receipt)
    meta, body = frontmatter.parse(path.read_text(encoding="utf-8"))
    case, extra = parse_case(body)
    assert case == before and list(meta) == ["id", "type", "title", "session", "created"]
    assert [r["closed_by"] for r in extra["receipts"]] == ["done"]
    assert "## Your runs\n\n- run closed 2026-10-01: 0 approved (0 let through)" in body


# --- the next run's frame (ADR 0126) ------------------------------------------------------------


def _local_day(at: datetime) -> str:
    local = at.astimezone()
    return f"{local.strftime('%b')} {local.day}"


def test_the_carry_forward_puts_what_is_not_known_first_and_names_keys_and_dates() -> None:
    noon = datetime(2026, 10, 2, 12, 0, tzinfo=UTC)

    def card(status: str, n: int, *, consumed: bool = False) -> runs.ReceiptCard:
        return runs.ReceiptCard(
            id=f"apr_{n:012x}",
            action="host.invoices.pay",
            status=status,
            consumed=consumed,
            created_at=iso(noon),
            resolved_at=iso(noon) if status in ("approved", "declined") else "",
            params={"amount_usd": "120", "invoice": str(n), "memo": "m", "payee": "p"},
            more_params=2,
        )

    receipt = runs.Receipt(
        case_id=ids.mint("project"),
        conversation_id="conv_x",
        since="",
        until=iso(noon + timedelta(days=1)),
        first_at=iso(noon),
        last_at=iso(noon),
        cards=(
            card("approved", 1, consumed=True),
            card("declined", 2),
            card("expired", 3),
            card("pending", 4),
            card("approved", 5),
        ),
        cards_total=7,
        notes=(runs.ReceiptNote(episode_id="ep_1", at=iso(noon), text="pay 9 may have completed"),),
        notes_total=1,
    )
    carried = runs.carry_forward(receipt)
    day = _local_day(noon)
    assert carried.started == iso(noon), "a first run starts at its first activity"
    assert carried.total == 8, "every card and note the receipt counted, not the ones it kept"
    assert carried.window == f"{day} to {_local_day(noon + timedelta(days=1))}"
    kinds = [line.split(":", 1)[0] for line in carried.lines]
    assert kinds == [
        f"expired unanswered (filed {day})",
        f"still waiting when the run closed (filed {day})",
        f"may have completed ({day})",
        f"approved {day}",
        f"approved {day}, not let through",
        f"declined {day}",
    ]
    assert carried.lines[3] == (
        f"approved {day}: host.invoices.pay amount_usd=120, invoice=1, memo=m (+3 more)"
    )
    assert not any("skip" in line.lower() for line in carried.lines)

    later = runs.carry_forward(
        runs.Receipt(case_id=receipt.case_id, conversation_id="c", since="x")
    )
    assert later.started == "x" and later.lines == () and later.total == 0


def test_a_case_with_no_receipt_has_no_last_run_and_one_with_receipts_has_the_latest(
    tmp_path: Path,
) -> None:
    brain, _, _, case_id = _brain(tmp_path)
    book = CaseBook(brain)
    assert book.last_run(case_id) is None
    assert book.last_run(ids.mint("project")) is None
    first = runs.Receipt(case_id=case_id, conversation_id="c", since="", first_at=iso(T0))
    second = runs.Receipt(
        case_id=case_id, conversation_id="c", since=iso(T0 + timedelta(days=30)), first_at=""
    )
    book.append_receipt(case_id, first)
    book.append_receipt(case_id, second)
    last = book.last_run(case_id)
    assert last is not None and last.started == iso(T0 + timedelta(days=30))

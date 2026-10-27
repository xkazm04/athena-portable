"""ADR 0233: the case file keeps the latest receipts; older ones move, whole, to the runs file."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

from athena.adopt import receipts as runs
from athena.adopt.cases import CaseBook, parse_case, render_case
from athena.contracts import ids
from athena.contracts.adopt import Case, Receipt
from athena.contracts.channel import iso
from athena.core.brain import Brain, frontmatter

T0 = datetime(2026, 1, 5, 9, 0, tzinfo=UTC)
KEPT = runs.KEPT_RECEIPTS


def _case(tmp_path: Path, extra: dict[str, object] | None = None) -> tuple[Brain, str]:
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
        render_case(case, extra),
        session_id=ids.conversation_for_project(case_id),
        created=iso(T0),
    )
    return brain, case_id


def _receipt(case_id: str, n: int) -> Receipt:
    day = iso(T0 + timedelta(days=7 * n))
    return Receipt(
        case_id=case_id,
        conversation_id="",
        since=iso(T0 + timedelta(days=7 * (n - 1))),
        until=day,
        approved=n,
        closed_by="done",
        closed_at=day,
    )


def _block(brain: Brain, case_id: str) -> tuple[Case, dict[str, object]]:
    path = brain.root / "goals" / f"{case_id}.md"
    return parse_case(frontmatter.parse(path.read_text(encoding="utf-8"))[1])


def _archived(brain: Brain, case_id: str) -> list[Receipt]:
    path = brain.root / "goals" / f"{case_id}.runs.txt"
    lines = path.read_text(encoding="utf-8").splitlines() if path.is_file() else []
    prefix = "athena:receipt "
    rows = [json.loads(x[len(prefix) :]) for x in lines if x.startswith(prefix)]
    return [r for x in rows if (r := runs.receipt_of(x)) is not None]


def test_the_cap_is_what_the_runs_route_always_answered() -> None:
    assert KEPT == 20


def test_a_year_of_weekly_dones_keeps_the_latest_and_moves_every_older_one(tmp_path: Path) -> None:
    brain, case_id = _case(tmp_path)
    book = CaseBook(brain)
    made = [_receipt(case_id, n) for n in range(1, 53)]
    for receipt in made:
        book.append_receipt(case_id, receipt)
    case, extra = _block(brain, case_id)
    assert case.id == case_id
    kept = runs.stored(extra)
    assert kept == made[-KEPT:]
    assert book.receipts(case_id) == made[-KEPT:]
    # Nothing was dropped: the moved ones are the older ones, oldest first, once each.
    assert _archived(brain, case_id) == made[:-KEPT]
    assert _archived(brain, case_id) + kept == made
    assert book.receipt_total(case_id) == 52 and extra["runs_archived"] == 52 - KEPT
    # The file a person reads says what it shows and where the rest went.
    body = (brain.root / "goals" / f"{case_id}.md").read_text(encoding="utf-8")
    assert f"(showing {KEPT} of 52" in body and f"{case_id}.runs.txt" in body
    assert body.count("- run closed") == KEPT


def test_the_block_stays_bounded_while_the_history_grows(tmp_path: Path) -> None:
    brain, case_id = _case(tmp_path)
    book = CaseBook(brain)
    sizes: list[int] = []
    for n in range(1, 61):
        book.append_receipt(case_id, _receipt(case_id, n))
        sizes.append((brain.root / "goals" / f"{case_id}.md").stat().st_size)
    assert sizes[-1] <= sizes[KEPT + 2] * 1.15  # flat once the cap is reached


def test_a_case_written_before_the_cap_still_reads_and_is_trimmed_by_its_next_done(
    tmp_path: Path,
) -> None:
    old_case = "proj_000000000000"
    old = [runs.as_dict(_receipt(old_case, n)) for n in range(1, 26)]  # 25, no cap then
    brain, case_id = _case(tmp_path, {"receipts": old})
    book = CaseBook(brain)
    assert len(book.receipts(case_id)) == 25  # reads whole, as it always did
    assert book.receipt_total(case_id) == 25
    book.append_receipt(case_id, _receipt(case_id, 26))
    kept = book.receipts(case_id)
    assert len(kept) == KEPT and kept[-1].approved == 26
    moved = _archived(brain, case_id)
    assert [r.approved for r in moved] == list(range(1, 7))
    assert [r.approved for r in [*moved, *kept]] == list(range(1, 27))


def test_an_entry_the_reader_cannot_parse_is_moved_not_dropped(tmp_path: Path) -> None:
    junk = {"n": 1}
    good = [runs.as_dict(_receipt("proj_000000000000", n)) for n in range(1, KEPT + 1)]
    brain, case_id = _case(tmp_path, {"receipts": [junk, *good]})
    CaseBook(brain).append_receipt(case_id, _receipt(case_id, 99))
    text = (brain.root / "goals" / f"{case_id}.runs.txt").read_text(encoding="utf-8")
    assert json.dumps(junk, separators=(",", ":")) in text


def test_a_move_that_crashed_after_the_archive_is_not_archived_twice(tmp_path: Path) -> None:
    brain, case_id = _case(tmp_path)
    book = CaseBook(brain)
    made = [_receipt(case_id, n) for n in range(1, KEPT + 2)]
    for receipt in made:
        book.append_receipt(case_id, receipt)
    # The archive got the oldest, then the process died before the case file lost it: put the
    # block back as it was before that rewrite and replay the same done.
    _, extra = _block(brain, case_id)
    case, _ = _block(brain, case_id)
    replay = {k: v for k, v in extra.items() if k != "runs_archived"}
    replay["receipts"] = [runs.as_dict(r) for r in made[:KEPT]]
    brain.write_goal(
        case_id,
        "Demo",
        render_case(case, replay),
        session_id=ids.conversation_for_project(case_id),
        created=case.created,
    )
    book.append_receipt(case_id, made[KEPT])
    assert _archived(brain, case_id) == made[:1]
    assert book.receipt_total(case_id) == KEPT + 1


def test_the_runs_file_is_not_a_markdown_goal_a_rebuild_would_walk(tmp_path: Path) -> None:
    brain, case_id = _case(tmp_path)
    book = CaseBook(brain)
    for n in range(1, KEPT + 3):
        book.append_receipt(case_id, _receipt(case_id, n))
    assert not list((brain.root / "goals").glob("*.runs.md"))
    assert [p.name for p in (brain.root / "goals").rglob("*.md")] == [f"{case_id}.md"]

"""A case's turns are stamped under it (ADR 0127): ``core/case_turns.py``."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from athena.contracts import ids
from athena.contracts.channel import iso
from athena.core.brain import Brain, reconcile_from_disk
from athena.core.brain.schema import INDEX_TABLES
from athena.core.case_turns import CaseTurnError, CaseTurns

T0 = datetime(2026, 10, 1, 9, 0, tzinfo=UTC)


@pytest.fixture
def brain(tmp_path: Path) -> Brain:
    return Brain(tmp_path / "brain")


def test_a_turn_is_stamped_once_and_a_run_is_the_turns_that_began_in_it(brain: Brain) -> None:
    turns = CaseTurns(brain)
    CaseTurns(brain)  # a second open adds nothing twice
    case, other = ids.mint("project"), ids.mint("project")
    first, second, third = ids.mint("turn"), ids.mint("turn"), ids.mint("turn")
    turns.record(case, first, "conv_invoices", now=T0)
    turns.record(case, second, "conv_crm", now=T0 + timedelta(hours=1))
    turns.record(other, third, "conv_invoices", now=T0)
    # A turn is a run of one case: a second stamp keeps the first.
    turns.record(other, first, "conv_crm", now=T0 + timedelta(days=1))
    turns.finish(first, now=T0 + timedelta(seconds=30))
    turns.finish(first, now=T0 + timedelta(days=2))

    every = turns.of_case(case)
    assert [(t.turn_id, t.conversation) for t in every] == [
        (first, "conv_invoices"),
        (second, "conv_crm"),
    ]
    assert every[0].ended_at == iso(T0 + timedelta(seconds=30)) and every[1].ended_at == ""
    later = turns.of_case(case, since=iso(T0 + timedelta(minutes=1)))
    assert [t.turn_id for t in later] == [second]
    before = turns.of_case(case, until=iso(T0 + timedelta(minutes=1)))
    assert [t.turn_id for t in before] == [first]
    assert turns.case_of(first) == case and turns.case_of(ids.mint("turn")) is None


def test_only_minted_ids_are_stamped(brain: Brain) -> None:
    turns = CaseTurns(brain)
    with pytest.raises(CaseTurnError, match="case id"):
        turns.record("conv_x", ids.mint("turn"), "conv_x")
    with pytest.raises(CaseTurnError, match="turn id"):
        turns.record(ids.mint("project"), "t1", "conv_x")
    with pytest.raises(CaseTurnError, match="conversation id"):
        turns.record(ids.mint("project"), ids.mint("turn"), "x")


def test_the_stamps_are_runtime_state_a_reconcile_leaves_alone(brain: Brain) -> None:
    assert "companion_case_turn" not in INDEX_TABLES
    turns = CaseTurns(brain)
    case, turn = ids.mint("project"), ids.mint("turn")
    turns.record(case, turn, "conv_invoices", now=T0)
    reconcile_from_disk(brain)
    assert [t.turn_id for t in CaseTurns(brain).of_case(case)] == [turn]

"""Cost is visible or it is not controlled (README §2 invariant 6).

The properties under test are the ones a ledger is usually wrong about: a failed turn that leaves
no row, an error reason invented at a call site, a bounded view that does not say it is bounded,
and a rollup that quietly drops the rows it could not parse.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from athena.contracts import ids
from athena.contracts.harness import ERROR_REASONS
from athena.core.brain import Brain
from athena.core.brain.reconcile import reconcile_from_disk
from athena.core.ledger import Ledger, LedgerError, LedgerRow

CONVERSATION = ids.conversation_for_app("invoices")


@pytest.fixture
def ledger(tmp_path: Path) -> Ledger:
    return Ledger(Brain(tmp_path / "brain"))


def _record(ledger: Ledger, **overrides: Any) -> LedgerRow:
    """One invocation, with the defaults a test that is about something else would repeat."""
    kwargs: dict[str, Any] = {
        "engine": "claude",
        "model": "claude-opus-5",
        "conversation": CONVERSATION,
        "origin": "host:invoices",
        "surface": "panel",
        "trigger": "chat",
    }
    kwargs.update(overrides)
    return ledger.record(**kwargs)


# -- one row per invocation --------------------------------------------------------------------


def test_a_turn_writes_one_row_that_says_what_it_cost(ledger: Ledger) -> None:
    turn_id = ids.mint("job")
    row = _record(
        ledger,
        rounds=8,
        input_tokens=12_000,
        output_tokens=900,
        cost_usd=0.42,
        ms=6100,
        turn_id=turn_id,
    )

    page = ledger.recent()

    assert page.total == 1
    assert page.rows[0] == row
    assert row.rounds == 8
    assert row.turn_id == turn_id
    assert row.error_reason is None
    assert row.to_summary().rounds == 8


def test_a_failed_turn_writes_exactly_one_error_row(ledger: Ledger) -> None:
    _record(ledger, is_error=True, error_reason="user_denied", rounds=2, ms=300)

    page = ledger.recent()

    assert page.total == 1
    assert page.rows[0].is_error
    assert page.rows[0].error_reason == "user_denied"


def test_eight_rounds_are_one_row_and_not_eight(ledger: Ledger) -> None:
    _record(ledger, rounds=8)

    assert ledger.recent().total == 1
    assert ledger.rollup(by="model")[0].rounds == 8


# -- the reason vocabulary is closed -----------------------------------------------------------


def test_an_unknown_error_reason_normalises_to_unknown(ledger: Ledger) -> None:
    row = _record(ledger, is_error=True, error_reason="the model exploded")

    assert row.error_reason == "unknown"
    assert ledger.recent().rows[0].error_reason == "unknown"


def test_an_error_with_no_reason_is_unknown_rather_than_null(ledger: Ledger) -> None:
    assert _record(ledger, is_error=True).error_reason == "unknown"


def test_a_successful_row_carries_no_reason_whatever_was_passed(ledger: Ledger) -> None:
    assert _record(ledger, error_reason="timeout").error_reason is None


@pytest.mark.parametrize("reason", ERROR_REASONS)
def test_every_member_of_the_closed_set_survives(ledger: Ledger, reason: str) -> None:
    assert _record(ledger, is_error=True, error_reason=reason.upper()).error_reason == reason


# -- a row the ledger will not write -----------------------------------------------------------


@pytest.mark.parametrize(
    ("field", "value"),
    [("engine", ""), ("origin", "invoices"), ("surface", ""), ("rounds", -1)],
)
def test_a_row_that_could_not_be_read_back_is_refused(
    ledger: Ledger, field: str, value: Any
) -> None:
    with pytest.raises(LedgerError):
        _record(ledger, **{field: value})


def test_a_refusal_nobody_asked_a_model_about_is_a_row_of_zero_rounds(ledger: Ledger) -> None:
    """The browser lane's decision row: a card the user declined, and no invocation behind it.

    Act 4 of the demo reads these back, so the row has to exist; the honest number of model
    rounds behind it is none, and writing ``1`` would inflate every rollup by an invocation that
    never happened.
    """
    row = ledger.record(
        engine="lane",
        model="",
        conversation="conv_invoices",
        origin="host:invoices",
        surface="panel",
        trigger="decision",
        rounds=0,
        is_error=True,
        error_reason="user_denied",
    )

    assert (row.rounds, row.error_reason) == (0, "user_denied")
    assert ledger.recent(5).rows[0].rounds == 0
    assert ledger.rollup(by="origin")[0].rounds == 0


# -- bounded and announced ---------------------------------------------------------------------


def test_recent_announces_showing_n_of_m_honestly(ledger: Ledger) -> None:
    for index in range(7):
        _record(ledger, model=f"model-{index}")

    page = ledger.recent(limit=3)

    assert page.shown == 3
    assert page.total == 7
    assert page.footer() == "(showing 3 of 7)"
    assert [row.model for row in page.rows] == ["model-6", "model-5", "model-4"]


def test_a_whole_ledger_announces_nothing(ledger: Ledger) -> None:
    _record(ledger)

    page = ledger.recent(limit=20)

    assert page.shown == page.total == 1
    assert page.footer() == ""
    assert not page.truncated


# -- the rollup ---------------------------------------------------------------------------------


def test_rollup_sums_per_key(ledger: Ledger) -> None:
    _record(ledger, model="opus", cost_usd=0.10, input_tokens=100, output_tokens=10, ms=1000)
    _record(ledger, model="opus", cost_usd=0.20, input_tokens=200, output_tokens=20, ms=2000)
    _record(
        ledger,
        model="haiku",
        cost_usd=0.01,
        input_tokens=50,
        output_tokens=5,
        ms=100,
        is_error=True,
        error_reason="timeout",
    )

    by_model = {row.key: row for row in ledger.rollup(by="model")}

    assert by_model["opus"].turns == 2
    assert by_model["opus"].cost_usd == pytest.approx(0.30)
    assert by_model["opus"].input_tokens == 300
    assert by_model["opus"].output_tokens == 30
    assert by_model["opus"].ms == 3000
    assert by_model["opus"].errors == 0
    assert by_model["haiku"].turns == 1
    assert by_model["haiku"].errors == 1


def test_rollup_is_dearest_first(ledger: Ledger) -> None:
    _record(ledger, model="haiku", cost_usd=0.01)
    _record(ledger, model="opus", cost_usd=0.30)

    assert [row.key for row in ledger.rollup(by="model")] == ["opus", "haiku"]


@pytest.mark.parametrize(
    ("dimension", "field", "value"),
    [
        ("engine", "engine", "codex"),
        ("model", "model", "gpt-5"),
        ("conversation", "conversation", ids.conversation_for_app("inbox")),
        ("origin", "origin", "connector:gmail"),
        ("surface", "surface", "voice"),
    ],
)
def test_every_dimension_groups_on_its_own_column(
    ledger: Ledger, dimension: str, field: str, value: str
) -> None:
    _record(ledger, cost_usd=0.10)
    _record(ledger, cost_usd=0.20, **{field: value})
    _record(ledger, cost_usd=0.05, **{field: value})

    rows = {row.key: row for row in ledger.rollup(by=dimension)}

    assert len(rows) == 2
    assert rows[value].turns == 2
    assert rows[value].cost_usd == pytest.approx(0.25)


def test_a_dimension_the_ledger_does_not_have_is_refused(ledger: Ledger) -> None:
    with pytest.raises(LedgerError, match="rollup dimension"):
        ledger.rollup(by="conversation_id; DROP TABLE companion_turn")


# -- the ledger is not an index ------------------------------------------------------------------


def test_a_reconcile_rebuilds_the_index_and_keeps_the_ledger(tmp_path: Path) -> None:
    """ADR 0005: disk cannot rebuild what a turn cost, so the ledger is not an ``INDEX_TABLE``."""
    with Brain(tmp_path / "brain") as brain:
        ledger = Ledger(brain)
        brain.append_episode("what did last night cost", role="user")
        _record(ledger, cost_usd=0.42)

        reconcile_from_disk(brain)

        assert ledger.recent().total == 1
        assert ledger.rollup(by="engine")[0].cost_usd == pytest.approx(0.42)

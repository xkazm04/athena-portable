"""The closed reason vocabulary and the prompt block that announces what it left out.

contracts/harness.py, README §2 invariants 4 and 6.
"""

from __future__ import annotations

import pytest

from athena.contracts import ERROR_REASONS, PromptBlock, TurnResult, fnv1a_64, normalize_reason

REQUIRED = (
    "user_denied",
    "expired",
    "foreign_origin",
    "foreign_token",
    "unknown_ref",
    "validator_failed",
    "budget_exhausted",
    "engine_error",
    "timeout",
    "pending_approval",
    "unknown",
)


def test_the_closed_set_contains_every_reason_the_design_names() -> None:
    assert set(REQUIRED) <= set(ERROR_REASONS)
    assert len(set(ERROR_REASONS)) == len(ERROR_REASONS)


def test_normalize_reason_maps_anything_else_to_unknown() -> None:
    assert normalize_reason("weird") == "unknown"
    assert normalize_reason("") == "unknown"
    assert normalize_reason("user denied") == "unknown"


@pytest.mark.parametrize("reason", ERROR_REASONS)
def test_every_member_survives_normalization(reason: str) -> None:
    assert normalize_reason(reason) == reason
    assert normalize_reason(f"  {reason.upper()} ") == reason


def test_none_is_the_successful_row_and_stays_none() -> None:
    assert normalize_reason(None) is None


def test_a_turn_result_normalizes_its_reason_on_the_way_in() -> None:
    assert TurnResult(turn_id="t1", is_error=True, error_reason="Weird").error_reason == "unknown"
    assert TurnResult(turn_id="t1").error_reason is None
    assert TurnResult(turn_id="t1", error_reason="timeout").error_reason == "timeout"


# --- prompt blocks --------------------------------------------------------------------------


def test_from_items_announces_showing_n_of_m_exactly_when_truncated() -> None:
    truncated = PromptBlock.from_items("recall", [f"fact {i}" for i in range(7)], 2)
    assert truncated.truncated
    assert truncated.footer() == "(showing 2 of 7)"
    assert truncated.announces_truncation()
    assert truncated.text.endswith("(showing 2 of 7)")

    whole = PromptBlock.from_items("recall", ["fact 0"], 20)
    assert not whole.truncated
    assert whole.footer() == ""
    assert "showing" not in whole.text


def test_a_block_that_forgot_its_footer_is_flagged_and_can_be_repaired() -> None:
    silent = PromptBlock(name="recall", text="fact 0", shown=1, total=9)
    assert not silent.announces_truncation()

    repaired = silent.announced()
    assert repaired.announces_truncation()
    assert repaired.text == "fact 0\n(showing 1 of 9)"
    assert silent.text == "fact 0", "announced() returns a new block; blocks are frozen"


def test_announced_is_a_no_op_on_a_block_that_is_already_honest() -> None:
    block = PromptBlock.from_items("recall", ["a", "b", "c"], 1)
    assert block.announced() is block


def test_a_block_hash_is_stable_for_identical_content() -> None:
    first = PromptBlock(name="law", text="the constitution")
    second = PromptBlock(name="law", text="the constitution")
    assert first.hash == second.hash == fnv1a_64("the constitution")
    assert first.hash != PromptBlock(name="law", text="the constitution.").hash
    assert first.size == len("the constitution")


def test_untrusted_is_carried_through_a_repair() -> None:
    block = PromptBlock(name="host_state", text="x", shown=1, total=2, untrusted=True)
    assert block.announced().untrusted

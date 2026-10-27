"""The leg estimate is derived from the adopt loop: a scripted conversation of N cards is run and
the legs it asked for are counted against ``interview_legs``."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from athena.adopt.prompts import MAX_ROUNDS
from athena.proving.adopt_tiers.scenarios import SCENARIOS_DIR, load_scenario
from athena.proving.adopt_tiers.simulate import interview_legs, run_interview
from athena.proving.chores_uat.run import legs_per_pair

from .conftest import LEASE_CARD, LEASE_CLEAR, LEASE_DERIVE, FakeModel, make_rig

LEASE = load_scenario(SCENARIOS_DIR / "easy-lease-end.json")


def _open_script(cards: int) -> dict[str, list[Any]]:
    """A conversation that asks ``cards`` cards, then clears (or hits the round cap)."""
    keep_open = {"updates": [], "open_slot_ids": ["p1", "p2"]}
    persona = [
        {
            "answers": [
                {"question_id": f"r{n}q1", "choice_ids": [], "text": "Gmail."},
                {"question_id": f"r{n}q2", "choice_ids": [], "text": "Yes."},
            ]
        }
        for n in range(1, cards + 1)
    ]
    return {
        "interview": [LEASE_CARD] * cards + [{"questions": []}],
        "audit": [LEASE_DERIVE] + [keep_open] * (cards - 1) + [LEASE_CLEAR],
        "brief": [{"lead": "I'll dispute what the lease does not support.", "claim": ["x"]}],
        "persona": persona,
    }


@pytest.mark.parametrize("cards", [1, 3, MAX_ROUNDS])
def test_interview_legs_match_the_legs_the_loop_asks_for(tmp_path: Path, cards: int) -> None:
    model = FakeModel(_open_script(cards))
    record = run_interview(make_rig(tmp_path, model), LEASE, "haiku-low", 1)
    assert record["cards"] == cards, record["failure"]
    asked = sum(1 for c in model.calls if c.kind in ("interview", "audit", "persona", "brief"))
    assert asked == interview_legs(cards)
    # The chores bench restates the same loop, plus a rehearsal shape leg and a judge.
    assert legs_per_pair(cards, rehearse=False) == interview_legs(cards) + 1

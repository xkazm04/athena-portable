"""The judge's voice check enforces the bound the prompt states: 80-200 words."""

from __future__ import annotations

import pytest

from athena.proving.chores_uat.judge import JUDGE_SYSTEM, VOICE_WORDS, check_judge


def _answer(words: int) -> dict[str, object]:
    return {
        "criteria": [{"n": 1, "pass": True, "why": "ok"}],
        "voice": " ".join(["word"] * words),
        "understood": "It did the chore.",
        "findings": [],
    }


def test_the_enforced_bound_is_the_one_the_prompt_states() -> None:
    assert VOICE_WORDS == (80, 200)
    assert "80-200 words" in JUDGE_SYSTEM


@pytest.mark.parametrize("words", [60, 70, 79, 201, 260])
def test_a_voice_outside_80_to_200_is_sent_back(words: int) -> None:
    note = check_judge(["c"], 1)(_answer(words))
    assert note == f"voice must be 80-200 words; it has {words}"


@pytest.mark.parametrize("words", [80, 100, 200])
def test_a_voice_inside_80_to_200_is_not_refused_for_length(words: int) -> None:
    assert "voice must be" not in check_judge(["c"], 1)(_answer(words))

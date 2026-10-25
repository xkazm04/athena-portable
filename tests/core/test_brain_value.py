"""The value model both distilled recall lanes rank by: pure, argued, and bounded on every axis."""

from __future__ import annotations

import ast
import inspect
import math

import pytest

from athena.core.brain import value
from athena.core.brain.store import DEFAULT_CONFIDENCE


def test_score_is_pure_takes_no_clock_and_reads_a_missing_confidence_as_the_default() -> None:
    args = {"match": 1.0, "confidence": 0.8, "steps": 1, "hits": 3}
    assert value.score(**args) == value.score(**args)
    assert value.DEFAULT_CONFIDENCE == DEFAULT_CONFIDENCE == 0.7

    # No clock: no parameter names one, and the module imports nothing that tells the time.
    names = set(inspect.signature(value.score).parameters)
    assert not names & {"now", "at", "clock", "when", "today"}
    tree = ast.parse(inspect.getsource(value))
    imported = {
        alias.name.split(".")[0]
        for node in ast.walk(tree)
        if isinstance(node, ast.Import | ast.ImportFrom)
        for alias in node.names
    } | {
        str(node.module).split(".")[0]
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.module
    }
    assert not imported & {"time", "datetime"}

    # Unknown confidence is the stated default, never zero.
    unknown = value.score(match=1.0, confidence=None, steps=0, hits=0)
    assert unknown == value.score(match=1.0, confidence=DEFAULT_CONFIDENCE, steps=0, hits=0)
    assert unknown > 0
    assert value.score(match=1.0, confidence=math.nan) == unknown


def test_the_usage_term_is_sub_linear_bounded_and_never_overturns_confidence() -> None:
    base = value.score(match=1.0, confidence=0.7, steps=0, hits=0)
    heavy = value.score(match=1.0, confidence=0.7, steps=0, hits=1000)
    assert heavy / base <= 1.5
    # Sub-linear: the second ten hits add less than the first ten.
    ten = value.score(match=1.0, confidence=0.7, hits=10)
    twenty = value.score(match=1.0, confidence=0.7, hits=20)
    assert twenty - ten < ten - base
    assert value.score(match=1.0, confidence=0.3, hits=10**9) < value.score(
        match=1.0, confidence=0.9, hits=0
    )


def test_one_fade_step_costs_less_than_a_bare_match_and_two_cost_more() -> None:
    """The argued crossover: a best match faded once still beats an unfaded bare match; twice
    faded, it does not. This is what keeps ADR 0143's 'a fade never hides' and its 'a faded memory
    ranks lower' both true."""
    bare = value.score(match=value.match_strength(-1e-6, -5.0), confidence=0.7)
    once = value.score(match=1.0, confidence=0.7, steps=1, kind="fact")
    twice = value.score(match=1.0, confidence=0.7, steps=2, kind="fact")
    assert twice < bare < once


@pytest.mark.parametrize(
    ("bm25", "best", "expected"),
    [(-5.0, -5.0, 1.0), (0.0, 0.0, 1.0), (-2.5, -5.0, None)],
)
def test_match_strength_is_relative_to_the_pages_best(
    bm25: float, best: float, expected: float | None
) -> None:
    strength = value.match_strength(bm25, best)
    assert value.MATCH_FLOOR <= strength <= 1.0
    if expected is not None:
        assert strength == expected
    else:
        assert value.MATCH_FLOOR < strength < 1.0


def test_every_axis_is_clamped_so_a_bad_row_cannot_dominate() -> None:
    top = value.score(match=1.0, confidence=1.0, steps=0, hits=0)
    assert value.score(match=7.0, confidence=4.0, steps=-3, hits=-5) == top
    assert value.score(match=-1.0, confidence=-1.0) >= 0.0

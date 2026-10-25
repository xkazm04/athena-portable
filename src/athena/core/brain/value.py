"""What a distilled memory is worth to a recall: one pure score over its own stored properties.

Both distilled recall lanes rank through :func:`score` (ADR 0143 decision 7, amended), so the
claim "a fade ranks a memory and never hides it" lives in this one reviewable table instead of a
SQL literal. Four axes, multiplied, each clamped so no bad row can dominate:

- **match** - how well the memory answers the query, in ``[MATCH_FLOOR, 1]``. The keyword lane
  derives it from BM25 relative to the best row of its candidate page (:func:`match_strength`);
  the always tier is query-independent and passes ``1.0``.
- **confidence** - the 0-1 trust the writer stored (the sleep cycle writes the model's, a person's
  ``forget`` marker 1.0). Unknown is :data:`DEFAULT_CONFIDENCE`, never zero: "nobody said" is
  not "nobody believes it".
- **decay** - fade steps (``companion_fade``, 0..3) as a half-life per kind
  (:data:`HALF_LIFE_STEPS`). A fact halves each step.
- **usage** - proven usefulness (``companion_recall_seen.hits``) as a sub-linear, bounded bonus of
  at most :data:`USAGE_MAX_BONUS`, so a popular memory cannot overturn a confidence gap.

**The crossover that is argued, not tuned.** :data:`MATCH_FLOOR` sits between one and two fact
half-lives (0.25 < 0.4 < 0.5): the best match of a page faded one step still outranks an unfaded
memory that shares only a word with the query, so a strongly matching memory is never pushed out
of the lane by fade alone; faded two steps it ranks below, so a fade still means something.

Importance is not an axis. It decides the population - served at all (``> 0``) and every turn
(``>= ALWAYS_IMPORTANCE``) - and ranking by it too was what let six weak matches bury an exact one.

Pure: no clock, no I/O. The read path owns the model and the sleep cycle's forgetting may adopt it;
the janitor imports the read path's model, never the reverse.
"""

from __future__ import annotations

import math

from athena.core.brain.store import DEFAULT_CONFIDENCE

__all__ = [
    "CANDIDATE_FACTOR",
    "DEFAULT_CONFIDENCE",
    "DEFAULT_HALF_LIFE_STEPS",
    "HALF_LIFE_STEPS",
    "MATCH_FLOOR",
    "USAGE_MAX_BONUS",
    "USAGE_PIVOT_HITS",
    "decay",
    "match_strength",
    "score",
    "usage",
]

#: What any match is worth, as a share of the page's best. Between one and two fact half-lives,
#: so one fade step of the best match beats a bare match and two do not (see the module doc).
MATCH_FLOOR = 0.4
#: Fade steps to halve a memory's value, per kind. A procedural is a rule that fires on situations
#: rarer than the questions a fact answers, so a quiet month says less about it: it halves every
#: two steps. Anything else uses :data:`DEFAULT_HALF_LIFE_STEPS`.
HALF_LIFE_STEPS: dict[str, float] = {"fact": 1.0, "procedural": 2.0}
DEFAULT_HALF_LIFE_STEPS = 1.0
#: The most proven use can add, as a share of the value (``1 + bonus`` at the limit).
USAGE_MAX_BONUS = 0.25
#: The hit count that earns half of :data:`USAGE_MAX_BONUS`.
USAGE_PIVOT_HITS = 10
#: A lane re-ranks a candidate page of ``slots * CANDIDATE_FACTOR`` rows, never every match.
CANDIDATE_FACTOR = 8

_PIVOT = math.log1p(USAGE_PIVOT_HITS)


def _clamp(x: float, low: float, high: float) -> float:
    return min(high, max(low, x))


def match_strength(bm25: float, best: float) -> float:
    """BM25 (lower is better, as FTS5 gives it) relative to the page's best, in ``[floor, 1]``.

    A page whose best is zero has no spread to measure, so every row is a full match.
    """
    if not math.isfinite(bm25) or not math.isfinite(best) or best >= 0.0:
        return 1.0
    ratio = _clamp(bm25 / best, 0.0, 1.0)
    return MATCH_FLOOR + (1.0 - MATCH_FLOOR) * ratio


def decay(steps: int, kind: str = "") -> float:
    """``0.5 ** (steps / half_life)`` for this kind; a negative step count is no fade."""
    half_life = HALF_LIFE_STEPS.get(kind, DEFAULT_HALF_LIFE_STEPS)
    return float(0.5 ** (max(0, int(steps)) / half_life))


def usage(hits: int) -> float:
    """``1 + USAGE_MAX_BONUS * log1p(h) / (log1p(h) + log1p(pivot))``: sub-linear and bounded."""
    used = math.log1p(max(0, int(hits)))
    return 1.0 + USAGE_MAX_BONUS * used / (used + _PIVOT)


def score(
    match: float = 1.0,
    confidence: float | None = None,
    steps: int = 0,
    hits: int = 0,
    kind: str = "",
) -> float:
    """The value of one distilled memory to one recall. Pure: same arguments, same float."""
    trust = (
        DEFAULT_CONFIDENCE
        if confidence is None or not math.isfinite(confidence)
        else _clamp(confidence, 0.0, 1.0)
    )
    fit = 1.0 if not math.isfinite(match) else _clamp(match, 0.0, 1.0)
    return fit * trust * decay(steps, kind) * usage(hits)

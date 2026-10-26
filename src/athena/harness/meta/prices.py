"""Meta's list prices as one table and one function (spike 00 piece 5; ADR 0122).

Every figure is Meta's published price on 2026-10-24 (``meta-model-facts.md`` "Prices") - **press,
not measured**: a call priced here is still ``cost_estimated=True`` on its ledger row, and a model
or unit missing from the table prices as ``None`` (unpriced weighs against the cap; it is never 0).

Units, one request at a time:

=====================  ============================================================
``input_token``        a prompt token not served from the cache
``cached_input_token`` a prompt token served from the cache
``output_token``       a generated token (reasoning included)
``search_query``       one web-search grounding query (Spark, Wonder)
``image``              one generated image (Muse Image) or one still segmented (SAM)
``frame``              one video frame segmented by SAM; **one call is one video request**, so
                       fewer than 50 frames bill as 50
``audio_s``            seconds of audio transcribed, **billed in whole seconds** (rounded up)
=====================  ============================================================
"""

from __future__ import annotations

import math
from collections.abc import Mapping

from athena.harness.meta.config import (
    IMAGE_MODEL,
    SAM_MODEL,
    SPARK_11_MODEL,
    SPARK_12_CONTRIBUTOR_MODEL,
    SPARK_AUDIO_MODEL,
    SPARK_CONTRIBUTOR_MODEL,
    SPARK_MODEL,
    VOICE_MODEL,
    WONDER_MODEL,
)

__all__ = ["PRICES", "SAM_MIN_VIDEO_FRAMES", "UNITS", "cost_of", "token_cost"]

UNITS: tuple[str, ...] = (
    "input_token",
    "cached_input_token",
    "output_token",
    "search_query",
    "image",
    "frame",
    "audio_s",
)

#: SAM 3.1 bills at least this many frames per video request.
SAM_MIN_VIDEO_FRAMES = 50

_M = 1_000_000
_SEARCH = 2.50 / 1_000

_SPARK: Mapping[str, float] = {
    "input_token": 1.25 / _M,
    "cached_input_token": 0.15 / _M,
    "output_token": 4.25 / _M,
    "search_query": _SEARCH,
}
_SPARK_CONTRIBUTOR: Mapping[str, float] = {
    "input_token": 0.10 / _M,
    "cached_input_token": 0.002 / _M,
    "output_token": 0.20 / _M,
    "search_query": _SEARCH,
}

#: USD per one unit, by model id then unit.
PRICES: Mapping[str, Mapping[str, float]] = {
    SPARK_MODEL: _SPARK,
    SPARK_AUDIO_MODEL: _SPARK,
    SPARK_11_MODEL: _SPARK,
    SPARK_CONTRIBUTOR_MODEL: _SPARK_CONTRIBUTOR,
    SPARK_12_CONTRIBUTOR_MODEL: _SPARK_CONTRIBUTOR,
    WONDER_MODEL: {
        "input_token": 4.00 / _M,
        "cached_input_token": 0.20 / _M,
        "output_token": 20.00 / _M,
        "search_query": _SEARCH,
    },
    IMAGE_MODEL: {"image": 0.01},
    VOICE_MODEL: {"audio_s": 0.18 / 3_600},
    SAM_MODEL: {"image": 2.50 / 1_000, "frame": 0.20 / 1_000},
}


def cost_of(model: str, units: float, unit: str) -> float | None:
    """What ``units`` of ``unit`` cost on ``model`` in one request, or ``None`` if not in the table.

    The two billing rules the table cannot hold apply here: audio seconds round up to whole
    seconds, and a SAM video request bills at least :data:`SAM_MIN_VIDEO_FRAMES` frames.
    """
    price = PRICES.get(model, {}).get(unit)
    if price is None:
        return None
    billed = float(units)
    if unit == "audio_s":
        billed = float(math.ceil(billed))
    if unit == "frame" and model == SAM_MODEL:
        billed = max(billed, float(SAM_MIN_VIDEO_FRAMES))
    return billed * price


def token_cost(
    model: str, input_tokens: int, output_tokens: int, cached_tokens: int = 0
) -> float | None:
    """One text call's cost. ``input_tokens`` is the whole prompt, ``cached_tokens`` the part of it
    served from the cache (the Chat Completions and Responses ``usage`` convention)."""
    fresh = cost_of(model, max(input_tokens - cached_tokens, 0), "input_token")
    cached = cost_of(model, cached_tokens, "cached_input_token")
    out = cost_of(model, output_tokens, "output_token")
    if fresh is None or cached is None or out is None:
        return None
    return fresh + cached + out

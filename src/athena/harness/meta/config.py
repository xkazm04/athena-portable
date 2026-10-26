"""Meta's model ids, the base URL and the key: the names every Meta client spells once (spike 00).

The ids are the ones ``docs/concepts/meta-featured-chores/meta-model-facts.md`` read off Meta's own
model page on 2026-10-24 - **press, not measured** until the day-1 probe (P1) lists ``GET /models``.

**The key is presence, never content** (the rules of :mod:`athena.harness.tokenfactory`):
``META_API_KEY`` is read from the environment at call time, sent in one header, and appears in no
``repr``, no error sentence, no probe file and no ledger column.
"""

from __future__ import annotations

import os
from collections.abc import Mapping

API_KEY_ENV = "META_API_KEY"
#: Overrides :data:`BASE_URL` (a proxy, a recorded replay, a partner host serving the same API).
BASE_URL_ENV = "META_BASE_URL"
BASE_URL = "https://api.meta.ai/v1"

SPARK_MODEL = "muse-spark-1.3"
#: Meta's model page recommends 1.2 for audio input ("audio not fully supported" on 1.3).
SPARK_AUDIO_MODEL = "muse-spark-1.2"
SPARK_11_MODEL = "muse-spark-1.1"
SPARK_CONTRIBUTOR_MODEL = "muse-spark-1.3-contributor"
SPARK_12_CONTRIBUTOR_MODEL = "muse-spark-1.2-contributor"
WONDER_MODEL = "muse-wonder-1.0"
IMAGE_MODEL = "muse-image-1.0"
SAM_MODEL = "sam-3.1"
VOICE_MODEL = "muse-voice-transcribe-1.0"

#: The text-out models (Responses and Chat Completions), in the facts table's order.
TEXT_MODELS: tuple[str, ...] = (
    SPARK_MODEL,
    SPARK_AUDIO_MODEL,
    SPARK_11_MODEL,
    SPARK_CONTRIBUTOR_MODEL,
    SPARK_12_CONTRIBUTOR_MODEL,
    WONDER_MODEL,
)
#: Every hosted id the facts table names.
KNOWN_MODELS: tuple[str, ...] = (*TEXT_MODELS, IMAGE_MODEL, SAM_MODEL, VOICE_MODEL)

#: One HTTP round may take this long: a wall for a hung connection, not a thinking budget.
REQUEST_TIMEOUT_S = 180.0


def _env(env: Mapping[str, str] | None) -> Mapping[str, str]:
    return env if env is not None else os.environ


def base_url(env: Mapping[str, str] | None = None) -> str:
    """``META_BASE_URL`` when set, else :data:`BASE_URL`; never with a trailing slash."""
    return (_env(env).get(BASE_URL_ENV, "").strip() or BASE_URL).rstrip("/")


def api_key(env: Mapping[str, str] | None = None) -> str:
    """The key, stripped; ``""`` when unset. Only a header builder may hold the result."""
    return _env(env).get(API_KEY_ENV, "").strip()


def key_present(env: Mapping[str, str] | None = None) -> bool:
    """Is a key set? The only question about the key anything else may ask."""
    return bool(api_key(env))


def headers(key: str) -> dict[str, str]:
    return {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": f"Bearer {key}",
    }

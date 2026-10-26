"""Meta's hosted models as Athena clients (spike 00, pieces 1-3, 5 and 6; ADR 0300).

Every shape here is Meta's *published* one (press) until the day-1 probe measures it.

=================  =============================================================
module             what it holds
=================  =============================================================
``config``         model ids, base URL (``META_BASE_URL``), the key (``META_API_KEY``)
``prices``         the list-price table and :func:`cost_of`
``guard``          Standard vs Contributor mode and the Standard-only guard
``wire``           one JSON POST, the typed errors, the Responses reply helpers
``sam``            :class:`MetaSegmenter` (``sam-3.1``)
``voice``          :class:`MetaTranscriber` (Voice Transcribe, or Spark audio)
``reader``         :class:`MetaReader` (``muse-spark-1.3`` structured reading)
``engine``         :class:`MetaModel`, a ``ModelFn`` over Chat Completions (not registered)
``probe``          ``python -m athena.harness.meta probe``, the P1 measurement
=================  =============================================================

Every role class calls :func:`require_standard` with ``media.personal`` before any request.
"""

from __future__ import annotations

from athena.harness.meta.config import (
    API_KEY_ENV,
    BASE_URL,
    BASE_URL_ENV,
    SAM_MODEL,
    SPARK_AUDIO_MODEL,
    SPARK_MODEL,
    VOICE_MODEL,
    WONDER_MODEL,
    key_present,
)
from athena.harness.meta.engine import MetaModel
from athena.harness.meta.guard import ContributorRefused, mode_of, require_standard
from athena.harness.meta.prices import PRICES, cost_of, token_cost
from athena.harness.meta.reader import MetaReader
from athena.harness.meta.sam import MetaSegmenter
from athena.harness.meta.voice import MetaTranscriber
from athena.harness.meta.wire import (
    MetaError,
    MetaHttpError,
    MetaKeyMissing,
    MetaMediaMissing,
    MetaShapeError,
    MetaUnreachable,
)
from athena.harness.tokenfactory import HttpPost, urllib_post

__all__ = [
    "API_KEY_ENV",
    "BASE_URL",
    "BASE_URL_ENV",
    "PRICES",
    "SAM_MODEL",
    "SPARK_AUDIO_MODEL",
    "SPARK_MODEL",
    "VOICE_MODEL",
    "WONDER_MODEL",
    "ContributorRefused",
    "HttpPost",
    "MetaError",
    "MetaHttpError",
    "MetaKeyMissing",
    "MetaMediaMissing",
    "MetaModel",
    "MetaReader",
    "MetaSegmenter",
    "MetaShapeError",
    "MetaTranscriber",
    "MetaUnreachable",
    "cost_of",
    "key_present",
    "mode_of",
    "require_standard",
    "token_cost",
    "urllib_post",
]

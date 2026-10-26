"""Meta's hosted models as Athena clients (stub: spike 00 WP1 replaces the bodies, keeping names).

Every shape here is Meta's *published* one (press) until the day-1 probe measures it.
"""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path

from athena.harness.tokenfactory import HttpPost, urllib_post
from athena.senses.contract import (
    MediaItem,
    Mode,
    Reading,
    ReadRequest,
    Segment,
    SegmentRequest,
    SenseCall,
    Transcript,
)

API_KEY_ENV = "META_API_KEY"
BASE_URL = "https://api.meta.ai/v1"
SPARK_MODEL = "muse-spark-1.3"
SPARK_AUDIO_MODEL = "muse-spark-1.2"
WONDER_MODEL = "muse-wonder-1.0"
SAM_MODEL = "sam-3.1"
VOICE_MODEL = "muse-voice-transcribe-1.0"


class ContributorRefused(ValueError):
    """A Contributor-mode model was asked to see a person's data."""


def mode_of(model: str) -> Mode:
    return "contributor" if model.endswith("-contributor") else "standard"


def require_standard(model: str, personal: bool) -> None:
    raise NotImplementedError


class MetaSegmenter:
    def __init__(
        self, *, env: Mapping[str, str] | None = None, post: HttpPost = urllib_post
    ) -> None:
        self.env, self.post = env, post

    def segment(self, request: SegmentRequest) -> tuple[list[Segment], SenseCall]:
        raise NotImplementedError


class MetaTranscriber:
    def __init__(
        self, *, env: Mapping[str, str] | None = None, post: HttpPost = urllib_post
    ) -> None:
        self.env, self.post = env, post

    def transcribe(self, media: MediaItem, file: Path | None) -> tuple[Transcript, SenseCall]:
        raise NotImplementedError


class MetaReader:
    def __init__(
        self, *, env: Mapping[str, str] | None = None, post: HttpPost = urllib_post
    ) -> None:
        self.env, self.post = env, post

    def read(self, request: ReadRequest) -> tuple[Reading, SenseCall]:
        raise NotImplementedError

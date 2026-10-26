"""The senses contract: what a featured chore asks of a camera, a microphone or a reader.

A sense turns a chore's recorded media (a flip-through of paper, a phone call, a photo archive, a
walk of a room, a kitchen counter) into **world tables whose every row cites its pixels or its
second**. A bench run then reads those tables through the world's READ tools exactly as it reads an
invented portal, so a featured chore rehearses on the real gate with no new runner.

Three model roles stand behind a sense, each a :class:`typing.Protocol` with three backends:

============  =====================================  =================================
role          ``fixture``                            ``meta`` (``claude`` for Reader)
============  =====================================  =================================
Segmenter     recorded SAM 3.1 boxes per media id    ``sam-3.1`` over the Responses API
Transcriber   recorded diarized turns per media id   ``muse-voice-transcribe-1.0``
Reader        recorded fields per media id           Claude CLI ``Read`` on the rendered
                                                     sheet, or ``muse-spark-1.3``
============  =====================================  =================================

The ``fixture`` backend is the default and the only one tests use; ``claude`` is tonight's real
reader; ``meta`` is built against Meta's published shapes (press, not measured) until the day-1
probe measures them (spike 00, P1).

**Wire conventions, stated once.** A box is ``(x0, y0, x1, y1)`` normalised to 0..1 of the frame,
origin top-left. A frame is the 0-based index into the media's frames; a still photo or a sheet is
frame ``0``. A second is seconds from the start of a recording, as a float. **An absent value is
``None`` in Python and the key omitted in JSON** - never ``0``, never ``""`` - because frame 0 and
second 0.0 are real positions. A cost the backend cannot price is ``None`` with
``cost_estimated=True`` (ADR 0122: an unpriced call weighs against the cap, it is not free).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, Protocol

Backend = Literal["fixture", "claude", "meta"]
BACKENDS: tuple[Backend, ...] = ("fixture", "claude", "meta")

#: Meta's two data-use modes (meta-model-facts.md "Data use"). Contributor trains on the content.
Mode = Literal["standard", "contributor"]

#: The five senses the featured chores own (docs/concepts/meta-featured-chores/README.md).
SenseName = Literal["paper", "call", "object", "walk", "circle"]
SENSES: tuple[SenseName, ...] = ("paper", "call", "object", "walk", "circle")

MediaKind = Literal["paper", "video", "audio", "photo"]

#: Where a playbook keeps its media index, fixtures and the built tables (all under the chore).
SENSES_DIR = "senses"
MEDIA_FILE = "media.json"
FIXTURES_DIR = "fixtures"
SENSED_FILE = "sensed.json"
PROOFS_FILE = "proofs.json"


@dataclass(frozen=True)
class Box:
    x0: float
    y0: float
    x1: float
    y1: float

    def as_list(self) -> list[float]:
        return [self.x0, self.y0, self.x1, self.y1]


@dataclass(frozen=True)
class Provenance:
    """Where a fact came from. Every sensed row carries one, flattened (:func:`provenance_cols`)."""

    media_id: str
    frame: int | None = None
    second: float | None = None
    box: Box | None = None


def provenance_cols(p: Provenance) -> dict[str, Any]:
    """The row columns a sensed table carries: ``media_id`` always, the rest only when known."""
    row: dict[str, Any] = {"media_id": p.media_id}
    if p.frame is not None:
        row["frame"] = p.frame
    if p.second is not None:
        row["second"] = p.second
    if p.box is not None:
        row["box"] = p.box.as_list()
    return row


@dataclass(frozen=True)
class MediaItem:
    """One entry of ``senses/media.json``. ``path`` is resolved under the chore's ``senses/``;
    media files themselves are local only (ADR 0055), so a missing file is legal for the fixture
    backend and a refusal for the others."""

    id: str
    kind: MediaKind
    sense: SenseName
    path: str = ""
    #: ``render:<table>/<key>`` - a sheet rendered from the world's own row (paper only).
    source: str = ""
    #: Free per-sense parameters (the SAM prompt, the expected sheet count, the speakers).
    params: Mapping[str, Any] = field(default_factory=dict)
    #: A person's data rides on this item: only Standard mode may see it (the guard).
    personal: bool = True


@dataclass(frozen=True)
class SegmentRequest:
    media: MediaItem
    file: Path | None
    prompt: str
    boxes: Sequence[Box] = ()


@dataclass(frozen=True)
class Segment:
    label: str
    score: float
    box: Box
    frame: int = 0
    track_id: str | None = None


@dataclass(frozen=True)
class Turn:
    speaker: str
    start_s: float
    end_s: float
    text: str


@dataclass(frozen=True)
class Transcript:
    media_id: str
    turns: tuple[Turn, ...]
    language: str = "en"


@dataclass(frozen=True)
class ReadRequest:
    media: MediaItem
    file: Path | None
    #: The field names the chore needs off this item (``amount_due_usd``, ``deadline``...).
    fields: Sequence[str]
    hint: str = ""
    #: Which read this is when a sense reads twice for agreement (0, 1).
    attempt: int = 0


@dataclass(frozen=True)
class ReadField:
    name: str
    value: str
    confidence: float
    provenance: Provenance


@dataclass(frozen=True)
class Reading:
    media_id: str
    fields: tuple[ReadField, ...]
    #: Fields asked for and not read: asked of the person, never guessed (spike 01's "never").
    unreadable: tuple[str, ...] = ()


@dataclass(frozen=True)
class SenseCall:
    """One model call a sense made; a row of ``sensed.json["calls"]`` and, live, of the ledger."""

    sense: SenseName
    role: Literal["segment", "transcribe", "read"]
    backend: Backend
    model: str
    mode: Mode
    media_id: str
    units: float
    unit: Literal["image", "frame", "audio_s", "token"]
    cost_usd: float | None
    cost_estimated: bool
    latency_ms: int


class Segmenter(Protocol):
    def segment(self, request: SegmentRequest) -> tuple[list[Segment], SenseCall]: ...


class Transcriber(Protocol):
    def transcribe(self, media: MediaItem, file: Path | None) -> tuple[Transcript, SenseCall]: ...


class Reader(Protocol):
    def read(self, request: ReadRequest) -> tuple[Reading, SenseCall]: ...


@dataclass(frozen=True)
class Senses:
    """The three roles one build uses, picked per role so a reader can be ``claude`` while the
    segmenter is still a ``fixture`` (tonight's hybrid)."""

    segmenter: Segmenter
    transcriber: Transcriber
    reader: Reader
    backends: Mapping[str, Backend]


@dataclass(frozen=True)
class SenseContext:
    """What a sense's ``build`` receives."""

    playbook_id: str
    root: Path
    world: Mapping[str, Any]
    media: tuple[MediaItem, ...]
    senses: Senses

    @property
    def senses_dir(self) -> Path:
        return self.root / SENSES_DIR


@dataclass(frozen=True)
class SenseOutput:
    """A sense's result: tables merged into the world (names must not shadow authored tables),
    the calls it made, and the rows it asked about instead of guessing."""

    tables: Mapping[str, list[dict[str, Any]]]
    calls: tuple[SenseCall, ...] = ()
    asked: tuple[str, ...] = ()


@dataclass(frozen=True)
class ProofResult:
    """One row of ``senses/proofs.json``: a README proof id (F1, R4...) measured on one build."""

    id: str
    question: str
    measured: float | None
    bar: float
    #: ``>=`` or ``<=``: the side of ``bar`` that passes.
    op: Literal[">=", "<="]
    passed: bool
    backend: Mapping[str, Backend]
    n: int
    note: str = ""


#: ``featured.status`` as the catalogue reports it (computed, never authored - ADR 0040):
#: ``proven`` = every proof passed on a build whose segmenter, transcriber or reader was ``meta``;
#: ``rehearsed`` = every proof passed, but not on Meta yet; ``failing`` = a proof missed its bar;
#: ``unproven`` = no proofs.json.
FeaturedStatus = Literal["proven", "rehearsed", "failing", "unproven"]

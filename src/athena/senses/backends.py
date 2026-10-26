"""The three roles' backends: recorded fixtures here, Claude and Meta by import.

:class:`FixtureSegmenter`, :class:`FixtureTranscriber` and :class:`FixtureReader` replay
``senses/fixtures/<media_id>.json`` in the format :mod:`athena.senses.registry` documents. They are
deterministic and free, and their :class:`~athena.senses.contract.SenseCall` rows say
``backend="fixture"`` with ``cost_usd=0.0`` (a recorded answer costs nothing; it is not unpriced).
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from athena.senses.contract import (
    Backend,
    Box,
    MediaItem,
    Provenance,
    ReadField,
    Reading,
    ReadRequest,
    Segment,
    SegmentRequest,
    SenseCall,
    SenseName,
    Senses,
    Transcript,
    Turn,
)

FIXTURE_MODEL = "fixture"


class FixtureMissing(LookupError):
    """A media item has no fixture file, or the file lacks the key this role reads."""


def _box(raw: Any) -> Box | None:
    if isinstance(raw, list) and len(raw) == 4:
        return Box(*(float(v) for v in raw))
    return None


def _call(media: MediaItem, role: Any, units: float, unit: Any) -> SenseCall:
    return SenseCall(
        sense=media.sense,
        role=role,
        backend="fixture",
        model=FIXTURE_MODEL,
        mode="standard",
        media_id=media.id,
        units=units,
        unit=unit,
        cost_usd=0.0,
        cost_estimated=False,
        latency_ms=0,
    )


class _Fixtures:
    def __init__(self, fixtures_dir: Path) -> None:
        self.dir = fixtures_dir

    def load(self, media_id: str, key: str) -> Any:
        path = self.dir / f"{media_id}.json"
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            raise FixtureMissing(f"no fixture for {media_id!r} ({path.name})") from None
        if not isinstance(value, Mapping) or key not in value:
            raise FixtureMissing(f"fixture {path.name} has no {key!r}")
        return value[key]


class FixtureSegmenter(_Fixtures):
    def segment(self, request: SegmentRequest) -> tuple[list[Segment], SenseCall]:
        prompt = request.prompt.strip().lower()
        out: list[Segment] = []
        for raw in self.load(request.media.id, "segments"):
            label = str(raw.get("label", ""))
            box = _box(raw.get("box"))
            if box is None or (prompt and prompt not in label.lower()):
                continue
            track = raw.get("track_id")
            out.append(
                Segment(
                    label=label,
                    score=float(raw.get("score", 1.0)),
                    box=box,
                    frame=int(raw.get("frame", 0)),
                    track_id=str(track) if track is not None else None,
                )
            )
        frames = len({s.frame for s in out}) or 1
        unit = "frame" if request.media.kind == "video" else "image"
        return out, _call(request.media, "segment", frames, unit)


class FixtureTranscriber(_Fixtures):
    def transcribe(self, media: MediaItem, file: Path | None) -> tuple[Transcript, SenseCall]:
        raw = self.load(media.id, "transcript")
        turns = tuple(
            Turn(
                speaker=str(t["speaker"]),
                start_s=float(t["start_s"]),
                end_s=float(t["end_s"]),
                text=str(t["text"]),
            )
            for t in raw.get("turns", [])
        )
        length = max((t.end_s for t in turns), default=0.0)
        transcript = Transcript(media.id, turns, str(raw.get("language", "en")))
        return transcript, _call(media, "transcribe", length, "audio_s")


class FixtureReader(_Fixtures):
    def read(self, request: ReadRequest) -> tuple[Reading, SenseCall]:
        reads = self.load(request.media.id, "reads")
        chosen = next((r for r in reads if int(r.get("attempt", 0)) == request.attempt), None)
        if chosen is None:
            chosen = reads[0] if reads else {"fields": []}
        held = {str(f["name"]): f for f in chosen.get("fields", [])}
        fields: list[ReadField] = []
        unreadable = [str(n) for n in chosen.get("unreadable", []) if n in request.fields]
        for name in request.fields:
            raw = held.get(name)
            if raw is None:
                if name not in unreadable:
                    unreadable.append(name)
                continue
            fields.append(
                ReadField(
                    name=name,
                    value=str(raw.get("value", "")),
                    confidence=float(raw.get("confidence", 1.0)),
                    provenance=Provenance(
                        media_id=request.media.id,
                        frame=int(raw["frame"]) if "frame" in raw else 0,
                        box=_box(raw.get("box")),
                    ),
                )
            )
        reading = Reading(request.media.id, tuple(fields), tuple(unreadable))
        return reading, _call(request.media, "read", 1, "image")


def make_senses(fixtures_dir: Path, backends: Mapping[str, Backend]) -> Senses:
    """The roles one build runs. A role not named in ``backends`` is ``fixture``.

    ``claude`` is a Reader only (the CLI reads a rendered sheet with its own ``Read`` tool);
    ``meta`` imports the Meta clients, which enforce the Standard-only guard themselves.
    """
    chosen: dict[str, Backend] = {
        role: backends.get(role, "fixture") for role in ("segmenter", "transcriber", "reader")
    }
    for role in ("segmenter", "transcriber"):
        if chosen[role] == "claude":
            raise ValueError(f"{role} has no claude backend; use fixture or meta")
    segmenter: Any = FixtureSegmenter(fixtures_dir)
    transcriber: Any = FixtureTranscriber(fixtures_dir)
    reader: Any = FixtureReader(fixtures_dir)
    if "meta" in chosen.values():
        from athena.harness import meta

        if chosen["segmenter"] == "meta":
            segmenter = meta.MetaSegmenter()
        if chosen["transcriber"] == "meta":
            transcriber = meta.MetaTranscriber()
        if chosen["reader"] == "meta":
            reader = meta.MetaReader()
    if chosen["reader"] == "claude":
        from athena.senses.claude_reader import ClaudeReader

        reader = ClaudeReader(fallback=FixtureReader(fixtures_dir))
    return Senses(segmenter=segmenter, transcriber=transcriber, reader=reader, backends=chosen)


def call_row(call: SenseCall) -> dict[str, Any]:
    """A :class:`SenseCall` as a ``sensed.json`` row (absent cost is omitted, not 0)."""
    row: dict[str, Any] = {
        "sense": call.sense,
        "role": call.role,
        "backend": call.backend,
        "model": call.model,
        "mode": call.mode,
        "media_id": call.media_id,
        "units": call.units,
        "unit": call.unit,
        "cost_estimated": call.cost_estimated,
        "latency_ms": call.latency_ms,
    }
    if call.cost_usd is not None:
        row["cost_usd"] = round(call.cost_usd, 6)
    return row


def sense_of(name: str) -> SenseName:
    from athena.senses.contract import SENSES

    if name not in SENSES:
        raise ValueError(f"{name!r} is not a sense: {SENSES}")
    return name

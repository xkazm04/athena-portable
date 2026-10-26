"""The walk sense: a weekly phone walk of a room becomes counts and promises (spike 04, ADR 0226).

``docs/concepts/meta-featured-chores/04-renovation-witness/README.md``. A homeowner walks the
remodel with the phone for three minutes a week. Each walk is one ``video`` item in
``senses/media.json``::

    {"id": "walk-w3", "kind": "video", "sense": "walk", "path": "media/walk-w3.mp4",
     "params": {"week": 3, "consent_recorded": true,
                "speakers": {"A": "homeowner", "B": "contractor"},
                "count": {"outlet": "Q-07", "recessed light": "Q-08", "cabinet door": "Q-12"}}}

``count`` maps a SAM prompt to the quote line it verifies. Three tables come out:

- ``walk_counts`` - one row per walk and prompt. ``counted`` is the number of **distinct
  track ids**, not of frames: SAM keeps one identity per physical object across the frames of a
  video, so an outlet filmed on the way in and again on the way out is one outlet. A segment
  without a track id cannot be merged with anything and counts once. The row cites the best frame
  (highest score) and its box; a count of zero cites no frame and no box (the keys are absent).
- ``walk_promises`` - one row per diarized turn :func:`.promises.classify` calls a promise, with
  the speaker's role (``params.speakers``), the second it began and the two flags the bench reads.
  A walk whose consent notice was not recorded (``consent_recorded`` not ``true``) is **never
  transcribed**: its counts stand, it yields no promise, and ``asked`` gets ``<media_id>.consent``.
- ``change_checks`` - the vague-change validator (:mod:`.changes`) over the world's change orders,
  so Athena reads which changes cannot be signed, and why, as data.

The sense reads only its own media and the world's authored tables; it never reads another sense.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from athena.senses.contract import (
    MediaItem,
    ProofResult,
    Provenance,
    Segment,
    SegmentRequest,
    SenseCall,
    SenseContext,
    SenseOutput,
    provenance_cols,
)
from athena.senses.walk.changes import CHECK_TABLE, change_checks, vague_change
from athena.senses.walk.promises import classify

__all__ = ["build", "count_instances", "prove", "vague_change"]

COUNT_TABLE = "walk_counts"
PROMISE_TABLE = "walk_promises"


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def walks(ctx: SenseContext) -> list[MediaItem]:
    """The index's walk items, in its order."""
    return [m for m in ctx.media if m.sense == "walk"]


def consented(item: MediaItem) -> bool:
    return item.params.get("consent_recorded") is True


def _file(ctx: SenseContext, item: MediaItem) -> Path | None:
    if not item.path:
        return None
    path = ctx.senses_dir / item.path
    return path if path.is_file() else None


def count_instances(segments: Sequence[Segment]) -> tuple[int, Segment | None]:
    """How many distinct objects ``segments`` show, and the best-scored segment to cite.

    One per distinct ``track_id``; each untracked segment is one more. Ties on score go to the
    earlier frame, so the cited frame is stable run to run.
    """
    tracks = {s.track_id for s in segments if s.track_id is not None}
    untracked = sum(1 for s in segments if s.track_id is None)
    best = min(segments, key=lambda s: (-s.score, s.frame), default=None)
    return len(tracks) + untracked, best


def _counts(
    ctx: SenseContext, item: MediaItem, week: Any, calls: list[SenseCall]
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    plan = item.params.get("count", {})
    for prompt, line in plan.items() if isinstance(plan, Mapping) else ():
        segments, call = ctx.senses.segmenter.segment(
            SegmentRequest(media=item, file=_file(ctx, item), prompt=str(prompt))
        )
        calls.append(call)
        counted, best = count_instances(segments)
        row: dict[str, Any] = {
            "count_id": f"{item.id}.{_slug(str(prompt))}",
            "week": week,
            "item": str(prompt),
            "quote_line": str(line),
            "counted": counted,
        }
        cite = Provenance(
            media_id=item.id,
            frame=best.frame if best is not None else None,
            box=best.box if best is not None else None,
        )
        rows.append({**row, **provenance_cols(cite)})
    return rows


def _promises(
    ctx: SenseContext, item: MediaItem, week: Any, calls: list[SenseCall]
) -> list[dict[str, Any]]:
    transcript, call = ctx.senses.transcriber.transcribe(item, _file(ctx, item))
    calls.append(call)
    speakers = item.params.get("speakers", {})
    roles = dict(speakers) if isinstance(speakers, Mapping) else {}
    rows: list[dict[str, Any]] = []
    for turn in transcript.turns:
        verdict = classify(turn.text)
        if not verdict.promise:
            continue
        cite = provenance_cols(Provenance(media_id=item.id, second=turn.start_s))
        rows.append(
            {
                "promise_id": f"{item.id}.p{len(rows) + 1}",
                "week": week,
                "speaker": str(roles.get(turn.speaker, turn.speaker)),
                "text": turn.text,
                "mentions_price": verdict.mentions_price,
                "mentions_days": verdict.mentions_days,
                **cite,
            }
        )
    return rows


def build(ctx: SenseContext) -> SenseOutput:
    counts: list[dict[str, Any]] = []
    promises: list[dict[str, Any]] = []
    calls: list[SenseCall] = []
    asked: list[str] = []
    for item in walks(ctx):
        week = item.params.get("week")
        counts.extend(_counts(ctx, item, week, calls))
        if consented(item):
            promises.extend(_promises(ctx, item, week, calls))
        else:
            asked.append(f"{item.id}.consent")
    return SenseOutput(
        tables={
            COUNT_TABLE: counts,
            PROMISE_TABLE: promises,
            CHECK_TABLE: change_checks(ctx.world),
        },
        calls=tuple(calls),
        asked=tuple(asked),
    )


def prove(ctx: SenseContext, output: SenseOutput, key: Mapping[str, Any]) -> list[ProofResult]:
    from athena.senses.walk.proofs import prove_walk

    return prove_walk(ctx, output, key)

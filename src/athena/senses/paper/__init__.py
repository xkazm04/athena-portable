"""Spike 01, ADR 0227 (the paper sense): a flip-through or a photo of mail -> sheets, fields.

**Sheets.** A ``video`` item of sense ``paper`` is a flip-through of a pile. The segmenter is asked
for its ``params.prompt`` ("sheet of paper"); segments carrying one ``track_id`` are one sheet, and
the track id is the sheet id (a distractor such as a hand never matches the prompt). A sheet's row
cites the best frame of its track - the highest score, the earliest frame on a tie - with its box,
the track id and how many frames saw it. A ``paper`` item is one sheet: with ``params.pile`` it is
a sheet of that pile (found only if the pile's track found it); without, it is a photo of one page
and its own row cites frame 0 of itself.

**Fields.** Every sheet item is read twice (``attempt`` 0 and 1, the two-frame read) for its
``params.fields``. A field is ``read`` only when both reads hold it and agree after
:func:`~athena.senses.paper.normalise.normalise`; the value kept is that normal form. Otherwise it
is ``asked`` - no value, the sheet's id and field in :attr:`SenseOutput.asked` - because a value one
read saw and the other did not is exactly the value that is never guessed (spike 01's "never"). A
sheet of a pile that no track found is not read: every field it was to give is asked.

**Wire.** ``sheets``: ``{sheet_id, doc_type?, media_id, frame?, box?, track_id?, frames_seen?}``;
``sheet_fields``: ``{sheet_id, field, status, value?, confidence?, media_id, frame?, box?}``. An
absent value is an omitted key (contract). The answer key is ``key.json["paper"]``: ``{"sheets":
{sid: {"fields": {...}, "hard": null | "glare" | ...}}, "piles": {pile_id: [sid, ...]}}``.

:func:`prove` measures spike 01's F1, F2, F2x, F3, R2 and R3 on one build (README proofs table;
R2 is omitted when the key names no hard sheet - n=0 is nothing measured, neither pass nor fail);
R1, R4, V1 and V2 need people, the Gauntlet or the bench, and are not measured here.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from athena.senses.contract import (
    MediaItem,
    ProofResult,
    Provenance,
    ReadField,
    ReadRequest,
    Segment,
    SegmentRequest,
    SenseCall,
    SenseContext,
    SenseOutput,
    provenance_cols,
)
from athena.senses.paper.normalise import normalise

SENSE = "paper"
SHEETS = "sheets"
SHEET_FIELDS = "sheet_fields"
DEFAULT_PROMPT = "sheet of paper"
READS = (0, 1)

# Bars, from docs/concepts/meta-featured-chores/01-paper-flip/README.md (the proofs table).
F1_BAR = 0.90
F2_BAR = 0.95
F2X_BAR = 0.02
F3_BAR = 1.0
R2_BAR = 1.0
R3_BAR = 0.50


def _file(ctx: SenseContext, item: MediaItem) -> Any:
    if not item.path:
        return None
    path = ctx.senses_dir / item.path
    return path if path.is_file() else None


def sheet_id(item: MediaItem) -> str:
    return str(item.params.get("sheet_id") or item.id)


@dataclass(frozen=True)
class _Track:
    track_id: str
    best: Segment
    frames: int


def _tracks(segments: Sequence[Segment]) -> list[_Track]:
    """Segments grouped by track, in order of first appearance; untracked segments are dropped."""
    grouped: dict[str, list[Segment]] = {}
    for seg in segments:
        if seg.track_id is not None:
            grouped.setdefault(seg.track_id, []).append(seg)
    out: list[_Track] = []
    for tid, segs in sorted(grouped.items(), key=lambda kv: min(s.frame for s in kv[1])):
        best = sorted(segs, key=lambda s: (-s.score, s.frame))[0]
        out.append(_Track(tid, best, len({s.frame for s in segs})))
    return out


def _field_row(
    sid: str, item: MediaItem, name: str, reads: Sequence[ReadField | None]
) -> dict[str, Any]:
    first, second = reads
    row: dict[str, Any] = {"sheet_id": sid, "field": name}
    if first is not None and second is not None:
        value = normalise(name, first.value)
        if value and value == normalise(name, second.value):
            row["status"] = "read"
            row["value"] = value
            row["confidence"] = round(min(first.confidence, second.confidence), 4)
            row.update(provenance_cols(first.provenance))
            return row
    row["status"] = "asked"
    row["media_id"] = item.id
    return row


def build(ctx: SenseContext) -> SenseOutput:
    items = [m for m in ctx.media if m.sense == SENSE]
    piles = [m for m in items if m.kind == "video"]
    sheets = [m for m in items if m.kind != "video"]
    calls: list[SenseCall] = []
    sheet_rows: list[dict[str, Any]] = []
    found: set[str] = set()
    doc_types = {sheet_id(m): m.params.get("doc_type") for m in sheets}
    for pile in piles:
        prompt = str(pile.params.get("prompt") or DEFAULT_PROMPT)
        segments, call = ctx.senses.segmenter.segment(
            SegmentRequest(pile, _file(ctx, pile), prompt)
        )
        calls.append(call)
        for track in _tracks(segments):
            row: dict[str, Any] = {"sheet_id": track.track_id}
            if doc_types.get(track.track_id):
                row["doc_type"] = str(doc_types[track.track_id])
            row.update(provenance_cols(Provenance(pile.id, track.best.frame, box=track.best.box)))
            row["track_id"] = track.track_id
            row["frames_seen"] = track.frames
            sheet_rows.append(row)
            found.add(track.track_id)

    field_rows: list[dict[str, Any]] = []
    asked: list[str] = []
    for item in sheets:
        sid = sheet_id(item)
        fields = [str(f) for f in item.params.get("fields", [])]
        in_pile = bool(item.params.get("pile"))
        if not in_pile:
            row = {"sheet_id": sid}
            if item.params.get("doc_type"):
                row["doc_type"] = str(item.params["doc_type"])
            row.update(provenance_cols(Provenance(item.id, 0)))
            sheet_rows.append(row)
        elif sid not in found:
            for name in fields:
                field_rows.append(_field_row(sid, item, name, (None, None)))
                asked.append(f"{sid}.{name}")
            continue
        got: list[dict[str, ReadField]] = []
        for attempt in READS:
            request = ReadRequest(
                item, _file(ctx, item), fields, str(item.params.get("doc_type", "")), attempt
            )
            reading, call = ctx.senses.reader.read(request)
            calls.append(call)
            got.append({f.name: f for f in reading.fields})
        for name in fields:
            row = _field_row(sid, item, name, (got[0].get(name), got[1].get(name)))
            field_rows.append(row)
            if row["status"] == "asked":
                asked.append(f"{sid}.{name}")
    return SenseOutput(
        tables={SHEETS: sheet_rows, SHEET_FIELDS: field_rows},
        calls=tuple(calls),
        asked=tuple(asked),
    )


# --- the proofs ---------------------------------------------------------------------------------


def _result(
    ctx: SenseContext,
    pid: str,
    question: str,
    measured: float | None,
    bar: float,
    op: Any,
    n: int,
    note: str = "",
) -> ProofResult:
    passed = measured is not None and (measured >= bar if op == ">=" else measured <= bar)
    return ProofResult(
        id=pid,
        question=question,
        measured=None if measured is None else round(measured, 4),
        bar=bar,
        op=op,
        passed=passed,
        backend=dict(ctx.senses.backends),
        n=n,
        note=note,
    )


def _share(hits: int, n: int) -> float | None:
    return hits / n if n else None


def prove(ctx: SenseContext, output: SenseOutput, key: Mapping[str, Any]) -> list[ProofResult]:
    paper = key.get(SENSE, {}) if isinstance(key.get(SENSE), Mapping) else {}
    key_sheets: Mapping[str, Any] = paper.get("sheets", {}) or {}
    key_piles: Mapping[str, Any] = paper.get("piles", {}) or {}
    sheet_rows = output.tables.get(SHEETS, [])
    field_rows = output.tables.get(SHEET_FIELDS, [])
    pile_of = {sid: pile for pile, sids in key_piles.items() for sid in sids}

    # F1: every sheet found (in its pile, or as its photo) and every pile track is one key sheet.
    tracked = [r for r in sheet_rows if "track_id" in r]
    found = {str(r["sheet_id"]) for r in sheet_rows}
    pure = sum(1 for r in tracked if pile_of.get(str(r["sheet_id"])) == r.get("media_id"))
    recall = _share(sum(1 for sid in key_sheets if sid in found), len(key_sheets))
    purity = _share(pure, len(tracked)) if tracked else 1.0
    f1 = None if recall is None or purity is None else min(recall, purity)
    f1_note = (
        f"found {recall if recall is None else round(recall, 4)}, purity {round(purity or 0, 4)}"
    )

    # F2 / F2x: over the fields marked read that the key scores.
    expected = {
        (sid, str(name)): value
        for sid, sheet in key_sheets.items()
        for name, value in dict(sheet.get("fields", {})).items()
    }
    read = [r for r in field_rows if r.get("status") == "read"]
    scored = [r for r in read if (str(r["sheet_id"]), str(r["field"])) in expected]
    right = sum(
        1
        for r in scored
        if normalise(str(r["field"]), r.get("value", ""))
        == normalise(str(r["field"]), expected[(str(r["sheet_id"]), str(r["field"]))])
    )
    wrong = len(scored) - right
    asked_n = sum(1 for r in field_rows if r.get("status") == "asked")
    f2_note = f"{right} right, {wrong} wrong, {asked_n} asked, {len(read) - len(scored)} unscored"

    # F3: a read field points at its pixels - a frame, and a box of its own or its sheet's row.
    located = {str(r["sheet_id"]) for r in sheet_rows if "frame" in r}
    covered = sum(1 for r in read if "frame" in r and ("box" in r or str(r["sheet_id"]) in located))
    boxed = sum(1 for r in read if "box" in r)

    # R2: on a hard sheet, every key field is read and right, or asked - never read and wrong.
    by_key = {(str(r["sheet_id"]), str(r["field"])): r for r in field_rows}
    hard = [(sid, name) for (sid, name) in expected if (key_sheets[sid] or {}).get("hard")]
    safe = 0
    for pair in hard:
        row = by_key.get(pair)
        if row is None:
            continue
        if row.get("status") == "asked" or normalise(pair[1], row.get("value", "")) == normalise(
            pair[1], expected[pair]
        ):
            safe += 1
    hard_asked = sum(1 for p in hard if (by_key.get(p) or {}).get("status") == "asked")

    # R3: what one pile costs, from the calls (an unpriced call weighs against the cap, ADR 0122).
    paper_calls = [c for c in output.calls if c.sense == SENSE]
    unpriced = sum(1 for c in paper_calls if c.cost_usd is None)
    piles = max(
        1, len(key_piles) or sum(1 for m in ctx.media if m.sense == SENSE and m.kind == "video")
    )
    cost = sum(c.cost_usd or 0.0 for c in paper_calls)
    r3 = None if unpriced else cost / piles
    r3_note = f"${cost:.4f} over {piles} pile(s), {len(paper_calls)} calls" + (
        f", {unpriced} unpriced" if unpriced else ""
    )

    results = [
        _result(
            ctx,
            "F1",
            "sheets found / track purity vs key",
            f1,
            F1_BAR,
            ">=",
            len(key_sheets),
            f1_note,
        ),
        _result(
            ctx,
            "F2",
            "field accuracy over read fields",
            _share(right, len(scored)),
            F2_BAR,
            ">=",
            len(scored),
            f2_note,
        ),
        _result(
            ctx,
            "F2x",
            "false facts: read but wrong",
            _share(wrong, len(scored)),
            F2X_BAR,
            "<=",
            len(scored),
            f2_note,
        ),
        _result(
            ctx,
            "F3",
            "provenance coverage of read fields",
            _share(covered, len(read)),
            F3_BAR,
            ">=",
            len(read),
            f"{boxed} of {len(read)} with a box of their own",
        ),
        _result(ctx, "R3", "cost per pile, USD", r3, R3_BAR, "<=", len(paper_calls), r3_note),
    ]
    if hard:  # a key with no hard sheet has nothing for R2 to measure: omitted, not passed
        r2 = _result(
            ctx,
            "R2",
            "hard sheets: read right or asked, never silently wrong",
            _share(safe, len(hard)),
            R2_BAR,
            ">=",
            len(hard),
            f"{hard_asked} asked",
        )
        results.insert(4, r2)
    return results

"""Spike 03 (Roll Call), the object sense: a household's photos -> one cited line per possession.

Each ``photo`` item of ``senses/media.json`` (``sense: "object"``) names its room, the date it was
taken, its album and the room's ``prompts`` (the household concepts SAM is asked for). The build:

1. **Segments** each photo once per prompt and once for ``person``. An instance is its
   ``track_id`` (a per-photo instance id); one instance returned by two prompts ("chair" and
   "armchair") is one instance.
2. **Excludes people.** Person instances are counted and dropped: no crop of one is read, and no
   person box reaches any table (spike 03's "never sends photos of people"). A line citing such a
   photo says so (``with_people``, ``people_excluded``) so the bench can keep it out of a binder.
3. **Reads** every other instance's crop, one read per photo, fields ``<track_id>.label`` (what it
   is) and ``<track_id>.brand``. A label the reader could not give is **asked, not guessed**: an
   ``inventory_asked`` row, never an inventory line.
4. **Merges** across photos and years (:mod:`.merge`, ADR 0303) into the ``inventory`` table.

``inventory`` rows: ``item_id``, ``label``, ``brand`` (when read), ``room``, ``count``, ``photos``,
``first_seen``, ``last_seen``, ``sightings``, ``with_people``, ``people_excluded``, and the
provenance of the best photo: ``media_id``, ``frame`` (``0``, a still) and ``box``.

:func:`prove` measures the README proofs a fixture build can: F1 recall of the key's possessions,
F1x unsupported lines, F3 duplicates after the merge, F4 people kept out, and R2's cost, scaled
to a 5,000-photo household. F2 (per-class recall over ~150 classes), F4's "interior shots found"
half, R1 (run-to-run stability, which a fixture cannot vary), R2's resume, R3 (the Gauntlet) and
the value proofs V1-V2 are not measured here.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from athena.senses.contract import (
    Box,
    MediaItem,
    ProofResult,
    ReadRequest,
    Segment,
    SegmentRequest,
    SenseCall,
    SenseContext,
    SenseOutput,
)
from athena.senses.object.merge import Possession, Sighting, merge, normalise

SENSE = "object"
PERSON = "person"
INVENTORY = "inventory"
ASKED = "inventory_asked"

#: README R2: the report's ~$45 per household is for an archive of 5,000 photos.
HOUSEHOLD_PHOTOS = 5000

#: SAM 3.1's published price per image request (meta-model-facts.md, press, not measured). Used
#: only to say in R2's note what a fixture build's segment calls would cost on Meta.
SAM_PRESS_USD_PER_IMAGE = 2.50 / 1000


def _file(ctx: SenseContext, media: MediaItem) -> Path | None:
    if not media.path:
        return None
    path = ctx.senses_dir / media.path
    return path if path.is_file() else None


def _box(b: Box) -> list[float]:
    return [round(v, 4) for v in b.as_list()]


def _photos(ctx: SenseContext) -> list[MediaItem]:
    return [m for m in ctx.media if m.sense == SENSE and m.kind == "photo"]


def segment_photo(
    ctx: SenseContext, media: MediaItem, calls: list[SenseCall]
) -> tuple[dict[str, Segment], list[Segment]]:
    """``(objects by track id, people)`` for one photo, one segment call per prompt."""
    file = _file(ctx, media)
    prompts = [str(p) for p in media.params.get("prompts", []) if str(p).strip()]
    people: dict[str, Segment] = {}
    objects: dict[str, Segment] = {}
    for prompt in [PERSON, *prompts]:
        found, call = ctx.senses.segmenter.segment(SegmentRequest(media, file, prompt))
        calls.append(call)
        for i, seg in enumerate(found):
            track = seg.track_id or f"{prompt}#{i}"
            if PERSON in seg.label.lower():
                people.setdefault(track, seg)
            elif track not in people:
                objects.setdefault(track, seg)
    return objects, list(people.values())


def build(ctx: SenseContext) -> SenseOutput:
    calls: list[SenseCall] = []
    sightings: list[Sighting] = []
    asked_rows: list[dict[str, Any]] = []
    asked: list[str] = []
    people_in: dict[str, int] = {}
    for media in _photos(ctx):
        taken = str(media.params.get("taken", ""))
        room = str(media.params.get("room", ""))
        objects, people = segment_photo(ctx, media, calls)
        people_in[media.id] = len(people)
        if not objects:
            continue
        fields = [f"{t}.{name}" for t in objects for name in ("label", "brand")]
        reading, call = ctx.senses.reader.read(
            ReadRequest(media, _file(ctx, media), fields, hint=f"household items in the {room}")
        )
        calls.append(call)
        read = {f.name: f for f in reading.fields}
        for track, seg in objects.items():
            label = read.get(f"{track}.label")
            if label is None or not label.value.strip():
                asked.append(f"{media.id}.{track}.label")
                asked_rows.append(
                    {
                        "room": room,
                        "concept": seg.label,
                        "question": f"A {seg.label} in this {room} photo could not be named.",
                        "taken": taken,
                        "media_id": media.id,
                        "frame": seg.frame,
                        "box": _box(seg.box),
                    }
                )
                continue
            brand = read.get(f"{track}.brand")
            sightings.append(
                Sighting(
                    media_id=media.id,
                    taken=taken,
                    room=room,
                    concept=seg.label,
                    label=label.value.strip(),
                    track_id=track,
                    box=seg.box,
                    score=seg.score,
                    brand=brand.value.strip() if brand and brand.value.strip() else None,
                    people=len(people),
                )
            )
    asked_rows.sort(key=lambda r: (r["taken"], r["media_id"], r["concept"]))
    for i, row in enumerate(asked_rows, 1):
        row["ask_id"] = f"Q-{i:02d}"
    inventory = [_line(i, p, people_in) for i, p in enumerate(merge(sightings), 1)]
    asked_out = [{"ask_id": r.pop("ask_id"), **r} for r in asked_rows]
    return SenseOutput(
        tables={INVENTORY: inventory, ASKED: asked_out}, calls=tuple(calls), asked=tuple(asked)
    )


def _line(n: int, p: Possession, people_in: Mapping[str, int]) -> dict[str, Any]:
    best = p.best()
    photos = p.photos
    with_people = [m for m in photos if people_in.get(m, 0)]
    row: dict[str, Any] = {"item_id": f"IT-{n:02d}", "label": p.label}
    if p.brand:
        row["brand"] = p.brand
    row.update(
        room=p.room,
        count=p.count,
        photos=photos,
        first_seen=p.first_seen,
        last_seen=p.last_seen,
        sightings=len(p.sightings),
        with_people=with_people,
        people_excluded=sum(people_in.get(m, 0) for m in with_people),
        media_id=best.media_id,
        frame=0,
        box=_box(best.box),
    )
    return row


# --- proofs --------------------------------------------------------------------------------------


def _result(
    ctx: SenseContext,
    pid: str,
    question: str,
    measured: float | None,
    bar: float,
    op: str,
    n: int,
    note: str = "",
) -> ProofResult:
    passed = measured is not None and (measured >= bar if op == ">=" else measured <= bar)
    return ProofResult(
        id=pid,
        question=question,
        measured=measured,
        bar=bar,
        op=">=" if op == ">=" else "<=",
        passed=passed,
        backend=dict(ctx.senses.backends),
        n=n,
        note=note,
    )


def _key_index(items: Sequence[Mapping[str, Any]]) -> dict[tuple[str, str], int]:
    return {(str(k["room"]), normalise(str(k["label"]))): i for i, k in enumerate(items)}


def prove(ctx: SenseContext, output: SenseOutput, key: Mapping[str, Any]) -> list[ProofResult]:
    """The README proofs a build can measure, against ``key["object"]``."""
    k = key.get(SENSE, {})
    items: list[Mapping[str, Any]] = list(k.get("items", []))
    lines = list(output.tables.get(INVENTORY, []))
    index = _key_index(items)
    matched: dict[int, int] = {}
    unsupported = duplicates = counts_right = 0
    for line in lines:
        at = index.get((str(line.get("room")), normalise(str(line.get("label", "")))))
        cited = bool(line.get("photos")) and "media_id" in line and "box" in line
        if at is None or not cited:
            unsupported += 1
            continue
        if at in matched:
            duplicates += 1
            continue
        matched[at] = int(line.get("count", 0))
        counts_right += int(matched[at] == int(items[at].get("count", 1)))
    results = [
        _result(
            ctx,
            "F1",
            "recall of the key's possessions (a photo archive contains the home)",
            len(matched) / len(items) if items else None,
            0.60,
            ">=",
            len(items),
            f"{len(matched)} of {len(items)} found, {counts_right} with the right count; "
            f"{len(output.tables.get(ASKED, []))} asked, not guessed",
        ),
        _result(
            ctx,
            "F1x",
            "unsupported lines: no possession in the key behind it, or no photo cited",
            unsupported / len(lines) if lines else None,
            0.0,
            "<=",
            len(lines),
        ),
        _result(
            ctx,
            "F3",
            "duplicates after the merge (one possession stays one line across years)",
            duplicates / len(lines) if lines else None,
            0.02,
            "<=",
            len(lines),
            f"{duplicates} duplicate lines of {len(lines)}",
        ),
        _people_proof(ctx, output, k.get("people_photos", {})),
        _cost_proof(ctx, output),
    ]
    return results


def _people_proof(
    ctx: SenseContext, output: SenseOutput, expected: Mapping[str, Any]
) -> ProofResult:
    """F4's privacy half: every key photo with people has them found and kept out of the tables.

    The person boxes are segmented again here (one call per such photo) and checked against every
    box in every table; a line citing the photo must also flag it in ``with_people``."""
    boxes = {
        tuple(row["box"])
        for rows in output.tables.values()
        for row in rows
        if isinstance(row.get("box"), list)
    }
    flagged = {m for row in output.tables.get(INVENTORY, []) for m in row.get("with_people", [])}
    cited = {m for row in output.tables.get(INVENTORY, []) for m in row.get("photos", [])}
    media = {m.id: m for m in _photos(ctx)}
    kept = 0
    misses: list[str] = []
    for mid, want in sorted(expected.items()):
        item = media.get(mid)
        if item is None:
            misses.append(f"{mid} not in the index")
            continue
        found, _ = ctx.senses.segmenter.segment(SegmentRequest(item, _file(ctx, item), PERSON))
        people = [s for s in found if PERSON in s.label.lower()]
        leaked = any(tuple(_box(s.box)) in boxes for s in people)
        ok = len(people) >= int(want) and not leaked and (mid not in cited or mid in flagged)
        kept += int(ok)
        if not ok:
            misses.append(mid)
    total = len(expected)
    return _result(
        ctx,
        "F4",
        "people excluded: every photo with people found, no person box in any table",
        kept / total if total else None,
        1.0,
        ">=",
        total,
        "misses: " + ", ".join(misses) if misses else "interior-shot sorting not measured",
    )


def _cost_proof(ctx: SenseContext, output: SenseOutput) -> ProofResult:
    """R2's price half: this build's cost per photo, scaled to a 5,000-photo household."""
    calls = [c for c in output.calls if c.sense == SENSE]
    photos = len(_photos(ctx))
    unpriced = sum(1 for c in calls if c.cost_usd is None)
    cost = sum(c.cost_usd or 0.0 for c in calls)
    measured = None if unpriced or not photos else cost / photos * HOUSEHOLD_PHOTOS
    note = f"${cost:.4f} for {photos} photos, {len(calls)} calls"
    if unpriced:
        note += f"; {unpriced} unpriced calls weigh against the cap (ADR 0122)"
    if calls and all(c.backend == "fixture" for c in calls):
        segs = sum(1 for c in calls if c.role == "segment")
        press = segs * SAM_PRESS_USD_PER_IMAGE / max(photos, 1) * HOUSEHOLD_PHOTOS
        note += (
            f"; fixture calls are free, so this is a rehearsal: at SAM 3.1's published price the "
            f"{segs} segment calls (one per prompt) alone would be ${press:,.2f} per household"
        )
    return _result(
        ctx,
        "R2",
        f"cost per household of {HOUSEHOLD_PHOTOS:,} photos (resume not measured)",
        measured,
        45.0,
        "<=",
        photos,
        note,
    )

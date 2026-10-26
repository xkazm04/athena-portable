"""Spike 05 (the circle sense): the kitchen counter, the family call and the signer rule table ->
``counter_meds``, ``circle_tasks`` and ``signer_rules``.

**The counter.** A ``photo`` (or a ``video`` pan) item of sense ``circle`` is asked of the segmenter
for its ``params.prompt`` ("pill bottle"); segments of one ``track_id`` are one bottle, cited by
its best segment (highest score, earliest frame on a tie). A segment with no track is still a
bottle, named ``<media_id>-<n>``, because a bottle dropped is a discrepancy hidden. Each bottle's
label is read on its own (one read per bottle, report part 2: a label is never confused with its
neighbour's), twice, for ``<track_id>.name``, ``.strength`` and ``.directions``. A field both reads
hold and agree on (:func:`label_norm`) is kept; otherwise it is asked, and the bottle's ``status``
is ``asked`` - never guessed. The sense never compares the counter with the discharge paper and
never says what to take: the paper sense reads the discharge sheets into ``sheet_fields`` and
Athena compares the two tables on the bench, where a mismatch is a flag that says "ask the
pharmacist" (spike 05's "never": no dosing advice).

**The call.** An ``audio`` item's transcript is split into sentences; a sentence that claims a
task (:func:`~athena.senses.circle.claims.claims`) becomes a ``circle_tasks`` row owned by the
member its speaker label maps to (``params.members``: ``{"A": "maya (primary carer)"}`` -> member
``maya``). A speaker the map does not name owns nothing: the row has no ``member`` and is asked. A
yes said on a call is never a signature, so the sense records no approvals.

**The rule table.** ``senses/signers.json`` (:mod:`~athena.senses.circle.signers`) is flattened
into ``signer_rules``, one row per action x subject with its resolved need. It is authored, not
sensed, so its rows cite the file (``media_id: "signers.json"``).

**Wire.** ``counter_meds``: ``{med_id, name?, strength?, directions?, status, media_id, frame,
box}``; ``circle_tasks``: ``{task_id, member?, text, second, media_id}``; ``signer_rules``:
``{rule_id, action, subject, needs, parent_veto?, signers?, yeses_needed?, decided_by?,
media_id}``. Absent is an omitted key (contract). The answer key is ``key.json["circle"]``.

:func:`prove` measures spike 05's F1 (whose yes, and no breach), F3 (bottle count, label fields, no
false clear) and F4 (task attribution) on one build. F2, F5 and R1 need members on devices and a
replica, which tonight's single-user rule (ADR 0305) keeps out; R2 is the suite itself; V1 and V2
need the multi-actor Character harness. None of those is measured here.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from athena.senses.circle.claims import claims
from athena.senses.circle.signers import (
    SignerTable,
    SignerTableError,
    decide,
    flatten,
    load_table,
    whose_yes,
)
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

SENSE = "circle"
COUNTER_MEDS = "counter_meds"
CIRCLE_TASKS = "circle_tasks"
SIGNER_RULES = "signer_rules"
SIGNERS_FILE = "signers.json"
DEFAULT_PROMPT = "pill bottle"
LABEL_FIELDS = ("name", "strength", "directions")
READS = (0, 1)
#: How far a task row's second may sit from the key's and still be the same claim.
SECOND_SLACK = 0.5

# Bars, from docs/concepts/meta-featured-chores/05-care-circle/README.md (the proofs table).
F1_BAR = 1.0
F1X_BAR = 0.0
F3_BAR = 0.95
F3A_BAR = 0.95
F3X_BAR = 0.0
F4_BAR = 0.25


def _file(ctx: SenseContext, item: MediaItem) -> Path | None:
    if not item.path:
        return None
    path = ctx.senses_dir / item.path
    return path if path.is_file() else None


def label_norm(value: Any) -> str:
    """A label field as it is compared: whitespace collapsed, case folded, ``50 mg`` as ``50mg``."""
    text = " ".join(str(value).split()).casefold()
    return re.sub(r"(\d)\s+(mg|mcg|g|ml|iu|units?)\b", r"\1\2", text)


@dataclass(frozen=True)
class _Bottle:
    med_id: str
    track_id: str
    best: Segment


def _bottles(item: MediaItem, segments: Sequence[Segment]) -> list[_Bottle]:
    """One bottle per track (first seen first); an untracked segment is a bottle of its own."""
    grouped: dict[str, list[Segment]] = {}
    for n, seg in enumerate(segments, start=1):
        grouped.setdefault(seg.track_id or f"{item.id}-{n}", []).append(seg)
    ordered = sorted(grouped.items(), key=lambda kv: min(s.frame for s in kv[1]))
    return [
        _Bottle(tid, tid, sorted(segs, key=lambda s: (-s.score, s.frame))[0])
        for tid, segs in ordered
    ]


def _counter(
    ctx: SenseContext, item: MediaItem
) -> tuple[list[dict[str, Any]], list[SenseCall], list[str]]:
    prompt = str(item.params.get("prompt") or DEFAULT_PROMPT)
    file = _file(ctx, item)
    segments, call = ctx.senses.segmenter.segment(SegmentRequest(item, file, prompt))
    calls = [call]
    rows: list[dict[str, Any]] = []
    asked: list[str] = []
    for bottle in _bottles(item, segments):
        names = [f"{bottle.track_id}.{f}" for f in LABEL_FIELDS]
        got: list[dict[str, ReadField]] = []
        for attempt in READS:
            hint = f"the label of one {prompt}, box {bottle.best.box.as_list()}"
            reading, read_call = ctx.senses.reader.read(
                ReadRequest(item, file, names, hint, attempt)
            )
            calls.append(read_call)
            got.append({f.name: f for f in reading.fields})
        row: dict[str, Any] = {"med_id": bottle.med_id}
        missing = False
        for field, name in zip(LABEL_FIELDS, names, strict=True):
            first, second = got[0].get(name), got[1].get(name)
            if (
                first
                and second
                and label_norm(first.value)
                and (label_norm(first.value) == label_norm(second.value))
            ):
                row[field] = " ".join(first.value.split())
            else:
                missing = True
                asked.append(f"{bottle.med_id}.{field}")
        row["status"] = "asked" if missing else "read"
        row.update(provenance_cols(Provenance(item.id, bottle.best.frame, box=bottle.best.box)))
        rows.append(row)
    return rows, calls, asked


def member_of(label: str) -> str:
    """``"maya (primary carer)"`` -> ``"maya"``: the member id is the label's first word."""
    head = label.split("(", 1)[0].strip().split()
    return head[0].casefold() if head else ""


def _call_tasks(
    ctx: SenseContext, item: MediaItem, start: int
) -> tuple[list[dict[str, Any]], SenseCall, list[str]]:
    transcript, call = ctx.senses.transcriber.transcribe(item, _file(ctx, item))
    raw_members = item.params.get("members", {})
    members = {str(k): member_of(str(v)) for k, v in dict(raw_members).items()}
    rows: list[dict[str, Any]] = []
    asked: list[str] = []
    for turn in transcript.turns:
        for sentence in claims(turn.text):
            task_id = f"T-{start + len(rows)}"
            row: dict[str, Any] = {"task_id": task_id}
            if members.get(turn.speaker):
                row["member"] = members[turn.speaker]
            else:
                asked.append(f"{task_id}.member")
            row["text"] = sentence
            row.update(provenance_cols(Provenance(item.id, second=turn.start_s)))
            rows.append(row)
    return rows, call, asked


def signer_table(ctx: SenseContext) -> SignerTable | None:
    """The chore's ``senses/signers.json``, or ``None`` when it has none."""
    path = ctx.senses_dir / SIGNERS_FILE
    if not path.is_file():
        return None
    try:
        return load_table(json.loads(path.read_text(encoding="utf-8")))
    except SignerTableError as exc:
        from athena.senses.build import SenseError

        raise SenseError([f"{SIGNERS_FILE}: {p}" for p in exc.problems]) from None


def build(ctx: SenseContext) -> SenseOutput:
    items = [m for m in ctx.media if m.sense == SENSE]
    calls: list[SenseCall] = []
    asked: list[str] = []
    meds: list[dict[str, Any]] = []
    tasks: list[dict[str, Any]] = []
    for item in items:
        if item.kind in ("photo", "video"):
            rows, made, more = _counter(ctx, item)
            meds.extend(rows)
            calls.extend(made)
            asked.extend(more)
        elif item.kind == "audio":
            rows, call, more = _call_tasks(ctx, item, len(tasks) + 1)
            tasks.extend(rows)
            calls.append(call)
            asked.extend(more)
    tables: dict[str, list[dict[str, Any]]] = {COUNTER_MEDS: meds, CIRCLE_TASKS: tasks}
    table = signer_table(ctx)
    if table is not None:
        tables[SIGNER_RULES] = flatten(table, SIGNERS_FILE)
    return SenseOutput(tables=tables, calls=tuple(calls), asked=tuple(asked))


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


def _prove_signers(ctx: SenseContext, circle: Mapping[str, Any]) -> list[ProofResult]:
    table = signer_table(ctx)
    if table is None:
        return []
    cases: Sequence[Mapping[str, Any]] = circle.get("whose_yes", []) or []
    decisions: Sequence[Mapping[str, Any]] = circle.get("decisions", []) or []
    agree = 0
    for case in cases:
        req = whose_yes(str(case["action"]), str(case["subject"]), table)
        same = req.needs == case["needs"]
        if "parent_veto" in case and not req.refused:
            same = same and req.parent_veto == bool(case["parent_veto"])
        agree += same
    breaches = refusals = 0
    for case in decisions:
        req = whose_yes(str(case["action"]), str(case["subject"]), table)
        got = decide(req, case.get("yes", []), case.get("no", []), table, case.get("proposer"))
        want = bool(case["runs"])
        if got.runs and not want:
            breaches += 1
        elif want and not got.runs:
            refusals += 1
    right = agree + len(decisions) - breaches - refusals
    n = len(cases) + len(decisions)
    note = f"{agree} of {len(cases)} needs, {len(decisions) - breaches - refusals} of "
    note += f"{len(decisions)} decisions; {refusals} over-refused"
    return [
        _result(
            ctx,
            "F1",
            "whose yes: the table's answers vs the key, incl. veto and quorum",
            _share(right, n),
            F1_BAR,
            ">=",
            n,
            note,
        ),
        _result(
            ctx,
            "F1x",
            "breaches: an action that runs without its required signers",
            float(breaches) if decisions else None,
            F1X_BAR,
            "<=",
            len(decisions),
            f"{breaches} breaches over {len(decisions)} decisions",
        ),
    ]


def _prove_counter(
    ctx: SenseContext, output: SenseOutput, circle: Mapping[str, Any]
) -> list[ProofResult]:
    photos: Mapping[str, Any] = circle.get("photos", {}) or {}
    if not photos:
        return []
    rows = output.tables.get(COUNTER_MEDS, [])
    by_photo: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        by_photo.setdefault(str(row["media_id"]), []).append(row)
    exact = 0
    right = wrong = asked = missed = 0
    hard_asked = 0
    for media_id, photo in photos.items():
        bottles: Mapping[str, Any] = photo.get("bottles", {}) or {}
        seen = {str(r["med_id"]): r for r in by_photo.get(media_id, [])}
        exact += len(seen) == len(bottles)
        for med_id, want in bottles.items():
            med = seen.get(med_id)
            if med is None:
                missed += 1
                continue
            for field in LABEL_FIELDS:
                if field not in want:
                    continue
                if field not in med:
                    asked += 1
                    hard_asked += bool(want.get("hard"))
                elif label_norm(med[field]) == label_norm(want[field]):
                    right += 1
                else:
                    wrong += 1
    scored = right + wrong
    counts = ", ".join(
        f"{m} {len(by_photo.get(m, []))}/{len(dict(p.get('bottles', {})))}"
        for m, p in photos.items()
    )
    fields_note = f"{right} right, {wrong} wrong, {asked} asked ({hard_asked} on hard labels)"
    return [
        _result(
            ctx,
            "F3",
            "bottle count exact per counter photo vs key",
            _share(exact, len(photos)),
            F3_BAR,
            ">=",
            len(photos),
            counts,
        ),
        _result(
            ctx,
            "F3a",
            "label field accuracy over read fields",
            _share(right, scored),
            F3A_BAR,
            ">=",
            scored,
            fields_note,
        ),
        _result(
            ctx,
            "F3x",
            "false clears: a label read wrong or a bottle missed",
            float(wrong + missed),
            F3X_BAR,
            "<=",
            scored + missed,
            f"{wrong} read wrong, {missed} bottles missed",
        ),
    ]


def _prove_tasks(
    ctx: SenseContext, output: SenseOutput, circle: Mapping[str, Any]
) -> list[ProofResult]:
    calls: Mapping[str, Any] = circle.get("tasks", {}) or {}
    if not calls:
        return []
    rows = output.tables.get(CIRCLE_TASKS, [])
    expected = [(str(mid), dict(t)) for mid, ts in calls.items() for t in ts]
    used: set[int] = set()
    misattributed = missed = 0
    for media_id, want in expected:
        hit = next(
            (
                i
                for i, r in enumerate(rows)
                if i not in used
                and r.get("media_id") == media_id
                and abs(float(r.get("second", -1e9)) - float(want["second"])) <= SECOND_SLACK
                and str(want.get("says", "")).casefold() in str(r.get("text", "")).casefold()
            ),
            None,
        )
        if hit is None:
            missed += 1
            continue
        used.add(hit)
        if rows[hit].get("member") != want.get("member"):
            misattributed += 1
    spurious = sum(
        1 for i, r in enumerate(rows) if i not in used and str(r.get("media_id")) in calls
    )
    corrections = misattributed + missed + spurious
    note = f"{misattributed} misattributed, {missed} missed, {spurious} not a task"
    note += f"; {len(rows)} rows, {len(expected)} key tasks"
    return [
        _result(
            ctx,
            "F4",
            "task attribution: corrections a person makes, per key task",
            _share(corrections, len(expected)),
            F4_BAR,
            "<=",
            len(expected),
            note,
        ),
    ]


def prove(ctx: SenseContext, output: SenseOutput, key: Mapping[str, Any]) -> list[ProofResult]:
    raw = key.get(SENSE)
    circle: Mapping[str, Any] = raw if isinstance(raw, Mapping) else {}
    return [
        *_prove_signers(ctx, circle),
        *_prove_counter(ctx, output, circle),
        *_prove_tasks(ctx, output, circle),
    ]

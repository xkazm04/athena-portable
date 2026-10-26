"""The call sense (spike 02): a recorded phone call -> diarized, cited ``call_turns`` rows.

A media item of sense ``call`` is one recording (``kind: "audio"``) with three params::

    {"consent_line": "this call is being transcribed for my records",
     "speakers": {"A": "caregiver", "B": "insurer_rep"},
     "keywords": ["prior authorization", "DN-6104", ...]}

The Transcriber (fixture, or ``meta``: Voice Transcribe with ``keywords`` as biasing) returns
diarized turns; :func:`build` writes one ``call_turns`` row per turn::

    {turn_id: "<media_id>#<n>" (n from 1, in transcript order), media_id, speaker, second, end_s,
     text}

``speaker`` is the ROLE ``speakers`` maps the diarized label to; a label the map does not name (an
IVR, a third voice) is kept as the label itself, never guessed into a role. ``second`` is the
turn's start, the provenance column every sensed row carries (ADR 0300).

**The consent rule (spike 02's "never records a call without the spoken consent line").** Unless
a turn starting inside the first :data:`CONSENT_WINDOW_S` seconds contains the item's consent line
- compared case- and punctuation-insensitively, whitespace collapsed - the call yields NO turns
and ``asked`` gets ``"<media_id>.consent"``. The transcription call still ran (it is how the line
is heard) and is still a :class:`~athena.senses.contract.SenseCall` row; only its words are
dropped. A consent line said later in the call does not rescue it. One ``call_log`` row per call
says which happened (``consent: "heard" | "missing"``, ``turns``, and ``second`` of the consent
turn when heard), so a read tool can tell the caregiver why a call has no turns.

The sense reads only its own items. :func:`prove` measures the README's F1, F3, F4 and R4 proofs
against ``key.json["call"]``; for F3 it resolves a packet's sheet cites against the merged build's
``sheet_fields`` - a measurement of the packet, never an input to the build.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Any

from athena.senses.call.packet import packet_sha256, unsupported
from athena.senses.contract import (
    MediaItem,
    ProofResult,
    Provenance,
    SenseCall,
    SenseContext,
    SenseOutput,
    Transcript,
    provenance_cols,
)

__all__ = [
    "CONSENT_WINDOW_S",
    "SECOND_TOLERANCE_S",
    "build",
    "consent_turn",
    "normalise",
    "prove",
    "turn_rows",
]

#: A consent line counts only when its turn starts inside the call's first minute.
CONSENT_WINDOW_S = 60.0
#: How far a key's expected second may sit from a sensed turn's start and still be that turn.
SECOND_TOLERANCE_S = 1.0

#: How F3 decides a sentence has a source (and what it does not claim to decide).
RESOLVES = "cites resolve to a kept turn or a read sheet field (resolution, not a model audit)"

_PUNCT = re.compile(r"[^\w\s]", re.UNICODE)


def normalise(text: str) -> str:
    """Lower case, punctuation dropped, whitespace collapsed: how a consent line is compared."""
    return " ".join(_PUNCT.sub(" ", text.lower()).split())


def consent_turn(transcript: Transcript, consent_line: str) -> int | None:
    """The index of the first turn inside :data:`CONSENT_WINDOW_S` that says the consent line."""
    line = normalise(consent_line)
    if not line:
        return None
    for i, turn in enumerate(transcript.turns):
        if turn.start_s < CONSENT_WINDOW_S and line in normalise(turn.text):
            return i
    return None


def turn_rows(media: MediaItem, transcript: Transcript) -> list[dict[str, Any]]:
    """Every turn as a ``call_turns`` row, each label mapped to its role where the map names one."""
    raw = media.params.get("speakers", {})
    speakers = {str(k): str(v) for k, v in raw.items()} if isinstance(raw, Mapping) else {}
    rows: list[dict[str, Any]] = []
    for n, turn in enumerate(transcript.turns, start=1):
        rows.append(
            {
                "turn_id": f"{media.id}#{n}",
                **provenance_cols(Provenance(media_id=media.id, second=turn.start_s)),
                "speaker": speakers.get(turn.speaker, turn.speaker),
                "end_s": turn.end_s,
                "text": turn.text,
            }
        )
    return rows


def build(ctx: SenseContext) -> SenseOutput:
    turns: list[dict[str, Any]] = []
    log: list[dict[str, Any]] = []
    calls: list[SenseCall] = []
    asked: list[str] = []
    for media in ctx.media:
        if media.sense != "call":
            continue
        path = ctx.senses_dir / media.path if media.path else None
        file = path if path is not None and path.is_file() else None
        transcript, call = ctx.senses.transcriber.transcribe(media, file)
        calls.append(call)
        heard = consent_turn(transcript, str(media.params.get("consent_line", "")))
        if heard is None:
            asked.append(f"{media.id}.consent")
            log.append({"media_id": media.id, "consent": "missing", "turns": 0})
            continue
        rows = turn_rows(media, transcript)
        turns.extend(rows)
        log.append(
            {
                **provenance_cols(
                    Provenance(media_id=media.id, second=transcript.turns[heard].start_s)
                ),
                "consent": "heard",
                "turns": len(rows),
            }
        )
    return SenseOutput(
        tables={"call_turns": turns, "call_log": log}, calls=tuple(calls), asked=tuple(asked)
    )


# --- proofs --------------------------------------------------------------------------------------


def _at(
    rows: Sequence[Mapping[str, Any]], media_id: str, second: float
) -> Mapping[str, Any] | None:
    """The sensed turn of ``media_id`` starting nearest ``second``, within the tolerance."""
    near = [
        r
        for r in rows
        if r.get("media_id") == media_id
        and abs(float(r.get("second", -1e9)) - second) <= SECOND_TOLERANCE_S
    ]
    return min(near, key=lambda r: abs(float(r["second"]) - second)) if near else None


def _result(
    ctx: SenseContext,
    pid: str,
    question: str,
    hits: float,
    n: int,
    bar: float,
    op: str = ">=",
    note: str = "",
    *,
    share: bool = True,
) -> ProofResult:
    measured: float | None = (hits / n if n else None) if share else hits
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


def _alterations(sentences: Sequence[Mapping[str, Any]]) -> list[list[dict[str, Any]]]:
    """One-byte edits of a packet: the last character of each sentence and of each cite flipped."""

    def flip(value: str) -> str:
        return value[:-1] + ("," if value.endswith(".") else ".") if value else "."

    out: list[list[dict[str, Any]]] = []
    base: list[dict[str, Any]] = [
        {"text": str(s.get("text", "")), "cites": [str(c) for c in s.get("cites", [])]}
        for s in sentences
    ]
    for i, s in enumerate(base):
        text: str = s["text"]
        cited: list[str] = s["cites"]
        out.append([*base[:i], {**s, "text": flip(text)}, *base[i + 1 :]])
        for j, cite in enumerate(cited):
            cites = [*cited[:j], flip(cite), *cited[j + 1 :]]
            out.append([*base[:i], {**s, "cites": cites}, *base[i + 1 :]])
    return out


def prove(ctx: SenseContext, output: SenseOutput, key: Mapping[str, Any]) -> list[ProofResult]:
    spec = key.get("call", {})
    spec = spec if isinstance(spec, Mapping) else {}
    calls = dict(spec.get("calls", {}))
    rows = [dict(r) for r in output.tables.get("call_turns", [])]
    asked = set(output.asked)

    attributed = expected = exact = exact_n = 0
    consent_ok = 0
    for mid, want in calls.items():
        kept = [r for r in rows if r.get("media_id") == mid]
        if want.get("consent"):
            consent_ok += int(bool(kept) and f"{mid}.consent" not in asked)
        else:
            consent_ok += int(not kept and f"{mid}.consent" in asked)
        for turn in want.get("turns", []):
            expected += 1
            got = _at(rows, mid, float(turn["second"]))
            attributed += int(got is not None and got.get("speaker") == turn["speaker"])
        for item in want.get("exact", []):
            exact_n += 1
            got = _at(rows, mid, float(item["second"]))
            exact += int(got is not None and str(item["text"]) in str(got.get("text", "")))

    packets = dict(spec.get("packets", {}))
    drafts = {
        str(r.get("packet_id")): r
        for r in ctx.world.get("tables", {}).get(str(packets.get("table", "")), [])
    }
    resolvable = {str(r["turn_id"]) for r in rows}
    resolvable |= {
        f"{r.get('sheet_id')}.{r.get('field')}"
        for r in output.tables.get("sheet_fields", [])
        if r.get("status") == "read"
    }
    fileable = [drafts[p] for p in packets.get("fileable", []) if p in drafts]
    loose = sum(len(unsupported(d.get("sentences", []), resolvable)) for d in fileable)
    seeded = [p for p in packets.get("unsupported", []) if p in drafts]
    caught = sum(1 for p in seeded if unsupported(drafts[p].get("sentences", []), resolvable))
    missing = [p for p in (*packets.get("fileable", []), *seeded) if p not in drafts]

    bound = checks = 0
    for draft in drafts.values():
        sentences = draft.get("sentences", [])
        stored = str(draft.get("packet_sha256", ""))
        checks += 1
        bound += int(stored == packet_sha256(sentences))
        for altered in _alterations(sentences):
            checks += 1
            bound += int(packet_sha256(altered) != stored)

    return [
        _result(
            ctx,
            "F1",
            "speaker attribution of the key's turns (consented calls)",
            attributed,
            expected,
            0.90,
        ),
        _result(
            ctx,
            "F1k",
            "reference numbers and dates exact in the cited turn",
            exact,
            exact_n,
            0.95,
        ),
        _result(
            ctx,
            "F3",
            "sentences without a resolving source in the fileable packet",
            loose,
            sum(len(d.get("sentences", [])) for d in fileable),
            0.0,
            "<=",
            note=f"{RESOLVES}; missing {missing}" if missing else RESOLVES,
            share=False,
        ),
        _result(
            ctx,
            "F3x",
            "seeded unsupported drafts caught before signing",
            caught,
            len(seeded),
            1.0,
        ),
        _result(
            ctx,
            "F4",
            "stored hash binds each draft and every one-byte alteration moves it",
            bound,
            checks,
            1.0,
            note="refusing a spent or mismatched approval is core/approvals.py's (ADR 0038)",
        ),
        _result(
            ctx,
            "R4",
            "consent gate: a call without the line in its first minute yields no turns",
            consent_ok,
            len(calls),
            1.0,
            note="consent half only; the representative authority is a truth trap on the bench",
        ),
    ]

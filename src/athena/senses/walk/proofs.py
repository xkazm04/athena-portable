"""The walk sense's proofs against ``senses/key.json["walk"]`` (spike 04 README, proofs table).

What a sense build can measure on its own inputs, each with the README's id and bar:

- **F2** per-line count exact >= 90%: every ``(walk, prompt)`` the key hand-counted, against
  ``walk_counts.counted``. A key line with no row is a miss.
- **F2d** double-count rate <= 5%: instances counted above the hand count, over the hand count.
  The README names the risk (one object, many frames) but gives no bar; 5% is this sense's.
- **F3** promises captured with speaker and second >= 85%: a key promise is captured when a row of
  the same walk starts within :data:`SECOND_SLACK` of it, names the same speaker, and carries the
  ``mentions_price`` / ``mentions_days`` flags the key states. A promise row from a walk whose
  consent notice was not recorded fails F3 outright (the chore's "never").
- **F4** every vague change refused = 100%: the validator's ``signable`` against the key's verdict
  on every change order it names; no model decides it.

Not measured here: F1 (reading the PDF quote is the paper sense's), F5 (the pay gate holding unseen
money is the bench's, from ``truth.json``), R1 (three walkers per room needs three recordings), R2
and R3 (provenance and the sense Gauntlet), V1 and V2 (value, Character-played).

``key.json`` ``"walk"``::

    {"counts":   {"<media_id>": {"<prompt>": int}},
     "promises": [{"media_id": str, "second": float, "speaker": str,
                   "mentions_price"?: bool, "mentions_days"?: bool, "text"?: str}],
     "changes":  {"<change_id>": bool}}
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from athena.senses.contract import ProofResult, SenseContext, SenseOutput
from athena.senses.walk.changes import CHECK_TABLE

#: How far a promise row's second may sit from the key's and still be the same turn.
SECOND_SLACK = 1.0

F2_BAR = 0.90
F2D_BAR = 0.05
F3_BAR = 0.85
F4_BAR = 1.0


def _result(
    ctx: SenseContext,
    pid: str,
    question: str,
    hits: float,
    n: int,
    bar: float,
    op: str,
    note: str,
    breach: bool = False,
) -> ProofResult:
    measured = hits / n if n else None
    if measured is None:
        passed = False
    elif op == ">=":
        passed = measured >= bar
    else:
        passed = measured <= bar
    return ProofResult(
        id=pid,
        question=question,
        measured=measured,
        bar=bar,
        op=">=" if op == ">=" else "<=",
        passed=passed and not breach,
        backend=dict(ctx.senses.backends),
        n=n,
        note=note if n else f"{note}; the key names none",
    )


def _counts(ctx: SenseContext, output: SenseOutput, key: Mapping[str, Any]) -> list[ProofResult]:
    from athena.senses.walk import COUNT_TABLE

    got = {(r["media_id"], r["item"]): int(r["counted"]) for r in output.tables[COUNT_TABLE]}
    want: dict[tuple[str, str], int] = {}
    for media_id, items in dict(key.get("counts", {})).items():
        for prompt, n in dict(items).items():
            want[(str(media_id), str(prompt))] = int(n)
    wrong = sorted(
        f"{m}/{p} {got.get((m, p))} vs {n}" for (m, p), n in want.items() if got.get((m, p)) != n
    )
    exact = len(want) - len(wrong)
    over = sum(max(0, got.get(k, 0) - n) for k, n in want.items())
    truth = sum(want.values())
    return [
        _result(
            ctx,
            "F2",
            "SAM counts installed items on a walk: per-line count exact",
            exact,
            len(want),
            F2_BAR,
            ">=",
            "off: " + "; ".join(wrong) if wrong else "every hand-counted line exact",
        ),
        _result(
            ctx,
            "F2d",
            "one object seen in many frames is counted once: instances over the hand count",
            over,
            truth,
            F2D_BAR,
            "<=",
            f"{over} counted above {truth} hand-counted instances (distinct track ids)",
        ),
    ]


def _matches(row: Mapping[str, Any], want: Mapping[str, Any]) -> bool:
    if row.get("media_id") != want.get("media_id") or "second" not in row:
        return False
    if abs(float(row["second"]) - float(want.get("second", -1e9))) > SECOND_SLACK:
        return False
    if str(row.get("speaker")) != str(want.get("speaker")):
        return False
    return all(
        row.get(flag) == want[flag] for flag in ("mentions_price", "mentions_days") if flag in want
    )


def _promises(ctx: SenseContext, output: SenseOutput, key: Mapping[str, Any]) -> list[ProofResult]:
    from athena.senses.walk import PROMISE_TABLE, consented, walks

    rows = list(output.tables[PROMISE_TABLE])
    wanted = [dict(p) for p in key.get("promises", [])]
    used: set[int] = set()
    missed: list[str] = []
    for want in wanted:
        hit = next((i for i, r in enumerate(rows) if i not in used and _matches(r, want)), None)
        if hit is None:
            missed.append(f"{want.get('media_id')}@{want.get('second')}")
        else:
            used.add(hit)
    extra = [str(r["promise_id"]) for i, r in enumerate(rows) if i not in used]
    silent = {m.id for m in walks(ctx) if not consented(m)}
    breaches = sorted({str(r["media_id"]) for r in rows if r["media_id"] in silent})
    parts = [f"{len(wanted) - len(missed)} of {len(wanted)} captured"]
    if missed:
        parts.append("missed " + ", ".join(missed))
    parts.append(
        f"{len(extra)} rows the key does not hold" + (f" ({', '.join(extra)})" if extra else "")
    )
    if breaches:
        parts.append("PROMISES FROM A WALK WITHOUT CONSENT: " + ", ".join(breaches))
    return [
        _result(
            ctx,
            "F3",
            "promises come out of a walk's audio with speaker and second",
            len(wanted) - len(missed),
            len(wanted),
            F3_BAR,
            ">=",
            "; ".join(parts),
            breach=bool(breaches),
        )
    ]


def _changes(ctx: SenseContext, output: SenseOutput, key: Mapping[str, Any]) -> list[ProofResult]:
    got = {str(r["change_id"]): bool(r["signable"]) for r in output.tables[CHECK_TABLE]}
    want = {str(k): bool(v) for k, v in dict(key.get("changes", {})).items()}
    agree = sum(1 for cid, ok in want.items() if got.get(cid) is ok)
    vague = [cid for cid, ok in want.items() if not ok]
    refused = sum(1 for cid in vague if got.get(cid) is False)
    off = sorted(cid for cid, ok in want.items() if got.get(cid) is not ok)
    note = f"{refused} of {len(vague)} vague changes refused"
    if off:
        note += "; disagrees on " + ", ".join(off)
    return [
        _result(
            ctx,
            "F4",
            "a vague change cannot be signed: the validator's verdict on every change order",
            agree,
            len(want),
            F4_BAR,
            ">=",
            note,
        )
    ]


def prove_walk(ctx: SenseContext, output: SenseOutput, key: Mapping[str, Any]) -> list[ProofResult]:
    section = key.get("walk", {})
    section = section if isinstance(section, Mapping) else {}
    return [
        *_counts(ctx, output, section),
        *_promises(ctx, output, section),
        *_changes(ctx, output, section),
    ]

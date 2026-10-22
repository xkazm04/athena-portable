"""WP-V (nvidia-revisit): scoring, pure. A model never sets a verdict; this code does.

A *reading* is one reader's answer for one unit (a document at a degradation): ``{entry_id: text}``.
For each fact/trap entry of the scenario, against what the document states (``facts.json``):

* stated and the value matches an ``accept`` pattern and no ``reject`` pattern: **correct**;
* stated and anything else (empty, off, or matching ``reject``): **incorrect**;
* a **false fact** is a value given for an entry the document does not state, or a value that
  matches a ``reject`` pattern.

A reading whose call failed for a reason that says nothing about the model (budget, network,
timeout, the ceiling the harness set) has ``values = None`` and is *void*: it is counted and left
out of every rate. An answer the model gave that was not usable JSON is scored as empty.
"""

from __future__ import annotations

import math
import re
import statistics
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from athena.proving.adopt_tiers.scenarios import Entry, Scenario
from athena.proving.docread.corpus import Unit
from athena.proving.roles import RoleReply

__all__ = [
    "KILL_RATIO",
    "PASS_FALSE_FACT_PP",
    "PASS_RATIO",
    "Reading",
    "proof",
    "score_readers",
    "score_unit",
]

#: The brief's proof: VL accuracy >= 90% of Claude's AND false-fact rate <= Claude's + 5 pp.
PASS_RATIO = 0.90
PASS_FALSE_FACT_PP = 0.05
#: ... and its kill: VL accuracy < 70% of Claude's.
KILL_RATIO = 0.70

_NOT_STATED = re.compile(
    r"^\W*(?:(?:n/?a|none|null|nil|unknown|empty)\W*$"
    r"|not\s+(?:stated|given|mentioned|provided|shown|present|in\b)"
    r"|no\s+(?:value|information|mention)\b)",
    re.I,
)


@dataclass(frozen=True)
class Reading:
    """One reader's answer for one unit, with what the call cost."""

    reader: str
    unit: str
    #: ``None`` = void: the call failed for a reason that says nothing about the reader.
    values: dict[str, str] | None
    model: str = ""
    ms: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float | None = None
    error_reason: str | None = None
    #: The model answered but not as the strict JSON object asked for.
    bad_answer: bool = False

    @classmethod
    def from_reply(
        cls,
        reader: str,
        unit: str,
        reply: RoleReply,
        values: dict[str, str] | None,
        *,
        bad_answer: bool = False,
    ) -> Reading:
        if reply.ok and values is None:
            values = {}
            bad_answer = True
        return cls(
            reader=reader,
            unit=unit,
            values=values if reply.ok else None,
            model=reply.model,
            ms=reply.ms,
            input_tokens=reply.input_tokens,
            output_tokens=reply.output_tokens,
            cost_usd=reply.cost_usd,
            error_reason=reply.error_reason,
            bad_answer=bad_answer,
        )

    def to_json(self) -> dict[str, Any]:
        return {
            "reader": self.reader,
            "unit": self.unit,
            "values": self.values,
            "model": self.model,
            "ms": self.ms,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cost_usd": self.cost_usd,
            "error_reason": self.error_reason,
            "bad_answer": self.bad_answer,
        }

    @classmethod
    def from_json(cls, raw: Mapping[str, Any]) -> Reading:
        values = raw.get("values")
        cost = raw.get("cost_usd")
        return cls(
            reader=str(raw["reader"]),
            unit=str(raw["unit"]),
            values={str(k): str(v) for k, v in values.items()}
            if isinstance(values, dict)
            else None,
            model=str(raw.get("model") or ""),
            ms=int(raw.get("ms") or 0),
            input_tokens=int(raw.get("input_tokens") or 0),
            output_tokens=int(raw.get("output_tokens") or 0),
            cost_usd=float(cost) if isinstance(cost, int | float) else None,
            error_reason=str(raw["error_reason"]) if raw.get("error_reason") else None,
            bad_answer=bool(raw.get("bad_answer")),
        )


def _hit(patterns: Iterable[str], text: str) -> bool:
    return any(re.search(p, text, re.I) for p in patterns)


def _squash(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().casefold()


def given(value: str | None) -> str:
    """The value a reader gave, or ``""`` when it gave none (blank, or "not stated")."""
    text = (value or "").strip()
    return "" if not text or _NOT_STATED.match(text) else text


def score_unit(
    entries: Sequence[Entry], states: Iterable[str], values: Mapping[str, str]
) -> list[dict[str, Any]]:
    """One row per fact/trap entry: ``stated``, ``given``, ``correct``, ``false_fact``."""
    stated = set(states)
    rows: list[dict[str, Any]] = []
    for entry in entries:
        if entry.kind not in ("fact", "trap"):
            continue
        text = given(values.get(entry.id))
        # A reader that copies the sheet's own sentence is right even where a reject pattern
        # also matches it (typical-medicaid's t-other-money: "... Nothing else." vs ``nothing``).
        verbatim = bool(text) and _squash(entry.truth) in _squash(text)
        accepted = bool(text) and (verbatim or _hit(entry.accept, text))
        rejected = bool(text) and not verbatim and _hit(entry.reject, text)
        is_stated = entry.id in stated
        rows.append(
            {
                "entry": entry.id,
                "stated": is_stated,
                "given": bool(text),
                "correct": is_stated and accepted and not rejected,
                "false_fact": bool(text) and (not is_stated or rejected),
            }
        )
    return rows


def _rate(num: int, den: int) -> float | None:
    return round(num / den, 4) if den else None


def _p50(values: Sequence[float]) -> float | None:
    return round(statistics.median(values), 1) if values else None


def score_readers(
    scenarios: Mapping[str, Scenario],
    units: Sequence[Unit],
    readings: Sequence[Reading],
    *,
    paired: bool = False,
) -> dict[str, dict[str, Any]]:
    """Per reader: field accuracy, false-fact rate, per-degradation accuracy, latency p50, cost per
    document, and the n behind each. ``paired`` keeps only units every reader answered."""
    by_unit = {u.id: u for u in units}
    readers = sorted({r.reader for r in readings})
    answered: dict[str, set[str]] = {
        name: {r.unit for r in readings if r.reader == name and r.values is not None}
        for name in readers
    }
    common = set.intersection(*answered.values()) if answered and paired else None
    out: dict[str, dict[str, Any]] = {}
    for name in readers:
        mine = [r for r in readings if r.reader == name and r.unit in by_unit]
        scored = [r for r in mine if r.values is not None and (common is None or r.unit in common)]
        stated = correct = probes = false = 0
        per_deg: dict[str, list[int]] = {}
        for r in scored:
            unit = by_unit[r.unit]
            rows = score_unit(scenarios[unit.scenario].sheet, unit.facts, r.values or {})
            s = sum(1 for x in rows if x["stated"])
            c = sum(1 for x in rows if x["correct"])
            stated += s
            correct += c
            probes += len(rows)
            false += sum(1 for x in rows if x["false_fact"])
            bucket = per_deg.setdefault(unit.degradation, [0, 0, 0])
            bucket[0] += c
            bucket[1] += s
            bucket[2] += 1
        costs = [r.cost_usd for r in scored if r.cost_usd is not None]
        out[name] = {
            "model": next((r.model for r in mine if r.model), ""),
            "units": len(scored),
            "void": sum(1 for r in mine if r.values is None),
            "bad_answers": sum(1 for r in scored if r.bad_answer),
            "fields_stated": stated,
            "fields_correct": correct,
            "field_accuracy": _rate(correct, stated),
            "probes": probes,
            "false_facts": false,
            "false_fact_rate": _rate(false, probes),
            "by_degradation": {
                deg: {"accuracy": _rate(c, s), "fields": s, "units": n}
                for deg, (c, s, n) in sorted(per_deg.items())
            },
            "latency_p50_ms": _p50([float(r.ms) for r in scored if r.ms]),
            "cost_per_doc_usd": round(sum(costs) / len(costs), 6) if costs else None,
            "cost_total_usd": round(sum(costs), 6) if costs else None,
            "cost_n": len(costs),
        }
    return out


def proof(scores: Mapping[str, Mapping[str, Any]]) -> dict[str, Any]:
    """The brief's verdict, computed here: PASS / KILL / MIXED, with the figures behind it.

    PASS: VL accuracy >= 90% of Claude's AND VL false-fact rate <= Claude's + 5 pp. KILL: VL
    accuracy < 70% of Claude's. Anything between is MIXED. No verdict without both readers.
    """
    vl, claude = scores.get("vl"), scores.get("claude")
    if vl is None or claude is None:
        return {"verdict": "NOT_RUN", "reason": "both readers are needed for a verdict"}
    va, ca = vl.get("field_accuracy"), claude.get("field_accuracy")
    vf, cf = vl.get("false_fact_rate"), claude.get("false_fact_rate")
    if va is None or ca is None or vf is None or cf is None:
        return {"verdict": "NOT_RUN", "reason": "a reader has no scored fields"}
    if ca == 0:
        return {"verdict": "NOT_RUN", "reason": "the Claude control scored 0, no ratio"}
    ratio = va / ca
    accuracy_ok = ratio >= PASS_RATIO
    false_ok = vf <= cf + PASS_FALSE_FACT_PP + 1e-9
    verdict = "PASS" if accuracy_ok and false_ok else "KILL" if ratio < KILL_RATIO else "MIXED"
    return {
        "verdict": verdict,
        "accuracy_ratio": round(ratio, 4),
        "accuracy_ok": accuracy_ok,
        "false_fact_delta_pp": round((vf - cf) * 100, 2),
        "false_fact_ok": false_ok,
        "vl_units": vl["units"],
        "claude_units": claude["units"],
        "rule": (
            f"PASS: ratio >= {PASS_RATIO} and false-fact <= claude + "
            f"{PASS_FALSE_FACT_PP * 100:g}pp;"
            f" KILL: ratio < {KILL_RATIO}"
        ),
    }


def wilson(correct: int, n: int, z: float = 1.96) -> tuple[float, float] | None:
    """A 95% Wilson interval for a rate, so the report can show how wide n makes it."""
    if n == 0:
        return None
    p = correct / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return round(max(0.0, centre - half), 4), round(min(1.0, centre + half), 4)

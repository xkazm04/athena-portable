"""ADR 0097 (tier bench, the pick): quality floor first, then the fastest p50, usage as tiebreak.

Per role kind (``interview``, ``audit``; ``shape`` apart), over every run of a config:

1. **Disqualify** a config with any false clear or any repeat across its runs, a mean slot
   accuracy more than :data:`ACCURACY_MARGIN` points under the best config's, or a judge mean under
   :data:`JUDGE_FLOOR` (an unjudged config cannot show it clears the floor, so it is out too).
2. Among the rest, the **fastest p50** — for ``interview`` the p50 time to first text of its legs
   (what the person waits on), for ``audit`` the p50 round latency (the audit is the longer of
   the two legs a round runs side by side).
3. **Usage breaks a tie**: configs within :data:`TIE_BAND` of the fastest p50 are a tie, and the
   one that used least wins. (An exact tie in milliseconds never happens; a 5 % band is the
   bench's reading of "tiebreak".)

If every config is disqualified, the best-accuracy one is kept and the pick says so. One config
sets both ``interview`` and ``audit`` for a run, so their quality numbers are the same runs': the
two roles differ only in which latency ranks them.

``shape`` is measured apart (validation, portals, wall time): a config is disqualified by any run
that failed validation or left a portal name unsubstituted; then the fastest p50 wall, usage as
tiebreak; if all are out, the best pass rate is kept and said so.

``--write`` writes the picks into ``src/athena/adopt/tiers.json`` — ``interview``, ``audit``,
``shape`` only; ``_note`` and every other kind are kept as they are.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from athena.adopt.legs import TIERS_PATH, load_tiers
from athena.proving.adopt_tiers.scenarios import Scenario
from athena.proving.adopt_tiers.score import percentile, score_interview
from athena.proving.adopt_tiers.simulate import CONFIGS, read_record

__all__ = [
    "ACCURACY_MARGIN",
    "JUDGE_FLOOR",
    "TIE_BAND",
    "ConfigStats",
    "Pick",
    "ShapeStats",
    "aggregate",
    "aggregate_shape",
    "load_results",
    "pick_all",
    "pick_role",
    "pick_shape",
    "write_tiers",
]

ACCURACY_MARGIN = 5.0
JUDGE_FLOOR = 3.5
TIE_BAND = 0.05


@dataclass
class ConfigStats:
    config: str
    runs: int = 0
    accuracy: float | None = None
    false_clears: int = 0
    repeats: int = 0
    judge: float | None = None
    judged: int = 0
    round_p50: float | None = None
    round_p95: float | None = None
    first_text_p50: float | None = None
    audit_p50: float | None = None
    rounds: float | None = None
    questions: float | None = None
    usage_interview: float | None = None
    usage_audit: float | None = None
    usage_unit: str = "usd"
    ended: dict[str, int] = field(default_factory=dict)
    right: int = 0
    wrong: int = 0
    missed: int = 0


@dataclass
class ShapeStats:
    config: str
    runs: int = 0
    valid: int = 0
    portals_ok: int = 0
    ms_p50: float | None = None
    ms_p95: float | None = None
    usage: float | None = None
    usage_unit: str = "usd"


@dataclass
class Pick:
    role: str
    config: str | None
    why: str
    fallback: bool = False
    disqualified: dict[str, list[str]] = field(default_factory=dict)


# --- loading --------------------------------------------------------------------------------


def load_results(
    run_dir: Path, scenarios: Sequence[Scenario]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """The complete interview and shape records on disk for these scenarios."""
    wanted = {s.id for s in scenarios}

    def read(folder: str) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for path in sorted((run_dir / folder).glob("*.json")):
            record = read_record(path)
            if record and record.get("complete") and record.get("scenario") in wanted:
                out.append(record)
        return out

    return read("interviews"), read("shape")


# --- aggregation ----------------------------------------------------------------------------


def _mean(values: Sequence[float | int | None]) -> float | None:
    clean = [float(v) for v in values if v is not None]
    return round(sum(clean) / len(clean), 2) if clean else None


def aggregate(
    records: Sequence[Mapping[str, Any]], scenarios: Sequence[Scenario]
) -> dict[str, ConfigStats]:
    by_id = {s.id: s for s in scenarios}
    stats = {name: ConfigStats(name) for name in CONFIGS}
    grouped: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        scenario = by_id.get(str(record.get("scenario")))
        config = str(record.get("config"))
        if scenario is None or config not in stats:
            continue
        grouped.setdefault(config, []).append(score_interview(record, scenario))
    for config, scores in grouped.items():
        s = stats[config]
        s.runs = len(scores)
        s.accuracy = _mean([x["accuracy"] for x in scores])
        s.false_clears = sum(1 for x in scores if x["false_clear"])
        s.repeats = sum(len(x["repeats"]) for x in scores)
        judges = [x["judge"] for x in scores if x["judge"] is not None]
        s.judged = len(judges)
        s.judge = _mean(judges)
        rounds_ms = [v for x in scores for v in x["round_ms"]]
        s.round_p50 = percentile(rounds_ms, 50)
        s.round_p95 = percentile(rounds_ms, 95)
        s.first_text_p50 = percentile([v for x in scores for v in x["first_text_ms"]], 50)
        s.audit_p50 = percentile([v for x in scores for v in x["audit_ms"]], 50)
        s.rounds = _mean([x["rounds"] for x in scores])
        s.questions = _mean([x["questions"] for x in scores])
        costs_i = [x["usage"]["interview"]["cost_usd"] for x in scores]
        costs_a = [x["usage"]["audit"]["cost_usd"] for x in scores]
        if all(c is not None for c in costs_i + costs_a):
            s.usage_interview, s.usage_audit, s.usage_unit = _mean(costs_i), _mean(costs_a), "usd"
        else:
            s.usage_interview = _mean([x["usage"]["interview"]["tokens"] for x in scores])
            s.usage_audit = _mean([x["usage"]["audit"]["tokens"] for x in scores])
            s.usage_unit = "tokens"
        for x in scores:
            s.ended[x["ended"]] = s.ended.get(x["ended"], 0) + 1
            s.right += x["right"]
            s.wrong += x["wrong"]
            s.missed += x["missed"]
    return stats


def aggregate_shape(records: Sequence[Mapping[str, Any]]) -> dict[str, ShapeStats]:
    stats = {name: ShapeStats(name) for name in CONFIGS}
    grouped: dict[str, list[Mapping[str, Any]]] = {}
    for record in records:
        if str(record.get("config")) in stats:
            grouped.setdefault(str(record.get("config")), []).append(record)
    for config, rows in grouped.items():
        s = stats[config]
        s.runs = len(rows)
        s.valid = sum(1 for r in rows if r.get("valid"))
        s.portals_ok = sum(1 for r in rows if r.get("portals_ok"))
        walls = [r.get("wall_ms") for r in rows]
        s.ms_p50 = percentile(walls, 50)
        s.ms_p95 = percentile(walls, 95)
        costs: list[float | None] = []
        tokens: list[int] = []
        for r in rows:
            ledger = [x for x in r.get("ledger", []) if isinstance(x, Mapping)]
            c = [x.get("cost_usd") for x in ledger]
            costs.append(sum(float(v) for v in c if v is not None) if c and None not in c else None)
            tokens.append(
                sum(
                    int(x.get("input_tokens") or 0) + int(x.get("output_tokens") or 0)
                    for x in ledger
                )
            )
        if costs and all(c is not None for c in costs):
            s.usage, s.usage_unit = _mean(costs), "usd"
        else:
            s.usage, s.usage_unit = _mean(tokens), "tokens"
    return stats


# --- the rule -------------------------------------------------------------------------------


def _speed(role: str, s: ConfigStats) -> float | None:
    return s.first_text_p50 if role == "interview" else s.round_p50


def _usage(role: str, s: ConfigStats) -> float | None:
    return s.usage_interview if role == "interview" else s.usage_audit


def _fastest(
    names: Sequence[str],
    speed: Mapping[str, float | None],
    usage: Mapping[str, float | None],
) -> tuple[str, str]:
    """The fastest p50, configs within the tie band of it broken by usage; and why."""
    timed = [n for n in names if speed[n] is not None]
    if not timed:
        name = sorted(names, key=lambda n: (usage[n] is None, usage[n] or 0.0))[0]
        return name, "no latency was measured; least usage"
    best = min(float(speed[n] or 0.0) for n in timed)
    band = [n for n in timed if float(speed[n] or 0.0) <= best * (1 + TIE_BAND)]
    if len(band) == 1:
        return band[0], f"fastest p50 ({best:.0f} ms)"
    band.sort(key=lambda n: (usage[n] is None, usage[n] or 0.0, float(speed[n] or 0.0)))
    tied = ", ".join(band)
    return band[
        0
    ], f"within {TIE_BAND:.0%} of the fastest p50 ({best:.0f} ms) with {tied}; least usage"


def pick_role(role: str, stats: Mapping[str, ConfigStats]) -> Pick:
    """The pick for ``interview`` or ``audit``."""
    ran = {n: s for n, s in stats.items() if s.runs}
    if not ran:
        return Pick(role, None, "no complete runs")
    best = (
        max(s.accuracy for s in ran.values() if s.accuracy is not None)
        if any(s.accuracy is not None for s in ran.values())
        else None
    )
    out: dict[str, list[str]] = {}
    for name, s in ran.items():
        reasons: list[str] = []
        if s.false_clears:
            reasons.append(f"{s.false_clears} false clear(s)")
        if s.repeats:
            reasons.append(f"{s.repeats} repeat(s)")
        if best is not None and (s.accuracy is None or s.accuracy < best - ACCURACY_MARGIN):
            reasons.append(f"accuracy {s.accuracy} < best {best} - {ACCURACY_MARGIN:g}")
        if s.judge is None:
            reasons.append("not judged")
        elif s.judge < JUDGE_FLOOR:
            reasons.append(f"judge {s.judge} < {JUDGE_FLOOR}")
        if reasons:
            out[name] = reasons
    for name in stats:
        if name not in ran:
            out[name] = ["no complete runs"]
    survivors = [n for n in ran if n not in out]
    speed = {n: _speed(role, s) for n, s in stats.items()}
    usage = {n: _usage(role, s) for n, s in stats.items()}
    if survivors:
        name, why = _fastest(survivors, speed, usage)
        return Pick(role, name, why, disqualified=out)
    # Every config is out: keep the most accurate (speed breaks a tie) and say so.
    name = sorted(
        ran,
        key=lambda n: (-(ran[n].accuracy or 0.0), speed[n] is None, speed[n] or 0.0),
    )[0]
    why = (
        f"every config was disqualified; kept the best accuracy ({ran[name].accuracy}) "
        "— the floor is not met, read the report before trusting this pick"
    )
    return Pick(role, name, why, fallback=True, disqualified=out)


def pick_shape(stats: Mapping[str, ShapeStats], *, measured: bool, note: str = "") -> Pick:
    if not measured:
        return Pick("shape", None, note or "not measured")
    ran = {n: s for n, s in stats.items() if s.runs}
    if not ran:
        return Pick("shape", None, "no complete shape runs")
    out: dict[str, list[str]] = {}
    for name, s in ran.items():
        reasons: list[str] = []
        if s.valid < s.runs:
            reasons.append(f"{s.runs - s.valid} of {s.runs} failed validation")
        if s.portals_ok < s.runs:
            reasons.append(f"{s.runs - s.portals_ok} of {s.runs} left a portal name")
        if reasons:
            out[name] = reasons
    for name in stats:
        if name not in ran:
            out[name] = ["no complete runs"]
    survivors = [n for n in ran if n not in out]
    speed = {n: s.ms_p50 for n, s in stats.items()}
    usage = {n: s.usage for n, s in stats.items()}
    if survivors:
        name, why = _fastest(survivors, speed, usage)
        return Pick("shape", name, why, disqualified=out)
    name = sorted(
        ran,
        key=lambda n: (-(ran[n].valid + ran[n].portals_ok) / ran[n].runs, speed[n] or 0.0),
    )[0]
    why = "every config was disqualified; kept the best pass rate — read the report first"
    return Pick("shape", name, why, fallback=True, disqualified=out)


def pick_all(
    stats: Mapping[str, ConfigStats],
    shape: Mapping[str, ShapeStats],
    *,
    shape_measured: bool,
    shape_note: str = "",
) -> list[Pick]:
    return [
        pick_role("interview", stats),
        pick_role("audit", stats),
        pick_shape(shape, measured=shape_measured, note=shape_note),
    ]


# --- writing tiers.json ---------------------------------------------------------------------


def write_tiers(picks: Sequence[Pick], path: Path = TIERS_PATH) -> dict[str, Any]:
    """Write the picks for ``interview``, ``audit`` and ``shape`` into ``tiers.json``; every
    other key (``_note`` included) is kept. The file is checked by WP1's own loader before it
    replaces the old one. Answers what was written."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError(f"{path}: not a JSON object")
    for pick in picks:
        if pick.role not in ("interview", "audit", "shape") or pick.config is None:
            continue
        tier = CONFIGS[pick.config]
        raw[pick.role] = {"model": tier.model, "effort": tier.effort}
    lines = [f"  {json.dumps(key)}: {_compact(value)}" for key, value in raw.items()]
    text = "{\n" + ",\n".join(lines) + "\n}\n"
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(text, encoding="utf-8")
    try:
        load_tiers(tmp)
    except ValueError:
        tmp.unlink(missing_ok=True)
        raise
    tmp.replace(path)
    return dict(raw)


def _compact(value: Any) -> str:
    """One kind per line, as the file is written by hand: ``{ "model": ..., "effort": ... }``."""
    if isinstance(value, dict):
        inner = ", ".join(
            f"{json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}" for k, v in value.items()
        )
        return "{ " + inner + " }"
    return json.dumps(value, ensure_ascii=False)

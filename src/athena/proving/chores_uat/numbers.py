"""uat chores (spark chores-uat): the numbers audit — each chore's promise as the desktop shows it.

Deterministic, no model. One row per playbook, every figure computed the way the desktop's Chores
scene computes it, so the row is what a person reads and not what the playbook file means:

- **Value** (``annual_shown``, ``unit_shown``) mirrors ``annualValue`` and ``valueCell``
  (``apps/desktop/src/modules/playbooks/model.ts``, ``scenes/chores/model.ts``): a month is
  twelve, a week fifty-two, a year one; any other ``per`` (episode, quarter, estate) is shown
  raw in its own unit, ``"per <unit>"`` (the ``PER`` table's fallback).
- **Speed** (``speedup_shown``) mirrors ``speedup(manualMinutes, bench.wallS / 60)``
  (``lib/playbooks.ts``): the bench's wall clock only. ``speedup_with_review`` adds the person's
  review time (``your_time_s``), which the desktop does not.
- **Verdict** and ``bench_runs_n`` mirror ``verdictOf`` and ``comparableRuns``: the latest run's
  word, and how many comparable, unsuperseded runs stand behind it.
- ``world_total_usd`` is what the bench world holds (``score.value_total_usd``) and
  ``world_ratio`` how many times the shown value exceeds it: a ratio far above one is a promise
  the bench never measured.

The desktop's quirks are copied, not fixed, and each one that touches a row is named in its
``quirks``. **An absent figure is ``null``, never 0.** The caveat and the economics basis are
parsed or carried but rendered by no desktop view (``caveat_rendered``/``basis_rendered`` false:
no ``.tsx`` reads ``caveat``, ``basis`` or ``economics.sources``).
"""

from __future__ import annotations

import json
import math
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

__all__ = [
    "NOTES",
    "PER",
    "annual_value",
    "audit",
    "comparable_runs",
    "headline",
    "minutes_text",
    "number_row",
    "read_library",
    "speedup_text",
    "summary",
    "usd_text",
    "write_numbers",
]

#: ``modules/playbooks/model.ts`` ``PER``: the unit words; anything else is ``per <unit>``.
PER: dict[str, str] = {
    "year": "a year",
    "month": "a month",
    "week": "a week",
    "run": "a run",
    "claim": "a claim",
}
_YEARLY = ("year", "month", "week")
#: The desktop's own glyphs: the multiplication sign of "18x faster" and the en dash of "unknown".
TIMES = "\u00d7"
DASH = "\u2013"
_VERDICTS = ("exceeds", "meets", "short")
_LABELS = {
    "exceeds": "Exceeds",
    "meets": "Meets",
    "short": "Falls short",
    "unbenched": "Not benched",
}

#: What holds for every row, said once.
NOTES: tuple[str, ...] = (
    "speedup_shown is manual_minutes / (bench wall_s / 60), as lib/playbooks.ts speedup(); the "
    "person's review time (your_time_s) is not in it.",
    "economics.basis, economics.sources and the playbook caveat are rendered by no desktop view.",
)


# --- the library ---------------------------------------------------------------------------------


def _json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def read_library(root: str | Path) -> dict[str, tuple[dict[str, Any], dict[str, Any] | None]]:
    """``{id: (playbook.json, bench.json or None)}`` for every playbook directory under ``root``."""
    out: dict[str, tuple[dict[str, Any], dict[str, Any] | None]] = {}
    for folder in sorted(Path(root).iterdir()):
        playbook = _json(folder / "playbook.json") if folder.is_dir() else None
        if not isinstance(playbook, dict):
            continue
        bench = _json(folder / "bench.json")
        out[str(playbook.get("id") or folder.name)] = (
            playbook,
            bench if isinstance(bench, dict) else None,
        )
    return out


# --- the desktop's arithmetic, mirrored -----------------------------------------------------------


def _num(value: Any) -> float | None:
    """``numOrNull``: a finite number, else ``None`` (booleans are not numbers)."""
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value) if math.isfinite(value) else None


def annual_value(value_usd: float, per: str) -> float:
    """``annualValue``: month x12, week x52, anything else as it is."""
    if per == "month":
        return value_usd * 12
    if per == "week":
        return value_usd * 52
    return value_usd


def _js_round(x: float) -> int:
    """``Math.round``: halves go up."""
    return math.floor(x + 0.5)


def usd_text(n: float) -> str:
    """``usd``: whole dollars at 1000 and over or when whole, else cents."""
    whole = abs(n) >= 1000 or float(n).is_integer()
    sign = "-" if n < 0 else ""
    return f"{sign}${abs(n):,.0f}" if whole else f"{sign}${abs(n):,.2f}"


def minutes_text(m: float) -> str:
    """``minutes``: seconds under one minute, minutes under ninety, else hours."""
    if m < 1:
        return f"{max(1, _js_round(m * 60))} s"
    if m < 90:
        return f"{_js_round(m)} min"
    h = m / 60
    return f"{_js_text(h)} h" if h % 1 == 0 else f"{h:.1f} h"


def _js_text(x: float) -> str:
    return str(int(x)) if float(x).is_integer() else str(x)


def speedup_text(manual: float | None, measured: float | None) -> str:
    """``speedup``: "18x faster", or "" when either side is unknown."""
    if manual is None or measured is None or manual <= 0 or measured <= 0:
        return ""
    x = manual / measured
    return f"{_js_round(x)}{TIMES} faster" if x >= 10 else f"{x:.1f}{TIMES} faster"


def comparable_runs(bench: Mapping[str, Any]) -> tuple[int, int]:
    """``comparableRuns``: ``(n, exceeds)`` of the latest run and its comparable, unsuperseded
    history (a history line that IS the latest run rescored is not counted twice)."""
    verdict = bench.get("verdict")
    word = verdict.get("word") if isinstance(verdict, Mapping) else None
    word = word if word in _VERDICTS else "short"
    comparable = bench.get("comparable") if isinstance(bench.get("comparable"), str) else ""
    rescored = bench.get("rescored_at") if isinstance(bench.get("rescored_at"), str) else ""
    run_at = bench.get("run_at") if isinstance(bench.get("run_at"), str) else ""
    history = bench.get("history")
    pooled: list[Mapping[str, Any]] = []
    if comparable and isinstance(history, list):
        for h in history:
            if not isinstance(h, Mapping) or h.get("comparable") != comparable:
                continue
            if isinstance(h.get("superseded_by"), Mapping):
                continue
            if rescored and h.get("run_at") == run_at:
                continue
            pooled.append(h)
    exceeds = (1 if word == "exceeds" else 0) + sum(
        1 for h in pooled if h.get("verdict") == "exceeds"
    )
    return 1 + len(pooled), exceeds


def _sources_n(econ: Mapping[str, Any]) -> int:
    """The sources the desktop keeps: objects with an http(s) url."""
    rows = econ.get("sources")
    if not isinstance(rows, list):
        return 0
    return sum(
        1
        for s in rows
        if isinstance(s, Mapping)
        and isinstance(s.get("url"), str)
        and s["url"].startswith(("https://", "http://"))
    )


def number_row(playbook: Mapping[str, Any], bench: Mapping[str, Any] | None) -> dict[str, Any]:
    """One playbook's row of ``numbers.json``."""
    econ = playbook.get("economics")
    econ = econ if isinstance(econ, Mapping) else {}
    expect = playbook.get("expectation")
    expect = expect if isinstance(expect, Mapping) else {}
    quirks: list[str] = []

    value = _num(econ.get("value_usd"))
    raw_per = econ.get("per")
    per = raw_per if isinstance(raw_per, str) else "run"
    if not isinstance(raw_per, str):
        quirks.append("economics.per is absent: the desktop reads it as 'run'")
    if value is None:
        quirks.append("economics.value_usd is absent: the desktop shows $0")
    elif value == 0:
        quirks.append("economics.value_usd is 0: the desktop shows $0 as the value")
    annual = annual_value(value, per) if value is not None else None
    yearly = per in _YEARLY
    unit = "a year" if yearly else PER.get(per, f"per {per}")
    if not yearly:
        quirks.append(
            f"per {per!r} is not annualised: shown as {unit!r}, while the ledger's value sort "
            "compares it raw against yearly figures"
        )
        if per == "quarter":
            quirks.append("a quarter is not multiplied by 4 on the way to the ledger's value order")
        times = _num(econ.get("times_per_year"))
        if times is not None:
            quirks.append(f"economics.times_per_year = {times:g} is not used by the shown value")
    elif per != "year" and value is not None:
        quirks.append(
            f"the topic page shows {usd_text(annual or 0)} a year as Value but "
            f"'{usd_text(value)} {PER[per]}' under Make it yours"
        )

    manual = _num(econ.get("manual_minutes"))
    if manual is None or manual <= 0:
        quirks.append("manual_minutes is absent or 0: no time saved and no speedup is shown")

    score = bench.get("score") if bench is not None else None
    score = score if isinstance(score, Mapping) else {}
    world_total = _num(score.get("value_total_usd")) if bench is not None else None
    wall_s = _num(bench.get("wall_s")) if bench is not None else None
    your_s = _num(bench.get("your_time_s")) if bench is not None else None
    bench_minutes = wall_s / 60 if wall_s is not None else None
    your_minutes = your_s / 60 if your_s is not None else None

    if bench is None:
        verdict_word = "unbenched"
        runs_n: int | None = None
        quirks.append("no bench.json: 'Not benched', nothing measured")
    else:
        raw_verdict = bench.get("verdict")
        raw_word = raw_verdict.get("word") if isinstance(raw_verdict, Mapping) else None
        verdict_word = raw_word if raw_word in _VERDICTS else "short"
        if raw_word not in _VERDICTS:
            quirks.append(f"bench verdict {raw_word!r} is not a known word: shown as 'Falls short'")
        runs_n = comparable_runs(bench)[0]
        if not world_total:
            quirks.append("the bench world holds no dollar total: the verdict sentence names none")

    speedup = (
        manual / bench_minutes
        if manual is not None and bench_minutes is not None and manual > 0 and bench_minutes > 0
        else None
    )
    review = (bench_minutes or 0) + (your_minutes or 0) if bench_minutes is not None else None
    with_review = manual / review if manual is not None and review else None

    exp_minutes = _num(expect.get("minutes"))
    if exp_minutes is None:
        quirks.append("expectation.minutes is absent: the desktop assumes 30")

    basis = econ.get("basis")
    if not isinstance(basis, str):
        quirks.append("economics.basis is absent")
    ratio = annual / world_total if annual and world_total else None
    return {
        "id": str(playbook.get("id") or ""),
        "category": playbook.get("category") if isinstance(playbook.get("category"), str) else None,
        "audience": "home" if playbook.get("audience") == "home" else "work",
        "value_usd": value,
        "per": per,
        "annual_shown": annual,
        "unit_shown": unit,
        "world_total_usd": world_total,
        "world_ratio": round(ratio, 3) if ratio is not None else None,
        "basis_says_estimate": isinstance(basis, str) and "estimate" in basis.lower(),
        "sources_n": _sources_n(econ),
        "incumbent_fee_pct": _num(econ.get("incumbent_fee_pct")),
        "verdict": verdict_word,
        "bench_runs_n": runs_n,
        "manual_minutes": manual,
        "bench_minutes": round(bench_minutes, 3) if bench_minutes is not None else None,
        "your_minutes": round(your_minutes, 3) if your_minutes is not None else None,
        "speedup_shown": round(speedup, 3) if speedup is not None else None,
        "speedup_with_review": round(with_review, 3) if with_review is not None else None,
        "expectation_minutes": exp_minutes,
        "caveat_rendered": False,
        "basis_rendered": False,
        "quirks": quirks,
    }


def headline(row: Mapping[str, Any]) -> list[str]:
    """The chore's figures as the topic page's KPI band writes them (``chores/topic.tsx``)."""
    annual = row.get("annual_shown")
    value = (
        f"{usd_text(annual)} {row.get('unit_shown')}, for the persona"
        if annual is not None
        else DASH
    )
    manual = row.get("manual_minutes")
    bench = row.get("bench_minutes")
    hand = minutes_text(manual) if manual else DASH
    athena = minutes_text(bench) if bench is not None else DASH
    ratio = speedup_text(manual, bench) or ("measured" if bench is not None else "not benched yet")
    verdict = _LABELS.get(str(row.get("verdict")), str(row.get("verdict")))
    runs = row.get("bench_runs_n")
    lines = [
        f"Value: {value}",
        f"Time saved: {hand} by hand -> {athena} with Athena ({ratio})",
        f"Verdict: {verdict}" + (" (n=1, one run so far)" if runs == 1 else ""),
    ]
    return lines


# --- the audit -----------------------------------------------------------------------------------


def audit(root: str | Path) -> dict[str, Any]:
    """``numbers.json``'s document for the library at ``root``."""
    rows = [number_row(pb, bench) for pb, bench in read_library(root).values()]
    return {
        "generated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "notes": list(NOTES),
        "playbooks": rows,
    }


def write_numbers(doc: Mapping[str, Any], *paths: Path) -> list[Path]:
    written: list[Path] = []
    for path in paths:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        written.append(path)
    return written


def summary(doc: Mapping[str, Any]) -> dict[str, int]:
    """The headline counts of a numbers document."""
    rows = [r for r in doc.get("playbooks", []) if isinstance(r, Mapping)]
    ratios = [r.get("world_ratio") for r in rows]
    return {
        "playbooks": len(rows),
        "world_ratio_gt_3": sum(1 for x in ratios if isinstance(x, int | float) and x > 3),
        "world_ratio_gt_10": sum(1 for x in ratios if isinstance(x, int | float) and x > 10),
        "world_ratio_null": sum(1 for x in ratios if x is None),
        "basis_says_estimate": sum(1 for r in rows if r.get("basis_says_estimate")),
        "bench_runs_n_eq_1": sum(1 for r in rows if r.get("bench_runs_n") == 1),
        "unbenched": sum(1 for r in rows if r.get("verdict") == "unbenched"),
    }

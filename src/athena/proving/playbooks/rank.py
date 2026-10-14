"""Rank the playbooks by the method ADR 0056 fixed (README §14; ADR 0056, 0064).

Computation over the committed ``playbook.json`` and ``bench.json`` files only: no model call, no
bench. ``playbooks/ranking.json`` carries no timestamp and a stable key order, so the same inputs
give the same bytes, and ``rank --check`` compares the committed file with what would be written.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Any

METHOD = "docs/adr/0056-how-the-best-use-of-athena-is-ranked.md"
RANKING_FILENAME = "ranking.json"

# ADR 0056 (a): times a year, and whether the value recurs. Adding a row takes an amendment.
PERIODS: dict[str, tuple[int, bool]] = {
    "year": (1, True),
    "quarter": (4, True),
    "month": (12, True),
    "week": (52, True),
    "estate": (1, False),
    "episode": (1, False),
}


class RankError(Exception):
    """A playbook's own data cannot be ranked (a bad ``times_per_year``)."""


def _clamp(x: float, low: float = 0.0, high: float = 5.0) -> float:
    return max(low, min(high, x))


def _log_points(x: float, offset: float) -> float:
    """``clamp(log10(x) + offset, 0, 5)``; a non-positive input scores 0 (ADR 0056 amendment)."""
    if x <= 0:
        return 0.0
    return _clamp(math.log10(x) + offset)


def _num(x: float) -> int | float:
    """Two decimals, and an int when whole, so the same value is the same bytes."""
    r = round(x, 2) + 0.0
    return int(r) if r == int(r) else r


def _times_per_year(playbook_id: str, economics: dict[str, Any]) -> tuple[float, bool]:
    if "times_per_year" not in economics:
        return 1.0, False
    t = economics["times_per_year"]
    if isinstance(t, bool) or not isinstance(t, (int, float)) or not t > 0:
        raise RankError(f"{playbook_id}: economics.times_per_year must be a number above 0: {t!r}")
    return float(t), True


def exclusion(playbook: dict[str, Any], bench: dict[str, Any] | None) -> str | None:
    """Why a playbook is not ranked (ADR 0056 (b)), or None."""
    if bench is None:
        return "no bench.json"
    verdict = bench.get("verdict", {})
    score = bench.get("score", {})
    if verdict.get("word") == "short":
        expected = verdict.get("expected", {}).get("recall")
        pct = f"{round(float(expected) * 100):d}%" if expected is not None else "?"
        return f"short: found {score.get('found')} of {score.get('eligible')} items, expected {pct}"
    if score.get("false_claims", 0) > 0 or score.get("traps_filed", 0) > 0:
        return (
            f"false claims {score.get('false_claims', 0)}, "
            f"traps filed {score.get('traps_filed', 0)}"
        )
    economics = playbook.get("economics", {})
    sources = economics.get("sources") or []
    if not any(isinstance(s, dict) and s.get("url") for s in sources):
        return "no source with a URL"
    if economics.get("per") not in PERIODS:
        return f"per {economics.get('per')!r} is not in the period table"
    return None


def rank_row(playbook: dict[str, Any], bench: dict[str, Any]) -> dict[str, Any]:
    """One ranked row, unplaced. The caller has checked :func:`exclusion`."""
    return _row(playbook, bench)[0]


def _row(
    playbook: dict[str, Any], bench: dict[str, Any]
) -> tuple[dict[str, Any], tuple[float, float]]:
    """The row, and the unrounded (proven, saved minutes a year) its tie-breaks compare."""
    pid = playbook["id"]
    economics = playbook["economics"]
    score = bench["score"]
    times, stated = _times_per_year(pid, economics)
    count, recurs = PERIODS[economics["per"]]
    value = economics.get("value_usd", 0)
    annual = value * count
    raw_recall = score.get("recall_value")
    recall = float(raw_recall) if raw_recall is not None else 0.0
    proven = annual * recall
    pct = economics.get("incumbent_fee_pct")
    manual = float(economics["manual_minutes"])
    person = (float(bench["wall_s"]) + float(bench["your_time_s"])) / 60
    per_time = manual - person
    per_year = per_time * times
    edge = playbook["edge"]
    money_pts = _log_points(proven, -1)
    time_pts = _log_points(per_year / 60, 1)
    edge_pts = math.sqrt(edge["difficulty"] * edge["usefulness"])
    row = {
        "playbook": pid,
        "domain": playbook.get("domain"),
        "audience": playbook.get("audience"),
        # ADR 0096: the ledger's two axes, carried so a reader of the ranking can group it the
        # way the desktop does without opening every playbook. They play no part in the score.
        "category": playbook.get("category"),
        "job": playbook.get("job"),
        "score": _num(money_pts + time_pts + edge_pts),
        "points": {"money": _num(money_pts), "time": _num(time_pts), "edge": _num(edge_pts)},
        "money": {
            "value_usd": value,
            "per": economics["per"],
            "annual_usd": _num(annual),
            "recurs": recurs,
            "recall_value": recall,
            "proven_usd_year": _num(proven),
            "incumbent_fee_pct": pct,
            "fee_avoided_usd_year": _num(proven * pct / 100) if pct is not None else None,
        },
        "minutes": {
            "manual": _num(manual),
            "person": _num(person),
            "saved_per_time": _num(per_time),
            "times_per_year": _num(times),
            "times_per_year_stated": stated,
            "saved_per_year": _num(per_year),
        },
        "edge": {"difficulty": edge["difficulty"], "usefulness": edge["usefulness"]},
        "bench": {
            "run_at": bench.get("run_at"),
            "model": bench.get("model"),
            "verdict": bench["verdict"]["word"],
            "found": score.get("found"),
            "eligible": score.get("eligible"),
            "false_claims": score.get("false_claims", 0),
            "traps_filed": score.get("traps_filed", 0),
            "traps_total": score.get("traps_total"),
        },
    }
    return row, (proven, per_year)


def rank_all(entries: list[tuple[dict[str, Any], dict[str, Any] | None]]) -> dict[str, Any]:
    """The ranking document for ``(playbook, bench-or-None)`` pairs."""
    rows: list[tuple[dict[str, Any], tuple[float, float]]] = []
    unranked: list[dict[str, str]] = []
    for playbook, bench in entries:
        why = exclusion(playbook, bench)
        if why is None and bench is not None:
            rows.append(_row(playbook, bench))
        else:
            unranked.append({"playbook": playbook["id"], "why": why or "no bench.json"})
    rows.sort(key=lambda r: (-r[0]["score"], -r[1][0], -r[1][1], r[0]["playbook"]))
    ranked = [{"rank": i, **row} for i, row in enumerate((r[0] for r in rows), start=1)]
    unranked.sort(key=lambda u: u["playbook"])
    return {"schema": 1, "method": METHOD, "ranked": ranked, "unranked": unranked}


def load_entries(base: Path) -> list[tuple[dict[str, Any], dict[str, Any] | None]]:
    entries: list[tuple[dict[str, Any], dict[str, Any] | None]] = []
    for book in sorted(p for p in base.iterdir() if (p / "playbook.json").is_file()):
        playbook = json.loads((book / "playbook.json").read_text(encoding="utf-8"))
        bench_path = book / "bench.json"
        bench = json.loads(bench_path.read_text(encoding="utf-8")) if bench_path.is_file() else None
        entries.append((playbook, bench))
    return entries


def render(ranking: dict[str, Any]) -> str:
    return json.dumps(ranking, indent=2, ensure_ascii=False) + "\n"


def run_rank(base: Path, *, check: bool) -> int:
    """Write (or with ``check`` compare) ``ranking.json``. Exit 0, 1 on drift, 2 on bad data."""
    try:
        text = render(rank_all(load_entries(base)))
    except RankError as exc:
        print(f"refused: {exc}", file=sys.stderr)
        return 2
    target = base / RANKING_FILENAME
    if check:
        current = target.read_bytes().decode("utf-8") if target.is_file() else None
        if current != text:
            print(f"{target.as_posix()} differs from what rank would write", file=sys.stderr)
            return 1
        print(f"{target.as_posix()} is current")
        return 0
    target.write_bytes(text.encode("utf-8"))
    data = json.loads(text)
    print(f"ranked {len(data['ranked'])}, unranked {len(data['unranked'])}: {target.as_posix()}")
    return 0

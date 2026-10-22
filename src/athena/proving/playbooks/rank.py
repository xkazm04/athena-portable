"""Rank the playbooks by the method ADR 0056 fixed (README §14; ADR 0056, 0064, 0128).

Computation over the committed ``playbook.json`` and ``bench.json`` files only: no model call, no
bench. ``playbooks/ranking.json`` carries no timestamp and a stable key order, so the same inputs
give the same bytes, and ``rank --check`` compares the committed file with what would be written.

A playbook is ranked on every run its ``bench.json`` holds under the key a run benched today would
carry (ADR 0128), not on its latest draw alone: the score takes the median recall, any comparable
run that filed a trap or a false claim excludes it, and each row says how many runs it stands on.
"""

from __future__ import annotations

import json
import math
import statistics
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from athena.proving.playbooks.bench import (
    comparability_key,
    comparable_runs,
    content_digest,
    headline,
)

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


def runs_of(bench: Mapping[str, Any], current: str | None = None) -> list[dict[str, Any]]:
    """The runs a playbook is ranked on (ADR 0128): every run under its latest run's key, or the
    latest alone when it carries none. Empty when that key is not ``current``."""
    pooled = comparable_runs(bench, current)
    return [headline(bench)] if pooled is None else pooled


def _count(run: Mapping[str, Any], key: str) -> int:
    value = run.get(key)
    return int(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0


def _recall(run: Mapping[str, Any]) -> float:
    raw = run.get("recall_value")
    return float(raw) if raw is not None else 0.0


def exclusion(
    playbook: dict[str, Any], bench: dict[str, Any] | None, current: str | None = None
) -> str | None:
    """Why a playbook is not ranked (ADR 0056 (b), ADR 0128), or None.

    ``current`` is the comparability key a run benched today would carry, when it is known. A
    playbook short in half its comparable runs or more is short; one false claim or one trap filed
    in any of them excludes it.
    """
    if bench is None:
        return "no bench.json"
    runs = runs_of(bench, current)
    if not runs:
        return "no comparable run: its world, truth, command or scorer changed since it was benched"
    n = len(runs)
    short = sum(1 for r in runs if r.get("verdict") == "short")
    if 2 * short >= n:
        if n > 1:
            return f"short in {short} of {n} comparable runs"
        verdict = bench.get("verdict", {})
        score = bench.get("score", {})
        expected = verdict.get("expected", {}).get("recall")
        pct = f"{round(float(expected) * 100):d}%" if expected is not None else "?"
        return f"short: found {score.get('found')} of {score.get('eligible')} items, expected {pct}"
    false_claims = max(_count(r, "false_claims") for r in runs)
    traps = max(_count(r, "traps_filed") for r in runs)
    if false_claims > 0 or traps > 0:
        worst = f" (the worst of {n} comparable runs)" if n > 1 else ""
        return f"false claims {false_claims}, traps filed {traps}{worst}"
    economics = playbook.get("economics", {})
    sources = economics.get("sources") or []
    if not any(isinstance(s, dict) and s.get("url") for s in sources):
        return "no source with a URL"
    if economics.get("per") not in PERIODS:
        return f"per {economics.get('per')!r} is not in the period table"
    return None


def rank_row(
    playbook: dict[str, Any], bench: dict[str, Any], current: str | None = None
) -> dict[str, Any]:
    """One ranked row, unplaced. The caller has checked :func:`exclusion`."""
    return _row(playbook, bench, runs_of(bench, current))[0]


def _row(
    playbook: dict[str, Any], bench: dict[str, Any], runs: Sequence[Mapping[str, Any]]
) -> tuple[dict[str, Any], tuple[float, float]]:
    """The row, and the unrounded (proven, saved minutes a year) its tie-breaks compare.

    The money takes the median recall of ``runs`` (ADR 0128); the minutes are the latest run's.
    """
    pid = playbook["id"]
    economics = playbook["economics"]
    score = bench["score"]
    times, stated = _times_per_year(pid, economics)
    count, recurs = PERIODS[economics["per"]]
    value = economics.get("value_usd", 0)
    annual = value * count
    recalls = [_recall(r) for r in runs]
    recall = statistics.median(recalls)
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
            # ADR 0128: what the score stands on. ``comparable`` is null for a run benched before
            # keys were kept, which is then a set of one.
            "runs": {
                "n": len(runs),
                "comparable": bench.get("comparable"),
                "exceeds": sum(1 for r in runs if r.get("verdict") == "exceeds"),
                "recall_min": min(recalls),
                "recall_median": recall,
                "false_claims_max": max(_count(r, "false_claims") for r in runs),
                "traps_filed_max": max(_count(r, "traps_filed") for r in runs),
            },
        },
    }
    return row, (proven, per_year)


def current_key(
    playbook: Mapping[str, Any],
    bench: Mapping[str, Any] | None,
    contents: Mapping[str, str] | None,
) -> str | None:
    """The key a run benched today would carry: the playbook's content digest with its latest
    run's engine, model and approval mode. None when the digest is not known."""
    content = (contents or {}).get(str(playbook.get("id")))
    if content is None or bench is None:
        return None
    return comparability_key(content, bench.get("engine"), bench.get("model"), bench.get("approve"))


def rank_all(
    entries: list[tuple[dict[str, Any], dict[str, Any] | None]],
    contents: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """The ranking document for ``(playbook, bench-or-None)`` pairs.

    ``contents`` maps a playbook id to its :func:`~.bench.content_digest`; for a playbook it does
    not name, a keyed latest run is taken as current.
    """
    rows: list[tuple[dict[str, Any], tuple[float, float]]] = []
    unranked: list[dict[str, str]] = []
    for playbook, bench in entries:
        current = current_key(playbook, bench, contents)
        why = exclusion(playbook, bench, current)
        if why is None and bench is not None:
            rows.append(_row(playbook, bench, runs_of(bench, current)))
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


def load_contents(base: Path) -> dict[str, str]:
    """Each playbook's content digest, by id; one whose files do not read is left out."""
    contents: dict[str, str] = {}
    for book in sorted(p for p in base.iterdir() if (p / "playbook.json").is_file()):
        try:
            pid = json.loads((book / "playbook.json").read_text(encoding="utf-8"))["id"]
            contents[str(pid)] = content_digest(book)
        except (OSError, ValueError, KeyError, TypeError):
            continue
    return contents


def render(ranking: dict[str, Any]) -> str:
    return json.dumps(ranking, indent=2, ensure_ascii=False) + "\n"


def run_rank(base: Path, *, check: bool) -> int:
    """Write (or with ``check`` compare) ``ranking.json``. Exit 0, 1 on drift, 2 on bad data."""
    try:
        text = render(rank_all(load_entries(base), load_contents(base)))
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


def kendall_tau_b(xs: Sequence[float], ys: Sequence[float]) -> float | None:
    """Kendall's tau-b of two paired score lists, ties counted; None when either is all ties."""
    concordant = discordant = ties_x = ties_y = 0
    for i in range(len(xs)):
        for j in range(i + 1, len(xs)):
            dx = (xs[i] > xs[j]) - (xs[i] < xs[j])
            dy = (ys[i] > ys[j]) - (ys[i] < ys[j])
            if dx == 0 and dy == 0:
                continue
            if dx == 0:
                ties_x += 1
            elif dy == 0:
                ties_y += 1
            elif dx == dy:
                concordant += 1
            else:
                discordant += 1
    pairs = concordant + discordant
    denominator = math.sqrt((pairs + ties_x) * (pairs + ties_y))
    return (concordant - discordant) / denominator if denominator else None


def tau_of(
    entries: list[tuple[dict[str, Any], dict[str, Any] | None]],
    contents: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """Run 1 against the rest (ADR 0128): does a second draw keep the order of the first?

    For each ranked playbook with two comparable runs or more: its score on its oldest comparable
    run alone, and its score on the median of the others, the minutes held at the latest run's on
    both sides so the difference is the recall's. Returns the pairs and their tau-b.
    """
    pairs: list[dict[str, Any]] = []
    fewer = excluded = 0
    for playbook, bench in entries:
        if bench is None:
            continue
        current = current_key(playbook, bench, contents)
        if exclusion(playbook, bench, current) is not None:
            excluded += 1
            continue
        runs = sorted(runs_of(bench, current), key=lambda r: str(r.get("run_at", "")))
        if len(runs) < 2:
            fewer += 1
            continue
        first = _row(playbook, bench, runs[:1])[0]["score"]
        rest = _row(playbook, bench, runs[1:])[0]["score"]
        pairs.append({"playbook": playbook["id"], "n": len(runs), "first": first, "rest": rest})
    pairs.sort(key=lambda p: (-p["first"], p["playbook"]))
    tau = kendall_tau_b([p["first"] for p in pairs], [p["rest"] for p in pairs])
    return {"pairs": pairs, "tau_b": tau, "fewer_runs": fewer, "excluded": excluded}


def run_tau(base: Path) -> int:
    """Print run 1's scores against the rest's and their tau-b. Exit 0, 1 with under two pairs."""
    try:
        doc = tau_of(load_entries(base), load_contents(base))
    except RankError as exc:
        print(f"refused: {exc}", file=sys.stderr)
        return 2
    pairs = doc["pairs"]
    for p in pairs:
        print(f"{p['playbook']}: run 1 {p['first']}, median of runs 2-{p['n']} {p['rest']}")
    tau = doc["tau_b"]
    if len(pairs) < 2:
        figure = "undefined (fewer than two playbooks with two comparable runs)"
    else:
        figure = f"{tau:.3f}" if tau is not None else "undefined (every score tied)"
    print(
        f"tau-b {figure} over {len(pairs)} playbooks; {doc['fewer_runs']} ranked on one "
        f"comparable run, {doc['excluded']} excluded"
    )
    return 0 if len(pairs) >= 2 else 1

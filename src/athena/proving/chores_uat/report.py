"""uat chores (spark chores-uat): the report — a run directory read into report.md and findings.

Dumps first, verdicts second: this module only reads what :mod:`.run` wrote. Per pair, its state
(complete, how the onboarding ended, approved, the rehearsal's status); margins by category,
audience, Character and ended-state, worst first, each group's n shown; criteria pass rates per
criterion text with n, where ``null`` is not evaluable and is never counted as a pass; would-adopt
counts; the time-saved estimates; the findings by frequency; the cost and ledger rows.

``findings.json`` rows follow the uat finding schema minimally (``cert_level`` LC, ``verdict``
``uncertain``: a judge's finding is a lead until a person reads the transcript).
"""

from __future__ import annotations

import json
import statistics
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any

__all__ = ["findings_rows", "load_dumps", "margins", "report_md", "write_report"]

_SEVERITY = {"blocker": 0, "major": 1, "minor": 2, "polish": 3}


def load_dumps(run_dir: Path) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for path in sorted((run_dir / "pairs").glob("*.json")):
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(raw, dict):
            out.append(raw)
    return out


def _judge(d: Mapping[str, Any]) -> Mapping[str, Any]:
    j = d.get("judge")
    return j if isinstance(j, Mapping) else {}


def _criteria_counts(dumps: Iterable[Mapping[str, Any]]) -> tuple[int, int, int]:
    passed = failed = unknown = 0
    for d in dumps:
        for c in _judge(d).get("criteria") or []:
            if not isinstance(c, Mapping):
                continue
            if c.get("pass") is True:
                passed += 1
            elif c.get("pass") is False:
                failed += 1
            else:
                unknown += 1
    return passed, failed, unknown


def _rate(num: int, den: int) -> float | None:
    return round(100.0 * num / den, 1) if den else None


def _pct(x: float | None) -> str:
    return "n/a" if x is None else f"{x:.0f}%"


def margins(dumps: Sequence[Mapping[str, Any]], key: str) -> list[dict[str, Any]]:
    """One row per value of ``key`` (``category``, ``audience``, ``character``, ``ended``):
    worst criteria pass rate first, ties toward the larger group."""
    groups: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for d in dumps:
        value = (d.get("onboarding") or {}).get("ended") if key == "ended" else d.get(key)
        groups[str(value or "?")].append(d)
    rows: list[dict[str, Any]] = []
    for value, members in groups.items():
        passed, failed, unknown = _criteria_counts(members)
        adopt = Counter(str(_judge(d).get("adopt")) for d in members if _judge(d))
        rows.append(
            {
                "value": value,
                "n": len(members),
                "complete": sum(1 for d in members if d.get("complete")),
                "approved": sum(1 for d in members if (d.get("onboarding") or {}).get("approved")),
                "rehearsed": sum(
                    1 for d in members if (d.get("rehearsal") or {}).get("status") == "done"
                ),
                "criteria_pass": _rate(passed, passed + failed),
                "criteria_n": passed + failed,
                "not_evaluable": unknown,
                "adopt_yes": adopt.get("yes", 0),
                "adopt_no": adopt.get("no", 0),
            }
        )
    rows.sort(
        key=lambda r: (
            r["criteria_pass"] if r["criteria_pass"] is not None else 101.0,
            -r["n"],
            r["value"],
        )
    )
    return rows


def _journey(finding: Mapping[str, Any]) -> str:
    evidence = finding.get("evidence") or []
    return "J8" if "rehearsal" in evidence else "J7"


def findings_rows(dumps: Sequence[Mapping[str, Any]], run_id: str = "") -> list[dict[str, Any]]:
    """The judges' findings as uat finding rows; evidence is ``transcript:<run>/<pair>#<cite>``."""
    rows: list[dict[str, Any]] = []
    for d in dumps:
        for index, f in enumerate(_judge(d).get("findings") or [], start=1):
            if not isinstance(f, Mapping):
                continue
            rows.append(
                {
                    "id": f"{d.get('pair')}#{index}",
                    "journey": _journey(f),
                    "character": d.get("character"),
                    "playbook_id": d.get("playbook_id"),
                    "cert_level": "LC",
                    "type": f.get("type"),
                    "dimension": f.get("dimension"),
                    "title": f.get("title"),
                    "expected": f.get("expected"),
                    "got": f.get("got"),
                    "evidence": [
                        f"transcript:{run_id}/{d.get('pair')}#{e}" for e in f.get("evidence") or []
                    ],
                    "severity_hint": f.get("severity_hint"),
                    "verdict": "uncertain",
                }
            )
    return rows


def _table(head: Sequence[str], rows: Iterable[Sequence[Any]]) -> list[str]:
    out = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    for row in rows:
        out.append("| " + " | ".join(str(c).replace("|", "/") for c in row) + " |")
    return out


def _ledger_rows(run_dir: Path) -> tuple[int, float]:
    try:
        lines = (run_dir / "ledger.jsonl").read_text(encoding="utf-8").splitlines()
    except OSError:
        return 0, 0.0
    n, cost = 0, 0.0
    for line in lines:
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict):
            n += 1
            cost += float(row.get("cost_usd") or 0.0)
    return n, cost


def report_md(run_dir: Path, dumps: Sequence[Mapping[str, Any]]) -> str:
    run_meta: Mapping[str, Any] = {}
    try:
        loaded = json.loads((run_dir / "run.json").read_text(encoding="utf-8"))
        run_meta = loaded if isinstance(loaded, dict) else {}
    except (OSError, json.JSONDecodeError):
        pass
    rows_n, ledger_cost = _ledger_rows(run_dir)
    complete = sum(1 for d in dumps if d.get("complete"))
    lines = [
        f"# Chores UAT — run {run_dir.name}",
        "",
        f"{len(dumps)} pairs on disk, {complete} complete. Ledger: {rows_n} rows, "
        f"${ledger_cost:.2f}. Pair dumps sum to "
        f"${sum(float(d.get('cost_usd') or 0) for d in dumps):.2f}.",
    ]
    instrument = run_meta.get("instrument")
    if isinstance(instrument, Mapping):
        lines += ["", "Instrument: " + ", ".join(f"{k} {v}" for k, v in instrument.items())]

    lines += ["", "## Pairs", ""]
    lines += _table(
        [
            "pair",
            "complete",
            "ended",
            "cards",
            "approved",
            "rehearsal",
            "found $",
            "adopt",
            "failure",
        ],
        (
            [
                d.get("pair"),
                "yes" if d.get("complete") else "no",
                (d.get("onboarding") or {}).get("ended"),
                (d.get("onboarding") or {}).get("cards"),
                "yes" if (d.get("onboarding") or {}).get("approved") else "no",
                (d.get("rehearsal") or {}).get("status"),
                (d.get("rehearsal") or {}).get("found_usd"),
                _judge(d).get("adopt", ""),
                str(d.get("failure") or "")[:80],
            ]
            for d in dumps
        ),
    )

    for key, title in (
        ("category", "Category"),
        ("audience", "Audience"),
        ("character", "Character"),
        ("ended", "Ended state"),
    ):
        lines += ["", f"## Margins by {title.lower()} (worst first)", ""]
        lines += _table(
            [
                title,
                "n",
                "complete",
                "approved",
                "rehearsed",
                "criteria pass (n)",
                "not evaluable",
                "adopt yes",
                "adopt no",
            ],
            (
                [
                    r["value"],
                    r["n"],
                    r["complete"],
                    r["approved"],
                    r["rehearsed"],
                    f"{_pct(r['criteria_pass'])} ({r['criteria_n']})",
                    r["not_evaluable"],
                    r["adopt_yes"],
                    r["adopt_no"],
                ]
                for r in margins(dumps, key)
            ),
        )

    per: dict[str, list[Any]] = defaultdict(list)
    for d in dumps:
        for c in _judge(d).get("criteria") or []:
            if isinstance(c, Mapping):
                per[str(c.get("text") or f"#{c.get('n')}")].append(c.get("pass"))
    lines += ["", "## Criteria (null = not evaluable, never a pass)", ""]
    crit_rows = []
    for text, states in per.items():
        passed = sum(1 for s in states if s is True)
        failed = sum(1 for s in states if s is False)
        crit_rows.append((_rate(passed, passed + failed), text, passed, failed, len(states)))
    crit_rows.sort(key=lambda r: (r[0] if r[0] is not None else 101.0, -r[4]))
    lines += _table(
        ["criterion", "pass rate", "pass", "fail", "not evaluable"],
        ([t, _pct(rate), p, f, n - p - f] for rate, t, p, f, n in crit_rows),
    )

    adopt = Counter(str(_judge(d).get("adopt")) for d in dumps if _judge(d))
    judged = sum(adopt.values())
    lines += [
        "",
        "## Would adopt",
        "",
        f"yes {adopt.get('yes', 0)}, maybe {adopt.get('maybe', 0)}, no {adopt.get('no', 0)} "
        f"(n={judged})",
    ]
    saved = [
        float(_judge(d)["time_saved_min_est"])
        for d in dumps
        if isinstance(_judge(d).get("time_saved_min_est"), int | float)
    ]
    lines += [
        "",
        "## Time saved (the Characters' own estimates, minutes per time)",
        "",
        (
            f"median {statistics.median(saved):.0f}, min {min(saved):.0f}, max {max(saved):.0f} "
            f"(n={len(saved)}; {judged - len(saved)} could not tell)"
            if saved
            else f"no estimate (n=0 of {judged} judged)"
        ),
    ]

    found = findings_rows(dumps, run_dir.name)
    by_kind = Counter((str(f["type"]), str(f["dimension"])) for f in found)
    lines += ["", "## Findings by frequency", ""]
    lines += _table(
        ["type", "dimension", "count"], ([t, dim, n] for (t, dim), n in by_kind.most_common())
    )
    top = sorted(found, key=lambda f: (_SEVERITY.get(str(f.get("severity_hint")), 9), str(f["id"])))
    shown = top[:30]
    lines += ["", f"## Top findings ({len(shown)} of {len(found)}, most severe first)", ""]
    lines += _table(
        ["id", "severity", "type", "title"],
        ([f["id"], f.get("severity_hint"), f["type"], f["title"]] for f in shown),
    )
    return "\n".join(lines) + "\n"


def write_report(run_dir: Path) -> tuple[Path, Path, int]:
    dumps = load_dumps(run_dir)
    md = run_dir / "report.md"
    md.write_text(report_md(run_dir, dumps), encoding="utf-8")
    fj = run_dir / "findings.json"
    rows = findings_rows(dumps, run_dir.name)
    fj.write_text(json.dumps(rows, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    return md, fj, len(dumps)

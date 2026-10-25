"""A playbook's run records: one append-only ledger for the bench and for follow-through (ADR 0195).

A ledger is a JSON file in the playbook's folder with two lists, ``runs`` and ``corrections``,
under whatever leading fields its owner derives from them. A run is appended and never edited or
dropped; a correction is appended beside it, names the run it is about by its *mark*, and carries
the line the run ``was`` and the line it is ``now``. The newest correction for a mark wins. This
module is the only writer of both ledgers:

- ``bench.runs.json``: each bench run's :func:`headline`, marked by its ``run_at``. A rescore is
  a correction, never a run. ``bench.json`` is a *view* of it: the latest run's summary, the last
  :data:`HISTORY` earlier runs as the desktop reads them, and a ``pool`` block (key, n, exceeds)
  over every run in the ledger.
- ``followthrough.runs.json`` (ADR 0129): its format is unchanged; follow-through supplies the
  leading fields (the tally) and the mark (run, branch, repeat).

The pooling rule (ADR 0128) is :func:`comparable_runs`, and it is the same rule over a ledger and
over a ``bench.json`` alone: a playbook benched before the ledger existed has none, and every
reader falls back to the window ``bench.json`` holds. A loader that read a ledger puts its records
on the in-memory bench under :data:`LEDGER_KEY` (:func:`view`), so the ranking and the narration
stay pure functions of what they are handed. That key is never written to disk.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Hashable, Mapping
from pathlib import Path
from typing import Any

from athena.proving.report import prune

__all__ = [
    "BENCH_LEDGER",
    "HISTORY",
    "LEDGER_KEY",
    "append",
    "bench_correction",
    "comparable_runs",
    "correct",
    "headline",
    "history_view",
    "newest",
    "pool",
    "pool_block",
    "read",
    "resolved",
    "seed",
    "view",
    "with_ledger",
    "write",
]

#: The bench's ledger, beside ``bench.json`` in the playbook's folder.
BENCH_LEDGER = "bench.runs.json"

#: How many earlier runs ``bench.json`` shows, newest last. A bound on the view, not on the pool.
HISTORY = 12

#: Where :func:`view` puts the ledger's records on an in-memory bench. Never on disk.
LEDGER_KEY = "ledger"

Records = dict[str, list[dict[str, Any]]]
Mark = Callable[[Mapping[str, Any]], Hashable]
Head = Callable[[Records], Mapping[str, Any]]


def read(root: Path, filename: str) -> Records:
    """The ledger's runs and corrections; both empty when the file is missing or unreadable."""
    target = root / filename
    if not target.is_file():
        return {"runs": [], "corrections": []}
    try:
        raw = json.loads(target.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        raw = {}
    return {
        "runs": list(raw.get("runs", [])) if isinstance(raw, dict) else [],
        "corrections": list(raw.get("corrections", [])) if isinstance(raw, dict) else [],
    }


def write(root: Path, filename: str, records: Records, head: Head) -> Path:
    """The ledger to disk: ``head``'s fields first, then the runs, then the corrections."""
    body: dict[str, Any] = {
        **head(records),
        "runs": records["runs"],
        "corrections": records["corrections"],
    }
    target = root / filename
    target.write_text(json.dumps(body, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return target


def append(
    root: Path,
    filename: str,
    line: Mapping[str, Any],
    head: Head,
    records: Records | None = None,
) -> Path:
    """Append one run; every earlier line stays as it was. ``records`` seeds a new ledger."""
    out = read(root, filename) if records is None else records
    out["runs"].append(dict(line))
    return write(root, filename, out, head)


def correct(
    root: Path,
    filename: str,
    entry: Mapping[str, Any],
    head: Head,
    records: Records | None = None,
) -> Path:
    """Append one correction: its mark fields, why, and the line the run ``was`` and is ``now``."""
    if "was" not in entry or "now" not in entry:
        raise ValueError("a correction carries the line it corrects (was) and its new line (now)")
    out = read(root, filename) if records is None else records
    out["corrections"].append(dict(entry))
    return write(root, filename, out, head)


def newest(records: Mapping[str, Any], mark: Mark) -> dict[Hashable, dict[str, Any]]:
    """Each corrected run's newest ``now`` line, by mark."""
    out: dict[Hashable, dict[str, Any]] = {}
    for correction in records.get("corrections", []):
        out[mark(correction)] = dict(correction.get("now", {}))
    return out


def resolved(records: Mapping[str, Any], mark: Mark) -> list[dict[str, Any]]:
    """Every run as its newest correction says, oldest first."""
    now = newest(records, mark)
    return [dict(now.get(mark(run), run)) for run in records.get("runs", [])]


def _run_at(line: Mapping[str, Any]) -> Hashable:
    return str(line.get("run_at"))


def headline(summary: Mapping[str, Any]) -> dict[str, Any]:
    """One run, in a line: when, on what, under which key, the verdict, the money and the minutes.

    It holds what the ranking needs to pool the run with the others under its key (ADR 0128), and
    it is what the bench's ledger appends.
    """
    s = summary.get("score", {})
    keep: dict[str, Any] = prune(
        {
            "run_at": summary.get("run_at"),
            "rescored_at": summary.get("rescored_at"),
            "engine": summary.get("engine"),
            "model": summary.get("model"),
            "approve": summary.get("approve"),
            "comparable": summary.get("comparable"),
            "verdict": summary.get("verdict", {}).get("word"),
            "found": s.get("found"),
            "eligible": s.get("eligible"),
            "value_found_usd": s.get("value_found_usd"),
            "recall_value": s.get("recall_value"),
            "false_claims": s.get("false_claims"),
            "traps_filed": s.get("traps_filed"),
            "wall_s": summary.get("wall_s"),
            "your_time_s": summary.get("your_time_s"),
            "note": summary.get("note"),
        }
    )
    return keep


def _window(bench: Mapping[str, Any], current: str | None) -> list[dict[str, Any]] | None:
    key = bench.get("comparable")
    if not key:
        return None
    if current is not None and key != current:
        return []
    runs = [headline(bench)]
    for line in bench.get("history", []):
        if not isinstance(line, Mapping) or line.get("superseded_by"):
            continue
        if line.get("comparable") != key:
            continue
        if bench.get("rescored_at") and line.get("run_at") == bench.get("run_at"):
            continue
        runs.append(dict(line))
    return runs


def comparable_runs(
    bench: Mapping[str, Any], current: str | None = None
) -> list[dict[str, Any]] | None:
    """The runs that pool with the latest, latest first (ADR 0128).

    ``None`` when the latest run carries no key (benched before keys were kept): it is then a set
    of one, and nothing is pooled with it. ``current`` is the key a run benched now would carry;
    a latest run under another key was measured against something that has changed since, and the
    set is empty. A run a rescore corrected is counted once, as the correction says.

    Over the ledger :func:`view` put on ``bench`` when there is one: every run ever benched under
    the key. Otherwise over the window ``bench.json`` holds (its latest and its history).
    """
    records = bench.get(LEDGER_KEY)
    runs = resolved(records, _run_at) if isinstance(records, Mapping) else []
    if not runs:
        return _window(bench, current)
    key = runs[-1].get("comparable")
    if not key:
        return None
    if current is not None and key != current:
        return []
    return [run for run in reversed(runs) if run.get("comparable") == key]


def view(root: Path) -> dict[str, Any] | None:
    """``bench.json`` as the readers take it: with the ledger's records on it when there is one.

    ``None`` when the playbook was never benched. Reads only; a playbook without a ledger is
    returned as its ``bench.json`` alone, and every rule then falls back to its window.
    """
    path = root / "bench.json"
    if not path.is_file():
        return None
    bench = json.loads(path.read_text(encoding="utf-8"))
    return with_ledger(root, bench) if isinstance(bench, dict) else None


def with_ledger(root: Path, bench: dict[str, Any]) -> dict[str, Any]:
    """``bench`` (read from ``root``'s ``bench.json``) with the ledger's records on it, if any."""
    if (root / BENCH_LEDGER).is_file():
        bench[LEDGER_KEY] = read(root, BENCH_LEDGER)
    return bench


def pool(root: Path, current: str | None = None) -> list[dict[str, Any]] | None:
    """The runs a playbook's latest run pools with, read from its folder (:func:`comparable_runs`);
    ``None`` with nothing benched or an unkeyed latest run."""
    bench = view(root)
    return None if bench is None else comparable_runs(bench, current)


def seed(before: Mapping[str, Any]) -> Records:
    """A new ledger from a ``bench.json`` benched before the ledger: every run it still holds.

    Each run once, oldest first, as its newest line in the window says; a ``superseded_by`` line
    is the same run as the line or latest that follows it, so it adds no run.
    """
    lines = [h for h in before.get("history", []) if isinstance(h, Mapping)]
    if before.get("run_at"):
        lines.append(headline(before))
    order: list[Hashable] = []
    last: dict[Hashable, dict[str, Any]] = {}
    for i, line in enumerate(lines):
        mark: Hashable = _run_at(line) if line.get("run_at") else ("unmarked", i)
        clean = {k: v for k, v in line.items() if k != "superseded_by"}
        if mark not in last:
            order.append(mark)
        last[mark] = clean
    return {"runs": [last[m] for m in order], "corrections": []}


def bench_correction(
    was: Mapping[str, Any], now: Mapping[str, Any], note: str = ""
) -> dict[str, Any]:
    """A rescore as a correction of the bench's ledger: when, which run, why, was and now."""
    entry: dict[str, Any] = prune(
        {
            "rescored_at": now.get("rescored_at"),
            "run_at": now.get("run_at"),
            "note": note or None,
            "was": dict(was),
            "now": dict(now),
        }
    )
    return entry


def history_view(records: Mapping[str, Any], latest: Mapping[str, Any]) -> list[dict[str, Any]]:
    """``bench.json``'s history, derived: every earlier run as its newest correction says, then
    each correction of the latest run as the line it was with its ``superseded_by`` (ADR 0128's
    form, which the desktop reads), the last :data:`HISTORY` of them."""
    mark = _run_at(latest)
    runs = resolved(records, _run_at)
    # The latest run is the ledger's last; every run before it is history, whatever its date.
    lines = runs[:-1] if runs and _run_at(runs[-1]) == mark else runs
    for correction in records.get("corrections", []):
        if _run_at(correction) != mark:
            continue
        now = dict(correction.get("now", {}))
        line = dict(correction.get("was", {}))
        line["superseded_by"] = prune(
            {
                "rescored_at": correction.get("rescored_at"),
                "note": correction.get("note"),
                "comparable": now.get("comparable"),
                "verdict": now.get("verdict"),
                "found": now.get("found"),
                "recall_value": now.get("recall_value"),
                "false_claims": now.get("false_claims"),
                "traps_filed": now.get("traps_filed"),
            }
        )
        lines.append(line)
    return lines[-HISTORY:]


def pool_block(records: Records) -> dict[str, Any]:
    """What ``bench.json`` says of the whole pool: the latest run's key, how many runs stand
    under it, and how many of those beat the bar. An unkeyed latest run is a pool of one."""
    pooled = comparable_runs({LEDGER_KEY: records})
    runs = resolved(records, _run_at)
    latest = runs[-1] if runs else {}
    if pooled is None:
        pooled = [latest]
    return {
        "key": latest.get("comparable"),
        "n": len(pooled),
        "exceeds": sum(1 for r in pooled if r.get("verdict") == "exceeds"),
    }

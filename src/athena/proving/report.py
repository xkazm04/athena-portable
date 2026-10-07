"""A run's report: ``proving-runs/<ts>/report.json`` and ``report.md`` (README §9; ADR 0030).

The shape is the design's (``{run_id, rows, attacks, conversations, judges, cost_usd}``) and one
rule governs every value in it: **an absent value is omitted, never written as 0.** A cost nobody
reported is not free, a judge that never answered did not answer "no", and a 0 in a report is
believed. :func:`prune` enforces it on the way out, for every prototype that writes here.

``proving-runs/`` is gitignored: a run is evidence for a person to read, not source.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from athena.contracts.registry import ExecResult

__all__ = ["RUNS_DIRNAME", "announce", "new_run_dir", "prune", "write_report"]

RUNS_DIRNAME = "proving-runs"


def new_run_dir(base: str | Path = RUNS_DIRNAME, *, now: datetime | None = None) -> Path:
    """A fresh ``<base>/<UTC timestamp>/`` directory. Two runs in one second get a suffix."""
    stamp = (now or datetime.now(UTC)).strftime("%Y%m%dT%H%M%SZ")
    root = Path(base)
    candidate = root / stamp
    suffix = 1
    while candidate.exists():
        suffix += 1
        candidate = root / f"{stamp}-{suffix}"
    candidate.mkdir(parents=True)
    return candidate


def prune(value: Any) -> Any:
    """``value`` with every ``None`` dropped from every mapping, recursively."""
    if isinstance(value, Mapping):
        return {str(key): prune(item) for key, item in value.items() if item is not None}
    if isinstance(value, list | tuple):
        return [prune(item) for item in value if item is not None]
    return value


def announce(shown: int, total: int) -> str:
    """``(showing N of M)`` when something was left out, ``""`` when nothing was — the repo's
    one idiom for an honest bound (``ExecResult.footer``)."""
    return ExecResult(ok=True, shown=shown, total=total).footer()


def write_report(run_dir: Path, report: Mapping[str, Any], markdown: str) -> tuple[Path, Path]:
    """Write both files. The JSON is pruned; the markdown is the caller's rendering of it."""
    json_path = run_dir / "report.json"
    md_path = run_dir / "report.md"
    json_path.write_text(
        json.dumps(prune(report), indent=2, ensure_ascii=False, sort_keys=False) + "\n",
        encoding="utf-8",
    )
    md_path.write_text(markdown.rstrip() + "\n", encoding="utf-8")
    return json_path, md_path

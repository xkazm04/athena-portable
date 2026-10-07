"""The trigger page's read side: run listing and one-line headlines (README §9; ADR 0037).

Every number here is copied from a run's own ``report.json``; nothing is computed that the report
did not already say, except two sums the page needs for its headline (a row's pressure over its
generators, and the models a run used). An absent value stays absent: a run that has not finished
has no headline, never a headline of zeros (:func:`athena.proving.report.prune`'s rule).
"""

from __future__ import annotations

import json
import threading
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from athena.proving.report import announce
from athena.proving.server.runner import RUN_ID

__all__ = ["DEFAULT_LIMIT", "MAX_LIMIT", "RunIndex", "headline"]

DEFAULT_LIMIT = 20
MAX_LIMIT = 100


def _models(report: Mapping[str, Any]) -> list[str]:
    seen: dict[str, None] = {}
    for row in report.get("rows") or []:
        if isinstance(row, Mapping) and row.get("model"):
            seen[str(row["model"])] = None
    for gen in report.get("generators") or []:
        if isinstance(gen, Mapping) and gen.get("model"):
            seen[str(gen["model"])] = None
    judge = report.get("judge")
    if isinstance(judge, Mapping) and judge.get("model"):
        seen[str(judge["model"])] = None
    judges = report.get("judges")
    if isinstance(judges, Mapping):
        control = judges.get("control")
        if isinstance(control, Mapping) and control.get("model"):
            seen[str(control["model"])] = None
    for user in report.get("users") or []:
        if isinstance(user, Mapping) and user.get("model"):
            seen[str(user["model"])] = None
    return list(seen)


def _pressure(report: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    """Per row: attacks that put pressure on the gate (Athena reached for the gated tool), summed
    over generators, beside how many were driven."""
    out: dict[str, dict[str, Any]] = {}
    pressure = (report.get("proof") or {}).get("pressure") or {}
    if not isinstance(pressure, Mapping):
        return out
    for row, generators in pressure.items():
        if not isinstance(generators, Mapping):
            continue
        driven = sum(int(c.get("driven", 0)) for c in generators.values() if isinstance(c, Mapping))
        hits = sum(int(c.get("pressure", 0)) for c in generators.values() if isinstance(c, Mapping))
        out[str(row)] = {
            "driven": driven,
            "pressure": hits,
            "rate": round(hits / driven, 4) if driven else None,
        }
    return out


def headline(report: Mapping[str, Any]) -> dict[str, Any]:
    """The run's headline, for the page's first screen and the history list."""
    proof = report.get("proof") or {}
    line: dict[str, Any] = {
        "run_id": report.get("run_id"),
        "prototype": report.get("prototype"),
        "claim": report.get("claim"),
        "started_at": report.get("started_at"),
        "wall_s": report.get("wall_s"),
        "cost_usd": report.get("cost_usd"),
        "budget": report.get("budget"),
        "models": _models(report),
        "rows": [
            {
                k: row.get(k)
                for k in ("key", "engine", "model", "planned", "driven", "footer", "verdicts")
                if row.get(k) is not None
            }
            for row in report.get("rows") or []
            if isinstance(row, Mapping)
        ],
    }
    if report.get("prototype") == "gauntlet":
        line["breaches"] = proof.get("breaches_zero")
        line["valid_rate"] = proof.get("valid_rate")
        line["pressure"] = _pressure(report)
        line["attacks"] = len(report.get("attacks") or [])
    elif report.get("prototype") == "characters":
        line["fidelity"] = proof.get("fidelity")
        line["agreement"] = proof.get("agreement")
        line["conversations"] = len(report.get("conversations") or [])
    return {k: v for k, v in line.items() if v is not None}


class RunIndex:
    """The run directories under one root, newest first, with cached headlines."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self._cache: dict[str, tuple[float, dict[str, Any]]] = {}
        self._lock = threading.Lock()

    def ids(self) -> list[str]:
        if not self.root.is_dir():
            return []
        names = [p.name for p in self.root.iterdir() if p.is_dir() and RUN_ID.match(p.name)]
        return sorted(names, reverse=True)

    def path(self, run_id: str) -> Path | None:
        """The run's directory, or ``None`` for an id that is not a run here. The id is matched
        against the stamp shape before it touches the filesystem, so no path can be smuggled."""
        if not RUN_ID.match(run_id):
            return None
        run_dir = self.root / run_id
        return run_dir if run_dir.is_dir() else None

    def report_text(self, run_id: str) -> str | None:
        run_dir = self.path(run_id)
        if run_dir is None:
            return None
        report = run_dir / "report.json"
        return report.read_text(encoding="utf-8") if report.is_file() else None

    def entry(self, run_id: str, *, running: bool = False) -> dict[str, Any]:
        run_dir = self.root / run_id
        report = run_dir / "report.json"
        if running:
            return {"run_id": run_id, "status": "running"}
        if not report.is_file():
            return {"run_id": run_id, "status": "incomplete"}
        mtime = report.stat().st_mtime
        with self._lock:
            cached = self._cache.get(run_id)
        if cached is not None and cached[0] == mtime:
            return cached[1]
        try:
            data = json.loads(report.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {"run_id": run_id, "status": "unreadable"}
        entry = {"status": "done", **headline(data if isinstance(data, Mapping) else {})}
        entry["run_id"] = run_id
        with self._lock:
            self._cache[run_id] = (mtime, entry)
        return entry

    def listing(self, limit: int = DEFAULT_LIMIT, running: str = "") -> dict[str, Any]:
        ids = self.ids()
        limit = max(1, min(limit, MAX_LIMIT))
        shown = ids[:limit]
        return {
            "runs": [self.entry(run_id, running=run_id == running) for run_id in shown],
            "shown": len(shown),
            "total": len(ids),
            "footer": announce(len(shown), len(ids)) or None,
        }

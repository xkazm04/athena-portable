"""Bench the valid variants on the real bench, from a copy outside ``playbooks/`` (README §14).

``spec.load_playbook`` reads any directory, so no bench code changes: a variant becomes
``<run>/forge/work/<playbook>-v<k>/<playbook>/`` (the base's ``playbook.json`` with the variant's
``world.json`` and ``truth.json``), is loaded by the spec, and goes to
:func:`~athena.proving.playbooks.bench.run_bench`. Nothing is written to ``playbooks/``: this is
``--no-write`` by construction, the report goes beside the variant.

Resumable and bounded: a variant whose report exists is skipped; a Claude purse that cannot pay for
another run ends the stage cleanly and the caller prints ``(showing N of M)``.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

from athena.proving.budget import CLAUDE, Budget
from athena.proving.forge.base import Base, materialize
from athena.proving.forge.store import ForgeDir, VariantRecord
from athena.proving.playbooks.bench import BenchConfig, run_bench
from athena.proving.playbooks.spec import Playbook, PlaybookError
from athena.proving.report import announce
from athena.proving.runlog import RunLog

__all__ = ["KEEP", "BenchOutcome", "BenchRunner", "bench_variants", "trim"]

BenchRunner = Callable[[Playbook, BenchConfig], dict[str, Any]]

#: What of a bench report the forge keeps: the verdict, the score with its cards, the cost.
KEEP = (
    "playbook",
    "run_at",
    "engine",
    "model",
    "approve",
    "comparable",
    "wall_s",
    "turns",
    "cost_usd",
    "errors",
    "verdict",
    "score",
    "cards",
)


@dataclass
class BenchOutcome:
    benched: int = 0
    skipped: int = 0
    voided: int = 0
    failed: int = 0
    total: int = 0
    stopped: str = ""
    lines: list[str] = field(default_factory=list)

    @property
    def shown(self) -> int:
        return self.benched + self.skipped

    def footer(self) -> str:
        return announce(self.shown, self.total)


def trim(report: Mapping[str, Any]) -> dict[str, Any]:
    return {k: report[k] for k in KEEP if k in report}


def default_runner(playbook: Playbook, config: BenchConfig) -> dict[str, Any]:  # pragma: no cover
    return run_bench(playbook, config, echo=lambda line: print("   " + line, flush=True))


def bench_variants(
    store: ForgeDir,
    bases: Mapping[str, Base],
    variants: list[VariantRecord],
    budget: Budget,
    log: RunLog,
    *,
    run: BenchRunner = default_runner,
    config: BenchConfig | None = None,
    per_run_cap: float = 5.0,
    reserve: float = 0.0,
    charge: bool = True,
    echo: Callable[[str], None] = print,
) -> BenchOutcome:
    """Bench every valid Nemotron variant not yet benched; stop when the Claude purse is dry.

    ``config`` is the instrument (engine, model, approval mode): the same one the report reads the
    bases' comparable runs under, so a variant and its baseline are measured alike (ADR 0128).
    """
    instrument = config or BenchConfig()
    engine, model = instrument.engine, instrument.model
    todo = [v for v in variants if v.valid and v.generator == "nemotron"]
    out = BenchOutcome(total=len(todo))
    for v in todo:
        name = f"{v.playbook}-v{v.k}"
        if store.bench_path(v).is_file():
            out.skipped += 1
            continue
        left = budget.cap(CLAUDE) - budget.spent(CLAUDE) - reserve
        if left <= 0 or not budget.can_spend(CLAUDE):
            out.stopped = f"the Claude purse is spent (cap ${budget.cap(CLAUDE):.2f})"
            break
        base = bases[v.playbook]
        assert v.world is not None and v.truth is not None
        try:
            book = materialize(base, v.world, v.truth, store.work / name)
        except PlaybookError as exc:
            out.failed += 1
            out.lines.append(f"{name}: the spec refused it at bench time: {exc}")
            continue
        config = replace(instrument, cap_usd=min(per_run_cap, left))
        echo(f"bench {name} on {engine}/{model} (cap ${config.cap_usd:.2f})")
        started = time.monotonic()
        try:
            report = run(book, config)
        except Exception as exc:
            # A bench that died may have spent before it did: the row is owed (README §2
            # invariant 6), and its unknown cost weighs on the cap as an unpriced call (ADR 0122)
            # so a variant that keeps raising on resume cannot spend past the purse unseen.
            if charge:
                budget.charge(CLAUDE, None)
            log.record(
                role="bench",
                engine=CLAUDE,
                model=f"{engine}/{model}",
                ms=int((time.monotonic() - started) * 1000),
                error_reason="engine_error",
                extra={"variant": name, "raised": type(exc).__name__},
            )
            out.failed += 1
            out.lines.append(f"{name}: the bench raised {type(exc).__name__}; it will retry")
            continue
        cost = report.get("cost_usd")
        if charge:
            budget.charge(CLAUDE, cost if isinstance(cost, int | float) else None)
        log.record(
            role="bench",
            engine=CLAUDE,
            model=f"{engine}/{model}",
            cost_usd=float(cost) if isinstance(cost, int | float) else None,
            ms=int(float(report.get("wall_s", 0)) * 1000),
            error_reason="engine_error" if report.get("errors") else None,
            extra={"variant": name},
        )
        kept = trim(report)
        if report.get("errors"):
            # A run that ended on an error says nothing about the variant: kept for the reader,
            # never scored as a flip, and retried when the stage is resumed.
            store.void_path(v).write_text(json.dumps(kept, indent=1), encoding="utf-8")
            out.voided += 1
            out.lines.append(f"{name}: the run ended on an error; set aside, not counted")
            continue
        store.bench_path(v).write_text(
            json.dumps(kept, indent=1, ensure_ascii=False), encoding="utf-8"
        )
        out.benched += 1
        word = kept.get("verdict", {}).get("word", "?")
        out.lines.append(f"{name}: {word}, ${cost if cost is not None else '?'}")
    return out


def work_root(store: ForgeDir) -> Path:
    return store.work

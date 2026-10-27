"""WP-V (nvidia-revisit): the run - render the corpus, read it with both readers, score, report.

State lives under ``<run>/docread/``: ``corpus/`` (html, png, pdf, facts), ``answers.jsonl`` (one
reading per line; a rerun with ``--run`` skips what is already answered, so a 429 on the Claude CLI
costs a resume, not a restart), ``ledger.jsonl`` (one row per model call), ``report.{json,md}``.
Nothing is written outside the gitignored ``proving-runs/``.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from athena.contracts.adopt import Tier
from athena.harness.tokenfactory import SUPER_VL_MODEL, HttpPost, urllib_post
from athena.proving.adopt_tiers.scenarios import Scenario, load_scenarios
from athena.proving.budget import CLAUDE, NEMOTRON, Budget
from athena.proving.docread.corpus import (
    DEGRADATIONS,
    PDF,
    DocSpec,
    Unit,
    build_docs,
    render,
    units_of,
    write_docs,
)
from athena.proving.docread.dry import dry_reading, is_dry
from athena.proving.docread.read import claude_tier, read_claude, read_vl
from athena.proving.docread.report import render_markdown
from athena.proving.docread.score import Reading, proof, score_readers, score_unit
from athena.proving.forge.store import restore_budget
from athena.proving.report import RUNS_DIRNAME, new_run_dir, write_report
from athena.proving.roles import RoleCaller, Runner, subprocess_runner
from athena.proving.runlog import RunLog

__all__ = ["READERS", "Config", "Run", "run_read", "run_render", "run_score"]

READERS: tuple[str, ...] = ("vl", "claude")
MISSES_SHOWN = 12


@dataclass(frozen=True)
class Config:
    scenarios: tuple[str, ...] = ()
    degradations: tuple[str, ...] = (*DEGRADATIONS, PDF)
    readers: tuple[str, ...] = READERS
    claude_cap: float = 8.0
    nemotron_cap: float = 1.0
    dry: bool = False
    thinking: bool = False
    out: str = RUNS_DIRNAME
    run: str = ""


@dataclass
class Run:
    config: Config
    root: Path
    scenarios: list[Scenario]
    docs: list[DocSpec]
    units: list[Unit]
    post: HttpPost = field(default=urllib_post, repr=False)
    runner: Runner = field(default=subprocess_runner, repr=False)

    @property
    def corpus(self) -> Path:
        return self.root / "corpus"

    @property
    def answers(self) -> Path:
        return self.root / "answers.jsonl"


def open_run(
    config: Config, *, post: HttpPost = urllib_post, runner: Runner = subprocess_runner
) -> Run:
    """Load the scenarios, build the corpus specs and the unit list, and settle the run folder."""
    scenarios = load_scenarios(config.scenarios, full=False)
    docs = [d for s in scenarios for d in build_docs(s)]
    units = units_of(docs, config.degradations)
    base = Path(config.run) if config.run else new_run_dir(config.out)
    root = base / "docread"
    root.mkdir(parents=True, exist_ok=True)
    return Run(config, root, scenarios, docs, units, post, runner)


def run_render(run: Run, *, echo: Callable[[str], None] = print) -> None:
    """Write the HTML + facts; render PNG/PDF unless this is a dry run."""
    write_docs(run.corpus, run.docs)
    echo(f"corpus: {len(run.docs)} documents -> {run.corpus}")
    if run.config.dry:
        echo("dry: not rendered")
        return
    render(run.corpus, run.docs)
    echo(f"rendered {len(run.units)} readable units")


def _saved(path: Path) -> dict[tuple[str, str], Reading]:
    """The answers on disk, the newest line per (reader, unit) winning. A line a killed read left
    half-written is skipped, so its unit is read again on resume rather than the run dying."""
    out: dict[tuple[str, str], Reading] = {}
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            try:
                raw = json.loads(line)
                r = Reading.from_json(raw)
            except (json.JSONDecodeError, KeyError, TypeError, ValueError, AttributeError):
                continue
            out[(r.reader, r.unit)] = r
    return out


def _end_line(path: Path) -> None:
    """Close a torn last line, so the next answer is appended on a line of its own."""
    if path.is_file() and path.stat().st_size:
        with path.open("rb") as handle:
            handle.seek(-1, 2)
            torn = handle.read(1) != b"\n"
        if torn:
            with path.open("a", encoding="utf-8") as handle:
                handle.write("\n")


def run_read(run: Run, *, echo: Callable[[str], None] = print) -> tuple[Budget, RunLog]:
    """Read every unit with each reader. Void readings are retried on the next run."""
    config = run.config
    budget = Budget(caps={NEMOTRON: config.nemotron_cap, CLAUDE: config.claude_cap})
    ledger = run.root / "ledger.jsonl"
    if not config.dry:
        # The caps are per run, not per session: a resumed ``read --run`` starts from what the
        # run's own ledger says was already spent (as the forge does), not from a full purse.
        restore_budget(budget, ledger)
    log = RunLog(None if config.dry else ledger)
    caller = RoleCaller(budget, log)
    by_id = {s.id: s for s in run.scenarios}
    # A fixture answer is not done for a live read (nor a live one for a dry read): a live
    # ``read --run`` over a dry folder reads every unit instead of keeping the fixtures.
    done = {
        k: v
        for k, v in _saved(run.answers).items()
        if v.values is not None and is_dry(v) == config.dry
    }
    tier: Tier | None = claude_tier() if "claude" in config.readers and not config.dry else None
    _end_line(run.answers)
    for reader in config.readers:
        for unit in run.units:
            if (reader, unit.id) in done:
                continue
            scenario = by_id[unit.scenario]
            if config.dry:
                reading = dry_reading(reader, unit, scenario)
            elif reader == "vl":
                reading = read_vl(
                    caller, scenario, unit, run.corpus, thinking=config.thinking, post=run.post
                )
            else:
                assert tier is not None
                reading = read_claude(caller, scenario, unit, run.corpus, tier, run=run.runner)
            with run.answers.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(reading.to_json(), ensure_ascii=False) + "\n")
            echo(f"{reader:6} {unit.id:55} {_status(reading)}")
    return budget, log


def run_score(
    run: Run, budget: Budget | None = None, *, tier: Tier | None = None
) -> dict[str, Any]:
    """Score the answers on disk and write ``report.json`` / ``report.md``."""
    config = run.config
    readings = list(_saved(run.answers).values())
    # Dry is what the answers are, not the flag this ``score`` was given: one fixture answer
    # among them and the report is a plumbing check, never a measurement.
    dry = config.dry or any(is_dry(r) for r in readings)
    scenarios = {s.id: s for s in run.scenarios}
    paired = score_readers(scenarios, run.units, readings, paired=True)
    everything = score_readers(scenarios, run.units, readings, paired=False)
    models: dict[str, str] = {}
    for name, stats in everything.items():
        if stats.get("model"):
            models[name] = str(stats["model"])
    if not dry:
        if "vl" in config.readers:
            models["vl"] = models.get("vl") or SUPER_VL_MODEL
        if "claude" in config.readers:
            models["claude"] = _claude_model(models.get("claude", ""), tier)
    report: dict[str, Any] = {
        "run_id": run.root.parent.name,
        "dry": dry,
        "experiment": "docread",
        "scenarios": [s.id for s in run.scenarios],
        "degradations": list(config.degradations),
        "readers": list(config.readers),
        "vl_thinking": config.thinking,
        "models": models,
        "cost_usd": budget.summary() if budget is not None else None,
        "paired": paired,
        "all": everything,
        "proof": proof(paired),
        **_misses(scenarios, run.units, readings),
    }
    write_report(run.root, report, render_markdown(report))
    return report


def _claude_model(answered: str, tier: Tier | None) -> str:
    """The Claude control as it ran: the model its readings recorded, and the effort only when
    today's ``tiers.json`` still names that model (a ``score`` can run long after the ``read``)."""
    try:
        t = tier or claude_tier()
    except (OSError, ValueError) as exc:
        return f"{answered or '?'} (Read only; tiers.json unreadable: {type(exc).__name__})"
    if not answered or answered == t.model:
        return f"{t.model} (effort {t.effort}, Read only)"
    return f"{answered} (Read only; effort not recorded, tiers.json now names {t.model})"


def _status(reading: Reading) -> str:
    return "ok" if reading.values is not None else f"void {reading.error_reason}"


def _misses(
    scenarios: Mapping[str, Scenario], units: Sequence[Unit], readings: Sequence[Reading]
) -> dict[str, Any]:
    by_id = {u.id: u for u in units}
    found: dict[str, list[dict[str, str]]] = {}
    for r in readings:
        unit = by_id.get(r.unit)
        if unit is None or r.values is None:
            continue
        for row in score_unit(scenarios[unit.scenario].sheet, unit.facts, r.values):
            if row["stated"] and not row["correct"]:
                got = r.values.get(row["entry"], "")[:80]
                what = f"missed (wrong value: {got})" if row["given"] else "missed (not given)"
            elif row["false_fact"] and not row["stated"]:
                what = f"false fact: {r.values.get(row['entry'], '')[:80]}"
            else:
                continue
            found.setdefault(r.reader, []).append(
                {"unit": r.unit, "entry": row["entry"], "what": what}
            )
    shown = {name: rows[:MISSES_SHOWN] for name, rows in found.items()}
    return {
        "misses": shown,
        "misses_shown": {n: f"showing {len(shown[n])} of {len(found[n])}" for n in found},
    }

"""``python -m athena.proving.adopt_tiers``: the adopt tier bench (ADR 0097, Wave 3)::

    uv run python -m athena.proving.adopt_tiers --dry [--scenarios ...] [--configs ...] [--reps 2]
    uv run python -m athena.proving.adopt_tiers run [--scenarios ...] [--configs ...] [--reps 2]
        [--parallel 3] [--date YYYY-MM-DD] [--out proving-runs]
    uv run python -m athena.proving.adopt_tiers report [--date YYYY-MM-DD]
    uv run python -m athena.proving.adopt_tiers pick [--write [--accept-fallback]] [--date ...]

``--dry`` prints the plan and the estimated leg count and spends nothing. ``run`` spends
subscription usage through the ``claude`` CLI (never the API, ADR 0007) and is resumable: what is
on disk under ``proving-runs/adopt-tiers/<date>/`` is skipped. ``report`` and ``pick`` read the
latest date unless ``--date`` names one. ``pick`` prints each role as a diff of ``tiers.json``
(``opus-low -> haiku-medium: first text -620 ms, ... (n 18/18)``, or ``(unchanged)``);
``--write`` writes only the roles that change, and refuses (exit 2) a fallback pick, one no
config cleared the floor for, unless ``--accept-fallback`` is passed. Exit codes: 0 done, 1 some
jobs failed (named), 2 nothing could run.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Callable, Sequence
from dataclasses import asdict
from pathlib import Path

from athena.adopt.legs import TIERS_PATH
from athena.proving.adopt_tiers.pick import (
    against,
    aggregate,
    aggregate_shape,
    changes,
    load_results,
    pick_bench,
    read_tiers,
    write_tiers,
)
from athena.proving.adopt_tiers.report import dry_text, pick_line, report_md, write_report
from athena.proving.adopt_tiers.scenarios import ScenarioError, load_scenarios
from athena.proving.adopt_tiers.simulate import (
    BENCH_DIRNAME,
    CONFIGS,
    Rig,
    make_plan,
    run_dir_for,
    run_jobs,
    shape_function,
)
from athena.proving.report import RUNS_DIRNAME
from athena.proving.roles import claude_available

__all__ = ["build_parser", "main"]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m athena.proving.adopt_tiers")
    parser.add_argument("--dry", action="store_true", help="print the plan; spend nothing")
    _common(parser)
    verbs = parser.add_subparsers(dest="verb")
    run = verbs.add_parser("run", help="run the bench (spends subscription usage)")
    _common(run)
    run.add_argument("--parallel", type=int, default=3)
    report = verbs.add_parser("report", help="write report.md from the results on disk")
    _common(report)
    pick = verbs.add_parser("pick", help="print the picks; --write updates tiers.json")
    _common(pick)
    pick.add_argument("--write", action="store_true")
    pick.add_argument(
        "--accept-fallback",
        action="store_true",
        help="with --write, also write a pick no config cleared the floor for",
    )
    return parser


def _common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--scenarios", nargs="+", default=argparse.SUPPRESS)
    parser.add_argument("--configs", nargs="+", choices=list(CONFIGS), default=argparse.SUPPRESS)
    parser.add_argument("--reps", type=int, default=argparse.SUPPRESS)
    parser.add_argument("--date", default=argparse.SUPPRESS, help="results date (YYYY-MM-DD)")
    parser.add_argument("--out", default=argparse.SUPPRESS, help="runs base directory")


def _latest(base: Path) -> str:
    root = base / BENCH_DIRNAME
    days = sorted(p.name for p in root.iterdir() if p.is_dir()) if root.is_dir() else []
    return days[-1] if days else ""


def main(
    argv: Sequence[str] | None = None,
    *,
    echo: Callable[[str], None] = print,
    tiers: Path = TIERS_PATH,
) -> int:
    args = build_parser().parse_args(argv)
    say = echo
    scenario_ids: list[str] = getattr(args, "scenarios", [])
    configs: list[str] = getattr(args, "configs", list(CONFIGS))
    reps: int = getattr(args, "reps", 2)
    base = Path(getattr(args, "out", RUNS_DIRNAME))
    verb = args.verb or ("dry" if args.dry else "")
    if not verb:
        build_parser().print_usage(sys.stderr)
        return 2
    date = getattr(args, "date", "") or ("" if verb in ("dry", "run") else _latest(base))
    run_dir = run_dir_for(base, date=date)
    try:
        scenarios = load_scenarios(scenario_ids)
    except ScenarioError as exc:
        say(f"scenarios: {exc}")
        return 2

    if verb == "dry" or args.dry:
        say(dry_text(make_plan(scenarios, configs, reps, run_dir)))
        return 0

    if verb == "run":
        if not claude_available():
            say("no claude CLI on PATH (or PROVING_HOSTED is set): the bench cannot run here")
            return 2
        plan = make_plan(scenarios, configs, reps, run_dir)
        say(dry_text(plan))
        if not plan.jobs:
            say("nothing to run: every result is on disk")
            return 0
        failed = run_jobs(Rig(run_dir), plan, parallel=getattr(args, "parallel", 3), echo=say)
        return 1 if failed else 0

    results = load_results(run_dir, scenarios)
    interviews = results.interviews
    stats = aggregate(interviews, scenarios)
    shape_stats = aggregate_shape(results.shapes)
    _, note = shape_function()
    measured = bool(results.shapes)
    picks = pick_bench(interviews, scenarios, shape_stats, shape_measured=measured, shape_note=note)
    picks = against(
        picks, stats, shape_stats, read_tiers(tiers), records=interviews, scenarios=scenarios
    )
    if verb == "report":
        text = report_md(
            stats,
            shape_stats,
            picks,
            run_dir=run_dir,
            scenarios=len(scenarios),
            shape_note=note,
            stale=results.stale,
            digest=results.digest,
        )
        say(f"wrote {write_report(run_dir, text).as_posix()}")
        return 0 if interviews else 2

    # pick
    if results.stale:
        say(f"excluded {results.stale} stale record(s) from another bench digest")
    for p in picks:
        say(pick_line(p))
    if run_dir.is_dir():
        (run_dir / "picks.json").write_text(
            json.dumps([asdict(p) for p in picks], indent=2) + "\n", encoding="utf-8"
        )
    if getattr(args, "write", False):
        if not interviews:
            say("no results: tiers.json left as it is")
            return 2
        changed = changes(picks)
        if not changed:
            say("tiers.json unchanged")
            return 0
        blind = [p.role for p in changed if p.fallback]
        if blind and not getattr(args, "accept_fallback", False):
            say(
                f"not written: {', '.join(blind)} is a fallback (no config cleared the floor); "
                "read report.md, then pass --accept-fallback to write it anyway"
            )
            return 2
        written = write_tiers(changed, tiers)
        say("tiers.json: " + ", ".join(f"{k} {v}" for k, v in written.items() if k != "_note"))
    return 0 if interviews else 2


if __name__ == "__main__":
    raise SystemExit(main())

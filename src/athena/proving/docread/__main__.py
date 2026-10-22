"""``python -m athena.proving.docread``: does Nemotron-3.5-Super-VL read documents like Claude?

    uv run python -m athena.proving.docread [render|read|score|all] [--scenarios ID ...]
        [--degradations clean skew scan pdf] [--reader vl claude] [--claude-cap 8]
        [--nemotron-cap 1] [--vl-thinking] [--run proving-runs/<ts>] [--out proving-runs] [--dry]

``--dry`` builds the corpus HTML, answers from recorded-fixture stand-ins, scores and reports:
no network, no render, no ``claude``. A live ``read`` spends Nemotron tokens (the key from
``NEBIUS_API_KEY`` / ``.env``) and Claude subscription usage through the CLI, capped by
``--nemotron-cap`` and ``--claude-cap``. ``render`` needs node and Playwright
(``examples/journey/node_modules``). Pass ``--run`` to continue a run: answers already on disk are
skipped. Exit codes: 0 done, 2 cannot run.
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Callable, Sequence

from athena.contracts.adopt import Tier
from athena.harness.tokenfactory import key_present
from athena.proving.adopt_tiers.scenarios import ScenarioError
from athena.proving.budget import Budget
from athena.proving.docread.corpus import DEGRADATIONS, PDF
from athena.proving.docread.run import (
    READERS,
    Config,
    open_run,
    run_read,
    run_render,
    run_score,
)
from athena.proving.report import RUNS_DIRNAME
from athena.proving.roles import claude_available, load_env_file

__all__ = ["build_parser", "main"]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m athena.proving.docread")
    parser.add_argument(
        "verb", nargs="?", default="all", choices=["render", "read", "score", "all"]
    )
    parser.add_argument("--scenarios", nargs="+", default=[])
    parser.add_argument(
        "--degradations", nargs="+", choices=[*DEGRADATIONS, PDF], default=[*DEGRADATIONS, PDF]
    )
    parser.add_argument("--reader", nargs="+", choices=list(READERS), default=list(READERS))
    parser.add_argument("--claude-cap", type=float, default=8.0)
    parser.add_argument("--nemotron-cap", type=float, default=1.0)
    parser.add_argument("--vl-thinking", action="store_true", help="let the VL reason first")
    parser.add_argument("--run", default="", help="continue this run folder")
    parser.add_argument("--out", default=RUNS_DIRNAME)
    parser.add_argument("--dry", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None, *, echo: Callable[[str], None] = print) -> int:
    args = build_parser().parse_args(argv)
    config = Config(
        scenarios=tuple(args.scenarios),
        degradations=tuple(args.degradations),
        readers=tuple(args.reader),
        claude_cap=args.claude_cap,
        nemotron_cap=args.nemotron_cap,
        dry=args.dry,
        thinking=args.vl_thinking,
        out=args.out,
        run=args.run,
    )
    if args.verb in ("score", "read") and not args.run:
        echo(f"{args.verb} needs --run <the folder render made>")
        return 2
    if args.verb in ("read", "all") and not config.dry:
        load_env_file(".env")
        if "vl" in config.readers and not key_present():
            echo("NEBIUS_API_KEY is not set (env or .env); use --dry or set it")
            return 2
        if "claude" in config.readers and not claude_available():
            echo("no claude CLI on PATH; use --reader vl or --dry")
            return 2
    try:
        run = open_run(config)
    except ScenarioError as exc:
        echo(str(exc))
        return 2
    budget: Budget | None = None
    if args.verb in ("render", "all"):
        run_render(run, echo=echo)
    if args.verb in ("read", "all"):
        budget, _ = run_read(run, echo=echo)
    if args.verb in ("score", "read", "all"):
        tier: Tier | None = None
        report = run_score(run, budget, tier=tier)
        verdict = report["proof"]
        echo(f"verdict: {verdict['verdict']}  report: {run.root / 'report.md'}")
    else:
        echo(f"run folder: {run.root.parent}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())

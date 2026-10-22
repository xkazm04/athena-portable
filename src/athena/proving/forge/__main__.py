"""``python -m athena.proving.forge``: forge, bench and audit varied playbook worlds (README §14).

::

    uv run python -m athena.proving.forge pick   [--seed 11]
    uv run python -m athena.proving.forge forge  [--n 3] [--seed 11] [--rung lightning|super]
        [--control | --no-control] [--nemotron-cap 1] [--run-dir proving-runs/<ts>]
    uv run python -m athena.proving.forge bench  --run-dir proving-runs/<ts> [--claude-cap 60]
    uv run python -m athena.proving.forge audit  --run-dir proving-runs/<ts> [--claude-cap 60]
    uv run python -m athena.proving.forge all    [--dry] ...

Everything is written under ``proving-runs/<ts>/forge/`` (gitignored); ``playbooks/`` is never
touched. A stage skips work that already exists in ``--run-dir``, so a killed run is resumed by
running the same command again. ``--dry`` swaps every model for a recorded fixture and the Sonnet
bench for a scripted one: no network, no ``claude``, no key; it checks plumbing and
measures nothing.
Live: Nemotron needs ``NEBIUS_API_KEY`` (read from ``.env``, never printed); the control, the bench
and the audit need the ``claude`` CLI. Exit 0, or 2 when a stage cannot start.
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path

from athena.harness.tokenfactory import API_KEY_ENV
from athena.proving.budget import CLAUDE, NEMOTRON
from athena.proving.forge.base import load_base
from athena.proving.forge.dry import DryRole, dry_bench
from athena.proving.forge.run import Forge, purse
from athena.proving.forge.runner import BenchRunner, default_runner
from athena.proving.forge.store import ForgeDir
from athena.proving.playbooks.spec import PLAYBOOKS_DIRNAME
from athena.proving.report import RUNS_DIRNAME, new_run_dir
from athena.proving.roles import (
    HAIKU_MODEL,
    RUNGS,
    ClaudeRole,
    RoleCaller,
    RoleClient,
    claude_available,
    load_env_file,
)
from athena.proving.runlog import RunLog

STAGES = ("pick", "forge", "bench", "audit", "report", "all")

#: Output budget of a generator call: a world is ~10k tokens and the answer is a whole world.
FORGE_MAX_TOKENS = 32768


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m athena.proving.forge")
    p.add_argument("stage", choices=STAGES, nargs="?", default="all")
    p.add_argument("--n", type=int, default=3, help="variants per playbook")
    p.add_argument("--seed", type=int, default=11)
    p.add_argument("--rung", choices=sorted(RUNGS), default="lightning")
    p.add_argument("--control", action=argparse.BooleanOptionalAction, default=True)
    p.add_argument("--claude-cap", type=float, default=60.0, help="USD, bench + control + audit")
    p.add_argument("--nemotron-cap", type=float, default=1.0, help="USD")
    p.add_argument("--bench-cap", type=float, default=5.0, help="USD cap for one variant's bench")
    p.add_argument("--dry", action="store_true", help="fixtures only: no network, no claude")
    p.add_argument("--library", default=PLAYBOOKS_DIRNAME)
    p.add_argument("--out", default=RUNS_DIRNAME)
    p.add_argument("--run-dir", default=None, help="resume this run directory")
    p.add_argument("--env", default=".env")
    return p


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.n < 1:
        print("refused: --n must be 1 or more", file=sys.stderr)
        return 2
    library = Path(args.library)
    if not (library / "taxonomy.json").is_file():
        print(f"refused: {library.as_posix()} is not a playbook library", file=sys.stderr)
        return 2
    run_dir = Path(args.run_dir) if args.run_dir else new_run_dir(Path(args.out))
    run_dir.mkdir(parents=True, exist_ok=True)
    store = ForgeDir(run_dir)
    budget = purse({NEMOTRON: args.nemotron_cap, CLAUDE: args.claude_cap}, store.runlog)
    caller = RoleCaller(budget, RunLog(store.runlog))

    stage = args.stage
    wants = {
        "forge": stage in ("forge", "all"),
        "bench": stage in ("bench", "all"),
        "audit": stage in ("audit", "all"),
    }
    live_claude = not args.dry and claude_available()
    nemotron: RoleClient
    control: RoleClient | None
    runner: BenchRunner
    if args.dry:
        bases = {d.name: load_base(library, d.name) for d in library.iterdir() if d.is_dir()}
        nemotron = DryRole(NEMOTRON, RUNGS[args.rung], bases, bug_every=4)
        control = DryRole(CLAUDE, HAIKU_MODEL, bases) if args.control else None
        runner = dry_bench
    else:
        if wants["forge"]:
            load_env_file(args.env)
            import os

            key = os.environ.get(API_KEY_ENV, "")
            if not key:
                print(f"refused: {API_KEY_ENV} is not set (put it in {args.env})", file=sys.stderr)
                return 2
            from athena.proving.roles import NebiusRole

            nemotron = NebiusRole(model=RUNGS[args.rung], max_tokens=FORGE_MAX_TOKENS, api_key=key)
        else:
            from athena.proving.roles import NebiusRole

            nemotron = NebiusRole(model=RUNGS[args.rung])
        needs_claude = wants["bench"] or wants["audit"] or (wants["forge"] and args.control)
        if needs_claude and not live_claude:
            print(
                "refused: the claude CLI is not available here (or PROVING_HOSTED is set); "
                "bench and audit need it. Use --dry, or --no-control for a forge-only run.",
                file=sys.stderr,
            )
            return 2
        control = (
            ClaudeRole(model=HAIKU_MODEL, timeout_s=900.0) if live_claude and args.control else None
        )
        runner = default_runner

    forge = Forge(
        store=store,
        library=library,
        budget=budget,
        caller=caller,
        nemotron=nemotron,
        control=control,
        n=args.n,
        seed=args.seed,
        rung=args.rung,
        dry=args.dry,
        run_id=run_dir.name,
        bench_runner=runner,
        bench_cap=args.bench_cap,
    )
    print(
        f"forge run {run_dir.as_posix()}{' (dry: fixtures, measures nothing)' if args.dry else ''}"
    )
    if stage in ("pick", "all"):
        forge.stage_pick()
    if wants["forge"]:
        forge.stage_forge()
    if wants["bench"]:
        forge.stage_bench()
    if wants["audit"]:
        forge.stage_audit()
    if stage != "pick":
        forge.stage_report()
    summary = budget.summary()
    print(
        "spent: "
        + ", ".join(f"{e} ${s['spent_usd']:.4f} of ${s['cap_usd']:.2f}" for e, s in summary.items())
    )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())

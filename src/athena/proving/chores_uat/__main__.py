"""uat chores (spark chores-uat): ``python -m athena.proving.chores_uat`` — the CLI.

::

    uv run python -m athena.proving.chores_uat numbers [--out PATH] [--run-id ID]
    uv run python -m athena.proving.chores_uat cases [--force] [--workers 4] [--dry] [selection]
    uv run python -m athena.proving.chores_uat run [--dry] [--workers 4] [--cap-usd 400]
        [--no-rehearse] [--wall-s 600] [--run-id ID] [selection]
    uv run python -m athena.proving.chores_uat report [--run-id ID]

``selection`` is ``--pairs ID.. --areas CATEGORY.. --characters ID.. --limit N``; ``--uat``,
``--pairs-file``, ``--library`` and ``--base`` move the inputs and the runs directory. ``numbers``
spends nothing; ``cases`` and ``run`` spend subscription usage through the ``claude`` CLI (never
the API, ADR 0007) unless ``--dry``. Runs land in ``proving-runs/chores-uat/<run-id>/``
(``run-id`` a UTC stamp by default; ``report`` reads the latest). Exit codes: 0 done, 1 some
pairs failed (named), 2 nothing could run.
"""

from __future__ import annotations

import argparse
import json
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import Any

from athena.adopt.slots import playbooks_root
from athena.proving.chores_uat.cases import write_cases
from athena.proving.chores_uat.cast import (
    PAIRS_FILENAME,
    CastError,
    Character,
    Pair,
    case_path,
    load_case,
    load_characters,
    load_pairs,
    select_pairs,
)
from athena.proving.chores_uat.numbers import audit, summary, write_numbers
from athena.proving.chores_uat.numbers import read_library as read_numbers_library
from athena.proving.chores_uat.report import write_report
from athena.proving.chores_uat.rig import BENCH_DIRNAME, Rig, run_dir_for
from athena.proving.chores_uat.run import (
    COST_MEDIANS,
    instrument,
    ledger_spent,
    legs_per_pair,
    plan_jobs,
    run_pairs,
    stamp,
)
from athena.proving.report import RUNS_DIRNAME
from athena.proving.roles import claude_available

__all__ = ["build_parser", "main"]

#: The instrument keys that must match for a resumed run (``git_head`` is informational).
_IDENTITY = (
    "persona_system",
    "judge_system",
    "interview_system",
    "audit_system",
    "brief_system",
    "tiers",
    "persona_tier",
    "judge_tier",
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m athena.proving.chores_uat")
    verbs = parser.add_subparsers(dest="verb", required=True)
    numbers = verbs.add_parser("numbers", help="the deterministic numbers audit (free)")
    _paths(numbers)
    numbers.add_argument("--out", default="", help="also write numbers.json here")
    cases = verbs.add_parser("cases", help="write missing case cards (spends usage)")
    _paths(cases)
    _selection(cases)
    cases.add_argument("--force", action="store_true", help="rewrite existing case cards")
    cases.add_argument("--dry", action="store_true", help="list what would be written")
    run = verbs.add_parser("run", help="run the pairs (spends usage)")
    _paths(run)
    _selection(run)
    run.add_argument("--dry", action="store_true", help="print the plan; spend nothing")
    run.add_argument("--cap-usd", type=float, default=400.0)
    run.add_argument("--no-rehearse", action="store_true")
    run.add_argument("--wall-s", type=float, default=600.0, help="per onboarding")
    report = verbs.add_parser("report", help="write report.md and findings.json")
    _paths(report)
    return parser


def _paths(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--uat", default="uat", help="the uat/ overlay")
    parser.add_argument("--pairs-file", default="", help="default <uat>/chores/pairs.json")
    parser.add_argument("--library", default="", help="the playbook library (playbooks/)")
    parser.add_argument("--base", default=RUNS_DIRNAME, help="runs base directory")
    parser.add_argument("--run-id", default="")


def _selection(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--pairs", nargs="+", default=[])
    parser.add_argument("--areas", nargs="+", default=[], help="taxonomy categories")
    parser.add_argument("--characters", nargs="+", default=[])
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--workers", type=int, default=4)


def _library(args: argparse.Namespace) -> Path | None:
    return Path(args.library) if args.library else playbooks_root()


def _latest(base: Path) -> str:
    root = base / BENCH_DIRNAME
    runs = (
        sorted(p.name for p in root.iterdir() if p.is_dir() and (p / "pairs").is_dir())
        if root.is_dir()
        else []
    )
    return runs[-1] if runs else ""


class _Cast:
    def __init__(self, args: argparse.Namespace, library: Path) -> None:
        from athena.proving.playbooks.spec import PlaybookError, load_taxonomy

        self.uat = Path(args.uat)
        self.library = library
        self.playbooks = {k: v[0] for k, v in read_numbers_library(library).items()}
        try:
            categories: list[str] | None = list(load_taxonomy(library).categories)
        except PlaybookError:
            categories = None
        self.characters = load_characters(self.uat)
        pairs_file = Path(args.pairs_file) if args.pairs_file else self.uat / PAIRS_FILENAME
        self.pairs = load_pairs(
            pairs_file,
            categories=categories,
            playbooks=self.playbooks,
            characters=set(self.characters),
        )
        self.selected = select_pairs(
            self.pairs,
            ids=args.pairs,
            areas=args.areas,
            characters=args.characters,
            limit=args.limit,
        )

    def load(self, pair: Pair) -> tuple[Character, Mapping[str, Any], Mapping[str, Any]]:
        playbook = self.playbooks[pair.playbook_id]
        case = load_case(case_path(self.uat, pair.id), playbook)
        return self.characters[pair.character], case, playbook


def main(argv: Sequence[str] | None = None, *, echo: Callable[[str], None] = print) -> int:
    args = build_parser().parse_args(argv)
    say = echo
    base = Path(args.base)
    library = _library(args)
    if library is None:
        say("no playbook library found (pass --library)")
        return 2

    if args.verb == "numbers":
        doc = audit(library)
        run_dir = run_dir_for(base, args.run_id or f"numbers-{stamp()}")
        paths = [run_dir / "numbers.json"] + ([Path(args.out)] if args.out else [])
        for path in write_numbers(doc, *paths):
            say(f"wrote {path.as_posix()}")
        say(json.dumps(summary(doc)))
        return 0

    if args.verb == "report":
        run_id = args.run_id or _latest(base)
        run_dir = run_dir_for(base, run_id)
        if not run_id or not (run_dir / "pairs").is_dir():
            say(f"no run with pair dumps under {(base / BENCH_DIRNAME).as_posix()}")
            return 2
        md, fj, n = write_report(run_dir)
        say(f"wrote {md.as_posix()} and {fj.as_posix()} from {n} pairs")
        return 0 if n else 2

    try:
        cast = _Cast(args, library)
    except CastError as exc:
        say(f"cast: {exc}")
        return 2

    if args.verb == "cases":
        todo = [p for p in cast.selected if args.force or not case_path(cast.uat, p.id).is_file()]
        if args.dry:
            for pair in todo:
                say(pair.id)
            say(
                f"cases: {len(todo)} to write of {len(cast.selected)} selected, "
                f"about ${len(todo) * COST_MEDIANS['case']:.2f}"
            )
            return 0
        if not claude_available():
            say("no claude CLI on PATH (or PROVING_HOSTED is set): cases cannot be written here")
            return 2
        rig = Rig(run_dir_for(base, args.run_id or f"cases-{stamp()}"), library=library)
        failed = write_cases(
            rig,
            cast.selected,
            cast.characters,
            cast.playbooks,
            cast.uat,
            force=args.force,
            workers=args.workers,
            echo=say,
        )
        return 1 if failed else 0

    # run
    run_id = args.run_id or stamp()
    run_dir = run_dir_for(base, run_id)
    jobs, done = plan_jobs(run_dir.resolve(), cast.selected)
    no_case = [j.pair.id for j in jobs if not case_path(cast.uat, j.pair.id).is_file()]
    rehearse = not args.no_rehearse
    per_pair = (
        COST_MEDIANS["onboarding"]
        + (COST_MEDIANS["rehearsal"] if rehearse else 0.0)
        + COST_MEDIANS["judge"]
    )
    estimate = len(jobs) * per_pair + len(no_case) * COST_MEDIANS["case"]
    plan = [
        f"run {run_id}: {len(cast.selected)} pairs selected, {done} complete on disk, "
        f"{len(jobs)} to run",
        f"legs per pair: about {legs_per_pair(rehearse=rehearse)} at 3 cards "
        f"(onboarding, {'a shape leg and the bench turns, ' if rehearse else ''}the judge)",
        f"estimate: ${estimate:.2f} (medians: onboarding ${COST_MEDIANS['onboarding']:.2f}, "
        f"rehearsal ${COST_MEDIANS['rehearsal']:.2f}{'' if rehearse else ' (off)'}, judge "
        f"${COST_MEDIANS['judge']:.2f}, case ${COST_MEDIANS['case']:.2f} x {len(no_case)} "
        f"without a case card); cap ${args.cap_usd:.2f}",
    ]
    if args.dry:
        for job in jobs:
            say(
                f"{job.kind} {job.pair.id}"
                + (" (no case card yet)" if job.pair.id in no_case else "")
            )
        for line in plan:
            say(line)
        return 0
    if no_case:
        say(f"{len(no_case)} pairs have no case card; run `cases` first: {', '.join(no_case[:10])}")
    if not claude_available():
        say("no claude CLI on PATH (or PROVING_HOSTED is set): the run cannot start here")
        return 2
    for line in plan:
        say(line)
    if not jobs:
        say("nothing to run: every pair is complete on disk")
        return 0
    ident = instrument()
    meta_path = run_dir / "run.json"
    if meta_path.is_file():
        try:
            old = json.loads(meta_path.read_text(encoding="utf-8")).get("instrument", {})
        except (OSError, json.JSONDecodeError, AttributeError):
            old = {}
        moved = [k for k in _IDENTITY if old.get(k) != ident.get(k)]
        if moved:
            say(
                f"run {run_id} was measured with another instrument ({', '.join(moved)}); "
                "start a new --run-id"
            )
            return 2
    run_dir.mkdir(parents=True, exist_ok=True)
    meta_path.write_text(
        json.dumps(
            {
                "run_id": run_id,
                "started_at": stamp(),
                "instrument": ident,
                "pairs": len(cast.selected),
                "rehearse": rehearse,
                "cap_usd": args.cap_usd,
                "wall_s": args.wall_s,
            },
            indent=1,
        )
        + "\n",
        encoding="utf-8",
    )
    rig = Rig(run_dir, library=library, wall_s=args.wall_s)
    failed = run_pairs(
        rig,
        jobs,
        cast.load,
        workers=args.workers,
        cap_usd=args.cap_usd,
        spent_before=ledger_spent(run_dir / "ledger.jsonl"),
        rehearse=rehearse,
        echo=say,
    )
    write_report(rig.run_dir)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

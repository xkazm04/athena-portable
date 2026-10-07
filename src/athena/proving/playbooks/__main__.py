"""``python -m athena.proving.playbooks``: check and bench the playbooks (README §14; ADR 0040).

::

    uv run python -m athena.proving.playbooks check              # every playbook loads
    uv run python -m athena.proving.playbooks bench <id> [--model sonnet] [--approve none|all]
        [--cap 5.0] [--engine claude_code] [--out proving-runs] [--no-write]
    uv run python -m athena.proving.playbooks rescore <id> <run>/report.json

``bench`` runs a real Athena on the user's own ``claude`` CLI (no key needed) and writes the full
report under ``proving-runs/<ts>/playbook-<id>/`` (gitignored) and the summary into the playbook's
``bench.json``, which the desktop's Playbooks module shows. Exit 0 when the verdict is ``meets``
or ``exceeds``, 1 when it is ``short``, 2 when the playbook could not be loaded.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path

from athena.proving.playbooks.bench import (
    BenchConfig,
    rescore,
    run_bench,
    write_bench,
    write_report,
)
from athena.proving.playbooks.spec import PLAYBOOKS_DIRNAME, PlaybookError, load_all, load_playbook
from athena.proving.report import RUNS_DIRNAME, new_run_dir


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m athena.proving.playbooks")
    parser.add_argument("--dir", default=PLAYBOOKS_DIRNAME, help="where the playbooks live")
    verbs = parser.add_subparsers(dest="verb", required=True)
    verbs.add_parser("check", help="load every playbook and report its problems")
    b = verbs.add_parser("bench", help="run one playbook against a real Athena")
    b.add_argument("playbook")
    b.add_argument("--engine", default="claude_code")
    b.add_argument("--model", default="sonnet")
    b.add_argument("--approve", choices=("none", "all"), default="none")
    b.add_argument("--cap", type=float, default=5.0, help="USD cap for the run")
    b.add_argument("--out", default=RUNS_DIRNAME)
    b.add_argument("--no-write", dest="write", action="store_false", help="leave bench.json alone")
    b.add_argument("--note", default="", help="what changed since the last run, in a sentence")
    r = verbs.add_parser("rescore", help="score a saved run again; nothing is re-run")
    r.add_argument("playbook")
    r.add_argument("report", help="the run's report.json")
    r.add_argument("--note", default="", help="why it was rescored, in a sentence")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.verb == "check":
        try:
            books = load_all(args.dir)
        except PlaybookError as exc:
            print(f"refused: {exc}", file=sys.stderr)
            return 2
        for book in books:
            print(
                f"{book.id}: {len(book.apps)} portals, {len(book.phases)} phases, "
                f"{sum(len(t.eligible) for t in book.targets)} eligible "
                f"(${book.eligible_total():,.2f}), "
                f"{sum(len(t.traps) for t in book.targets)} traps"
            )
        return 0
    try:
        book = load_playbook(Path(args.dir) / args.playbook)
    except PlaybookError as exc:
        print(f"refused: {exc}", file=sys.stderr)
        return 2
    if args.verb == "rescore":
        source = Path(args.report)
        again = rescore(book, json.loads(source.read_text(encoding="utf-8")))
        target = write_bench(book, again, source.parent, note=args.note)
        print(f"rescored {source.as_posix()} -> {target.as_posix()}: {again['verdict']['word']}")
        return 1 if again["verdict"]["word"] == "short" else 0
    config = BenchConfig(
        engine=args.engine, model=args.model, approve=args.approve, cap_usd=args.cap
    )
    print(f"bench {book.id} on {config.engine} {config.model}", flush=True)
    report = run_bench(book, config, echo=lambda line: print(line, flush=True))
    run_dir = new_run_dir(Path(args.out)) / f"playbook-{book.id}"
    if args.write:
        target = write_bench(book, report, run_dir, note=args.note)
        print(f"summary: {target.as_posix()}", flush=True)
    else:
        write_report(run_dir, report)
    s = report["score"]
    v = report["verdict"]
    print(
        f"found {s['found']}/{s['eligible']} (${s['value_found_usd']:,.2f} of "
        f"${s['value_total_usd']:,.2f}), exact {s['exact']}, false {s['false_claims']}, "
        f"dup {s['duplicates']}; {report['turns']} turns, {v['minutes']} min, "
        f"${report.get('cost_usd', '?')}",
        flush=True,
    )
    print(f"verdict: {v['word']}" + (f" - {'; '.join(v['reasons'])}" if v["reasons"] else ""))
    print(f"report: {(run_dir / 'report.json').as_posix()}", flush=True)
    return 1 if v["word"] == "short" else 0


if __name__ == "__main__":
    sys.exit(main())

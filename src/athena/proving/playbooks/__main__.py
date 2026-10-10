"""``python -m athena.proving.playbooks``: check and bench the playbooks (README §14; ADR 0040).

::

    uv run python -m athena.proving.playbooks check              # every playbook loads
    uv run python -m athena.proving.playbooks bench <id> [--model sonnet] [--approve none|all]
        [--cap 5.0] [--engine claude_code] [--out proving-runs] [--no-write]
    uv run python -m athena.proving.playbooks rescore <id> <run>/report.json
    uv run python -m athena.proving.playbooks evidence <id>|--all [--dry] [--verify]

``bench`` runs a real Athena on the user's own ``claude`` CLI (no key needed) and writes the full
report under ``proving-runs/<ts>/playbook-<id>/`` (gitignored) and the summary into the playbook's
``bench.json``, which the desktop's Playbooks module shows. Exit 0 when the verdict is ``meets``
or ``exceeds``, 1 when it is ``short``, 2 when the playbook could not be loaded.

``evidence`` films a benched playbook (ADR 0055, :mod:`.evidence`): the media under the gitignored
``evidence/<id>/``, the index and thumbnail into ``playbooks/<id>/``. ``--dry`` prints the plan and
runs no tool; ``--verify`` reports each index as current, stale, missing or unreadable (a
``bench.json`` or ``evidence.json`` that is not a JSON object) against its bench.
Exit 0 when every step ran (or, with ``--verify``, every benched playbook is current), 1 when one
did not, 2 when a playbook could not be loaded or has no bench to film.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path

from athena.core.catalog import READ_CAP
from athena.proving.playbooks.bench import (
    BenchConfig,
    rescore,
    run_bench,
    write_bench,
    write_report,
)
from athena.proving.playbooks.evidence import (
    EvidenceError,
    build_evidence,
    choose_voice,
    find_tools,
    plan,
    verify,
)
from athena.proving.playbooks.page import SimulatedPortals
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
    e = verbs.add_parser("evidence", help="narrate and film a benched playbook (ADR 0055)")
    e.add_argument("playbook", nargs="?", help="one playbook's id; or --all")
    e.add_argument("--all", action="store_true", help="every benched playbook")
    e.add_argument("--dry", action="store_true", help="print the plan, run no tool")
    e.add_argument(
        "--verify", action="store_true", help="current, stale, missing or unreadable, re-hashed"
    )
    return parser


def evidence(args: argparse.Namespace) -> int:
    if bool(args.playbook) == bool(args.all):
        print("refused: name one playbook or pass --all", file=sys.stderr)
        return 2
    base = Path(args.dir)
    repo = base.resolve().parent
    try:
        books = load_all(base) if args.all else [load_playbook(base / args.playbook)]
    except PlaybookError as exc:
        print(f"refused: {exc}", file=sys.stderr)
        return 2
    if args.verify:
        standings = verify(books, repo)
        for s in standings:
            print(f"{s.playbook}: {s.state}" + "".join(f"\n  {n}" for n in s.notes))
        current = sum(1 for s in standings if s.state == "current")
        filmable = sum(1 for s in standings if s.state != "unbenched")
        print(f"{current} of {filmable} benched playbooks current")
        return 0 if all(s.ok for s in standings) else 1
    benched = [b for b in books if (b.root / "bench.json").is_file()]
    if not args.all and not benched:
        print(f"refused: {books[0].id} has no bench.json: bench it first", file=sys.stderr)
        return 2
    for book in books:
        if book not in benched:
            print(f"{book.id}: not benched, no evidence to film")
    if args.dry:
        for book in benched:
            print("\n".join(plan(book, repo)))
        return 0
    try:
        tools = find_tools()
        voice = choose_voice()
    except EvidenceError as exc:
        print(f"missing: {exc}", file=sys.stderr)
        return 1
    failed = 0
    for book in benched:
        try:
            build_evidence(book, repo, tools, voice, echo=lambda line: print(line, flush=True))
        except EvidenceError as exc:
            failed += 1
            print(f"{book.id}: failed: {exc}", file=sys.stderr, flush=True)
    return 1 if failed else 0


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.verb == "check":
        try:
            books = load_all(args.dir)
        except PlaybookError as exc:
            print(f"refused: {exc}", file=sys.stderr)
            return 2
        cut = 0
        for book in books:
            print(
                f"{book.id}: {len(book.apps)} portals, {len(book.phases)} phases, "
                f"{sum(len(t.eligible) for t in book.targets)} eligible "
                f"(${book.eligible_total():,.2f}), "
                f"{sum(len(t.traps) for t in book.targets)} traps"
            )
            for line in SimulatedPortals(book).oversized():
                cut += 1
                print(f"  cut at {READ_CAP} chars, page it: {line}")
        return 1 if cut else 0
    if args.verb == "evidence":
        return evidence(args)
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

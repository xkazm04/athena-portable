"""``python -m athena.proving.playbooks``: check and bench the playbooks (README §14; ADR 0040).

::

    uv run python -m athena.proving.playbooks check              # every playbook loads
    uv run python -m athena.proving.playbooks bench <id> [--model sonnet] [--approve none|all]
        [--cap 5.0] [--engine claude_code] [--out proving-runs] [--no-write] [--runs 1]
        [--project] [--case]
    uv run python -m athena.proving.playbooks bench <id> --second-run [--model ...]
    uv run python -m athena.proving.playbooks rescore <id> <run>/report.json
    uv run python -m athena.proving.playbooks evidence <id>|--all [--dry] [--verify]
        [--stills-only] [--desktop apps/desktop]
    uv run python -m athena.proving.playbooks rank [--check | --tau]
    uv run python -m athena.proving.playbooks followthrough <id> [--branch approve|decline|
        lost_answer|all] [--repeats 3] [--model sonnet] [--cap 5.0] [--engine claude_code]
        [--out proving-runs] [--no-write]
    uv run python -m athena.proving.playbooks followthrough <id> --reassess <run>.json [--note]

``bench`` runs a real Athena on the user's own ``claude`` CLI (no key needed) and writes the full
report under ``proving-runs/<ts>/playbook-<id>/`` (gitignored) and the summary into the playbook's
``bench.json``, which the desktop's Playbooks module shows. Exit 0 when the verdict is ``meets``
or ``exceeds``, 1 when it is ``short``, 2 when the playbook could not be loaded. ``--runs k``
benches ``k`` fresh worlds one after the other, each a line of the history under its comparability
key (ADR 0128); the exit is 1 when any of them was short. ``rescore`` writes the rescored report
beside the run's own ``report.json``, never over it, and appends the run's original score to the
history as a correction.

``bench --second-run`` (ADR 0126) runs the playbook twice on one world: run 1 approving every card,
run 2 after a restart with the gate looking back to run 1's start, and reports run 2's cards for
items run 1 already filed and its recall on the rest. ``--no-carry`` is accepted and changes
nothing: run 1's receipt no longer reaches run 2's prompt in any run (ADR 0130). It writes the
report alone, never ``bench.json``: a two-run result is not comparable with a one-run verdict.
``--cap`` bounds each run. Exit 1 when run 2 is ``short`` of that bar.

``evidence`` films a benched playbook (ADR 0055, :mod:`.evidence`): the media under the gitignored
``evidence/<id>/``, the index and thumbnail into ``playbooks/<id>/``. ``--dry`` prints the plan and
runs no tool; ``--verify`` reports each index as current, stale, missing or unreadable (a
``bench.json`` or ``evidence.json`` that is not a JSON object) against its bench, and re-hashes
its storyboard. ``--stills-only`` runs the storyboard step alone: the stills into
``playbooks/<id>/story/`` and the index rewritten to schema 2 with every other key kept; no voice
is needed. ``--desktop`` serves the capture from another checkout's ``apps/desktop``.
Exit 0 when every step ran (or, with ``--verify``, every benched playbook is current), 1 when one
did not, 2 when a playbook could not be loaded or has no bench to film.

``rank`` writes ``playbooks/ranking.json`` by the method of ADR 0056 (:mod:`.rank`), from the
committed files alone. ``--check`` writes nothing and exits 1 when the file differs. ``--tau``
writes nothing and prints each playbook's score on its first comparable run against the median of
the rest, with their Kendall tau-b (ADR 0128).

``followthrough`` drives a playbook that has a ``followthrough.json`` overlay (ADR 0129,
:mod:`.followthrough`) through two sessions on one brain with a restart between, once per branch
per repeat, writes each run's full record under ``proving-runs/<ts>/followthrough-<id>/``, appends
its line to ``playbooks/<id>/followthrough.runs.json`` and prints k-of-n per branch under the
current key. ``--reassess`` judges a saved run again and appends a correction; nothing is re-run.
Exit 0 when every run passed, 1 when one did not, 2 when the playbook or overlay could not be read.
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
    WorldFactory,
    rescore,
    run_bench,
    run_second,
    write_bench,
    write_report,
)
from athena.proving.playbooks.evidence import (
    EvidenceError,
    build_evidence,
    build_story,
    choose_voice,
    find_tools,
    plan,
    plan_story,
    verify,
    write_story,
)
from athena.proving.playbooks.followthrough import (
    BRANCHES,
    RESULTS_FILENAME,
    FollowConfig,
    FollowWorldFactory,
    OverlayError,
    load_overlay,
    reassess,
    record_correction,
    record_run,
    run_followthrough,
    tally,
)
from athena.proving.playbooks.page import SimulatedPortals
from athena.proving.playbooks.rank import run_rank, run_tau
from athena.proving.playbooks.spec import (
    PLAYBOOKS_DIRNAME,
    Playbook,
    PlaybookError,
    load_all,
    load_playbook,
)
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
    b.add_argument(
        "--project",
        action="store_true",
        help="experiment: a minted proj_ id sent as project_id, one shared conversation (ADR 0124)",
    )
    b.add_argument(
        "--case",
        action="store_true",
        help="run under a minted case, sent as case_id on every turn; routes nothing (ADR 0127)",
    )
    b.add_argument(
        "--second-run",
        action="store_true",
        help="run twice on one world, run 2 after a restart, scored for re-filing (ADR 0126)",
    )
    b.add_argument(
        "--no-carry",
        action="store_true",
        help="no-op since ADR 0130: run 2 never gets run 1's receipt in its prompt",
    )
    b.add_argument("--out", default=RUNS_DIRNAME)
    b.add_argument("--no-write", dest="write", action="store_false", help="leave bench.json alone")
    b.add_argument("--note", default="", help="what changed since the last run, in a sentence")
    b.add_argument(
        "--runs", type=int, default=1, help="fresh worlds to bench, one after the other (ADR 0128)"
    )
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
    e.add_argument(
        "--stills-only",
        action="store_true",
        help="only the storyboard: stills into playbooks/<id>/story/, the index to schema 2",
    )
    e.add_argument("--desktop", default=None, help="the apps/desktop the capture serves")
    k = verbs.add_parser("rank", help="rank every playbook by ADR 0056")
    how = k.add_mutually_exclusive_group()
    how.add_argument("--check", action="store_true", help="exit 1 if ranking.json would change")
    how.add_argument(
        "--tau", action="store_true", help="run 1's order against the rest's, as Kendall tau-b"
    )
    f = verbs.add_parser(
        "followthrough", help="approve, decline or lose the answers, restart, run again (ADR 0129)"
    )
    f.add_argument("playbook")
    f.add_argument("--branch", choices=(*BRANCHES, "all"), default="all")
    f.add_argument("--repeats", type=int, default=3, help="runs per branch")
    f.add_argument("--engine", default="claude_code")
    f.add_argument("--model", default="sonnet")
    f.add_argument("--cap", type=float, default=5.0, help="USD cap per session")
    f.add_argument("--out", default=RUNS_DIRNAME)
    f.add_argument(
        "--no-write", dest="write", action="store_false", help="leave followthrough.runs.json alone"
    )
    f.add_argument("--reassess", default=None, help="a saved run's record, judged again")
    f.add_argument("--note", default="", help="why it was reassessed, in a sentence")
    return parser


def followthrough(
    book: Playbook,
    args: argparse.Namespace,
    *,
    world_factory: FollowWorldFactory | None = None,
) -> int:
    """Every branch asked for, ``--repeats`` times, each run written and appended (ADR 0129)."""
    try:
        overlay = load_overlay(book)
    except OverlayError as exc:
        print(f"refused: {exc}", file=sys.stderr)
        return 2
    if args.reassess:
        source = Path(args.reassess)
        original = json.loads(source.read_text(encoding="utf-8"))
        again = reassess(overlay, original)
        stamp = str(again["reassessed_at"]).replace(":", "").replace("-", "")
        write_report(source.parent, again, f"{source.stem}.reassessed-{stamp}.json")
        target = record_correction(book, original, again, note=args.note)
        word = "passed" if again["assessment"]["passed"] else "failed"
        print(f"reassessed {source.as_posix()} -> {target.as_posix()}: {word}")
        return 0 if again["assessment"]["passed"] else 1
    if args.repeats < 1:
        print(f"refused: --repeats must be 1 or more, not {args.repeats}", file=sys.stderr)
        return 2
    config = FollowConfig(engine=args.engine, model=args.model, cap_usd=args.cap)
    branches = BRANCHES if args.branch == "all" else (args.branch,)
    run_dir = new_run_dir(Path(args.out)) / f"followthrough-{book.id}"
    failed = 0
    key = ""
    for branch in branches:
        for repeat in range(1, args.repeats + 1):
            report = run_followthrough(
                book,
                overlay,
                branch,
                config,
                repeat=repeat,
                world_factory=world_factory,
                echo=lambda line: print(line, flush=True),
            )
            key = str(report["comparable"])
            path = write_report(run_dir, report, f"{branch}-{repeat}.json")
            if args.write:
                record_run(book, report, path.as_posix())
            verdict = report["assessment"]
            failed += not verdict["passed"]
            print(
                f"{branch} {repeat}: {'passed' if verdict['passed'] else 'FAILED'}; "
                + "; ".join(
                    f"{name} {'ok' if c['ok'] else 'no'} ({c['detail']})"
                    for name, c in verdict["checks"].items()
                )
                + f"; ${report.get('cost_usd', '?')}; record {path.as_posix()}",
                flush=True,
            )
    if args.write and key:
        results = json.loads((book.root / RESULTS_FILENAME).read_text(encoding="utf-8"))
        for branch, row in tally(results, key).items():
            print(f"{branch}: {row['k']} of {row['n']} under {key}", flush=True)
    return 1 if failed else 0


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
            print("\n".join((plan_story if args.stills_only else plan)(book, repo)))
        return 0
    desktop = Path(args.desktop).resolve() if args.desktop else None
    if args.stills_only:
        return stills(benched, repo, desktop)
    try:
        tools = find_tools()
        voice = choose_voice()
    except EvidenceError as exc:
        print(f"missing: {exc}", file=sys.stderr)
        return 1
    failed = 0
    for book in benched:
        try:
            build_evidence(
                book,
                repo,
                tools,
                voice,
                echo=lambda line: print(line, flush=True),
                desktop=desktop,
            )
        except EvidenceError as exc:
            failed += 1
            print(f"{book.id}: failed: {exc}", file=sys.stderr, flush=True)
    return 1 if failed else 0


def stills(books: Sequence[Playbook], repo: Path, desktop: Path | None) -> int:
    """``--stills-only``: each playbook's storyboard, and its index at schema 2 with the rest kept.

    The voice is not looked for: nothing is spoken. One playbook failing does not stop the others;
    the exit says whether any did, and its line says why.
    """
    try:
        tools = find_tools()
    except EvidenceError as exc:
        print(f"missing: {exc}", file=sys.stderr)
        return 1
    failed = 0
    for book in books:
        try:
            story = build_story(
                book, repo, tools, desktop=desktop, echo=lambda line: print(line, flush=True)
            )
            write_story(book, repo, story)
        except EvidenceError as exc:
            failed += 1
            print(f"{book.id}: failed: {exc}", file=sys.stderr, flush=True)
            continue
        total = sum(int(s["bytes"]) for s in story)
        print(f"{book.id}: {len(story)} stills, {total:,} bytes", flush=True)
    return 1 if failed else 0


def bench(
    book: Playbook,
    config: BenchConfig,
    *,
    runs: int = 1,
    out: Path = Path(RUNS_DIRNAME),
    write: bool = True,
    note: str = "",
    world_factory: WorldFactory | None = None,
) -> int:
    """``runs`` fresh worlds of ``book``, each benched and written in turn (ADR 0128).

    Every run is kept: each writes its own report and, with ``write``, becomes the latest run of
    ``bench.json`` and pushes the one before into the history, so the ranking pools all of them.
    Exit 1 when any run was short, else 0.
    """
    short = 0
    for index in range(1, runs + 1):
        if runs > 1:
            print(f"run {index} of {runs}", flush=True)
        report = run_bench(
            book, config, world_factory=world_factory, echo=lambda line: print(line, flush=True)
        )
        run_dir = new_run_dir(out) / f"playbook-{book.id}"
        if write:
            target = write_bench(book, report, run_dir, note=note)
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
        receipt = report.get("case_receipt")
        if isinstance(receipt, dict):
            # What the chore page would show for this run (ADR 0127), beside the bench's own cost.
            print(
                f"case receipt: {receipt.get('turns')} turns, {receipt.get('pending')} waiting, "
                f"${receipt.get('cost_usd')} over {receipt.get('calls')} ledger rows",
                flush=True,
            )
        print(f"report: {(run_dir / 'report.json').as_posix()}", flush=True)
        short += v["word"] == "short"
    if runs > 1:
        print(f"{runs - short} of {runs} runs met the bar", flush=True)
    return 1 if short else 0


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
    if args.verb == "rank":
        if args.tau:
            return run_tau(Path(args.dir))
        return run_rank(Path(args.dir), check=args.check)
    try:
        book = load_playbook(Path(args.dir) / args.playbook)
    except PlaybookError as exc:
        print(f"refused: {exc}", file=sys.stderr)
        return 2
    if args.verb == "followthrough":
        return followthrough(book, args)
    if args.verb == "rescore":
        source = Path(args.report)
        again = rescore(book, json.loads(source.read_text(encoding="utf-8")))
        # ADR 0128: the run's own report stays as it was; the rescore is written beside it.
        name = f"report.rescored-{str(again['rescored_at']).replace(':', '').replace('-', '')}.json"
        target = write_bench(book, again, source.parent, note=args.note, report_name=name)
        print(f"rescored {source.as_posix()} -> {target.as_posix()}: {again['verdict']['word']}")
        return 1 if again["verdict"]["word"] == "short" else 0
    if args.runs < 1:
        print(f"refused: --runs must be 1 or more, not {args.runs}", file=sys.stderr)
        return 2
    config = BenchConfig(
        engine=args.engine,
        model=args.model,
        approve=args.approve,
        cap_usd=args.cap,
        project=args.project,
        case=args.case,
    )
    if args.second_run:
        if args.no_carry:
            print(NO_CARRY_NOTE, flush=True)
        return second_run(book, config, out=Path(args.out))
    print(f"bench {book.id} on {config.engine} {config.model}", flush=True)
    return bench(book, config, runs=args.runs, out=Path(args.out), write=args.write, note=args.note)


#: What ``--no-carry`` says: kept so the command that measured ADR 0130 still runs, and changes
#: nothing, because no run carries the last receipt into its prompt any more.
NO_CARRY_NOTE = (
    "--no-carry changes nothing since ADR 0130: run 2 never gets run 1's receipt in its prompt"
)


def second_run(book: Playbook, config: BenchConfig, *, out: Path) -> int:
    """``bench --second-run``: two runs on one world, the report written, ``bench.json`` not."""
    print(f"bench {book.id} second run on {config.engine} {config.model}", flush=True)
    report = run_second(book, config, echo=lambda line: print(line, flush=True))
    run_dir = new_run_dir(out) / f"second-run-{book.id}"
    write_report(run_dir, report)
    s = report["second_run"]
    first = report["run_1"]["score"]
    rest = s.get("recall_rest_count")
    print(
        f"run 1 found {first['found']}/{first['eligible']}; run 2: "
        f"{s['duplicates_of_run_1']} duplicates of run 1, "
        f"found {s['rest_found']}/{s['rest_eligible']} of the rest"
        + (f" ({rest:.0%})" if rest is not None else "")
        + f"; ${report.get('cost_usd', '?')}",
        flush=True,
    )
    print(f"second run: {s['word']}" + (f" - {'; '.join(s['reasons'])}" if s["reasons"] else ""))
    print(f"report: {(run_dir / 'report.json').as_posix()}", flush=True)
    return 1 if s["word"] == "short" else 0


if __name__ == "__main__":
    sys.exit(main())

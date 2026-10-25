"""One append-only run ledger for the bench and for follow-through (ADR 0195).

Each test is one acceptance case of the card that made the ledger: the pool is every run under the
key however many there are, a rescore costs no run, a playbook without a ledger reads as it always
did, follow-through's file is the same bytes, and ``bench.json`` stays the desktop's view.
"""

from __future__ import annotations

import json
import shutil
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import pytest

from athena.proving.playbooks import bench as bench_module
from athena.proving.playbooks import followthrough as ft
from athena.proving.playbooks import ledger, rank, spec
from athena.proving.playbooks.__main__ import main
from athena.proving.playbooks.bench import BenchConfig, rescore, run_bench, write_bench
from athena.proving.playbooks.evidence import narration
from athena.proving.playbooks.spec import TAXONOMY_FILENAME, Playbook, load_playbook
from athena.proving.report import prune

from .conftest import scripted_model
from .test_playbooks import _careful, _factory, make_playbook

REPO = Path(__file__).resolve().parents[2]

ECONOMICS = {
    "value_usd": 30,
    "per": "year",
    "manual_minutes": 60,
    "times_per_year": 1,
    "sources": [{"label": "a source", "url": "https://example.org/x"}],
}


@pytest.fixture
def book(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Playbook:
    # The scripted fixture is small on purpose; ADR 0057's floor is tested in its own file.
    monkeypatch.setattr(spec, "BEFORE_ADR_0057", spec.BEFORE_ADR_0057 | {"late-parcels"})
    return load_playbook(make_playbook(tmp_path, showcase={"economics": ECONOMICS}))


@pytest.fixture
def report(book: Playbook) -> dict[str, Any]:
    return run_bench(
        book, BenchConfig(engine="nebius"), world_factory=_factory(scripted_model(_careful))
    )


def _at(i: int) -> str:
    return f"2026-10-{i + 1:02d}T00:00:00Z"


def _bench_n(book: Playbook, report: Mapping[str, Any], tmp_path: Path, n: int) -> None:
    """``n`` keyed runs of one playbook under one key, each through ``write_bench``."""
    for i in range(n):
        write_bench(book, {**report, "run_at": _at(i)}, tmp_path / f"run-{i}")


def test_case1_fourteen_runs_pool_fourteen_and_the_ranking_row_says_14(
    book: Playbook, report: dict[str, Any], tmp_path: Path
) -> None:
    # The window holds the latest and HISTORY (12) earlier runs: the 14th run is the first to
    # evict one from bench.json (the card said 13; the window's own count is one more).
    _bench_n(book, report, tmp_path, 14)
    pooled = ledger.pool(book.root, report["comparable"])
    assert pooled is not None and len(pooled) == 14
    ranking = rank.rank_all(
        rank.load_entries(book.root.parent), rank.load_contents(book.root.parent)
    )
    [row] = ranking["ranked"]
    assert row["bench"]["runs"]["n"] == 14


def test_case2_a_rescore_appends_a_correction_and_costs_no_run(
    book: Playbook, report: dict[str, Any], tmp_path: Path
) -> None:
    _bench_n(book, report, tmp_path, 13)
    latest = {**report, "run_at": _at(12)}
    again = rescore(book, latest)
    again["score"] = {**again["score"], "recall_value": 0.75}
    write_bench(book, again, tmp_path / "run-12", note="rescored", report_name="r.json")
    records = ledger.read(book.root, ledger.BENCH_LEDGER)
    assert len(records["runs"]) == 13
    [correction] = records["corrections"]
    assert correction["run_at"] == _at(12)
    assert correction["was"]["run_at"] == _at(12) and correction["note"] == "rescored"
    pooled = ledger.pool(book.root, again["comparable"])
    assert pooled is not None and len(pooled) == 13
    assert pooled[0]["run_at"] == _at(12) and pooled[0]["recall_value"] == 0.75
    assert pooled[0]["comparable"] == again["comparable"]


def test_case3_without_a_ledger_the_pool_is_bench_json_as_comparable_runs_read_it(
    book: Playbook, report: dict[str, Any], tmp_path: Path
) -> None:
    """Guard: a playbook benched before the ledger reads as it always did; nothing is written."""
    key = report["comparable"]
    history = [
        {"run_at": _at(1), "comparable": key, "verdict": "exceeds", "recall_value": 1.0},
        {"run_at": _at(2), "comparable": "OLD", "verdict": "short"},
        {"run_at": _at(3), "comparable": key, "verdict": "meets", "superseded_by": {"note": "x"}},
        {"run_at": _at(4), "comparable": key, "verdict": "meets", "recall_value": 0.5},
    ]
    seeded = {**bench_module.summary_of({**report, "run_at": _at(5)}), "history": history}
    (book.root / "bench.json").write_text(json.dumps(seeded), encoding="utf-8")
    listing = sorted(p.name for p in book.root.iterdir())
    expected = bench_module.comparable_runs(seeded)
    assert expected is not None and len(expected) == 3
    assert ledger.pool(book.root) == expected
    assert ledger.pool(book.root, key) == bench_module.comparable_runs(seeded, key)
    assert ledger.pool(book.root, "ELSE") == []
    assert sorted(p.name for p in book.root.iterdir()) == listing


def test_case4_the_committed_library_ranks_byte_identical(
    capsys: pytest.CaptureFixture[str],
) -> None:
    """Guard: no ledger is committed, so every read falls back and ranking.json does not move."""
    library = REPO / "playbooks"
    assert not list(library.glob(f"*/{ledger.BENCH_LEDGER}"))
    assert main(["--dir", str(library), "rank", "--check"]) == 0
    capsys.readouterr()
    text = rank.render(rank.rank_all(rank.load_entries(library), rank.load_contents(library)))
    assert text.encode("utf-8") == (library / rank.RANKING_FILENAME).read_bytes()


# --- follow-through: today's writer, frozen, as the oracle ---------------------------------------


def _oracle_write(results: dict[str, Any], playbook: str, scratch: Path) -> bytes:
    runs = results["runs"]
    latest = None
    if runs:
        last = runs[-1]
        latest = last.get("comparable")
        for correction in results["corrections"]:
            if ft._mark(correction) == ft._mark(last):
                latest = dict(correction.get("now", {})).get("comparable", latest)
    body = {
        "playbook": playbook,
        "assertion_version": ft.ASSERTION_VERSION,
        "comparable": latest,
        "tally": ft.tally(results, latest) if latest else {},
        "runs": runs,
        "corrections": results["corrections"],
    }
    oracle = scratch / "oracle.json"
    oracle.write_text(json.dumps(body, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return oracle.read_bytes()


def _ft_report(i: int, branch: str, key: str, passed: bool) -> dict[str, Any]:
    return {
        "run_at": _at(i),
        "branch": branch,
        "repeat": i,
        "engine": "nebius",
        "model": "fake",
        "drive": "d" * 8,
        "comparable": key,
        "assessment": {"version": 1, "passed": passed, "checks": {"x": {"ok": passed}}},
        "sessions": [{"cards": [1, 2]}, {"cards": []}],
        "cost_usd": 0.01,
    }


@pytest.fixture
def ft_book(tmp_path: Path) -> Playbook:
    library = tmp_path / "playbooks"
    shutil.copytree(
        REPO / "playbooks" / "freelancer-receivables", library / "freelancer-receivables"
    )
    shutil.copy(REPO / "playbooks" / TAXONOMY_FILENAME, library / TAXONOMY_FILENAME)
    (library / "freelancer-receivables" / ft.RESULTS_FILENAME).unlink(missing_ok=True)
    return load_playbook(library / "freelancer-receivables")


def test_case5_followthrough_writes_through_the_ledger_and_its_bytes_do_not_move(
    ft_book: Playbook, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    calls: list[str] = []
    real_append, real_correct = ledger.append, ledger.correct

    def spy_append(*args: Any, **kwargs: Any) -> Path:
        calls.append("append")
        return real_append(*args, **kwargs)

    def spy_correct(*args: Any, **kwargs: Any) -> Path:
        calls.append("correct")
        return real_correct(*args, **kwargs)

    monkeypatch.setattr(ledger, "append", spy_append)
    monkeypatch.setattr(ledger, "correct", spy_correct)
    oracle: dict[str, Any] = {"runs": [], "corrections": []}
    target = ft_book.root / ft.RESULTS_FILENAME
    reports = [
        _ft_report(1, "approve", "K", True),
        _ft_report(2, "approve", "K", False),
        _ft_report(3, "decline", "K", True),
    ]
    for r in reports:
        ft.record_run(ft_book, r, f"proving-runs/x/{r['branch']}-{r['repeat']}.json")
        oracle["runs"].append(ft._line(r, f"proving-runs/x/{r['branch']}-{r['repeat']}.json"))
        assert target.read_bytes() == _oracle_write(oracle, ft_book.id, tmp_path)
    again = {**reports[1], "comparable": "K2", "reassessed_at": _at(9)}
    again["assessment"] = {"version": 2, "passed": True, "checks": {"x": {"ok": True}}}
    ft.record_correction(ft_book, reports[1], again, note="forgiven")
    oracle["corrections"].append(
        prune(
            {
                "reassessed_at": _at(9),
                "run_at": reports[1]["run_at"],
                "branch": "approve",
                "repeat": 2,
                "note": "forgiven",
                "was": ft._line(reports[1]),
                "now": ft._line(again),
            }
        )
    )
    assert target.read_bytes() == _oracle_write(oracle, ft_book.id, tmp_path)
    assert calls == ["append", "append", "append", "correct"]
    results = json.loads(target.read_text(encoding="utf-8"))
    assert ft.tally(results, "K") == {"approve": {"k": 1, "n": 1}, "decline": {"k": 1, "n": 1}}
    assert ft.tally(results, "K2") == {"approve": {"k": 1, "n": 1}}


def test_case6_bench_json_after_fourteen_runs_is_the_view_with_a_pool_block(
    book: Playbook, report: dict[str, Any], tmp_path: Path
) -> None:
    _bench_n(book, report, tmp_path, 14)
    view = json.loads((book.root / "bench.json").read_text(encoding="utf-8"))
    assert view["run_at"] == _at(13)
    assert view["score"] == bench_module.summary_of(report)["score"]
    assert 0 < len(view["history"]) <= bench_module.HISTORY
    assert view["history"][-1]["run_at"] == _at(12)
    assert view["pool"] == {
        "key": report["comparable"],
        "n": 14,
        "exceeds": 14 if report["verdict"]["word"] == "exceeds" else 0,
    }
    assert ledger.LEDGER_KEY not in view


def test_case8_the_narration_counts_every_run_in_the_ledger(
    book: Playbook, report: dict[str, Any], tmp_path: Path
) -> None:
    _bench_n(book, report, tmp_path, 14)
    bench = ledger.view(book.root)
    assert bench is not None
    text = narration(book.showcase, bench)
    assert "of 14 test runs" in text
    ranking = rank.rank_all(
        rank.load_entries(book.root.parent), rank.load_contents(book.root.parent)
    )
    assert ranking["ranked"][0]["bench"]["runs"]["n"] == 14


def test_the_first_ledger_write_seeds_every_run_bench_json_held(
    book: Playbook, report: dict[str, Any], tmp_path: Path
) -> None:
    """A playbook benched before the ledger loses no run when it is benched again."""
    key = report["comparable"]
    history = [
        {"run_at": _at(1), "comparable": key, "verdict": "exceeds", "recall_value": 1.0},
        {"run_at": _at(2), "comparable": key, "verdict": "meets", "superseded_by": {"note": "x"}},
    ]
    seeded = {**bench_module.summary_of({**report, "run_at": _at(2)}), "history": history}
    (book.root / "bench.json").write_text(json.dumps(seeded), encoding="utf-8")
    write_bench(book, {**report, "run_at": _at(3)}, tmp_path / "run-3")
    records = ledger.read(book.root, ledger.BENCH_LEDGER)
    assert [r["run_at"] for r in records["runs"]] == [_at(1), _at(2), _at(3)]
    assert not any("superseded_by" in r for r in records["runs"])
    pooled = ledger.pool(book.root, key)
    assert pooled is not None and len(pooled) == 3

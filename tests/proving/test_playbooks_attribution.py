"""Every missed item says whether she saw it: seen and passed, or never surfaced.

Each test is one acceptance case of the card that made :mod:`athena.proving.playbooks.attribution`.
A short run's missed items and filed traps are joined to the reads the transcript recorded,
replayed through the page, so the operator reads a coverage failure (the page, the search, the
pagination) apart from a judgement failure (seen, passed) without opening the transcript. The
score, the verdict and the comparability key do not move.
"""

from __future__ import annotations

import inspect
import re
from pathlib import Path
from typing import Any

import pytest

from athena.harness.ports import ModelRequest
from athena.proving.playbooks import __main__ as playbooks_main
from athena.proving.playbooks import bench as bench_module
from athena.proving.playbooks import page as page_module
from athena.proving.playbooks import spec
from athena.proving.playbooks.bench import (
    SCORER_VERSION,
    BenchConfig,
    cards_of,
    headline,
    rescore,
    run_bench,
    score,
    summary_of,
    verdict,
)
from athena.proving.playbooks.page import SimulatedPortals
from athena.proving.playbooks.spec import Playbook, load_playbook
from athena.proving.report import prune

from .conftest import frame_of, op_line, scripted_model
from .test_playbooks import _factory, make_playbook

READ = "host.shipdesk.list_shipments"


@pytest.fixture(autouse=True)
def _late_parcels_is_a_one_portal_world(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(spec, "BEFORE_ADR_0057", spec.BEFORE_ADR_0057 | {"late-parcels"})


def _files(*keys: str) -> Any:
    """Reads page 1 of the list, then files a claim for each of ``keys`` and stops."""

    def say(request: ModelRequest) -> str:
        if "1ZA" not in frame_of(request):
            return "Reading the shipments.\n" + op_line(READ)
        return "\n".join(op_line("host.shipdesk.file_claim", tracking=k, amount=12.5) for k in keys)

    return say


def _run(book: Playbook, *keys: str) -> dict[str, Any]:
    return run_bench(
        book, BenchConfig(engine="nebius"), world_factory=_factory(scripted_model(_files(*keys)))
    )


def _item(rows: list[dict[str, Any]], key: str) -> dict[str, Any]:
    return next(r for r in rows if r["key"] == key)


def _page_two_book(tmp_path: Path) -> Playbook:
    """The fixture with 1ZD, which sits on page 2 of the shipments, eligible as well."""
    truth = {
        "targets": [
            {
                "tool": "file_claim",
                "key": "tracking",
                "eligible": {
                    "1ZA": {"value_usd": 12.5, "expect": {"amount": 12.5}},
                    "1ZB": {"value_usd": 17.5, "expect": {"amount": 17.5}},
                    "1ZD": {"value_usd": 8.0},
                },
                "traps": {"1ZC": "delivered late because the address was wrong"},
            }
        ],
        "forbidden": ["close_account"],
    }
    return load_playbook(make_playbook(tmp_path, truth=truth))


def _bench_output(book: Playbook, keys: tuple[str, ...], tmp_path: Path, capsys: Any) -> str:
    code = playbooks_main.bench(
        book,
        BenchConfig(engine="nebius"),
        out=tmp_path / "runs",
        write=False,
        world_factory=_factory(scripted_model(_files(*keys))),
    )
    assert code in (0, 1)
    return str(capsys.readouterr().out)


def test_case1_an_item_read_and_not_filed_is_seen_with_the_read_that_showed_it(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    book = load_playbook(make_playbook(tmp_path))
    report = _run(book, "1ZA")
    row = _item(report["attribution"]["missed"], "1ZB")
    assert row["seen"] is True
    assert row["read_by"] == [READ]
    out = _bench_output(book, ("1ZA",), tmp_path, capsys)
    assert "missed 1ZB - seen on list_shipments, not filed" in out


def test_case2_an_item_on_a_page_never_read_is_never_surfaced_with_the_page_named(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    book = _page_two_book(tmp_path)
    report = _run(book, "1ZA", "1ZB")
    row = _item(report["attribution"]["missed"], "1ZD")
    assert row["seen"] is False
    assert row["read_by"] == []
    assert row["unread"] == {"read": READ, "page": 2, "pages": 2}
    out = _bench_output(book, ("1ZA", "1ZB"), tmp_path, capsys)
    assert "missed 1ZD - never surfaced (page 2 of 2 of list_shipments not read)" in out


def test_case3_a_filed_trap_names_the_read_that_showed_it(tmp_path: Path) -> None:
    book = load_playbook(make_playbook(tmp_path))
    report = _run(book, "1ZA", "1ZB", "1ZC")
    [trap] = report["attribution"]["traps"]
    assert (trap["action"], trap["key"], trap["seen"]) == ("file_claim", "1ZC", True)
    assert trap["read_by"] == [READ]


def test_case4_a_report_saved_before_attribution_is_rebuilt_by_replaying_its_reads(
    tmp_path: Path,
) -> None:
    book = _page_two_book(tmp_path)
    live = _run(book, "1ZA")
    old = {k: v for k, v in live.items() if k != "attribution"}
    # A saved transcript call carries its name and params, never what the page answered.
    for turn in old["transcript"]:
        for call in turn["calls"]:
            assert set(call) == {"name", "params"}
    again = rescore(book, old)
    assert again["attribution"] == live["attribution"]
    assert {r["key"]: r["seen"] for r in again["attribution"]["missed"]} == {
        "1ZB": True,
        "1ZD": False,
    }


def test_case5_guard_the_page_never_sees_the_truth_and_answers_the_same_either_way(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Guard: passes before the change by design.
    code = re.sub(r'"""[\s\S]*?"""', "", inspect.getsource(page_module))
    for word in ("truth", "targets", "eligible", "traps"):
        assert word not in code, f"the page names {word}"
    book = load_playbook(make_playbook(tmp_path))
    answers: list[str] = []
    real = SimulatedPortals.answer

    def spy(self: SimulatedPortals, name: str, params: Any) -> tuple[bool, str]:
        ok, out = real(self, name, params)
        answers.append(out)
        return ok, out

    monkeypatch.setattr(SimulatedPortals, "answer", spy)
    on = _run(book, "1ZA")
    with_attribution = list(answers)
    answers.clear()
    if hasattr(bench_module, "attribute"):
        monkeypatch.setattr(bench_module, "attribute", lambda *a, **k: None)
    off = _run(book, "1ZA")
    assert answers[: len(with_attribution)] == with_attribution[: len(answers)]
    assert _turns(on) == _turns(off)
    assert on["reads"] == off["reads"]


def _turns(report: dict[str, Any]) -> list[dict[str, Any]]:
    """The transcript without ``dropped``, which names each run's own minted approval ids."""
    return [{k: v for k, v in t.items() if k != "dropped"} for t in report["transcript"]]


def test_case6_guard_score_verdict_and_key_are_unchanged(tmp_path: Path) -> None:
    # Guard: passes before the change by design.
    assert SCORER_VERSION == 1
    book = load_playbook(make_playbook(tmp_path))
    report = _run(book, "1ZA")
    assert "attribution" not in report["score"]
    assert report["score"] == prune(score(book, cards_of(report)))
    bare = {k: v for k, v in report.items() if k != "attribution"}
    assert verdict(book, bare) == report["verdict"]
    assert report["verdict"]["reasons"] == [
        "found 42% of the value, expected 70%",
        "found 1 of 2 items, expected 70%",
    ]
    again = rescore(book, bare)
    assert again["comparable"] == report["comparable"]
    assert prune(again["score"]) == report["score"]


def test_case7_bench_json_carries_attribution_and_the_headline_does_not(tmp_path: Path) -> None:
    book = _page_two_book(tmp_path)
    report = _run(book, "1ZA")
    summary = summary_of(report)
    block = summary["attribution"]
    assert block["missed_seen"] == 1 and block["missed_unseen"] == 1
    by = {(r["kind"], r["key"]): r for r in block["by_item"]}
    assert by[("missed", "1ZB")]["seen"] is True
    assert by[("missed", "1ZD")]["unread"] == {"read": READ, "page": 2, "pages": 2}
    bare = {k: v for k, v in report.items() if k != "attribution"}
    assert headline(summary) == headline(summary_of(bare))
    assert "attribution" not in headline(summary)

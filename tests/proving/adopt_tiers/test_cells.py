"""Comparable cells (ADR 0145): one bench digest, paired cells, outcome-conditioned speed."""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

import pytest

from athena.proving.adopt_tiers import pick as pick_module
from athena.proving.adopt_tiers.cells import bench_digest, cell_digest
from athena.proving.adopt_tiers.pick import (
    aggregate,
    aggregate_shape,
    load_results,
    pick_all,
    pick_bench,
)
from athena.proving.adopt_tiers.report import dry_text, report_md
from athena.proving.adopt_tiers.scenarios import SCENARIOS_DIR, load_scenario, load_scenarios
from athena.proving.adopt_tiers.simulate import Job, job_path, make_plan, write_record

LEASE = load_scenario(SCENARIOS_DIR / "easy-lease-end.json")
SCENARIOS = load_scenarios()


# --- case 0: the digest ----------------------------------------------------------------------


def test_bench_digest_is_stable_and_follows_every_input(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    first = bench_digest(SCENARIOS)
    assert first == bench_digest(SCENARIOS)
    assert len(first) == 64
    for module, name in (
        ("athena.adopt.prompts", "INTERVIEW_SYSTEM"),
        ("athena.adopt.prompts", "AUDIT_SYSTEM"),
        ("athena.adopt.prompts", "BRIEF_SYSTEM"),
        ("athena.proving.adopt_tiers.simulate", "PERSONA_SYSTEM"),
        ("athena.proving.adopt_tiers.score", "JUDGE_SYSTEM"),
    ):
        with monkeypatch.context() as m:
            m.setattr(f"{module}.{name}", "a changed prompt")
            assert bench_digest(SCENARIOS) != first, name
    with monkeypatch.context() as m:
        m.setattr("athena.adopt.prompts.MAX_ROUNDS", 99)
        assert bench_digest(SCENARIOS) != first
    assert bench_digest(SCENARIOS) == first
    # A scenario file's bytes are in it.
    copy = tmp_path / "scenarios"
    shutil.copytree(SCENARIOS_DIR, copy)
    assert bench_digest(SCENARIOS, directory=copy) == first
    path = copy / "easy-lease-end.json"
    path.write_bytes(path.read_bytes() + b"\n")
    assert bench_digest(SCENARIOS, directory=copy) != first


# --- case 1: the plan runs a stale cell again --------------------------------------------------


def test_a_record_of_another_digest_is_planned_again_and_counted(tmp_path: Path) -> None:
    current = Job("interview", LEASE.id, "haiku-low", 1)
    stale = Job("interview", LEASE.id, "haiku-low", 2)
    ok_judge = {"ok": True}
    write_record(
        job_path(tmp_path, current),
        {"complete": True, "judge": ok_judge, "bench_digest": cell_digest(LEASE)},
    )
    write_record(
        job_path(tmp_path, stale), {"complete": True, "judge": ok_judge, "bench_digest": "other"}
    )
    plan = make_plan([LEASE], ["haiku-low"], 2, tmp_path, shape=False)
    assert [(j.kind, j.rep) for j in plan.jobs] == [("interview", 2)]
    assert plan.stale == 1
    assert plan.interviews_done == 1
    assert "1 stale (another bench digest) will run again" in dry_text(plan)


# --- case 2: the pick leaves other-digest records out ------------------------------------------


def test_load_results_drops_other_digest_records_and_the_report_says_so(tmp_path: Path) -> None:
    write_record(
        job_path(tmp_path, Job("interview", LEASE.id, "opus-low", 1)),
        {
            "complete": True,
            "scenario": LEASE.id,
            "config": "opus-low",
            "rep": 1,
            "bench_digest": cell_digest(LEASE),
        },
    )
    write_record(
        job_path(tmp_path, Job("interview", LEASE.id, "opus-low", 2)),
        {"complete": True, "scenario": LEASE.id, "config": "opus-low", "rep": 2},
    )
    results = load_results(tmp_path, [LEASE])
    assert [r["rep"] for r in results.interviews] == [1]
    assert results.stale == 1
    text = report_md(
        aggregate([], [LEASE]),
        aggregate_shape([]),
        [],
        run_dir=tmp_path,
        scenarios=1,
        shape_note="",
        stale=results.stale,
        digest=results.digest,
    )
    assert "excluded 1 record from another bench digest" in text
    assert results.digest[:12] in text


# --- scripted scores for the pick ----------------------------------------------------------------


def _score(record: dict[str, Any], _scenario: Any) -> dict[str, Any]:
    s = record["_score"]
    return {
        "ended": record["ended"],
        "right": 9,
        "wrong": 0,
        "missed": 1,
        "accuracy": s.get("accuracy", 90.0),
        "verdicts": [],
        "false_clear": [],
        "repeats": [],
        "rounds": 3,
        "questions": 6,
        "round_ms": s["round_ms"],
        "first_text_ms": s["first_text_ms"],
        "audit_ms": s["round_ms"],
        "usage": {
            "interview": {"cost_usd": s.get("usage", 0.01), "tokens": 100},
            "audit": {"cost_usd": s.get("usage", 0.01), "tokens": 100},
        },
        "judge": 4.5,
    }


def _record(
    scenario: str,
    config: str,
    rep: int,
    *,
    first: list[int],
    rounds: list[int] | None = None,
    accuracy: float = 90.0,
    ended: str = "clear",
) -> dict[str, Any]:
    return {
        "complete": True,
        "scenario": scenario,
        "config": config,
        "rep": rep,
        "ended": ended,
        "_score": {
            "accuracy": accuracy,
            "first_text_ms": first,
            "round_ms": rounds or [5000],
        },
    }


def _grid(config: str, scenarios: list[str], **kw: Any) -> list[dict[str, Any]]:
    return [_record(s, config, rep, **kw) for s in scenarios for rep in (1, 2)]


@pytest.fixture
def scripted(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pick_module, "score_interview", _score)


def _picks(records: list[dict[str, Any]]) -> list[pick_module.Pick]:
    return pick_bench(records, SCENARIOS, aggregate_shape([]), shape_measured=False)


# --- case 3: paired cells ----------------------------------------------------------------------


@pytest.mark.usefixtures("scripted")
def test_a_config_short_of_the_cells_is_out_not_ranked_on_its_easy_mix() -> None:
    every = [s.id for s in SCENARIOS]
    easy = [s.id for s in SCENARIOS if s.band == "easy"]
    records = _grid("opus-low", every, first=[1500], accuracy=88.0) + _grid(
        "haiku-low", easy, first=[400], accuracy=99.0
    )
    # Today's rule ranks haiku-low on its six easy runs.
    today = pick_all(aggregate(records, SCENARIOS), aggregate_shape([]), shape_measured=False)
    assert today[0].config == "haiku-low"
    interview = _picks(records)[0]
    assert interview.config == "opus-low"
    assert not interview.fallback
    assert interview.disqualified["haiku-low"] == ["covered 6 of 18 cells"]
    assert "paired 18 of 18" in interview.why
    assert interview.paired == 18 and interview.cells == 18


# --- case 4: outcome-conditioned speed ----------------------------------------------------------


@pytest.mark.usefixtures("scripted")
def test_speed_ranks_over_cells_every_survivor_ended_clear(tmp_path: Path) -> None:
    every = [s.id for s in SCENARIOS]
    opus = _grid("opus-low", every, first=[1000])
    sonnet = _grid("sonnet-low", every, first=[1100])
    # One wall-capped interview whose many short legs drag sonnet-low's pooled p50 down.
    sonnet[0] = _record(every[0], "sonnet-low", 1, first=[100] * 40, ended="wall_cap")
    pooled = aggregate(opus + sonnet, SCENARIOS)
    assert (pooled["sonnet-low"].first_text_p50 or 0) < (pooled["opus-low"].first_text_p50 or 0)
    interview = _picks(opus + sonnet)[0]
    assert interview.config == "opus-low"
    assert interview.conditioned == 17 and interview.paired == 18
    assert interview.speed["opus-low"] == 1000 and interview.speed["sonnet-low"] == 1100
    assert interview.pooled["sonnet-low"] == 100
    text = report_md(
        aggregate(opus + sonnet, SCENARIOS),
        aggregate_shape([]),
        _picks(opus + sonnet),
        run_dir=tmp_path,
        scenarios=9,
        shape_note="",
    )
    assert "conditioned (17 of 18 paired cells)" in text
    assert "| sonnet-low | 1,100 ms | 100 ms |" in text


# --- case 5 (guard): comparable records pick what today's rule picks ------------------------------


@pytest.mark.usefixtures("scripted")
def test_guard_full_current_clear_grid_picks_what_todays_rule_picks() -> None:
    every = [s.id for s in SCENARIOS]
    records = (
        _grid("haiku-low", every, first=[600], rounds=[4000], accuracy=80.0)
        + _grid("sonnet-low", every, first=[900], rounds=[6000])
        + _grid("opus-low", every, first=[1500], rounds=[3000], accuracy=92.0)
    )
    today = pick_all(aggregate(records, SCENARIOS), aggregate_shape([]), shape_measured=False)
    now = _picks(records)
    for old, new in zip(today, now, strict=True):
        assert (new.role, new.config, new.fallback, new.disqualified) == (
            old.role,
            old.config,
            old.fallback,
            old.disqualified,
        )
        assert new.why.startswith(old.why)

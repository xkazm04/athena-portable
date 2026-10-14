"""The plan, the simulated conversation, resume, and the shape adapter — all on a scripted model."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

import pytest

from athena.adopt.slots import playbooks_root
from athena.contracts.adopt import Brief
from athena.proving.adopt_tiers.__main__ import main
from athena.proving.adopt_tiers.scenarios import SCENARIOS_DIR, load_scenario, load_scenarios
from athena.proving.adopt_tiers.score import score_interview
from athena.proving.adopt_tiers.simulate import (
    CONFIGS,
    Job,
    job_path,
    make_plan,
    run_interview,
    run_jobs,
    run_shape,
    write_record,
)

from .conftest import FakeModel, clearing_script, make_rig

LEASE = load_scenario(SCENARIOS_DIR / "easy-lease-end.json")


# --- the plan ------------------------------------------------------------------------------------


def test_dry_counts(tmp_path: Path) -> None:
    plan = make_plan(load_scenarios(), list(CONFIGS), 2, tmp_path, shape=False)
    assert plan.interviews == 108
    assert plan.judges == 108
    assert plan.shapes == 0
    assert len(plan.jobs) == 108
    # 3 cards: start (audit + interview), 3 x (persona + audit + interview), brief; + a judge.
    assert plan.legs(3) == 108 * 12 + 108
    assert plan.legs(1) == 108 * 6 + 108
    assert plan.legs(8) == 108 * 25 + 108
    with_shape = make_plan(load_scenarios(), list(CONFIGS), 2, tmp_path, shape=True)
    assert with_shape.shapes == 108
    assert len(with_shape.jobs) == 216
    assert with_shape.legs(3) == 108 * 12 + 108 + 108


def test_main_dry_prints_the_plan_and_spends_nothing(tmp_path: Path) -> None:
    out: list[str] = []
    code = main(["--dry", "--out", str(tmp_path)], echo=out.append)
    assert code == 0
    text = "\n".join(out)
    assert "interviews: 9 x 6 x 2 = 108" in text
    assert "judge legs: 108" in text
    assert "estimated legs" in text
    assert not (tmp_path / "adopt-tiers").exists()


def test_resume_skips_what_is_on_disk(tmp_path: Path) -> None:
    scenarios = [LEASE]
    configs = ["haiku-low", "opus-medium"]
    done = Job("interview", LEASE.id, "haiku-low", 1)
    unjudged = Job("interview", LEASE.id, "haiku-low", 2)
    broken = Job("interview", LEASE.id, "opus-medium", 1)
    write_record(job_path(tmp_path, done), {"complete": True, "judge": {"ok": True}})
    write_record(job_path(tmp_path, unjudged), {"complete": True, "judge": None})
    write_record(job_path(tmp_path, broken), {"complete": False, "failure": "persona"})
    shaped = Job("shape", LEASE.id, "haiku-low", 1)
    write_record(job_path(tmp_path, shaped), {"complete": True})
    plan = make_plan(scenarios, configs, 2, tmp_path, shape=True)
    kinds = {(j.kind, j.config, j.rep) for j in plan.jobs}
    assert ("interview", "haiku-low", 1) not in kinds
    assert ("judge", "haiku-low", 1) not in kinds
    assert ("judge", "haiku-low", 2) in kinds
    assert ("interview", "haiku-low", 2) not in kinds
    assert ("interview", "opus-medium", 1) in kinds
    assert ("shape", "haiku-low", 1) not in kinds
    assert plan.interviews_done == 2 and plan.judged == 1 and plan.shapes_done == 1


# --- one conversation ----------------------------------------------------------------------------


def test_an_interview_runs_to_clear_on_the_configs_tier(tmp_path: Path) -> None:
    model = FakeModel(clearing_script())
    rig = make_rig(tmp_path, model)
    record = run_interview(rig, LEASE, "haiku-medium", 1)
    assert record["complete"], record["failure"]
    assert record["ended"] == "clear"
    assert record["rounds"] == 1
    kinds = [e["kind"] for e in record["events"]]
    assert "adopt.questions" in kinds and "adopt.clear" in kinds
    # The roles under test ran on the config's tier; the persona on its fixed tier.
    for leg in record["legs"]:
        if leg["kind"] in ("interview", "audit"):
            assert (leg["model"], leg["effort"]) == ("claude-haiku-5-5", "medium")
        if leg["kind"] == "persona":
            assert (leg["model"], leg["effort"]) == ("claude-sonnet-5-5", "medium")
    assert any(leg["role"] == "brief" for leg in record["legs"])
    # What she said up front rode on her first answer.
    assert "All my lease mail comes to my Gmail" in record["answers"][0]["text"]
    assert record["stated_round"] == 1
    # The persona saw the card fenced, and never the playbook's own answers.
    persona = model.prompts("persona")[0]
    assert "<<<card:" in persona and "Dana Whitcombe" in persona
    # A ledger row per invocation, kept on the record and in the run's ledger.
    assert len(record["ledger"]) == len(record["legs"])
    assert (tmp_path / "ledger.jsonl").read_text(encoding="utf-8").count("\n") == len(
        record["ledger"]
    )
    score = score_interview(record, LEASE)
    assert score["accuracy"] == 100.0
    assert score["false_clear"] == [] and score["repeats"] == []
    # The research lanes are off: no lane event.
    assert "adopt.lane" not in kinds


def test_tiers_json_is_not_touched_by_a_run(tmp_path: Path) -> None:
    from athena.adopt.legs import TIERS_PATH

    before = TIERS_PATH.read_bytes()
    run_interview(make_rig(tmp_path, FakeModel(clearing_script())), LEASE, "opus-low", 1)
    assert TIERS_PATH.read_bytes() == before


def test_a_failed_persona_is_an_incomplete_job(tmp_path: Path) -> None:
    script = clearing_script()
    script["persona"] = ["not json", "still not json"]
    record = run_interview(make_rig(tmp_path, FakeModel(script)), LEASE, "sonnet-low", 1)
    assert not record["complete"]
    assert record["failure"].startswith("persona")


def test_the_wall_cap_stops_the_interview(tmp_path: Path) -> None:
    rig = make_rig(tmp_path, FakeModel(clearing_script()), wall_s=0.0)
    record = run_interview(rig, LEASE, "sonnet-low", 1)
    assert record["ended"] == "wall_cap"


def test_run_jobs_writes_judges_blind_and_resumes(tmp_path: Path) -> None:
    model = FakeModel(clearing_script())
    rig = make_rig(tmp_path, model)
    plan = make_plan([LEASE], ["opus-medium"], 1, tmp_path, shape=False)
    lines: list[str] = []
    failed = run_jobs(rig, plan, parallel=2, echo=lines.append)
    assert failed == []
    assert lines[-1] == "harvest: 1 of 1 done, 0 failed"
    record = json.loads(job_path(tmp_path, plan.jobs[0]).read_text(encoding="utf-8"))
    assert record["judge"]["ok"] and record["judge"]["scores"]["plain"] == 5
    judge = model.prompts("judge")[0]
    for secret in ("opus-medium", "claude-opus-5-5", "claude-haiku", "claude-sonnet", "effort"):
        assert secret not in judge
    judge_argv = model.argvs("judge")[0]
    assert judge_argv[judge_argv.index("--model") + 1] == "claude-opus-5-5"
    again = make_plan([LEASE], ["opus-medium"], 1, tmp_path, shape=False)
    assert again.jobs == ()


def test_a_failed_job_is_named_in_the_harvest(tmp_path: Path) -> None:
    script = clearing_script()
    script["persona"] = ["nope"]
    rig = make_rig(tmp_path, FakeModel(script))
    plan = make_plan([LEASE], ["haiku-low"], 1, tmp_path, shape=False)
    lines: list[str] = []
    failed = run_jobs(rig, plan, parallel=1, echo=lines.append)
    assert len(failed) == 1
    assert "1 failed" in lines[-1] and f"{LEASE.id}/haiku-low/r1" in lines[-1]


# --- the shaper ----------------------------------------------------------------------------------


def _fake_shape(rename: bool) -> Any:
    def shape_world(
        playbook_dir: Path, brief: Brief, *, run_leg: Any, dest: Path, slots: Any = ()
    ) -> Path:
        target = Path(dest) / Path(playbook_dir).name
        shutil.copytree(playbook_dir, target)
        if rename:
            for name in ("world.json", "truth.json", "playbook.json"):
                path = target / name
                text = path.read_text(encoding="utf-8")
                for old, new in brief.portals.items():
                    if new:
                        text = text.replace(old, new)
                path.write_text(text, encoding="utf-8")
        return target

    return shape_world


def test_shape_adapter_validates_and_checks_portals(tmp_path: Path) -> None:
    rig = make_rig(tmp_path, FakeModel({}), library=playbooks_root())
    good = run_shape(rig, LEASE, "haiku-low", 1, _fake_shape(rename=True))
    assert good["complete"] and good["valid"] and good["portals_ok"], good["detail"]
    lazy = run_shape(rig, LEASE, "haiku-low", 2, _fake_shape(rename=False))
    assert lazy["valid"] and not lazy["portals_ok"]
    assert "Gmail" in lazy["portals_missing"]


def test_a_shape_that_raises_is_a_measured_failure(tmp_path: Path) -> None:
    def broken(playbook_dir: Path, brief: Brief, *, run_leg: Any, dest: Path) -> Path:
        raise ValueError("the shaped world did not pass the spec check")

    rig = make_rig(tmp_path, FakeModel({}), library=playbooks_root())
    record = run_shape(rig, LEASE, "haiku-low", 1, broken)
    assert record["complete"] and not record["valid"]
    assert "spec check" in record["detail"]


def test_report_and_pick_read_the_results(tmp_path: Path) -> None:
    from athena.proving.adopt_tiers.simulate import run_dir_for

    run_dir = run_dir_for(tmp_path, date="2026-10-14")
    rig = make_rig(run_dir, FakeModel(clearing_script()))
    plan = make_plan([LEASE], ["sonnet-low", "opus-medium"], 1, run_dir, shape=False)
    assert run_jobs(rig, plan, parallel=1, echo=lambda _line: None) == []
    out: list[str] = []
    args = ["--out", str(tmp_path), "--scenarios", LEASE.id]
    assert main(["report", *args], echo=out.append) == 0
    report = (run_dir / "report.md").read_text(encoding="utf-8")
    assert "## interview" in report and "## audit" in report and "## shape" in report
    assert "| sonnet-low | 1 |" in report
    assert main(["pick", *args], echo=out.append) == 0
    assert any(line.startswith("interview: ") for line in out)
    picks = json.loads((run_dir / "picks.json").read_text(encoding="utf-8"))
    assert [p["role"] for p in picks] == ["interview", "audit", "shape"]


def test_a_relative_run_dir_becomes_absolute_so_legs_in_temp_dirs_find_their_prompts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    rig = make_rig(Path("proving-runs/x"), FakeModel(clearing_script()))
    assert rig.run_dir.is_absolute() and rig.prompt_dir.is_absolute()

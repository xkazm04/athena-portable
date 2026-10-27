"""One pair end to end on a scripted model: onboard, approve, rehearse, judge; resume; the cap."""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from typing import Any

import pytest

from athena.adopt.prompts import AUDIT_SYSTEM, INTERVIEW_SYSTEM
from athena.proving.chores_uat.__main__ import main
from athena.proving.chores_uat.cast import case_path, load_case, load_characters, load_pairs
from athena.proving.chores_uat.numbers import TAG, read_library
from athena.proving.chores_uat.rig import Rig
from athena.proving.chores_uat.run import (
    Job,
    dump_path,
    instrument,
    ledger_spent,
    plan_jobs,
    run_pair,
    run_pairs,
)
from athena.proving.runlog import RunLog

from ..adopt_tiers.conftest import FakeWarm, stream_lines
from .conftest import (
    CARD,
    DERIVE,
    LIBRARY,
    STILL_OPEN,
    UAT,
    FakeModel,
    clearing_script,
    judge_answer,
    make_rig,
    persona_answer,
    stub_rehearsal,
)

assert LIBRARY is not None
PLAYBOOKS = {k: v[0] for k, v in read_library(LIBRARY).items()}
CHARACTERS = load_characters(UAT)
PAIRS = load_pairs(UAT / "chores" / "pairs.json")
ROSA = next(p for p in PAIRS if p.id == "lease-end-wear-charges--rosa")
PLAYBOOK = PLAYBOOKS[ROSA.playbook_id]
CASE = load_case(case_path(UAT, ROSA.id), PLAYBOOK)


def _run(tmp_path: Path, script: dict[str, list[Any]], **kw: Any) -> tuple[dict[str, Any], Any]:
    model = FakeModel(script)
    rig = make_rig(tmp_path, model, rehearse=kw.pop("rehearse_door", stub_rehearsal()))
    dump = run_pair(rig, ROSA, CHARACTERS["rosa"], CASE, PLAYBOOK, **kw)
    return dump, model


def test_a_pair_runs_onboard_approve_rehearse_judge(tmp_path: Path) -> None:
    dump, model = _run(tmp_path, clearing_script())
    assert dump["complete"], dump["failure"]
    ob = dump["onboarding"]
    assert ob["ended"] == "clear" and ob["cards"] == 1 and ob["rounds"] == 1
    assert ob["approved"] is True and ob["approve_problem"] == ""
    assert ob["brief_md"].startswith("I'll dispute")
    assert ob["asides"] == [{"round": 1, "aside": "I was not sure what Postwren is."}]
    assert [a["question_id"] for a in ob["answers"]] == ["r1q1", "r1q2"]
    assert "r1q1: Do Torvane's letters" in ob["card_texts"][0]["text"]
    kinds = [e["kind"] for e in ob["events"]]
    assert "adopt.clear" in kinds and "adopt.showcase" in kinds
    # The intro was the case card's first message, read by the first card.
    assert "My letters come to my email" in model.prompts("interview")[0]
    # Athena's legs ran at the production tiers (tiers.json), not a sweep.
    for leg in ob["legs"]:
        if leg["kind"] in ("interview", "audit"):
            assert (leg["model"], leg["effort"]) == ("claude-opus-5-5", "low")
        if leg["kind"] == "persona":
            assert (leg["model"], leg["effort"]) == ("claude-sonnet-5-5", "medium")
    reh = dump["rehearsal"]
    assert reh["status"] == "done" and reh["found_usd"] == 100.0
    assert (reh["cards"], reh["turns"], reh["wall_s"], reh["cost_usd"]) == (3, 4, 61.5, 1.25)
    assert isinstance(reh["recorded_cards"], int)
    judge = dump["judge"]
    assert judge["adopt"] == "maybe" and len(judge["criteria"]) == 5
    # The criterion text is the card's, not the model's; null stays null.
    assert judge["criteria"][0]["text"].startswith("Every question is in words")
    assert [c["pass"] for c in judge["criteria"]] == [False, None, True, False, None]
    assert dump["category"] == "housing" and dump["audience"] == "home"
    ledger = (tmp_path / "ledger.jsonl").read_text("utf-8").splitlines()
    assert dump["ledger_rows"] == len(ledger) > 0
    assert dump["cost_usd"] == pytest.approx(0.001 * len(ledger))


def test_the_dump_carries_the_contract_keys(tmp_path: Path) -> None:
    dump, _ = _run(tmp_path, clearing_script())
    assert {
        "pair",
        "playbook_id",
        "character",
        "complete",
        "failure",
        "onboarding",
        "rehearsal",
        "judge",
        "cost_usd",
        "ledger_rows",
        "wall_ms",
    } <= set(dump)
    assert {
        "ended",
        "cards",
        "rounds",
        "answers",
        "asides",
        "events",
        "brief_md",
        "approved",
        "approve_problem",
    } <= set(dump["onboarding"])
    assert {
        "status",
        "found_usd",
        "found_reason",
        "cards",
        "recorded_cards",
        "turns",
        "wall_s",
        "cost_usd",
        "detail",
    } <= set(dump["rehearsal"])
    assert {
        "criteria",
        "voice",
        "adopt",
        "understood",
        "findings",
        "time_saved_min_est",
        "confidence",
    } <= set(dump["judge"])
    json.dumps(dump)


def test_the_person_is_voiced_fenced_and_never_sees_the_criteria(tmp_path: Path) -> None:
    _, model = _run(tmp_path, clearing_script())
    prompt = model.prompts("persona")[0]
    assert "<<<character:" in prompt and "<<<case:" in prompt and "<<<card:" in prompt
    assert "disposition fee" in prompt  # her voice
    assert "I use Gmail for this, not Postwren." in prompt
    assert "ask me first" in prompt
    assert "what the wear standard in the lease says" in prompt
    assert "Nothing is sent in her name" not in prompt


def test_the_judge_is_blind_to_athenas_prompts_and_sees_the_criteria(tmp_path: Path) -> None:
    _, model = _run(tmp_path, clearing_script())
    prompt = model.prompts("judge")[0]
    assert "Nothing is sent in her name" in prompt  # criteria
    # The page as the desktop renders it since ADR 0133-0136: the hero brief, not the promise.
    assert "NOT SHOWN IN THE APP" not in prompt and "Promise:" not in prompt
    assert TAG in prompt and str(PLAYBOOK["brief"]).strip() in prompt
    assert "In the example case: " in prompt and "Typical value: about $" in prompt
    assert "Time saved: " in prompt and "of your review" in prompt
    assert "Where it fits\nWhere: " in prompt
    assert "ONE CLICK AWAY ON THE PAGE (the estimate's disclosure)" in prompt
    assert "Basis: " in prompt and "Caveat:" in prompt
    assert "invented data shaped like your case" in prompt
    assert "I was not sure what Postwren is." in prompt  # her aside
    assert "turn 1" in prompt and "turn 0" in prompt
    for system in (INTERVIEW_SYSTEM, AUDIT_SYSTEM):
        assert system[:120] not in prompt
    # A fresh conversation: the judge's ledger rows are not the session's.
    rows = [json.loads(r) for r in (tmp_path / "ledger.jsonl").read_text("utf-8").splitlines()]
    judge_rows = [r for r in rows if r["role"] == "adopt.judge"]
    assert judge_rows and all(r["conversation"].endswith("/judge") for r in judge_rows)


def test_an_uncleared_brief_gets_good_enough_then_is_approved(tmp_path: Path) -> None:
    # The audit never clears: eight cards, a brief at the cap, "Good enough", then rev 2.
    script = clearing_script()
    script["interview"] = [CARD]
    script["audit"] = [DERIVE, STILL_OPEN]
    script["persona"] = [persona_answer]
    script["judge"] = [judge_answer(turn=8)]
    dump, model = _run(tmp_path, script)
    ob = dump["onboarding"]
    assert ob["ended"] == "round_cap" and ob["cards"] == 8
    briefs = [e for e in ob["events"] if e["kind"] == "adopt.brief"]
    assert [b["rev"] for b in briefs] == [1, 2]
    assert ob["approved"] is True
    assert dump["complete"], dump["failure"]
    assert len(model.prompts("brief")) == 2


def test_no_rehearse_and_a_failing_rehearsal(tmp_path: Path) -> None:
    dump, _ = _run(tmp_path / "a", clearing_script(), rehearse=False)
    assert dump["rehearsal"]["status"] == "skipped" and dump["complete"]

    def boom(rig: Any, session: Any, rev: int) -> Any:
        raise RuntimeError("the bench fell over")

    dump, _ = _run(tmp_path / "b", clearing_script(), rehearse_door=boom)
    assert dump["rehearsal"]["status"] == "failed"
    assert "the bench fell over" in dump["rehearsal"]["detail"]
    assert dump["complete"]  # a failed rehearsal is a measurement, the pair still judged


def test_a_failed_persona_fails_the_pair_and_skips_the_judge(tmp_path: Path) -> None:
    script = clearing_script()
    script["persona"] = ["not json", "still not json"]
    dump, model = _run(tmp_path, script)
    assert not dump["complete"] and dump["failure"].startswith("persona")
    assert dump["onboarding"]["ended"] == "failed"
    assert dump["judge"] is None and model.prompts("judge") == []


def test_a_judge_citing_a_turn_that_does_not_exist_is_sent_back(tmp_path: Path) -> None:
    script = clearing_script()
    script["judge"] = [judge_answer(turn=7), judge_answer(turn=1)]
    dump, model = _run(tmp_path, script)
    assert dump["complete"]
    assert len(model.prompts("judge")) == 2
    assert "only turns 0..1" in model.prompts("judge")[1]


def test_real_rehearsal_runs_the_showcase_synchronously(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import athena.proving.playbooks.bench as bench

    def fake_bench(playbook: Any, config: Any, **kw: Any) -> dict[str, Any]:
        assert config.approve == "none" and config.model == "claude-sonnet-5-5"
        return {
            "portals": {},
            "transcript": [{"app": "x", "user": "go", "said": "Done.", "cards": [{"action": "a"}]}],
            "score": {"cards": [{"key": "k", "outcome": "correct"}], "value_found_usd": 250.0},
            "cards": [{"action": "a"}],
            "turns": 1,
            "wall_s": 12.0,
            "cost_usd": 0.4,
            "errors": [],
        }

    monkeypatch.setattr(bench, "run_bench", fake_bench)
    dump, model = _run(tmp_path, clearing_script(), rehearse_door=None)
    reh = dump["rehearsal"]
    assert reh["status"] == "done", reh
    # Renames only: the answer key holds and the bench's dollars are claimed.
    assert reh["found_usd"] == 250.0 and reh["found_reason"] is None
    assert (reh["cards"], reh["turns"], reh["wall_s"], reh["cost_usd"]) == (1, 1, 12.0, 0.4)
    # The shape leg ran at the production shape tier.
    argv = model.argvs("shape")[0]
    assert argv[argv.index("--model") + 1] == "claude-haiku-5-5"


# --- many pairs ----------------------------------------------------------------------------------


def _loader(pair: Any) -> tuple[Any, Any, Any]:
    playbook = PLAYBOOKS[pair.playbook_id]
    return CHARACTERS[pair.character], load_case(case_path(UAT, pair.id), playbook), playbook


def test_run_pairs_writes_resumes_and_names_a_bad_pair(tmp_path: Path) -> None:
    model = FakeModel(clearing_script())
    rig = make_rig(tmp_path, model, rehearse=stub_rehearsal())
    jobs, done = plan_jobs(rig.run_dir, PAIRS)
    assert done == 0 and [j.kind for j in jobs] == ["pair"] * 3
    out: list[str] = []
    failed = run_pairs(rig, jobs, _loader, workers=2, echo=out.append)
    # Tom has no case card: a failed pair, named, never a dead pool.
    assert [pid for pid, _ in failed] == ["clinic-denials--tom", "lease-end-wear-charges--tom"] or [
        pid for pid, _ in failed
    ] == ["lease-end-wear-charges--tom", "clinic-denials--tom"]
    assert all(why.startswith("cast:") for _, why in failed)
    assert json.loads(dump_path(rig.run_dir, ROSA.id).read_text("utf-8"))["complete"]
    again, done = plan_jobs(rig.run_dir, PAIRS)
    assert done == 1 and {j.pair.id for j in again} == {
        "lease-end-wear-charges--tom",
        "clinic-denials--tom",
    }
    assert out[-1].startswith("harvest: 1 of 3 done, 2 failed")


def test_a_failed_judge_is_judged_again_on_its_own(tmp_path: Path) -> None:
    script = clearing_script()
    script["judge"] = ["nope", "nope"]
    model = FakeModel(script)
    rig = make_rig(tmp_path, model, rehearse=stub_rehearsal())
    run_pairs(rig, [Job(ROSA, "pair")], _loader, echo=lambda _: None)
    dump = json.loads(dump_path(rig.run_dir, ROSA.id).read_text("utf-8"))
    assert dump["failure"].startswith("judge:") and dump["judge"] is None
    jobs, _ = plan_jobs(rig.run_dir, [ROSA])
    assert [j.kind for j in jobs] == ["judge"]
    model.script["judge"] = [judge_answer()]
    interviews = len(model.prompts("interview"))
    run_pairs(rig, jobs, _loader, echo=lambda _: None)
    dump = json.loads(dump_path(rig.run_dir, ROSA.id).read_text("utf-8"))
    assert dump["complete"] and dump["judge"]["adopt"] == "maybe"
    assert len(model.prompts("interview")) == interviews  # nothing re-onboarded


def test_a_judge_step_that_raises_leaves_the_dump_and_is_judged_again_on_its_own(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A bench bug in the judge step (here: the page's numbers row cannot be built) is the
    judge's failure, written beside the paid onboarding, never a lost dump that re-runs it."""
    from athena.proving.chores_uat import run as run_module

    def broken(*_args: Any, **_kw: Any) -> str:
        raise RuntimeError("the page cannot be built")

    model = FakeModel(clearing_script())
    rig = make_rig(tmp_path, model, rehearse=stub_rehearsal())
    with monkeypatch.context() as m:
        m.setattr(run_module, "judge_prompt", broken)
        failed = run_pairs(rig, [Job(ROSA, "pair")], _loader, echo=lambda _: None)
    assert [pid for pid, _ in failed] == [ROSA.id]
    path = dump_path(rig.run_dir, ROSA.id)
    assert path.is_file()
    dump = json.loads(path.read_text("utf-8"))
    assert dump["failure"] == "judge: RuntimeError: the page cannot be built"
    assert dump["judge"] is None and dump["onboarding"]["approved"]
    jobs, _ = plan_jobs(rig.run_dir, [ROSA])
    assert [j.kind for j in jobs] == ["judge"]
    interviews = len(model.prompts("interview"))
    run_pairs(rig, jobs, _loader, echo=lambda _: None)
    dump = json.loads(path.read_text("utf-8"))
    assert dump["complete"]
    assert len(model.prompts("interview")) == interviews  # nothing re-onboarded


def test_the_cap_stops_scheduling_new_pairs(tmp_path: Path) -> None:
    model = FakeModel(clearing_script())
    rig = make_rig(tmp_path, model, rehearse=stub_rehearsal())
    out: list[str] = []
    jobs = [Job(ROSA, "pair"), Job(PAIRS[1], "pair"), Job(PAIRS[2], "pair")]
    run_pairs(rig, jobs, _loader, workers=1, cap_usd=0.0005, echo=out.append)
    assert any(line.startswith("cap:") and "2 pairs not scheduled" in line for line in out)
    assert dump_path(rig.run_dir, ROSA.id).is_file()
    assert not dump_path(rig.run_dir, PAIRS[1].id).is_file()


# --- legs that come back unpriced (ADR 0122 through runlog.spend) ---------------------------------


def _unpriced(lines: list[str]) -> list[str]:
    """The CLI's stream with the result turned into an error that printed no total."""
    out = []
    for line in lines:
        record = json.loads(line)
        if record.get("type") == "result":
            record.pop("total_cost_usd", None)
            record["is_error"] = True
            record["subtype"] = "error_during_execution"
        out.append(json.dumps(record))
    return out


class _UnpricedWarm(FakeWarm):
    def send(self, line: str) -> None:
        text = json.loads(line)["message"]["content"][0]["text"]
        for out in _unpriced(stream_lines(self.model.answer(self.argv, text))):
            self._lines.put(out)


class _UnpricedTransport:
    def __init__(self, model: FakeModel) -> None:
        self.model = model

    async def run(self, request: Any) -> Any:
        for line in _unpriced(stream_lines(self.model.answer(request.argv, request.stdin))):
            yield line


def _unpriced_rig(run_dir: Path, model: FakeModel) -> Rig:
    return Rig(
        run_dir=run_dir,
        transport=lambda: _UnpricedTransport(model),  # type: ignore[arg-type, return-value]
        spawn_warm=lambda argv, cwd: _UnpricedWarm(model, argv),  # type: ignore[arg-type]
        runlog=RunLog(run_dir / "ledger.jsonl"),
        library=LIBRARY,
        rehearse=stub_rehearsal(),
    )


def test_the_cap_binds_on_legs_that_all_come_back_unpriced(tmp_path: Path) -> None:
    """Before: an unpriced leg cost $0 to the cap, so every pair of a failing run was scheduled."""
    model = FakeModel(clearing_script())
    rig = _unpriced_rig(tmp_path, model)
    out: list[str] = []
    jobs = [Job(ROSA, "pair") for _ in range(4)]
    run_pairs(rig, jobs, _loader, workers=1, cap_usd=1.00, echo=out.append)
    lines = (tmp_path / "ledger.jsonl").read_text("utf-8").splitlines()
    rows = [json.loads(line) for line in lines]
    assert rows and all("cost_usd" not in r for r in rows)
    cap = [line for line in out if line.startswith("cap:")]
    assert cap and "pairs not scheduled" in cap[0]
    # At $0.50 an unpriced leg, the scheduler stops once two are booked.
    assert len(rows) >= 2
    assert "known" in cap[0] and "unpriced" in cap[0]


def test_a_resumed_run_counts_its_unpriced_rows_before_the_first_job(tmp_path: Path) -> None:
    ledger = tmp_path / "ledger.jsonl"
    log = RunLog(ledger)
    for _ in range(3):
        log.record(role="interview", engine="claude", model="m", error_reason="timeout")
    model = FakeModel(clearing_script())
    rig = make_rig(tmp_path, model, rehearse=stub_rehearsal())
    out: list[str] = []
    before = ledger_spent(ledger)
    assert (before.spent_usd, before.unpriced_calls, before.enforced_usd) == (0.0, 3, 1.5)
    run_pairs(rig, [Job(ROSA, "pair")], _loader, cap_usd=1.00, spent_before=before, echo=out.append)
    assert out[0].startswith("cap:") and "1 pairs not scheduled" in out[0]
    assert model.calls == []


def test_a_pair_whose_every_leg_is_unpriced_has_no_cost_and_counts_its_legs(
    tmp_path: Path,
) -> None:
    model = FakeModel(clearing_script())
    dump = run_pair(_unpriced_rig(tmp_path / "a", model), ROSA, CHARACTERS["rosa"], CASE, PLAYBOOK)
    assert dump["ledger_rows"] > 0
    assert "cost_usd" not in dump
    assert dump["unpriced_legs"] == dump["ledger_rows"]
    priced, _ = _run(tmp_path / "b", clearing_script())
    assert priced["unpriced_legs"] == 0
    assert priced["cost_usd"] == pytest.approx(0.001 * priced["ledger_rows"])


def test_main_dry_over_the_fixture_spends_nothing(tmp_path: Path) -> None:
    out: list[str] = []
    code = main(
        ["run", "--dry", "--uat", str(UAT), "--base", str(tmp_path), "--run-id", "t"],
        echo=out.append,
    )
    assert code == 0, out
    text = "\n".join(out)
    assert "pair lease-end-wear-charges--rosa" in text
    assert "pair clinic-denials--tom (no case card yet)" in text
    assert "3 to run" in text and "legs per pair" in text
    # 3 x (0.30 + 1.50 + 0.10) + 2 cases x 0.05
    assert "estimate: $5.80" in text
    assert not (tmp_path / "chores-uat" / "t").exists()


def test_main_dry_prices_a_judge_only_job_as_a_judge(tmp_path: Path) -> None:
    """A dump whose judge failed is planned as a "judge" job: the estimate is the judge's
    median, not a whole pair's onboarding and rehearsal again."""
    run_dir = tmp_path / "chores-uat" / "t" / "pairs"
    run_dir.mkdir(parents=True)
    dump = {"pair": ROSA.id, "complete": False, "failure": "judge: timeout", "onboarding": {}}
    (run_dir / f"{ROSA.id}.json").write_text(json.dumps(dump), "utf-8")
    out: list[str] = []
    code = main(
        ["run", "--dry", "--uat", str(UAT), "--base", str(tmp_path), "--run-id", "t"],
        echo=out.append,
    )
    assert code == 0, out
    text = "\n".join(out)
    assert f"judge {ROSA.id}" in text
    # 1 judge x 0.10 + 2 pairs x (0.30 + 1.50 + 0.10) + 2 cases x 0.05
    assert "3 to run (1 judge only)" in text and "estimate: $4.00" in text


def test_main_reports_a_bad_pairs_file_and_writes_numbers(tmp_path: Path) -> None:
    uat = tmp_path / "uat"
    shutil.copytree(UAT, uat)
    doc = json.loads((uat / "chores" / "pairs.json").read_text("utf-8"))
    doc["pairs"][0]["category"] = "freight"
    (uat / "chores" / "pairs.json").write_text(json.dumps(doc), "utf-8")
    out: list[str] = []
    assert main(["run", "--dry", "--uat", str(uat), "--base", str(tmp_path)], echo=out.append) == 2
    assert "lease-end-wear-charges--rosa" in out[-1] and "freight" in out[-1]
    out.clear()
    extra = tmp_path / "copy.json"
    assert (
        main(
            ["numbers", "--base", str(tmp_path), "--run-id", "n", "--out", str(extra)],
            echo=out.append,
        )
        == 0
    )
    assert (tmp_path / "chores-uat" / "n" / "numbers.json").is_file() and extra.is_file()
    assert json.loads(out[-1])["playbooks"] == 100


def test_instrument_names_every_prompt_and_tier() -> None:
    ident = instrument()
    for key in (
        "persona_system",
        "judge_system",
        "interview_system",
        "audit_system",
        "brief_system",
        "tiers",
    ):
        assert re.fullmatch(r"sha256:[0-9a-f]{16}", ident[key])
    assert ident["judge_tier"] == "claude-sonnet-5-5/medium"


def test_a_resume_with_another_rehearse_setting_is_refused_before_anything_runs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A run whose dumps rehearsed cannot be resumed with --no-rehearse (or back): its pairs would
    be two experiments under one run.json, which the resume then rewrites as one."""
    from athena.proving.chores_uat import __main__ as cli

    ran: list[Any] = []
    monkeypatch.setattr(cli, "claude_available", lambda: True)
    monkeypatch.setattr(cli, "run_pairs", lambda *a, **k: ran.append(a) or [])
    monkeypatch.setattr(cli, "write_report", lambda *_a, **_k: None)
    run_dir = tmp_path / "chores-uat" / "t"
    run_dir.mkdir(parents=True)
    meta = {"instrument": instrument(), "rehearse": True, "wall_s": 600.0}
    (run_dir / "run.json").write_text(json.dumps(meta), "utf-8")
    argv = ["run", "--uat", str(UAT), "--base", str(tmp_path), "--run-id", "t"]
    out: list[str] = []
    assert cli.main([*argv, "--no-rehearse"], echo=out.append) == 2
    assert not ran and "rehearse" in out[-1] and "start a new --run-id" in out[-1]
    assert json.loads((run_dir / "run.json").read_text("utf-8"))["rehearse"] is True
    # The same setting resumes.
    assert cli.main(argv, echo=out.append) == 0 and len(ran) == 1

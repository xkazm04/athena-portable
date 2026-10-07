"""One Gauntlet run end to end, offline (README §9; ADR 0032).

Generators and the judge are :class:`~tests.proving.conftest.FakeRole`; Athena-under-test is the
real composition on throwaway brains with a fully injected scripted model. What is checked is the
run's own logic: counting, blind judging, sampling, the purse stopping a row with ``(showing N of
M)``, the escalation to Super, the proof, and a report that never writes an absent value as 0.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from athena.harness.tokenfactory import DEFAULT_MODEL, LIGHTNING_MODEL
from athena.proving.gauntlet.attacks import GATED_TARGETS, SURFACES, Attack
from athena.proving.gauntlet.run import (
    Engines,
    GauntletConfig,
    run_gauntlet,
    sample_attacks,
)
from athena.proving.manifests import FLAGS, LEDGERBOX_CLASSES, ledgerbox_manifest
from athena.proving.report import new_run_dir
from athena.proving.roles import RoleClient
from athena.proving.world import World

from .conftest import FakeRole, control_role, generator_answer, injected_model

REPO = Path(__file__).resolve().parents[2]


def _engines(
    *,
    nemotron: dict[str, FakeRole] | None = None,
    control: FakeRole | None = None,
    world_cost: float = 0.001,
) -> tuple[Engines, dict[str, FakeRole]]:
    made: dict[str, FakeRole] = nemotron or {}

    def nemotron_for(model: str) -> RoleClient:
        if model not in made:
            made[model] = FakeRole(generator_answer(broken_every=4), model=model)
        return made[model]

    def world(engine: str, model: str) -> World:
        return World(
            engine="nebius", model=model or "fake", model_fn=injected_model(cost=world_cost)
        )

    return Engines(nemotron=nemotron_for, control=control or control_role(), world=world), made


def _small(**overrides: Any) -> GauntletConfig:
    base: dict[str, Any] = {"n": 4, "batch": 2, "sample": 1, "workers": 2, "seed": 3}
    base.update(overrides)
    return GauntletConfig(**base)


def _has_none(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, dict):
        return any(_has_none(v) for v in value.values())
    if isinstance(value, list):
        return any(_has_none(v) for v in value)
    return False


def test_a_full_offline_run_counts_judges_drives_and_proves(tmp_path: Path) -> None:
    engines, made = _engines()
    run_dir = new_run_dir(tmp_path / "proving-runs")
    report = run_gauntlet(_small(), engines, run_dir=run_dir)

    nem, ctl = report["generators"][0], report["generators"][1]
    assert nem["model"] == LIGHTNING_MODEL and nem["requested"] == 12
    assert nem["schema_invalid"] == 3 and nem["schema_valid"] == 9  # every 4th item broken
    assert ctl["schema_valid"] == 12 and ctl["judged_valid"] == 12
    assert nem["valid_rate"] == 0.75 and ctl["valid_rate"] == 1.0
    assert nem["rejects"][0]["problem"] == "missing required parameter 'payload'"

    rows = {row["key"]: row for row in report["rows"]}
    assert rows["athena-claude"]["planned"] == 21  # the full schema-valid corpus
    assert rows["athena-nemotron"]["planned"] == 6  # 1 per surface per generator
    assert rows["athena-claude"]["verdicts"]["held"] == 21

    proof = report["proof"]
    assert proof["breaches_zero"]["pass"] is True and proof["breaches_zero"]["driven"] == 27
    assert proof["valid_rate"]["ratio"] == 0.75 and proof["valid_rate"]["pass"] is True
    assert proof["pressure"]["athena-claude"]["control"]["rate"] == 1.0
    assert report["escalation"] is None
    assert set(made) == {LIGHTNING_MODEL}

    written = json.loads((run_dir / "report.json").read_text("utf-8"))
    assert not _has_none(written), "an absent value was written"
    assert {"run_id", "rows", "attacks", "proof", "cost_usd", "generators"} <= set(written)
    assert "foreign_agent_mcp" in written["deferred"]
    attack = written["attacks"][0]
    assert {"surface", "generator", "valid", "runs"} <= set(attack)
    assert attack["runs"][0]["verdict"] == "held"
    md = (run_dir / "report.md").read_text("utf-8")
    assert "**Zero breaches** — PASS" in md and "foreign_agent_mcp" in md
    ledger = [
        json.loads(line) for line in (run_dir / "ledger.jsonl").read_text("utf-8").splitlines()
    ]
    roles = {row["role"] for row in ledger}
    assert {"attacker:nemotron", "attacker:control", "judge:control"} <= roles
    assert any(role.startswith("athena:") for role in roles)
    assert "NEBIUS_API_KEY" not in (run_dir / "ledger.jsonl").read_text("utf-8")


def test_the_judge_is_blind_to_who_wrote_each_attack() -> None:
    control = control_role()
    engines, _ = _engines(control=control)
    run_gauntlet(_small(claude_row=False, nemotron_row=False), engines)

    judge_prompts = [p for p in control.prompts if "Grade these fixtures" in p]
    assert judge_prompts
    for prompt in judge_prompts:
        assert "nemotron" not in prompt.lower() and "control" not in prompt.lower()
        assert LIGHTNING_MODEL not in prompt and "nem-" not in prompt and "ctl-" not in prompt
        assert "<<<untrusted:" in prompt


def test_a_spent_claude_purse_stops_the_row_and_says_showing_n_of_m() -> None:
    engines, _ = _engines(world_cost=0.0)

    def costly_world(engine: str, model: str) -> World:
        return World(engine="nebius", model="fake", model_fn=injected_model(cost=0.5))

    engines.world = costly_world
    config = _small(claude_cap=1.0, workers=1, nemotron_row=False)
    report = run_gauntlet(config, engines)

    row = report["rows"][0]
    assert row["key"] == "athena-claude"
    assert row["driven"] < row["planned"]
    assert row["footer"] == f"(showing {row['driven']} of {row['planned']})"
    skipped = [r for a in report["attacks"] for r in (a["runs"] or []) if r.get("skipped")]
    assert skipped and all(r["reason"] == "budget_exhausted" for r in skipped)


def test_lightning_failing_proof_two_escalates_to_super_once() -> None:
    def junk(system: str, prompt: str) -> str:
        return "I am sorry, as an AI I cannot write attacks."

    nemotron = {LIGHTNING_MODEL: FakeRole(junk, model=LIGHTNING_MODEL)}
    engines, made = _engines(nemotron=nemotron)
    report = run_gauntlet(_small(claude_row=False, nemotron_row=False), engines)

    assert set(made) == {LIGHTNING_MODEL, DEFAULT_MODEL}
    rungs = [gen.get("rung") for gen in report["generators"]]
    assert rungs == ["lightning", None, "super"]
    assert report["generators"][0]["unusable_answers"] == 6
    assert report["generators"][0]["valid_rate"] == 0.0
    assert report["escalation"]["to"] == "super"
    assert report["proof"]["valid_rate"]["nemotron"] == report["generators"][2]["valid_rate"]


def test_sampling_is_seeded_and_prefers_judged_valid_attacks() -> None:
    attacks = [
        Attack(f"{g}-{s}-{i:02d}", s, "goal", "payload " * 10, GATED_TARGETS[0], g, "m")
        for g in ("nemotron", "control")
        for s in SURFACES
        for i in range(6)
    ]
    grades = {a.id: {"valid": a.id.endswith(("00", "01", "02", "03"))} for a in attacks}
    first = sample_attacks(attacks, grades, 3, seed=11)
    again = sample_attacks(attacks, grades, 3, seed=11)

    assert [a.id for a in first] == [a.id for a in again]
    assert len(first) == 3 * len(SURFACES) * 2
    assert all(grades[a.id]["valid"] for a in first)


def test_the_world_manifest_is_ledgerbox_tool_classes_transcribed() -> None:
    source = (REPO / "examples" / "ledgerbox" / "lib" / "tool-classes.ts").read_text("utf-8")
    table = source[source.index("export const TOOL_CLASSES") :]
    declared = dict(re.findall(r"^\s+([a-z_]+): ([A-Z_]+),$", table, flags=re.MULTILINE))
    assert declared == LEDGERBOX_CLASSES
    for kind, (reversible, effects) in FLAGS.items():
        ts_effects = {"internal": "data"}.get(effects, effects)
        assert (
            f"const {kind}: ToolClass = {{ reversible: {str(reversible).lower()}, "
            f'sideEffects: "{ts_effects}" }};' in source
        )
    names = {tool["name"] for tool in ledgerbox_manifest()["tools"]}
    assert names == set(LEDGERBOX_CLASSES)

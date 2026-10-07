"""Hosted mode, offline: the Gauntlet without the control, the CLI's choice, seeding (ADR 0039).

The hosted container has no ``claude`` CLI. What is checked: a no-control Gauntlet never invokes
the control (a real :class:`~athena.proving.roles.ClaudeRole` whose process runner fails the test
if called), reports proof 2 as ``n/a`` with its reason and every judged field absent, and still
reads proof 1, pressure and the approve path off the gate; the CLI turns the control and the
Claude row off when no Claude is available and refuses Characters; recorded runs are seeded into
a runs directory without overwriting, without unfinished runs and never with a secret in them.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import pytest

from athena.harness.tokenfactory import LIGHTNING_MODEL
from athena.proving import __main__ as cli
from athena.proving.gauntlet.run import (
    HOSTED,
    NO_CONTROL_REASON,
    Engines,
    GauntletConfig,
    run_gauntlet,
)
from athena.proving.report import new_run_dir
from athena.proving.roles import (
    HAIKU_MODEL,
    HOSTED_ENV,
    ClaudeRole,
    ProcessResult,
    RoleClient,
    claude_available,
    hosted_flag,
)
from athena.proving.server.seed import seed_runs
from athena.proving.world import World

from .conftest import FakeRole, generator_answer, injected_model


class ForbiddenClaude:
    """The ``claude`` process seam, armed: any call is a test failure, and is recorded."""

    def __init__(self) -> None:
        self.calls: list[Sequence[str]] = []

    def __call__(
        self, argv: Sequence[str], stdin: str, timeout: float, cwd: str | None
    ) -> ProcessResult:
        self.calls.append(argv)
        raise AssertionError("a no-control run invoked claude")


def _hosted_run(tmp_path: Path) -> tuple[dict[str, Any], Path, ForbiddenClaude, FakeRole]:
    forbidden = ForbiddenClaude()
    nemotron = FakeRole(generator_answer(broken_every=4), model=LIGHTNING_MODEL)

    def nemotron_for(model: str) -> RoleClient:
        assert model == LIGHTNING_MODEL, "no escalation without a control"
        return nemotron

    def world(engine: str, model: str) -> World:
        return World(engine="nebius", model=model, model_fn=injected_model())

    engines = Engines(
        nemotron=nemotron_for, control=ClaudeRole(model=HAIKU_MODEL, run=forbidden), world=world
    )
    config = GauntletConfig(
        n=4, batch=2, sample=1, workers=2, seed=3, control=False, claude_row=False
    )
    run_dir = new_run_dir(tmp_path / "proving-runs")
    report = run_gauntlet(config, engines, run_dir=run_dir)
    return report, run_dir, forbidden, nemotron


def test_a_no_control_gauntlet_never_calls_claude(tmp_path: Path) -> None:
    report, run_dir, forbidden, nemotron = _hosted_run(tmp_path)
    assert forbidden.calls == []
    assert nemotron.prompts and all("Grade these fixtures" not in p for p in nemotron.prompts)
    rows = [json.loads(line) for line in (run_dir / "ledger.jsonl").read_text().splitlines()]
    roles = {row["role"] for row in rows}
    assert "attacker:control" not in roles and "judge:control" not in roles
    assert all(row["engine"] not in ("claude", "claude_code") for row in rows)
    assert report["cost_usd"]["claude"] == 0.0
    assert report["mode"] == HOSTED
    assert report["roles"] == ["attacker:nemotron", "athena:athena-nemotron", "approve-probe"]
    assert [g["generator"] for g in report["generators"]] == ["nemotron"]
    assert report["escalation"] is None and report["judge"] is None


def test_hosted_proof_2_is_na_with_its_reason_and_nothing_judged_reads_as_zero(
    tmp_path: Path,
) -> None:
    report, run_dir, _, _ = _hosted_run(tmp_path)
    valid = report["proof"]["valid_rate"]
    assert valid["na"] == NO_CONTROL_REASON and NO_CONTROL_REASON.startswith(
        "n/a — hosted, no control"
    )
    assert valid["pass"] is None and valid["ratio"] is None
    written = json.loads((run_dir / "report.json").read_text(encoding="utf-8"))
    nem = written["generators"][0]
    for absent in ("judged_valid", "judged_invalid", "judge_missing", "valid_rate"):
        assert absent not in nem, absent  # nobody judged: absent, never 0
    assert nem["schema_valid"] == 9 and nem["schema_invalid"] == 3
    assert "pass" not in written["proof"]["valid_rate"]
    assert all("valid" not in attack for attack in written["attacks"])
    md = (run_dir / "report.md").read_text(encoding="utf-8")
    assert "Mode: `hosted`" in md and "n/a — hosted, no control" in md
    assert any("Hosted mode (ADR 0039)" in note for note in written["notes"])


def test_hosted_proof_1_pressure_and_the_approve_path_still_come_from_the_gate(
    tmp_path: Path,
) -> None:
    report, _, _, _ = _hosted_run(tmp_path)
    proof = report["proof"]
    breaches = proof["breaches_zero"]
    assert breaches["driven"] == 3 and breaches["breached"] == 0 and breaches["pass"] is True
    cell = proof["pressure"]["athena-nemotron"]["nemotron"]
    assert cell["driven"] == 3 and cell["pressure"] == 3  # the fully injected model reached
    assert "athena-nemotron" in proof["approve_path"]
    assert [row["key"] for row in report["rows"]] == ["athena-nemotron"]


# --- the CLI ---------------------------------------------------------------------------------


def test_without_claude_the_cli_turns_the_control_and_the_claude_row_off() -> None:
    args = cli.build_parser().parse_args(["gauntlet"])
    full = cli.gauntlet_config(args, claude_ok=True)
    assert full.control and full.claude_row and full.mode == "full"
    hosted = cli.gauntlet_config(args, claude_ok=False)
    assert not hosted.control and not hosted.claude_row and hosted.mode == HOSTED
    explicit = cli.gauntlet_config(
        cli.build_parser().parse_args(["gauntlet", "--no-control"]), claude_ok=True
    )
    assert not explicit.control and explicit.claude_row


def test_claude_is_available_only_with_a_cli_and_no_hosted_flag() -> None:
    present, absent = (lambda name: "/bin/claude"), (lambda name: None)
    assert claude_available({}, which=present) is True
    assert claude_available({}, which=absent) is False
    assert claude_available({HOSTED_ENV: "1"}, which=present) is False
    assert hosted_flag({HOSTED_ENV: "true"}) and not hosted_flag({HOSTED_ENV: "0"})


def test_hosted_characters_refuses_before_any_run(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("NEBIUS_API_KEY", "nb-test-key-0123456789")
    monkeypatch.setenv(HOSTED_ENV, "1")
    out = tmp_path / "runs"
    code = cli.main(["characters", "--out", str(out), "--env-file", str(tmp_path / "none")])
    assert code == 2
    assert "Haiku judges" in capsys.readouterr().err
    assert not out.exists()


# --- seeding ---------------------------------------------------------------------------------


def _recorded(root: Path, run_id: str, text: str = "{}", *, finished: bool = True) -> Path:
    run = root / run_id
    run.mkdir(parents=True)
    if finished:
        (run / "report.json").write_text(text, encoding="utf-8")
        (run / "report.md").write_text("# run", encoding="utf-8")
    (run / "ledger.jsonl").write_text('{"role": "judge:control"}\n', encoding="utf-8")
    (run / "breaches" / "x" / "world").mkdir(parents=True)
    (run / "breaches" / "x" / "world" / "brain.db").write_text("db", encoding="utf-8")
    return run


def test_seeding_copies_what_the_page_reads_and_never_overwrites(tmp_path: Path) -> None:
    src, dest = tmp_path / "recorded", tmp_path / "volume"
    _recorded(src, "20261006T090000Z", '{"prototype": "characters"}')
    _recorded(src, "20261006T100000Z", finished=False)
    _recorded(src, "20261006T110000Z", '{"prototype": "gauntlet", "mode": "full"}')
    (src / "not-a-run").mkdir()
    (dest / "20261006T110000Z").mkdir(parents=True)
    (dest / "20261006T110000Z" / "report.json").write_text('{"host": "own"}', encoding="utf-8")

    result = seed_runs(src, dest, environ={})
    assert result.seeded == ["20261006T090000Z"]
    assert result.skipped == {
        "20261006T100000Z": "no report.json (unfinished)",
        "20261006T110000Z": "already there",
    }
    seeded = dest / "20261006T090000Z"
    assert sorted(p.name for p in seeded.iterdir()) == ["ledger.jsonl", "report.json", "report.md"]
    assert json.loads((dest / "20261006T110000Z" / "report.json").read_text()) == {"host": "own"}
    assert not any(p.name.startswith(".seed-") for p in dest.iterdir())
    again = seed_runs(src, dest, environ={})
    assert again.seeded == []  # a restart that seeds again changes nothing


def test_seeding_refuses_a_run_that_holds_a_secret(tmp_path: Path) -> None:
    key = "nb-live-key-abcdef0123456789"
    src, dest = tmp_path / "recorded", tmp_path / "volume"
    _recorded(src, "20261006T090000Z", json.dumps({"notes": [f"key {key}"]}))
    _recorded(src, "20261006T100000Z", '{"prototype": "gauntlet"}', finished=True)
    result = seed_runs(src, dest, ["20261006T090000Z"], environ={"NEBIUS_API_KEY": key})
    assert result.seeded == [] and "report.json" in result.refused["20261006T090000Z"]
    assert not (dest / "20261006T090000Z").exists()
    assert not (dest / "20261006T100000Z").exists()  # not named, not copied

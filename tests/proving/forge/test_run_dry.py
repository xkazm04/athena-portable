"""A fixture-driven dry run of the whole forge: plumbing, resume, caps, report conventions."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import pytest

from athena.proving.forge.__main__ import main
from athena.proving.forge.report import PROOF_RATIO


def digest(library: Path) -> str:
    h = hashlib.sha256()
    for path in sorted(library.rglob("*.json")):
        h.update(path.read_bytes())
    return h.hexdigest()


def runs(out: Path) -> list[Path]:
    return sorted(p for p in out.iterdir() if p.is_dir())


def has_none(value: Any) -> bool:
    if isinstance(value, dict):
        return any(v is None or has_none(v) for v in value.values())
    if isinstance(value, list):
        return any(has_none(v) for v in value)
    return False


@pytest.fixture(scope="module")
def dry_run(library: Path, tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, str]:
    out = tmp_path_factory.mktemp("forge-runs")
    before = digest(library)
    assert main(["all", "--dry", "--n", "2", "--out", str(out), "--library", str(library)]) == 0
    assert digest(library) == before  # nothing under playbooks/ is written
    return runs(out)[0], before


def test_the_dry_run_writes_the_report_and_the_proof_lines(dry_run: tuple[Path, str]) -> None:
    run, _ = dry_run
    report = json.loads((run / "forge" / "report.json").read_text(encoding="utf-8"))
    assert (run / "forge" / "report.md").read_text(encoding="utf-8").startswith("# World forge")
    assert report["dry"] is True and report["n_per_playbook"] == 2
    assert [p["id"] for p in report["proof"]] == ["proof-1", "proof-2"]
    assert {p["status"] for p in report["proof"]} <= {"PASS", "FAIL", "n-a"}
    nem, hai = report["generators"]["nemotron"], report["generators"]["haiku_control"]
    assert nem["n"] == 16 and hai["n"] == 16  # 8 playbooks x 2, every rate carries its n
    assert report["valid_rate_ratio_nemotron_over_haiku"] == round(
        nem["valid_rate"] / hai["valid_rate"], 3
    )
    assert report["proof"][0]["status"] == (
        "PASS" if nem["valid_rate"] / hai["valid_rate"] >= PROOF_RATIO else "FAIL"
    )
    assert report["bench"]["benched"] == nem["valid"]
    assert set(report["cost_usd"]) == {"nemotron", "claude"}
    assert report["models"]["claude_control"] == "claude-haiku-5-5"


def test_absent_values_are_omitted_never_zero(dry_run: tuple[Path, str]) -> None:
    run, _ = dry_run
    report = json.loads((run / "forge" / "report.json").read_text(encoding="utf-8"))
    assert not has_none(report)
    for variant in (v for pb in report["playbooks"] for v in pb["variants"]):
        if not variant["valid"]:
            assert "verdict" not in variant and "recall_value" not in variant


def test_a_resumed_stage_skips_what_exists(
    dry_run: tuple[Path, str], library: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    run, _ = dry_run
    capsys.readouterr()
    args = ["--dry", "--n", "2", "--run-dir", str(run), "--library", str(library)]
    assert main(["bench", *args]) == 0
    assert "0 run," in capsys.readouterr().out
    assert main(["audit", *args]) == 0
    assert "0 variants audited" in capsys.readouterr().out


def test_a_spent_claude_cap_stops_the_bench_cleanly(
    library: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    args = ["--dry", "--n", "1", "--out", str(tmp_path), "--library", str(library)]
    assert main(["pick", *args]) == 0
    assert main(["forge", *args, "--run-dir", str(runs(tmp_path)[0])]) == 0
    capsys.readouterr()
    # The reserve eats the whole purse: no run may start, and the stage says how much it shows.
    assert main(["bench", *args, "--claude-cap", "1", "--run-dir", str(runs(tmp_path)[0])]) == 0
    out = capsys.readouterr().out
    assert "stopped:" in out and "(showing 0 of" in out


def test_no_control_means_no_audit_and_no_ratio(library: Path, tmp_path: Path) -> None:
    code = main(
        [
            "all",
            "--dry",
            "--n",
            "1",
            "--no-control",
            "--out",
            str(tmp_path),
            "--library",
            str(library),
        ]
    )
    assert code == 0
    report = json.loads((runs(tmp_path)[0] / "forge" / "report.json").read_text(encoding="utf-8"))
    assert "valid_rate_ratio_nemotron_over_haiku" not in report
    assert report["proof"][0]["status"] == "n-a"
    assert report["proof"][1]["status"] == "n-a"


def test_a_live_run_without_the_key_is_refused(
    library: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("NEBIUS_API_KEY", raising=False)
    code = main(
        [
            "forge",
            "--no-control",
            "--out",
            str(tmp_path),
            "--env",
            str(tmp_path / "none.env"),
            "--library",
            str(library),
        ]
    )
    assert code == 2

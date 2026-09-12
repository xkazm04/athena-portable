"""``athena``: the three verbs, and what the doctor's exit code means (README §3.5, §7).

The interesting claim is the doctor's, and it is about a *split*: the ordered stages are a
diagnosis for a person, and the exit code is a claim for a script. Only a ``fail`` sets the code,
so a missing CLI engine or a port already in use is said out loud and still exits zero — and the
first non-OK stage is named as the cause either way.

``athena --help`` is exercised through the installed console script, not through ``main`` alone:
the entry point is a line in ``pyproject.toml`` and a line nothing runs is a line that rots.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

from athena.cli import DOCTOR_STAGES, STATUSES, Stage, build_parser, doctor_report, main
from athena.core.brain.store import Brain
from athena.harness.engines import EngineStatus


def _run(capsys: pytest.CaptureFixture[str], *argv: str) -> tuple[int, dict[str, Any]]:
    """One command, its exit code and the one JSON object it printed."""
    code = main(list(argv))
    out = capsys.readouterr().out
    return code, json.loads(out)


# -- doctor ------------------------------------------------------------------------------------


def test_doctor_reports_the_ordered_stages(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code, report = _run(capsys, "doctor", "--brain", str(tmp_path / "brain"))

    assert [stage["name"] for stage in report["stages"]] == list(DOCTOR_STAGES)
    assert all(stage["status"] in STATUSES for stage in report["stages"])
    by_name = {stage["name"]: stage for stage in report["stages"]}
    assert by_name["python"]["status"] == "ok"
    assert by_name["brain"]["status"] == "ok"
    assert by_name["index"]["status"] == "ok"
    assert by_name["constitution"]["status"] == "ok"
    assert str(tmp_path / "brain") in by_name["brain"]["detail"]
    # No stage failed, so the code is zero whatever the engine and the port had to say.
    assert code == 0
    assert report["ok"] is True


def test_a_warn_is_the_cause_and_still_exits_zero(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """An index row whose markdown is gone: a real problem, a real sentence, and a fix that is
    one command away — so it is named as the cause and the installation is not called broken."""
    root = tmp_path / "brain"
    with Brain(root) as brain:
        episode = brain.append_episode("the first thing said", role="user")
        node = brain.node(episode.id)
        assert node is not None
    (root / node.file_path).unlink()

    code, report = _run(capsys, "doctor", "--brain", str(root))

    assert code == 0
    assert report["ok"] is True
    assert report["cause"] == "index"
    index = next(stage for stage in report["stages"] if stage["name"] == "index")
    assert index["status"] == "warn"
    assert "athena brain reconcile" in index["detail"]


def test_a_missing_law_is_a_fail_and_sets_the_exit_code(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """A turn with no law is a turn that should not have started (ADR 0006)."""
    empty = tmp_path / "nowhere"
    empty.mkdir()
    monkeypatch.setenv("ATHENA_CONSTITUTION", str(empty))

    code, report = _run(capsys, "doctor", "--brain", str(tmp_path / "brain"))

    assert code == 1
    assert report["ok"] is False
    assert report["cause"] == "constitution"
    law = next(stage for stage in report["stages"] if stage["name"] == "constitution")
    assert law["status"] == "fail"
    assert law["ok"] is False


def test_a_brain_that_will_not_open_fails_and_the_index_stage_is_skipped(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    occupied = tmp_path / "not-a-directory"
    occupied.write_text("in the way", encoding="utf-8")

    code, report = _run(capsys, "doctor", "--brain", str(occupied))

    assert code == 1
    assert report["cause"] == "brain"
    by_name = {stage["name"]: stage for stage in report["stages"]}
    assert by_name["brain"]["status"] == "fail"
    assert by_name["index"]["status"] == "skip"
    # Every later stage still ran: a person fixing an install wants the whole picture.
    assert [stage["name"] for stage in report["stages"]] == list(DOCTOR_STAGES)


def test_an_engine_this_machine_cannot_run_is_a_warning_and_not_a_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """The brain, the gate and every read route work without an engine; only a turn does not."""
    monkeypatch.setattr(
        "athena.harness.engines.probe",
        lambda name, **kwargs: EngineStatus(name, False, f"{name} is not on PATH"),
    )

    code, report = _run(capsys, "doctor", "--brain", str(tmp_path / "brain"))

    assert code == 0
    engine = next(stage for stage in report["stages"] if stage["name"] == "engine")
    assert engine["status"] == "warn"
    assert "not on PATH" in engine["detail"]


def test_the_cause_is_the_first_non_ok_stage_whatever_its_status() -> None:
    stages = [
        Stage("python", "ok", ""),
        Stage("brain", "warn", "the first one that is not ok"),
        Stage("index", "fail", "and a worse one after it"),
    ]

    report = doctor_report(stages)

    assert report["cause"] == "brain"
    assert report["ok"] is False


def test_a_status_outside_the_closed_set_is_a_programming_error() -> None:
    with pytest.raises(ValueError, match="status"):
        Stage("python", "broken", "")


# -- brain reconcile ---------------------------------------------------------------------------


def test_reconcile_rebuilds_the_index_from_the_tree(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """A brain is portable by copying the directory: copy it, drop the index, run this."""
    root = tmp_path / "brain"
    with Brain(root) as brain:
        episode = brain.append_episode("Northwind paid 40 days late", role="user")
        brain.write_fact("client/northwind", "pays late", scope="world", sources=[episode.id])
    (root / "index.sqlite").unlink()

    code, report = _run(capsys, "brain", "reconcile", "--brain", str(root))

    assert code == 0
    assert report["ok"] is True
    assert report["files"] == 2
    assert report["by_kind"] == {"episode": 1, "fact": 1}
    assert report["skipped"] == []
    assert report["missing"] == []
    with Brain(root) as rebuilt:
        assert rebuilt.counts() == {"episode": 1, "fact": 1}
        # The provenance came back with it: the fact still cites the episode it was drawn from.
        assert rebuilt.sources_of(_only_fact(rebuilt)) == [episode.id]


def _only_fact(brain: Brain) -> str:
    with brain.read_connection() as con:
        row = con.execute("SELECT id FROM companion_node WHERE kind = 'fact'").fetchone()
    assert row is not None
    return str(row[0])


# -- the parser and the console script ---------------------------------------------------------


def test_the_parser_lists_every_verb() -> None:
    usage = build_parser().format_usage()

    assert "serve" in usage
    assert "doctor" in usage
    assert "brain" in usage


def test_a_bare_athena_prints_help_and_exits_zero(capsys: pytest.CaptureFixture[str]) -> None:
    code = main([])

    assert code == 0
    assert "athena" in capsys.readouterr().out


def test_brain_with_no_verb_prints_the_brain_help(capsys: pytest.CaptureFixture[str]) -> None:
    """The help of the level the caller reached, not the top one, which would hide `reconcile`."""
    code = main(["brain"])

    assert code == 0
    assert "reconcile" in capsys.readouterr().out


def test_serve_hands_its_flags_to_the_daemons_own_parser() -> None:
    """``athena serve --help`` is the daemon's help, under the daemon's own prog name."""
    with pytest.raises(SystemExit) as exit_info:
        main(["serve", "--help"])

    assert exit_info.value.code == 0


def test_athena_help_works_through_the_console_script() -> None:
    """The entry point is a line in pyproject.toml, and a line nothing runs is a line that rots."""
    script = _console_script()
    assert script is not None, "the athena console script was not installed; run `uv sync`"

    done = subprocess.run(
        [str(script), "--help"], capture_output=True, text=True, timeout=120, check=False
    )

    assert done.returncode == 0, done.stderr
    assert "doctor" in done.stdout
    assert "serve" in done.stdout


def _console_script() -> Path | None:
    directory = Path(sys.executable).parent
    for name in ("athena.exe", "athena"):
        candidate = directory / name
        if candidate.exists():
            return candidate
    return None

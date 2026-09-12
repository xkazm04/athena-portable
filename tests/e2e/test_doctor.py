"""``athena doctor`` is a contract, not a message (README §7; ``src/athena/cli.py``).

One JSON object on stdout and nothing else, so a shell, a test and the desktop's Setup module all
read the same answer. The shape is asserted here and the machine's answers are not: this suite
runs on whatever laptop it runs on, and a doctor whose *shape* depends on what is installed is
not a contract.

The one verdict that is asserted is the split the command is designed around: **only ``fail`` sets
the exit code**. A missing CLI engine and a busy port are worth saying out loud and neither means
the installation is broken, so the second test hides the engine — an empty ``PATH`` — and the
command must still exit 0 and still name the engine as the cause.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from athena.cli import DOCTOR_STAGES, STATUSES

from .conftest import Spawn, athena_console_script


def _doctor(spawn: Spawn, **env_overrides: str) -> tuple[int, dict]:
    """``athena doctor`` in its own ``ATHENA_HOME``, and the one object it printed."""
    home = spawn.home()
    env = spawn.environ(home)
    env.update(env_overrides)
    done = subprocess.run(
        [str(athena_console_script()), "doctor"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=str(spawn.tmp_path),
        env=env,
        timeout=180,
        check=False,
    )
    assert done.stdout.strip(), f"nothing on stdout; stderr: {done.stderr[-2000:]!r}"
    payload = json.loads(done.stdout)
    assert isinstance(payload, dict)
    return done.returncode, payload


def _assert_shape(report: dict) -> None:
    assert set(report) == {"ok", "stages", "cause"}
    assert isinstance(report["ok"], bool)
    assert [stage["name"] for stage in report["stages"]] == list(DOCTOR_STAGES)
    for stage in report["stages"]:
        assert set(stage) == {"name", "status", "ok", "detail"}, stage
        assert stage["status"] in STATUSES, stage
        assert stage["ok"] is (stage["status"] != "fail"), stage
        assert isinstance(stage["detail"], str) and stage["detail"], stage
    assert report["ok"] is all(stage["ok"] for stage in report["stages"])
    first_bad = next((s["name"] for s in report["stages"] if s["status"] != "ok"), None)
    assert report["cause"] == first_bad


def test_athena_doctor_exits_zero_and_prints_the_documented_stages(spawn: Spawn) -> None:
    code, report = _doctor(spawn)

    _assert_shape(report)
    assert code == 0
    assert report["ok"] is True
    # It is a real write and not a ``stat``: the brain it was pointed at now exists.
    brains = list(spawn.tmp_path.glob("home*/brain"))
    assert brains and all(Path(brain).is_dir() for brain in brains)


def test_athena_doctor_still_exits_zero_on_a_machine_with_no_engine_installed(
    spawn: Spawn,
) -> None:
    """A doctor that exited non-zero because a CLI is missing would be a doctor whose exit code
    means "something is not perfect", which is a thing nobody can act on."""
    code, report = _doctor(spawn, PATH="")

    _assert_shape(report)
    assert code == 0
    engine = next(stage for stage in report["stages"] if stage["name"] == "engine")
    assert engine["status"] == "warn"
    assert engine["ok"] is True
    assert "not on PATH" in engine["detail"]
    assert report["cause"] == "engine", "the first non-OK stage is named as the cause"
    assert report["ok"] is True

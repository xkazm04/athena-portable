"""One live Nemotron attacker call, and what keeps it out of every other run (README §9; ADR 0030).

A ``provider`` test runs only when the run's ``-m`` names ``provider``
(``uv run pytest -m provider -k live``) and ``NEBIUS_API_KEY`` is set. A key in the environment
is never enough: the ini registers the marker and CI runs bare ``uv run pytest``, so the refusal
lives in ``conftest.py``'s ``pytest_runtest_setup`` and is tested here by running pytest itself
over a two-test tree. The live test asks Lightning — the first rung of the ladder — for one
attack and checks only what the run depends on: the call is ledgered with a cost, and the answer
is either a usable attack or a *counted* schema failure.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

from athena.harness.tokenfactory import LIGHTNING_MODEL
from athena.proving.budget import Budget
from athena.proving.gauntlet.attacks import BATCH_SCHEMA, generator_prompt, generator_system
from athena.proving.roles import NebiusRole, RoleCaller
from athena.proving.runlog import RunLog

CONFTEST = Path(__file__).with_name("conftest.py")


@pytest.mark.provider
@pytest.mark.skipif(not os.environ.get("NEBIUS_API_KEY"), reason="NEBIUS_API_KEY is not set")
def test_live_lightning_writes_one_attack_or_is_counted() -> None:
    log = RunLog()
    caller = RoleCaller(Budget(), log)
    answer = caller.call_json(
        NebiusRole(model=LIGHTNING_MODEL),
        "attacker:nemotron",
        generator_system(),
        generator_prompt("page_state", 1),
        BATCH_SCHEMA,
    )

    assert answer.reply.ok, answer.reply.detail
    assert answer.reply.cost_usd is not None and answer.reply.cost_usd > 0
    assert len(log.rows) == 1 and "schema_ok" in log.rows[0]
    counted = sum(sum(bucket.values()) for bucket in caller.validity.counts.values())
    assert counted == 1


# --- what keeps a provider test out of a run that did not ask for it ----------------------------

_INNER_CONFTEST = """\
import importlib.util
import sys

_spec = importlib.util.spec_from_file_location("proving_conftest", {path!r})
_module = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = _module
_spec.loader.exec_module(_module)
globals().update({{k: v for k, v in vars(_module).items() if k.startswith("pytest_")}})
"""

_INNER_TESTS = """\
import pytest


@pytest.mark.provider
def test_spends():
    pass


@pytest.mark.eval
def test_grades():
    pass


def test_offline():
    pass
"""


def _inner_pytest(tmp_path: Path, *args: str) -> str:
    """Run pytest over a three-test tree that uses this directory's conftest, with a key set."""
    (tmp_path / "pytest.ini").write_text(
        "[pytest]\naddopts = -p no:cacheprovider --strict-markers\n"
        "markers =\n    provider: live\n    eval: opt-in\n",
        encoding="utf-8",
    )
    (tmp_path / "conftest.py").write_text(
        _INNER_CONFTEST.format(path=str(CONFTEST)), encoding="utf-8"
    )
    (tmp_path / "test_inner.py").write_text(_INNER_TESTS, encoding="utf-8")
    env = {**os.environ, "NEBIUS_API_KEY": "nb-not-a-real-key"}
    done = subprocess.run(
        [sys.executable, "-m", "pytest", "-rs", *args, str(tmp_path)],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    return done.stdout + done.stderr


def test_a_bare_run_with_a_key_set_skips_every_provider_and_eval_test(tmp_path: Path) -> None:
    out = _inner_pytest(tmp_path)
    assert "1 passed, 2 skipped" in out, out
    assert "runs only when selected with -m provider" in out, out


def test_a_run_whose_marker_expression_names_provider_runs_it(tmp_path: Path) -> None:
    out = _inner_pytest(tmp_path, "-m", "provider")
    assert "1 passed, 2 deselected" in out, out

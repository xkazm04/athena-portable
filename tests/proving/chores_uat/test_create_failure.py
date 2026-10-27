"""A session the store refuses is that job's failure: a record that names it and no leaked root."""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any

import pytest

from athena.adopt.session import SessionStore
from athena.proving.adopt_tiers import simulate
from athena.proving.adopt_tiers.scenarios import SCENARIOS_DIR, load_scenario

from ..adopt_tiers.conftest import FakeModel as TierModel
from ..adopt_tiers.conftest import make_rig as tier_rig
from .test_run import _run

LEASE = load_scenario(SCENARIOS_DIR / "easy-lease-end.json")


def _refuse(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    scratch = tmp_path / "scratch"
    scratch.mkdir()
    monkeypatch.setattr(tempfile, "tempdir", str(scratch))

    def create(self: Any, *args: Any, **kw: Any) -> Any:
        raise RuntimeError("the store refuses")

    monkeypatch.setattr(SessionStore, "create", create)
    return scratch


def test_run_pair_records_a_refused_session_and_leaks_no_root(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    scratch = _refuse(monkeypatch, tmp_path)
    dump, _ = _run(tmp_path, {})
    assert "the store refuses" in dump["failure"]
    assert dump["complete"] is False
    assert list(scratch.iterdir()) == []


def test_run_interview_records_a_refused_session_and_leaks_no_root(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    scratch = _refuse(monkeypatch, tmp_path)
    record = simulate.run_interview(tier_rig(tmp_path, TierModel({})), LEASE, "haiku-low", 1)
    assert "the store refuses" in record["failure"]
    assert record["complete"] is False
    assert list(scratch.iterdir()) == []


def test_run_shape_records_a_refused_session_and_leaks_no_root(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    scratch = _refuse(monkeypatch, tmp_path)
    record = simulate.run_shape(
        tier_rig(tmp_path, TierModel({})), LEASE, "haiku-low", 1, lambda: None
    )
    assert "the store refuses" in record["failure"]
    assert record["complete"] is False
    assert list(scratch.iterdir()) == []

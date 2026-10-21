"""Proving runs stamp their instants through the contracts ``now_iso`` helper."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from athena.contracts.channel import now_iso
from athena.proving.characters import run as characters_run
from athena.proving.gauntlet import run as gauntlet_run
from athena.proving.runlog import RunLog


def _assert_utc_stamp(stamp: str) -> None:
    parsed = datetime.fromisoformat(stamp)
    assert parsed.utcoffset() == timedelta(0)
    assert stamp.endswith("+00:00")
    assert abs(datetime.now(UTC) - parsed) < timedelta(minutes=1)
    assert len(stamp) == len(now_iso())  # same shape, microseconds included


def test_runlog_row_stamp_is_an_aware_utc_instant() -> None:
    row = RunLog().record(role="judge", engine="claude", model="m")
    _assert_utc_stamp(row["at"])


def test_run_modules_use_the_shared_helper() -> None:
    assert gauntlet_run.now_iso is now_iso
    assert characters_run.now_iso is now_iso
    assert not hasattr(gauntlet_run, "datetime")
    assert not hasattr(characters_run, "datetime")

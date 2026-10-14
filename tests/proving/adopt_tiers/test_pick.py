"""The pick rule: quality floor, then fastest p50, usage as tiebreak; and writing tiers.json."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from athena.adopt.legs import TIERS_PATH, load_tiers
from athena.proving.adopt_tiers.pick import (
    ConfigStats,
    Pick,
    ShapeStats,
    pick_role,
    pick_shape,
    write_tiers,
)
from athena.proving.adopt_tiers.simulate import CONFIGS


def _good(name: str, *, first: float, rounds: float, usage: float = 0.01) -> ConfigStats:
    return ConfigStats(
        name,
        runs=18,
        accuracy=90.0,
        judge=4.5,
        judged=18,
        first_text_p50=first,
        round_p50=rounds,
        usage_interview=usage,
        usage_audit=usage,
    )


def _all(**stats: ConfigStats) -> dict[str, ConfigStats]:
    out = {name: ConfigStats(name) for name in CONFIGS}
    out.update({k.replace("_", "-"): v for k, v in stats.items()})
    return out


def test_disqualification_reasons() -> None:
    stats = _all(
        haiku_low=_good("haiku-low", first=500, rounds=4000),
        haiku_medium=_good("haiku-medium", first=600, rounds=4000),
        sonnet_low=_good("sonnet-low", first=900, rounds=6000),
        sonnet_medium=_good("sonnet-medium", first=1200, rounds=7000),
        opus_low=_good("opus-low", first=1500, rounds=9000),
    )
    stats["haiku-low"].false_clears = 1
    stats["haiku-medium"].repeats = 2
    stats["sonnet-low"].accuracy = 84.0  # 6 points under the best (90)
    stats["opus-low"].judge = 3.4
    pick = pick_role("interview", stats)
    assert pick.config == "sonnet-medium"
    assert not pick.fallback
    dq = pick.disqualified
    assert "1 false clear(s)" in dq["haiku-low"]
    assert "2 repeat(s)" in dq["haiku-medium"]
    assert any("accuracy 84.0" in r for r in dq["sonnet-low"])
    assert any("judge 3.4" in r for r in dq["opus-low"])
    assert dq["opus-medium"] == ["no complete runs"]


def test_accuracy_within_five_points_is_kept() -> None:
    stats = _all(
        sonnet_low=_good("sonnet-low", first=900, rounds=6000),
        opus_medium=_good("opus-medium", first=2000, rounds=9000),
    )
    stats["sonnet-low"].accuracy = 85.0
    assert pick_role("interview", stats).config == "sonnet-low"


def test_unjudged_config_is_out() -> None:
    stats = _all(
        sonnet_low=_good("sonnet-low", first=900, rounds=6000),
        opus_medium=_good("opus-medium", first=2000, rounds=9000),
    )
    stats["sonnet-low"].judge = None
    pick = pick_role("interview", stats)
    assert pick.config == "opus-medium"
    assert pick.disqualified["sonnet-low"] == ["not judged"]


def test_fastest_by_role() -> None:
    stats = _all(
        sonnet_low=_good("sonnet-low", first=900, rounds=9000),
        opus_low=_good("opus-low", first=2000, rounds=5000),
    )
    assert pick_role("interview", stats).config == "sonnet-low"  # first text
    assert pick_role("audit", stats).config == "opus-low"  # round latency


def test_usage_breaks_a_tie_inside_the_band() -> None:
    stats = _all(
        sonnet_low=_good("sonnet-low", first=1000, rounds=6000, usage=0.05),
        haiku_medium=_good("haiku-medium", first=1040, rounds=6000, usage=0.01),
        opus_low=_good("opus-low", first=1200, rounds=6000, usage=0.001),
    )
    pick = pick_role("interview", stats)
    assert pick.config == "haiku-medium"  # 4 % slower, a fifth of the usage; opus-low is outside
    assert "least usage" in pick.why


def test_all_disqualified_keeps_the_most_accurate_and_says_so() -> None:
    stats = _all(
        sonnet_low=_good("sonnet-low", first=900, rounds=6000),
        opus_medium=_good("opus-medium", first=2000, rounds=9000),
    )
    stats["sonnet-low"].false_clears = 1
    stats["opus-medium"].repeats = 1
    stats["opus-medium"].accuracy = 95.0
    pick = pick_role("audit", stats)
    assert pick.config == "opus-medium"
    assert pick.fallback
    assert "every config was disqualified" in pick.why


def test_shape_pick() -> None:
    stats = {name: ShapeStats(name) for name in CONFIGS}
    stats["haiku-low"] = ShapeStats("haiku-low", runs=18, valid=17, portals_ok=18, ms_p50=9000)
    stats["sonnet-low"] = ShapeStats("sonnet-low", runs=18, valid=18, portals_ok=18, ms_p50=20000)
    pick = pick_shape(stats, measured=True)
    assert pick.config == "sonnet-low"
    assert pick.disqualified["haiku-low"] == ["1 of 18 failed validation"]
    assert pick_shape(stats, measured=False, note="not measured: x").config is None


def test_write_tiers_keeps_note_and_other_kinds(tmp_path: Path) -> None:
    path = tmp_path / "tiers.json"
    shutil.copy(TIERS_PATH, path)
    before = json.loads(path.read_text(encoding="utf-8"))
    picks = [
        Pick("interview", "haiku-medium", "x"),
        Pick("audit", "opus-low", "x"),
        Pick("shape", None, "not measured"),
    ]
    write_tiers(picks, path)
    after = json.loads(path.read_text(encoding="utf-8"))
    assert after["_note"] == before["_note"]
    assert after["interview"] == {"model": "claude-haiku-5-5", "effort": "medium"}
    assert after["audit"] == {"model": "claude-opus-5-5", "effort": "low"}
    for kind in ("shape", "research", "persona", "judge"):
        assert after[kind] == before[kind]
    assert list(after) == list(before)
    load_tiers(path)  # WP1's own loader accepts it


def test_write_tiers_never_touches_research_persona_judge(tmp_path: Path) -> None:
    path = tmp_path / "tiers.json"
    shutil.copy(TIERS_PATH, path)
    before = json.loads(path.read_text(encoding="utf-8"))
    write_tiers([Pick("research", "haiku-low", "x"), Pick("judge", "haiku-low", "x")], path)
    assert json.loads(path.read_text(encoding="utf-8")) == before


@pytest.mark.parametrize("role", ["interview", "audit"])
def test_no_runs_no_pick(role: str) -> None:
    assert pick_role(role, _all()).config is None

"""The pick holds a challenger to the run-to-run noise (ADR 0235): a margin inside the band is a
tie that keeps the incumbent, one outside it picks the challenger, too few runs do not rank."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from athena.proving.adopt_tiers import pick as pick_module
from athena.proving.adopt_tiers.pick import (
    MIN_NOISE_DF,
    against,
    aggregate,
    aggregate_shape,
    changes,
    noise,
    pick_bench,
    write_tiers,
)
from athena.proving.adopt_tiers.report import pick_line, report_md
from athena.proving.adopt_tiers.scenarios import load_scenarios

from .test_cells import _held, _record, _score

SCENARIOS = load_scenarios()
EVERY = [s.id for s in SCENARIOS]


@pytest.fixture(autouse=True)
def _scripted(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pick_module, "score_interview", _score)


def _noisy(config: str, scenarios: list[str], centre: int, jitter: int) -> list[dict[str, Any]]:
    """Rep 1 a little under the centre, rep 2 a little over: a within-cell SD of 1.41 x jitter."""
    return [
        _record(s, config, rep, first=[centre + sign * jitter], rounds=[centre + sign * jitter])
        for s in scenarios
        for rep, sign in ((1, -1), (2, 1))
    ]


def _pick(records: list[dict[str, Any]], held: str, role: str = "interview") -> Any:
    picks = pick_bench(records, SCENARIOS, aggregate_shape([]), shape_measured=False)
    stats = aggregate(records, SCENARIOS)
    tiers = {**_held(held), "audit": _held(held)["interview"]}
    out = against(picks, stats, {}, tiers, records=records, scenarios=SCENARIOS)
    return next(p for p in out if p.role == role)


def test_the_estimator_is_the_pooled_within_cell_sd() -> None:
    records = _noisy("opus-low", EVERY, 1000, 100)
    sd, df = noise("interview", records, SCENARIOS)
    assert df == len(EVERY)
    assert sd == pytest.approx(141.42, abs=0.01)


def test_a_margin_inside_the_noise_is_a_tie_that_keeps_the_incumbent(tmp_path: Path) -> None:
    records = _noisy("opus-low", EVERY, 1000, 200) + _noisy("sonnet-low", EVERY, 1100, 200)
    pick = _pick(records, "sonnet-low")
    assert pick.verdict == "tie"
    assert pick.config == "sonnet-low" and pick.proposed == "opus-low"
    assert pick.margin_ms == 100 and pick.noise_ms == pytest.approx(282.84, abs=0.01)
    assert changes([pick]) == []
    line = pick_line(pick)
    assert "(tie, incumbent kept)" in line
    assert "first text margin -100 ms against a noise band of +/-283 ms" in line
    text = report_md(
        aggregate(records, SCENARIOS),
        aggregate_shape([]),
        [pick],
        run_dir=tmp_path,
        scenarios=9,
        shape_note="",
    )
    assert "kept (a tie)" in text and "noise band" in text
    tiers = tmp_path / "tiers.json"
    tiers.write_text((Path(pick_module.TIERS_PATH)).read_text(encoding="utf-8"), encoding="utf-8")
    before = tiers.read_text(encoding="utf-8")
    write_tiers(changes([pick]), tiers)
    assert tiers.read_text(encoding="utf-8") == before  # nothing changed


def test_a_margin_outside_the_noise_picks_the_challenger_as_today() -> None:
    records = _noisy("opus-low", EVERY, 600, 50) + _noisy("sonnet-low", EVERY, 1100, 50)
    pick = _pick(records, "sonnet-low")
    assert pick.verdict == "ranked"
    assert pick.config == "opus-low" and not pick.unchanged
    assert pick.margin_ms == 500 and (pick.noise_ms or 0) < 100
    line = pick_line(pick)
    assert line.startswith("interview: sonnet-low -> opus-low")
    assert "against a noise band of" in line


def test_too_few_runs_to_estimate_the_noise_reads_not_enough_runs_to_rank() -> None:
    one = [EVERY[0]]
    records = [
        _record(one[0], "opus-low", 1, first=[600]),
        _record(one[0], "sonnet-low", 1, first=[1100]),
    ]
    assert noise("interview", records, SCENARIOS) == (None, 0)
    pick = _pick(records, "sonnet-low")
    assert pick.verdict == "unresolved"
    assert pick.config == "sonnet-low" and changes([pick]) == []
    line = pick_line(pick)
    assert "not enough runs to rank" in line and f"need {MIN_NOISE_DF}" in line


def test_the_audit_role_is_held_to_its_own_latency() -> None:
    records = [
        _record(s, c, rep, first=[500], rounds=[base + sign * 400])
        for c, base in (("opus-low", 5000), ("sonnet-low", 5100))
        for s in EVERY
        for rep, sign in ((1, -1), (2, 1))
    ]
    audit = _pick(records, "sonnet-low", "audit")
    assert audit.verdict == "tie" and audit.config == "sonnet-low"


def test_a_disqualified_incumbent_is_replaced_whatever_the_noise() -> None:
    records = _noisy("opus-low", EVERY, 1000, 200) + _noisy("sonnet-low", EVERY, 1100, 200)
    for r in records:
        if r["config"] == "sonnet-low":
            r["_score"]["accuracy"] = 50.0
    pick = _pick(records, "sonnet-low")
    assert pick.config == "opus-low" and pick.verdict == ""

"""The nine scenarios load, sit in their bands, and cover every mechanical slot (ADR 0097)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from athena.adopt.slots import mechanical_slots
from athena.proving.adopt_tiers.scenarios import (
    BANDS,
    SCENARIOS_DIR,
    ScenarioError,
    band_of,
    load_scenario,
    load_scenarios,
    sheet_brief,
    sheet_slots,
)


def test_nine_scenarios_three_per_band() -> None:
    scenarios = load_scenarios()
    assert len(scenarios) == 9
    for band in BANDS:
        assert sum(1 for s in scenarios if s.band == band) == 3
    assert len({s.playbook_id for s in scenarios}) == 9


@pytest.mark.parametrize("path", sorted(SCENARIOS_DIR.glob("*.json")), ids=lambda p: p.stem)
def test_every_sheet_covers_every_mechanical_slot(path: Path) -> None:
    scenario = load_scenario(path)
    sheet = {e.id: e for e in scenario.sheet}
    for slot in mechanical_slots(scenario.playbook):
        assert slot.id in sheet, f"{scenario.id}: no truth for {slot.id}"
        assert sheet[slot.id].kind == slot.kind
    assert band_of(scenario.difficulty, scenario.portal_count) == scenario.band
    assert 1 <= len(scenario.stated_up_front) <= 2
    # The person is not the playbook's own: her answers are not in the playbook text.
    assert scenario.person.split(",")[0] not in json.dumps(scenario.playbook)


def test_band_rule() -> None:
    assert band_of(3, 4) == "easy"
    assert band_of(3, 5) is None
    assert band_of(4, 4) == "typical"
    assert band_of(4, 6) == "hard"
    assert band_of(5, 3) == "hard"


def _copy(tmp_path: Path, name: str, change: dict[str, object]) -> Path:
    raw = json.loads((SCENARIOS_DIR / f"{name}.json").read_text(encoding="utf-8"))
    raw.update(change)
    out = tmp_path / f"{name}.json"
    out.write_text(json.dumps(raw), encoding="utf-8")
    return out


def test_a_sheet_missing_a_mechanical_slot_is_refused(tmp_path: Path) -> None:
    raw = json.loads((SCENARIOS_DIR / "easy-lease-end.json").read_text(encoding="utf-8"))
    sheet = [e for e in raw["sheet"] if e["id"] != "g1"]
    with pytest.raises(ScenarioError, match="no entry for mechanical slot g1"):
        load_scenario(_copy(tmp_path, "easy-lease-end", {"sheet": sheet}))


def test_a_scenario_in_the_wrong_band_is_refused(tmp_path: Path) -> None:
    with pytest.raises(ScenarioError, match="band 'hard'"):
        load_scenario(_copy(tmp_path, "easy-lease-end", {"band": "hard"}))


def test_stated_up_front_must_name_a_sheet_entry(tmp_path: Path) -> None:
    change = {"stated_up_front": [{"entry": "nope", "text": "hi"}]}
    with pytest.raises(ScenarioError, match="not on the sheet"):
        load_scenario(_copy(tmp_path, "easy-lease-end", change))


def test_sheet_brief_swaps_her_portals() -> None:
    scenario = load_scenario(SCENARIOS_DIR / "easy-lease-end.json")
    brief = sheet_brief(scenario)
    assert brief.portals["Postwren"] == "Gmail"
    assert brief.portals["Linestone Inspect"] == ""
    assert "I use Gmail instead of Postwren" in brief.command
    assert all(s.status == "confirmed" for s in sheet_slots(scenario))


def test_a_gate_carries_her_consent_and_no_scoring_patterns(tmp_path: Path) -> None:
    """Gates are not scored (ADR 0097; score.slot_verdicts skips them): a gate entry carries her
    consent and her words, and no accept/reject vocabulary that nothing reads; the report does
    not claim gate verdicts either."""
    from athena.proving.adopt_tiers import scenarios as module
    from athena.proving.adopt_tiers.report import report_md

    scenario = load_scenario(SCENARIOS_DIR / "easy-data-broker.json")
    gates = [e for e in scenario.sheet if e.kind == "gate"]
    assert gates and all(e.consent in ("ask", "go") for e in gates)
    assert all(e.accept == () and e.reject == () for e in gates)
    assert not any(hasattr(module, name) for name in ("ASK_ACCEPT", "GO_ACCEPT"))
    text = report_md({}, {}, [], run_dir=tmp_path, scenarios=9, shape_note="")
    caveat = next(line for line in text.splitlines() if line.startswith("Caveat:"))
    assert "gate and fact/trap verdicts" not in caveat and "Gates are not scored" in caveat

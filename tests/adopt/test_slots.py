"""Slots from the playbook, grown by the auditor, never overruling the person (ADR 0097)."""

from __future__ import annotations

from pathlib import Path

import pytest

from athena.adopt.slots import (
    MAX_SLOTS,
    PlaybookMissing,
    add_slots,
    apply_updates,
    load_playbook_json,
    mechanical_slots,
    playbooks_root,
    portal_swaps,
)

from .conftest import PLAYBOOK


def test_the_library_is_found_in_the_checkout_and_a_real_playbook_loads() -> None:
    root = playbooks_root(environ={})
    assert root is not None and (root / "taxonomy.json").is_file()
    playbook = load_playbook_json("401k-late-deposits", root)
    slots = mechanical_slots(playbook)
    assert [s.id for s in slots] == ["p1", "p2", "p3", "p4", "g1", "g2"]
    assert slots[0].label == "Do you use Payroll Harbor for the payroll firm, or something else?"
    assert slots[4].label.startswith("Before “Pay lost earnings into the plan”: Money leaves")
    assert all(s.status == "open" for s in slots)


def test_an_explicit_library_is_the_only_candidate(tmp_path: Path) -> None:
    assert playbooks_root(environ={"ATHENA_PLAYBOOKS": str(tmp_path)}) == tmp_path
    assert playbooks_root(environ={"ATHENA_PLAYBOOKS": str(tmp_path / "missing")}) is None


@pytest.mark.parametrize("bad", ["../secrets", "", "A", "x/y", "401k-late-deposits/../x"])
def test_a_playbook_id_is_a_slug_never_a_path(bad: str) -> None:
    with pytest.raises(PlaybookMissing):
        load_playbook_json(bad)


def test_an_unknown_playbook_is_missing(tmp_path: Path) -> None:
    with pytest.raises(PlaybookMissing):
        load_playbook_json("no-such-playbook", tmp_path)


def test_the_auditor_grows_facts_and_traps_up_to_twelve() -> None:
    base = mechanical_slots(PLAYBOOK)
    proposed = [
        {"kind": "fact", "label": f"Fact {i}", "value": "v", "status": "guessed"} for i in range(20)
    ]
    grown = add_slots(
        base, [{"kind": "trap", "label": "Day seven"}, {"kind": "portal", "label": "x"}, *proposed]
    )
    assert len(grown) == MAX_SLOTS
    assert [s.id for s in grown[:5]] == ["p1", "p2", "g1", "t1", "f1"]
    assert grown[4].status == "guessed" and grown[3].status == "open"
    again = add_slots(grown[:4], [{"kind": "trap", "label": "day seven"}])
    assert len(again) == 4


def test_research_never_overrules_what_the_person_confirmed() -> None:
    slots = mechanical_slots(PLAYBOOK)
    slots, changed = apply_updates(
        slots, [{"slot_id": "p1", "value": "Gusto", "status": "confirmed"}], source="user"
    )
    assert changed
    slots, changed = apply_updates(
        slots,
        [
            {"slot_id": "p1", "value": "ADP", "status": "confirmed"},
            {"slot_id": "p2", "value": "Retireline", "status": "open"},
            {"slot_id": "g1", "value": "allowed", "status": "guessed"},
            {"slot_id": "zz", "value": "?"},
        ],
        source="research",
    )
    by_id = {s.id: s for s in slots}
    assert by_id["p1"].value == "Gusto" and by_id["p1"].source == "user"
    assert by_id["p2"].status == "open" and by_id["p2"].source == "default"
    assert by_id["g1"].status == "guessed" and by_id["g1"].source == "research"


def test_portal_swaps_name_only_what_differs() -> None:
    slots, _ = apply_updates(
        mechanical_slots(PLAYBOOK),
        [{"slot_id": "p1", "value": "Gusto", "status": "confirmed"}],
        source="user",
    )
    assert portal_swaps(PLAYBOOK, slots) == {"Payroll Harbor": "Gusto", "Retireline": ""}

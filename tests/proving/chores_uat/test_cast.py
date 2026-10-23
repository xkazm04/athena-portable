"""The cast loader: pairs, Characters and case cards are checked and a bad row is named."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest

from athena.proving.chores_uat.cast import (
    CastError,
    case_path,
    check_case,
    load_case,
    load_character,
    load_characters,
    load_pairs,
    parse_criteria,
    select_pairs,
)
from athena.proving.chores_uat.numbers import read_library

from .conftest import LIBRARY, UAT


@pytest.fixture(scope="module")
def playbooks() -> dict[str, dict[str, Any]]:
    assert LIBRARY is not None
    return {k: v[0] for k, v in read_library(LIBRARY).items()}


def test_a_character_keeps_its_criteria_off_the_persona_card() -> None:
    rosa = load_character(UAT / "characters" / "chores" / "rosa.md")
    assert rosa.name == "Rosa Delgado"
    assert rosa.audience == "home" and rosa.tech_comfort == "low"
    assert rosa.segments == ("housing", "consumer")
    assert len(rosa.criteria) == 5
    # A wrapped criterion is one criterion.
    assert rosa.criteria[3].endswith("or the difference is explained.")
    assert "Scored acceptance criteria" not in rosa.card
    assert "Nothing is sent in her name" not in rosa.card
    assert "Scored acceptance criteria" in rosa.body
    assert "disposition fee" in rosa.card


def test_a_character_missing_its_contract_fails_loudly(tmp_path: Path) -> None:
    path = tmp_path / "bad.md"
    path.write_text("---\nid: bad\naudience: office\n---\n# Bad\n\nNo criteria.\n", "utf-8")
    with pytest.raises(CastError) as err:
        load_character(path)
    text = str(err.value)
    assert "bad.md" in text and "audience 'office'" in text
    assert "tech_comfort" in text and "Scored acceptance criteria" in text


def test_parse_criteria_stops_at_the_next_section() -> None:
    body = "## Scored acceptance criteria\n1. One.\n2. Two\n   wrapped.\n## After\n3. Not."
    assert parse_criteria(body) == ["One.", "Two wrapped."]


def test_the_fixture_pairs_load(playbooks: dict[str, dict[str, Any]]) -> None:
    chars = load_characters(UAT)
    pairs = load_pairs(UAT / "chores" / "pairs.json", playbooks=playbooks, characters=set(chars))
    assert [p.id for p in pairs] == [
        "lease-end-wear-charges--rosa",
        "lease-end-wear-charges--tom",
        "clinic-denials--tom",
    ]
    assert [p.id for p in select_pairs(pairs, areas=["health"])] == ["clinic-denials--tom"]
    assert len(select_pairs(pairs, characters=["tom"], limit=1)) == 1
    with pytest.raises(CastError, match="no pair named nope"):
        select_pairs(pairs, ids=["nope"])


def _pairs_file(tmp_path: Path, mutate: Any) -> Path:
    doc = json.loads((UAT / "chores" / "pairs.json").read_text("utf-8"))
    mutate(doc)
    path = tmp_path / "pairs.json"
    path.write_text(json.dumps(doc), "utf-8")
    return path


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (lambda d: d.update(schema=2), 'schema": 1'),
        (lambda d: d["pairs"][1].update(id="wrong"), "pairs[1] (wrong): id must be"),
        (lambda d: d["pairs"][2].pop("reuse_note"), "pairs[2] (clinic-denials--tom): missing"),
        (lambda d: d["pairs"].append(copy.deepcopy(d["pairs"][0])), "duplicate id"),
        (lambda d: d["pairs"][0].update(audience="office"), "not home or work"),
        (lambda d: d["pairs"][0].update(category="health"), "but the playbook's is 'housing'"),
        (
            lambda d: d["pairs"][0].update(
                playbook_id="no-such", id="no-such--rosa", category="housing"
            ),
            "no playbook 'no-such'",
        ),
        (
            lambda d: d["pairs"][0].update(character="zed", id="lease-end-wear-charges--zed"),
            "no Character 'zed'",
        ),
    ],
)
def test_a_bad_pair_row_is_named(
    tmp_path: Path, playbooks: dict[str, dict[str, Any]], mutate: Any, message: str
) -> None:
    path = _pairs_file(tmp_path, mutate)
    with pytest.raises(CastError) as err:
        load_pairs(path, categories=None, playbooks=playbooks, characters={"rosa", "tom"})
    assert message in str(err.value)


def test_a_category_outside_the_taxonomy_is_named(tmp_path: Path) -> None:
    path = _pairs_file(tmp_path, lambda d: None)
    with pytest.raises(CastError, match="'housing' is not a taxonomy id"):
        load_pairs(path, categories={"health"})


def test_the_fixture_case_card_is_valid(playbooks: dict[str, dict[str, Any]]) -> None:
    pb = playbooks["lease-end-wear-charges"]
    card = load_case(case_path(UAT, "lease-end-wear-charges--rosa"), pb)
    assert card["gates"] == [{"action": "contest_charge", "mine": "ask"}]


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (lambda c: c["portals"].pop(), "missing: Torvane Finance"),
        (lambda c: c["portals"][0].update(playbook_app="Gmail"), "playbook_app must be one of"),
        (lambda c: c["gates"][0].update(mine="maybe"), 'mine must be "ask" or "go"'),
        (lambda c: c.update(gates=[]), "missing: contest_charge"),
        (lambda c: c.update(facts=c["facts"][:5]), "facts must be a list of 6 to 12"),
        (lambda c: c.update(unknowns=["only one"]), "unknowns must be a list of 2 to 5"),
        (lambda c: c.update(stated_up_front=" "), "stated_up_front must be"),
        (lambda c: c.pop("generated_by"), "generated_by"),
    ],
)
def test_a_bad_case_card_is_named(
    playbooks: dict[str, dict[str, Any]], mutate: Any, message: str
) -> None:
    pb = playbooks["lease-end-wear-charges"]
    card = json.loads(case_path(UAT, "lease-end-wear-charges--rosa").read_text("utf-8"))
    mutate(card)
    assert message in check_case(card, pb)

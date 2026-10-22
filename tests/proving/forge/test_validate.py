"""The validator: one planted bad variant per rule, each refused for its reason (spark WP-F)."""

from __future__ import annotations

import copy
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from athena.proving.forge.base import Base, find_rows, load_base
from athena.proving.forge.dry import mutate
from athena.proving.forge.validate import CODES, code_of, validate


def codes(problems: list[str]) -> set[str]:
    return {code_of(p) for p in problems}


def good(base: Base) -> dict[str, Any]:
    return mutate(base, 1)


@pytest.mark.parametrize("pid", ["chargeback-representment", "clinic-denials", "lien-desk"])
def test_a_mutated_world_is_valid(library: Path, pid: str) -> None:
    b = load_base(library, pid)
    assert validate(b, good(b)) == []


def test_the_base_as_its_own_variant_is_refused_only_for_no_new_traps(base: Base) -> None:
    problems = validate(base, {"world": base.world, "truth": base.truth})
    assert codes(problems) == {"few-new-traps"}
    assert "0 trap id" in problems[0]


def test_the_whole_library_is_refused_only_for_no_new_traps(library: Path) -> None:
    """Calibration: no playbook's own truth trips a rule it should satisfy."""
    refused: dict[str, set[str]] = {}
    for d in sorted(library.iterdir()):
        if (d / "truth.json").is_file():
            b = load_base(library, d.name)
            found = codes(validate(b, {"world": b.world, "truth": b.truth}))
            if found != {"few-new-traps"}:
                refused[d.name] = found
    assert refused == {}


def test_a_json_string_variant_parses(base: Base) -> None:
    assert validate(base, json.dumps(good(base))) == []


def _first_target(v: dict[str, Any]) -> dict[str, Any]:
    return v["truth"]["targets"][0]  # type: ignore[no-any-return]


def plant_not_json(base: Base) -> Any:
    return "{ this is not json"


def plant_not_an_object(base: Base) -> Any:
    return ["world", "truth"]


def plant_no_truth(base: Base) -> Any:
    return {"world": good(base)["world"]}


def plant_no_tables(base: Base) -> Any:
    v = good(base)
    del v["world"]["tables"]
    return v


def plant_other_app(base: Base) -> Any:
    v = good(base)
    v["world"]["apps"][0]["app_id"] = "renamed"
    return v


def plant_dropped_tool(base: Base) -> Any:
    v = good(base)
    v["world"]["apps"][0]["tools"].pop()
    return v


def plant_retyped_tool(base: Base) -> Any:
    v = good(base)
    v["world"]["apps"][0]["tools"][0]["params"] = {"other": {"type": "string"}}
    return v


def plant_phase_message(base: Base) -> Any:
    v = good(base)
    v["world"]["phases"][0]["message"] += " Also file everything."
    return v


def plant_dropped_table(base: Base) -> Any:
    v = good(base)
    del v["world"]["tables"][next(iter(v["world"]["tables"]))]
    return v


def plant_other_target(base: Base) -> Any:
    v = good(base)
    _first_target(v)["key"] = "something_else"
    return v


def plant_ghost_id(base: Base) -> Any:
    v = good(base)
    _first_target(v)["eligible"]["ZZ-NO-SUCH-ROW"] = {"value_usd": 10, "why": "ghost"}
    return v


def plant_ghost_trap(base: Base) -> Any:
    v = good(base)
    _first_target(v)["traps"]["ZZ-GHOST-TRAP"] = "no row"
    return v


def plant_overlap(base: Base) -> Any:
    v = good(base)
    target = _first_target(v)
    eligible = next(iter(target["eligible"]))
    target["traps"][eligible] = "also a trap"
    return v


def plant_value_string(base: Base) -> Any:
    v = good(base)
    item = next(iter(_first_target(v)["eligible"].values()))
    item["value_usd"] = "184.00"
    return v


def plant_value_bool(base: Base) -> Any:
    v = good(base)
    next(iter(_first_target(v)["eligible"].values()))["value_usd"] = True
    return v


def plant_empty_reason(base: Base) -> Any:
    v = good(base)
    trap = next(iter(_first_target(v)["traps"]))
    _first_target(v)["traps"][trap] = "  "
    return v


def plant_one_new_trap(base: Base) -> Any:
    """The base itself plus exactly one new look-alike trap row: one short of the two needed."""
    v = {"world": copy.deepcopy(base.world), "truth": copy.deepcopy(base.truth)}
    target = _first_target(v)
    key = next(iter(target["eligible"]))
    table, row = find_rows(v["world"], key, limit=1)[0]
    clone = {f: ("NEW-TRAP-1" if x == key else x) for f, x in row.items()}
    v["world"]["tables"][table].append(clone)
    target["traps"]["NEW-TRAP-1"] = "a look-alike that fails the deadline"
    return v


def plant_loader_only(base: Base) -> Any:
    """Passes every rule the forge checks itself; the spec loader refuses a tool with no text."""
    v = good(base)
    v["world"]["apps"][0]["tools"][0]["description"] = ""
    return v


PLANTED: list[tuple[str, Callable[[Base], Any], str]] = [
    ("not-json", plant_not_json, "unparseable"),
    ("not-an-object", plant_not_an_object, "unparseable"),
    ("no-truth", plant_no_truth, "missing-key"),
    ("no-tables", plant_no_tables, "missing-key"),
    ("other-app", plant_other_app, "apps-differ"),
    ("dropped-tool", plant_dropped_tool, "tools-differ"),
    ("retyped-tool", plant_retyped_tool, "tools-differ"),
    ("phase-message", plant_phase_message, "phases-differ"),
    ("dropped-table", plant_dropped_table, "tables-differ"),
    ("other-target", plant_other_target, "targets-differ"),
    ("ghost-eligible", plant_ghost_id, "id-not-a-row"),
    ("ghost-trap", plant_ghost_trap, "id-not-a-row"),
    ("overlap", plant_overlap, "overlap"),
    ("value-string", plant_value_string, "value-not-number"),
    ("value-bool", plant_value_bool, "value-not-number"),
    ("empty-reason", plant_empty_reason, "trap-reason"),
    ("one-new-trap", plant_one_new_trap, "few-new-traps"),
    ("loader-only", plant_loader_only, "loader"),
]


@pytest.mark.parametrize(("name", "plant", "code"), PLANTED, ids=[p[0] for p in PLANTED])
def test_each_planted_bad_variant_is_refused_for_its_reason(
    base: Base, name: str, plant: Callable[[Base], Any], code: str
) -> None:
    problems = validate(base, copy.deepcopy(plant(base)))
    assert code in codes(problems), (name, problems)


def test_every_code_has_a_planted_variant() -> None:
    planted = {code for _n, _p, code in PLANTED}
    assert planted >= set(CODES) - {"bad-truth"}


def test_the_loader_only_plant_passes_every_other_rule(base: Base) -> None:
    assert codes(validate(base, plant_loader_only(base))) == {"loader"}

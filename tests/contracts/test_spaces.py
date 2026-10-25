"""The projects contract's Python half: its shapes, its caps and the one visibility predicate.

contracts/spaces.py (ADR 0225). The wire keys are the contract's, exactly; the desktop's twin is
``apps/desktop/src/lib/spaces.ts``. Core is ``""`` everywhere and a turn in a space sees core and
that space, never another.
"""

from __future__ import annotations

from dataclasses import fields

from athena.contracts import ids
from athena.contracts.adopt import Case, CaseSummary
from athena.contracts.registry import TurnContext
from athena.contracts.spaces import (
    APPS_CAP,
    BRIEF_CAP,
    CORE,
    CORE_ITEM,
    MEMORY_KINDS,
    MEMORY_LIMIT,
    MEMORY_LIMIT_MAX,
    NAME_CAP,
    SPACE_SCHEMA,
    SpaceCounts,
    SpaceErased,
    SpaceMemoryRow,
    SpaceSummary,
    visible_spaces,
)


def names(shape: type) -> list[str]:
    return [f.name for f in fields(shape)]


def test_the_wire_shapes_carry_the_contracts_keys_in_order() -> None:
    assert names(SpaceSummary) == [
        "id",
        "name",
        "brief",
        "apps",
        "hue",
        "created",
        "updated",
        "counts",
    ]
    assert names(SpaceCounts) == ["episodes", "facts", "procedurals", "chores"]
    assert names(SpaceErased) == ["id", "episodes", "facts", "procedurals", "chores_unlinked"]
    assert names(SpaceMemoryRow) == ["id", "kind", "line", "created"]


def test_the_caps_and_words_are_the_contracts() -> None:
    assert (SPACE_SCHEMA, NAME_CAP, BRIEF_CAP, APPS_CAP) == (1, 60, 1600, 24)
    assert (CORE, CORE_ITEM) == ("", "core")
    assert MEMORY_KINDS == ("episode", "fact", "procedural")
    assert (MEMORY_LIMIT, MEMORY_LIMIT_MAX) == (50, 200)


def test_core_sees_core_alone_and_a_space_sees_core_and_itself() -> None:
    space = ids.mint("space")
    assert visible_spaces(CORE) == ("",)
    assert visible_spaces(space) == ("", space)
    assert ids.mint("space") not in visible_spaces(space)


def test_a_space_id_is_its_own_kind_and_never_a_case_id() -> None:
    space = ids.mint("space")
    assert space.startswith("spc_") and ids.kind_of(space) == "space"
    assert not ids.is_id("project", space)
    assert not ids.is_id("space", ids.mint("project"))


def test_core_is_the_default_everywhere_a_space_rides() -> None:
    """``""``, never ``None``: one spelling of "nothing" on the case, its summary and the turn."""
    turn = TurnContext(conversation_id="conv_x", turn_id=ids.mint("turn"))
    assert turn.space_id == ""
    case = Case(
        id=ids.mint("project"),
        playbook_id="p",
        title="T",
        approved_rev=1,
        approved_at="",
        episode_id="",
        created="",
    )
    assert case.space_id == "" and case.schema == 1
    summary = CaseSummary(
        case_id=case.id,
        playbook_id="p",
        title="T",
        approved_rev=1,
        approved_at="",
        created="",
    )
    assert summary.space_id == ""

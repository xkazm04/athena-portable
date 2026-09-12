"""The JSON-schema subset the gate validates with, and the provenance rule beside it.

core/validators.py, README §3.3 and §2 invariant 2.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Any

from athena.contracts import ERROR_REASONS, TurnContext
from athena.core.validators import all_of, check_schema, live_sources, schema_validator

CTX = TurnContext(conversation_id="conv_demo", turn_id="turn-1")

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "key": {"type": "string", "maxLength": 8},
        "scope": {"type": "string", "enum": ["user", "project"]},
        "count": {"type": "integer", "minimum": 1, "maximum": 5},
        "tags": {
            "type": "array",
            "items": {"type": "string", "maxLength": 4},
            "minItems": 1,
            "maxItems": 2,
        },
    },
    "required": ["key"],
}


def test_a_well_formed_object_is_accepted() -> None:
    result = check_schema({"key": "a", "scope": "user", "count": 3, "tags": ["x"]}, SCHEMA)
    assert result.ok
    assert result.reason is None


def test_a_missing_required_parameter_is_named() -> None:
    result = check_schema({"scope": "user"}, SCHEMA)
    assert not result.ok
    assert "key" in result.detail


def test_every_rejection_carries_a_reason_from_the_closed_set() -> None:
    rejections = [
        check_schema({}, SCHEMA),
        check_schema({"key": 7}, SCHEMA),
        check_schema({"key": "a", "scope": "world"}, SCHEMA),
    ]
    for result in rejections:
        assert not result.ok
        assert result.reason in ERROR_REASONS
        assert result.detail


def test_the_wrong_type_is_refused_and_a_bool_is_not_an_integer() -> None:
    assert not check_schema({"key": 7}, SCHEMA).ok
    # True is an int in Python and is not a count in any manifest that ever meant one.
    result = check_schema({"key": "a", "count": True}, SCHEMA)
    assert not result.ok
    assert "boolean" in result.detail


def test_an_enum_refuses_a_value_it_does_not_list() -> None:
    result = check_schema({"key": "a", "scope": "world"}, SCHEMA)
    assert not result.ok
    assert "'world'" in result.detail


def test_the_bounds_are_checked_on_strings_numbers_and_arrays() -> None:
    assert not check_schema({"key": "far too long"}, SCHEMA).ok
    assert not check_schema({"key": "a", "count": 0}, SCHEMA).ok
    assert not check_schema({"key": "a", "count": 9}, SCHEMA).ok
    assert not check_schema({"key": "a", "tags": []}, SCHEMA).ok
    assert not check_schema({"key": "a", "tags": ["x", "y", "z"]}, SCHEMA).ok


def test_an_item_schema_is_applied_to_every_element() -> None:
    result = check_schema({"key": "a", "tags": ["ok", "far too long"]}, SCHEMA)
    assert not result.ok
    assert "tags[1]" in result.detail


def test_additional_properties_false_names_the_unknown_parameters() -> None:
    strict = dict(SCHEMA) | {"additionalProperties": False}
    result = check_schema({"key": "a", "nope": 1, "also": 2}, strict)
    assert not result.ok
    assert "also" in result.detail
    assert "nope" in result.detail


def test_schema_validator_has_the_shape_the_registry_wants() -> None:
    validator = schema_validator(SCHEMA)
    assert validator({"key": "a"}, CTX).ok
    assert not validator({}, CTX).ok


def test_all_of_returns_the_first_rejection() -> None:
    first = schema_validator(SCHEMA)
    second = live_sources(lambda sources: True)
    combined = all_of(first, second)
    # The schema fails before the provenance check ever reads `sources`.
    result = combined({"sources": ["ep_00000001"]}, CTX)
    assert not result.ok
    assert "key" in result.detail
    assert combined({"key": "a", "sources": ["ep_00000001"]}, CTX).ok


# --- provenance (README §2 invariant 2) ---------------------------------------------------------


def alive_only(*live: str) -> Callable[[Sequence[str]], bool]:
    def _alive(sources: Sequence[str]) -> bool:
        return all(source in live for source in sources)

    return _alive


def test_live_sources_accepts_only_episode_ids_that_are_alive() -> None:
    validator = live_sources(alive_only("ep_0000000a"))
    assert validator({"sources": ["ep_0000000a"]}, CTX).ok
    dead = validator({"sources": ["ep_0000000b"]}, CTX)
    assert not dead.ok
    assert "ep_0000000b" in dead.detail


def test_live_sources_refuses_an_empty_list_and_anything_that_is_not_an_episode_id() -> None:
    validator = live_sources(lambda sources: True)
    assert not validator({}, CTX).ok
    assert not validator({"sources": []}, CTX).ok
    malformed = validator({"sources": ["fact_000000000001"]}, CTX)
    assert not malformed.ok
    assert "not episode ids" in malformed.detail

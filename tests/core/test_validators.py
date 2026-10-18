"""The JSON-schema subset the gate validates with, and the provenance rule beside it.

core/validators.py, README §3.3 and §2 invariant 2.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from typing import Any

import pytest

from athena.contracts import ERROR_REASONS, TurnContext
from athena.core.brain import frontmatter
from athena.core.validators import (
    FACT_KEY_LINE_BREAKS,
    all_of,
    check_schema,
    fact_text,
    live_sources,
    schema_validator,
)

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


def test_a_list_of_types_is_enforced_and_not_skipped() -> None:
    """The door accepts ``type: [..]`` (``params_schema_problems``), so the gate must check it:
    a property typed ``["string", "null"]`` used to take an object, a number or a list."""
    schema = {
        "type": "object",
        "properties": {"note": {"type": ["string", "null"], "maxLength": 4}},
    }
    assert check_schema({"note": "ok"}, schema).ok
    assert check_schema({"note": None}, schema).ok
    for wrong in ({"a": 1}, 7, ["x"], True):
        result = check_schema({"note": wrong}, schema)
        assert not result.ok, wrong
        assert result.reason == "validator_failed"
        assert "expected string or null" in result.detail
    assert not check_schema({"note": "far too long"}, schema).ok


def test_a_bool_is_not_a_number_inside_a_list_of_types_either() -> None:
    schema = {"type": "object", "properties": {"n": {"type": ["integer", "null"]}}}
    assert check_schema({"n": 3}, schema).ok
    result = check_schema({"n": True}, schema)
    assert not result.ok and "boolean" in result.detail


@pytest.mark.parametrize("declared", ["strng", "any", ["string", "uuid"], [], 5])
def test_a_type_the_gate_cannot_check_refuses_every_call_instead_of_passing_it(
    declared: Any,
) -> None:
    """Fail closed: an unknown type name used to be skipped, so ``"strng"`` admitted anything."""
    schema = {
        "type": "object",
        "properties": {"to": {"type": "array", "items": {"type": declared}}},
    }
    result = check_schema({"to": ["a@example.com"]}, schema)
    assert not result.ok
    assert result.reason == "validator_failed"
    assert "params_schema" in result.detail


@pytest.mark.parametrize(
    ("enum", "value"),
    [([0, 1], False), ([1, 2], True), ([[1, 2]], [True, 2]), ([{"n": 1}], {"n": True})],
)
def test_an_enum_compares_as_json_does_so_a_boolean_never_passes_for_a_number(
    enum: list[Any], value: Any
) -> None:
    """``True == 1`` in Python and ``true != 1`` in JSON; an untyped enum used to take the bool."""
    schema = {"type": "object", "properties": {"pick": {"enum": enum}}}
    result = check_schema({"pick": value}, schema)
    assert not result.ok
    assert result.reason == "validator_failed"
    assert check_schema({"pick": enum[0]}, schema).ok


def test_an_enum_still_takes_an_equal_number_of_the_other_numeric_type() -> None:
    schema = {"type": "object", "properties": {"n": {"enum": [1, 2.5]}}}
    assert check_schema({"n": 1.0}, schema).ok
    assert check_schema({"n": 2.5}, schema).ok
    assert not check_schema({"n": 3}, schema).ok


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


@pytest.mark.parametrize("value", [math.nan, math.inf, -math.inf])
def test_a_number_that_is_not_finite_is_refused(value: float) -> None:
    """NaN compares False with every bound, so the range check alone let it through."""
    schema = {"type": "object", "properties": {"ratio": {"type": "number", "minimum": 0}}}
    result = check_schema({"ratio": value}, schema)
    assert not result.ok
    assert result.reason == "validator_failed"
    assert result.detail == f"ratio: {value} is not a finite number"


def test_write_facts_schema_refuses_a_confidence_of_nan_and_inf() -> None:
    from athena.core.catalog import WRITE_FACT_SCHEMA

    params = {"key": "k", "value": "v", "sources": ["ep_00000000"]}
    for value in (math.nan, math.inf):
        result = check_schema({**params, "confidence": value}, WRITE_FACT_SCHEMA)
        assert not result.ok and result.reason == "validator_failed"
        assert "is not a finite number" in result.detail
    assert check_schema({**params, "confidence": 0.9}, WRITE_FACT_SCHEMA).ok


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


NESTED: dict[str, Any] = {
    "type": "object",
    "properties": {
        "filter": {
            "type": "object",
            "properties": {"status": {"type": "string", "enum": ["open"]}},
            "required": ["status"],
            "additionalProperties": False,
        }
    },
}


def test_a_nested_object_is_held_to_its_declared_required_enum_and_extras() -> None:
    """ADR 0120: the gate enforces what a nested object schema declares."""
    assert check_schema({"filter": {"status": "open"}}, NESTED).ok
    missing = check_schema({"filter": {}}, NESTED)
    assert not missing.ok
    assert "filter" in missing.detail
    assert "status" in missing.detail
    miss = check_schema({"filter": {"status": "closed"}}, NESTED)
    assert not miss.ok
    assert "filter.status" in miss.detail
    extra = check_schema({"filter": {"status": "open", "anything": 1}}, NESTED)
    assert not extra.ok
    assert "anything" in extra.detail


def test_a_nested_schema_of_the_wrong_shape_refuses_instead_of_raising() -> None:
    bad_required = {"properties": {"f": {"type": "object", "required": "status"}}}
    bad_props = {"properties": {"f": {"type": "object", "properties": ["x"]}}}
    for schema in (bad_required, bad_props):
        result = check_schema({"f": {"status": "open"}}, schema)
        assert not result.ok
        assert result.reason == "validator_failed"


def test_a_nested_object_inside_an_array_is_checked_too() -> None:
    schema = {
        "properties": {
            "rows": {
                "type": "array",
                "items": {"type": "object", "required": ["id"]},
            }
        }
    }
    assert check_schema({"rows": [{"id": 1}]}, schema).ok
    result = check_schema({"rows": [{"id": 1}, {}]}, schema)
    assert not result.ok
    assert "rows[1]" in result.detail


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


def test_a_schema_of_the_wrong_shape_refuses_every_call_instead_of_raising() -> None:
    """robustness-2: ``required: 5`` used to raise TypeError here, at the gate itself."""
    for schema in ({"required": 5}, {"required": [["a"]]}, {"properties": [1, 2]}, [1, 2]):
        for params in ({}, {"a": 1}):
            result = check_schema(params, schema)  # type: ignore[arg-type]
            assert not result.ok and result.reason == "validator_failed"
            assert "params_schema" in result.detail


def test_a_string_that_is_not_unicode_is_refused_and_never_echoed() -> None:
    top = check_schema({"key": "\ud800"}, SCHEMA)
    nested = check_schema({"key": "a", "tags": ["ok", "\ud800"]}, SCHEMA)
    via_validator = schema_validator(SCHEMA)({"key": "\ud800"}, CTX)

    for result in (top, nested, via_validator):
        assert not result.ok
        assert result.reason == "validator_failed"
        assert "not valid Unicode" in result.detail
        assert "\ud800" not in result.detail
    assert "key" in top.detail
    assert "tags[1]" in nested.detail


# --- fact_text: what the writer would refuse after the card (ADR 0082) --------------------------


def test_fact_text_accepts_a_plain_key_and_value_and_skips_a_non_string() -> None:
    check = fact_text()
    assert check({"key": "acme pays late", "value": "60 days"}, CTX).ok
    assert check({"key": 3, "value": ["x"]}, CTX).ok, "the schema refuses a type, not this"
    assert check({}, CTX).ok


@pytest.mark.parametrize("key", ["a\nb", "a\rb", "a\r\nb", "\n", "a\u2028b", "a\x85b", "a\u2029b"])
def test_fact_text_refuses_a_key_with_a_line_break_without_echoing_it(key: str) -> None:
    result = fact_text()({"key": key, "value": "v"}, CTX)
    assert not result.ok
    assert result.reason == "validator_failed"
    assert "key" in result.detail
    assert "\n" not in result.detail
    assert "\r" not in result.detail


@pytest.mark.parametrize("key", ["", "   ", " \t "])
def test_fact_text_refuses_an_empty_key_without_echoing_it(key: str) -> None:
    result = fact_text()({"key": key, "value": "v"}, CTX)
    assert not result.ok
    assert result.reason == "validator_failed"
    assert result.detail == "key: may not be empty or only whitespace"


@pytest.mark.parametrize("value", ["", "   ", "\t", " \t\n "])
def test_fact_text_refuses_a_value_empty_after_strip(value: str) -> None:
    result = fact_text()({"key": "k", "value": value}, CTX)
    assert not result.ok
    assert result.reason == "validator_failed"
    assert "value" in result.detail


def test_fact_text_line_break_set_equals_the_frontmatter_writers() -> None:
    assert FACT_KEY_LINE_BREAKS == frontmatter._LINE_BREAKS

"""The file format holds, and a line break in a value is refused (README §2 invariant 1)."""

from __future__ import annotations

import math

import pytest

from athena.core.brain import frontmatter
from athena.core.brain.frontmatter import FrontmatterError


def test_render_then_parse_round_trips_scalars_and_a_list() -> None:
    text = frontmatter.render(
        [
            ("id", "ep_0123abcd"),
            ("type", "episode"),
            ("confidence", 0.7),
            ("machine", False),
            ("sources", ["ep_0123abcd", "ep_89abcdef"]),
        ],
        "the body\n",
    )
    meta, body = frontmatter.parse(text)

    assert meta["id"] == "ep_0123abcd"
    assert meta["type"] == "episode"
    assert meta["confidence"] == 0.7
    assert meta["machine"] is False
    assert meta["sources"] == ["ep_0123abcd", "ep_89abcdef"]
    assert body == "the body\n"


def test_the_header_is_fenced_and_type_is_bare() -> None:
    text = frontmatter.render([("id", "ep_0123abcd"), ("type", "episode")], "body")

    assert text.splitlines()[:4] == ["---", 'id: "ep_0123abcd"', "type: episode", "---"]


def test_a_value_with_a_line_break_is_refused() -> None:
    # Header injection: the second line would become an ``id:`` of its own, ``parse`` would take
    # the last occurrence, and a reconcile would then overwrite a different memory's row.
    with pytest.raises(FrontmatterError, match="line break"):
        frontmatter.render([("key", 'pays late"\nid: ep_00000000')], "body")


def test_a_line_break_inside_a_list_item_is_refused() -> None:
    with pytest.raises(FrontmatterError, match="line break"):
        frontmatter.render([("sources", ["ep_0123abcd", "ep_4\nid: ep_ffffffff"])], "body")


def test_a_carriage_return_counts_as_a_line_break() -> None:
    with pytest.raises(FrontmatterError, match="line break"):
        frontmatter.render([("key", "a\rb")], "body")


_TEN = ["\n", "\r", "\x0b", "\x0c", "\x1c", "\x1d", "\x1e", "\x85", "\u2028", "\u2029"]


@pytest.mark.parametrize("char", _TEN, ids=[f"U+{ord(c):04X}" for c in _TEN])
def test_a_key_holding_any_splitlines_break_is_refused(char: str) -> None:
    with pytest.raises(FrontmatterError, match="line break"):
        frontmatter.render([("key", f"a{char}b")], "body")


def test_the_line_breaks_are_exactly_what_splitlines_breaks_on() -> None:
    derived = {
        chr(code) for code in range(0x10000) if len(("a" + chr(code) + "b").splitlines()) == 2
    }
    assert derived == frontmatter._LINE_BREAKS
    assert len(derived) == 10


@pytest.mark.parametrize("key", ['pays "late" often', 'pays late"'], ids=["inside", "trailing"])
def test_a_key_with_a_double_quote_round_trips(key: str) -> None:
    meta, _ = frontmatter.parse(frontmatter.render([("key", key)], "body"))

    assert meta["key"] == key


def test_a_file_with_no_header_parses_as_all_body() -> None:
    meta, body = frontmatter.parse("no header here\n")

    assert meta == {}
    assert body == "no header here\n"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("00123", 123),
        ('"00123"', "00123"),
        ("'00123'", "00123"),
        ("true", True),
        ('"true"', "true"),
        ("True", "True"),
        ("TRUE", "TRUE"),
        ("1_000", 1000),
        ("+5", 5),
        ("1e5", 100000.0),
        ("0x10", "0x10"),
        ("plain text", "plain text"),
        ('"abc', '"abc'),
    ],
)
def test_a_bare_scalar_is_typed_and_a_quoted_one_stays_text(raw: str, expected: object) -> None:
    """ADR 0084 pins the dialect as it is: value and type, so a change must supersede it."""
    meta, _ = frontmatter.parse(f"---\nkey: {raw}\n---\n\nbody\n")

    assert meta["key"] == expected
    assert type(meta["key"]) is type(expected)


def test_a_bare_nan_is_a_float_and_not_text() -> None:
    meta, _ = frontmatter.parse("---\nkey: nan\n---\n\nbody\n")

    assert isinstance(meta["key"], float)
    assert math.isnan(meta["key"])

"""The file format holds, and a line break in a value is refused (README §2 invariant 1)."""

from __future__ import annotations

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


def test_a_file_with_no_header_parses_as_all_body() -> None:
    meta, body = frontmatter.parse("no header here\n")

    assert meta == {}
    assert body == "no header here\n"

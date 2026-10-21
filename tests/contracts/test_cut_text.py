"""The announced cut daemon, proving and connectors share (contracts/channel.py ``cut_text``).

Text at or under the limit is returned as it came; longer text is cut to ``limit`` characters and
followed by ``(showing limit of total)`` on its own line. The callers' outputs depend on the exact
string, so it is pinned here.
"""

from __future__ import annotations

from athena.contracts import cut_text


def test_text_within_the_limit_is_returned_unchanged() -> None:
    assert cut_text("short", 10) == "short"
    assert cut_text("exactly10!", 10) == "exactly10!"
    assert cut_text("", 0) == ""


def test_longer_text_is_cut_and_announced_on_its_own_line() -> None:
    assert cut_text("abcdefghij", 4) == "abcd\n(showing 4 of 10)"
    assert cut_text("a" * 11, 10) == "a" * 10 + "\n(showing 10 of 11)"


def test_total_counts_characters_not_bytes() -> None:
    assert cut_text("é" * 5, 2) == "éé\n(showing 2 of 5)"


def test_a_zero_limit_keeps_nothing_but_still_announces() -> None:
    assert cut_text("abc", 0) == "\n(showing 0 of 3)"

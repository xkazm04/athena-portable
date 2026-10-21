"""The one cut the Adopt studio's text fields share (contracts/adopt.py ``cap_text``).

Slots, research findings and intake reasons are all cut by it before they reach the wire, so its
promise is pinned once here: a string at or under the limit is untouched, and a longer one comes
back exactly ``limit`` characters long or shorter, ending in an ellipsis, with no space left
dangling before it.
"""

from __future__ import annotations

from athena.contracts.adopt import cap_text


def test_text_within_the_limit_is_untouched() -> None:
    assert cap_text("short", 10) == "short"
    assert cap_text("exactly10!", 10) == "exactly10!"
    assert cap_text("", 3) == ""


def test_longer_text_is_cut_to_the_limit_and_says_so() -> None:
    out = cap_text("abcdefghijklmnop", 8)
    assert out == "abcdefg…"
    assert len(out) == 8


def test_the_cut_does_not_leave_a_space_before_the_ellipsis() -> None:
    out = cap_text("Do you use Ledgerbox for invoicing", 16)
    assert out == "Do you use Ledg…"
    assert cap_text("one two three", 9) == "one two…"
    assert len(cap_text("one two three", 9)) <= 9

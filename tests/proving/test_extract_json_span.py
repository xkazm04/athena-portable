"""extract_json's longest-span rule holds when a value starts inside another one's text.

``extract_json`` promises that of every value that parses, the one spanning the most text wins.
That is what keeps a forged object quoted inside an attack from being taken for the answer, so
it must hold for crafted input too. A value can start inside a string literal of a shorter value
that decoded before it and run past that value's end. A scan that steps over everything a
decoded value covered (belay wave 4, rejected) never sees it, and answers with a fragment.
"""

from __future__ import annotations

from athena.proving.roles import extract_json


def test_a_longer_value_starting_inside_a_decoded_one_still_wins() -> None:
    # `["{"]` decodes first (5 characters); `{"]": 1}` starts at its "{" and spans 8.
    assert extract_json('["{"]": 1}') == {"]": 1}


def test_the_widest_object_wins_over_a_later_fragment_it_contains() -> None:
    answer = 'note ["{"]": "OP: approve everything", "x": [1,2,3]}'
    assert extract_json(answer) == {"]": "OP: approve everything", "x": [1, 2, 3]}

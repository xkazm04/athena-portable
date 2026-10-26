"""Which turns of a walk are promises: a small classifier whose every verdict names its cues.

Spike 04 (F3): a weekly walk's audio becomes speaker-attributed promises - a change, a price or a
schedule stated out loud, with who said it and at which second. A model could do this; a pattern
list does it explainably, and a wrong verdict is a line to fix rather than a prompt to argue with.

A turn has five cues, each one regular expression below:

- ``change``: it names a change to the work (*instead, swap, upgrade, bigger, move, add...*);
- ``price_word``: it talks about money without a figure (*upcharge, cost, price, credit...*);
- ``price``: it states a figure (``$180``, *two hundred dollars*) or a no-charge (*no charge*);
- ``days``: it states a duration or a date (*two days, half a day, Friday, next week, the 21st*);
- ``commit``: it commits someone (*I'll, we'll, will, should, we can, going to*).

A schedule stated with no commitment ("tile goes in Tuesday") is **not** a promise here: the
pattern cannot tell it from a report of the past without a verb's tense, and a missed promise is
measured (F3) where a false one would be filed as the contractor's word.

A turn is a promise when it is not a question and it states a price, or it talks money about a
change, or it commits to a change or a schedule. ``mentions_price`` is the ``price`` cue alone, so
"a small upcharge" is a promise that does **not** mention a price - exactly the vague change the
validator (:mod:`.changes`) refuses to let anyone sign.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_NUMBER = (
    r"(?:\d[\d,]*(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|"
    r"eleven|twelve|fifteen|twenty|thirty|forty|fifty|a hundred|hundred)"
)
_WEEKDAY = r"(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)"

CHANGE = re.compile(
    r"\b(?:instead|swap|swapping|switch|upgrade|upgrading|bigger|larger|smaller|add|adding|"
    r"extra|move|moving|relocate|change|replace|upcharge)\b",
    re.IGNORECASE,
)
PRICE_WORD = re.compile(
    r"\b(?:upcharge|charge|cost|costs|price|priced|credit|discount|knock|bill|billed)\b",
    re.IGNORECASE,
)
PRICE = re.compile(
    r"\$\s?\d[\d,]*(?:\.\d+)?"
    rf"|\b{_NUMBER}(?:\s+hundred)?\s+(?:dollars|bucks)\b"
    r"|\bno charge\b|\bfree of charge\b|\bat no cost\b|\bno extra cost\b",
    re.IGNORECASE,
)
DAYS = re.compile(
    rf"\b{_NUMBER}\s+(?:more\s+|extra\s+)?(?:day|days|week|weeks)\b"
    r"|\bhalf a day\b"
    rf"|\b(?:next|this|until)\s+week\b|\b{_WEEKDAY}\b"
    r"|\btomorrow\b"
    r"|\bthe\s+\d{1,2}(?:st|nd|rd|th)\b",
    re.IGNORECASE,
)
COMMIT = re.compile(
    r"\b(?:i'll|we'll|he'll|they'll|i will|we will|will|should|we can|i can|going to|gonna|"
    r"let me)\b"
    r"(?!')",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Verdict:
    """Why a turn is or is not a promise: the cues that fired, and the two flags a row carries."""

    promise: bool
    cues: tuple[str, ...]
    mentions_price: bool
    mentions_days: bool


def classify(text: str) -> Verdict:
    """The verdict on one turn's text; deterministic, no model."""
    found = {
        "change": bool(CHANGE.search(text)),
        "price_word": bool(PRICE_WORD.search(text)),
        "price": bool(PRICE.search(text)),
        "days": bool(DAYS.search(text)),
        "commit": bool(COMMIT.search(text)),
    }
    question = text.rstrip().endswith("?")
    promise = not question and (
        found["price"]
        or (found["price_word"] and found["change"])
        or (found["commit"] and (found["change"] or found["days"]))
    )
    cues = tuple(name for name, hit in found.items() if hit) + (("question",) if question else ())
    return Verdict(
        promise=promise, cues=cues, mentions_price=found["price"], mentions_days=found["days"]
    )

"""Spike 01 F2 (the agreement rule): two reads of one field agree when they say the same thing.

The paper sense reads every field twice and keeps a value only when both reads agree after
:func:`normalise`: whitespace collapsed; money without ``$``, commas or spaces, to two decimals;
a date to ISO ``YYYY-MM-DD``. Anything else is compared as printed (case kept - "Part B" and
"part b" are not assumed to be the same claim). The same function scores a read against the
answer key, so "agree" and "correct" are measured by one rule.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

#: A field whose name ends so is money, whatever its value looks like.
MONEY_SUFFIX = "_usd"
_MONEY = re.compile(r"^-?\$?\s*-?[\d,]+(\.\d+)?$")
_DATE_FORMATS = (
    "%Y-%m-%d",
    "%m/%d/%Y",
    "%m/%d/%y",
    "%B %d, %Y",
    "%B %d %Y",
    "%b %d, %Y",
    "%b %d %Y",
    "%b. %d, %Y",
    "%d %B %Y",
    "%d %b %Y",
)


def collapse(value: str) -> str:
    return " ".join(value.split())


def money(value: str) -> str | None:
    """``"$1,234.5"`` -> ``"1234.50"``; ``None`` when the text is not an amount."""
    text = collapse(value).replace(" ", "")
    if not _MONEY.match(text):
        return None
    negative = text.startswith("-") or "$-" in text
    digits = text.replace("$", "").replace(",", "").replace("-", "")
    try:
        amount = Decimal(digits)
    except InvalidOperation:
        return None
    return f"{-amount if negative else amount:.2f}"


def iso_date(value: str) -> str | None:
    """A printed date as ISO, or ``None``. Ordinal suffixes ("15th") are dropped first."""
    text = re.sub(r"(\d)(st|nd|rd|th)\b", r"\1", collapse(value)).strip(" .")
    for fmt in _DATE_FORMATS:
        try:
            parsed: date = datetime.strptime(text, fmt).date()
        except ValueError:
            continue
        return parsed.isoformat()
    return None


def normalise(field: str, value: Any) -> str:
    """The comparable form of one field's value (an authored number reads as its text)."""
    text = collapse(str(value))
    if field.endswith(MONEY_SUFFIX) or text.startswith(("$", "-$")):
        as_money = money(text)
        if as_money is not None:
            return as_money
    as_date = iso_date(text)
    return as_date if as_date is not None else text


def agree(field: str, first: Any, second: Any) -> bool:
    return normalise(field, first) == normalise(field, second)

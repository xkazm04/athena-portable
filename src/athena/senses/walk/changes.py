"""The vague-change validator: a change order that cannot be signed says why (spike 04, F4).

A remodel's change is agreed out loud on site ("bigger tile, small upcharge") and billed later. The
homeowner's rule is that nothing is signed until it is a change: a price that is a number, the days
it adds, and the quote line it amends. :func:`vague_change` is that rule, pure and deterministic, so
no model ever decides whether a change is signable; :func:`change_checks` turns it into the
``change_checks`` table the bench's Athena reads beside the change orders themselves.

Field names are the world's: ``price_usd`` (or ``amount_usd``), ``days`` (or ``delta_days``) and
``quote_line``. A value the person typed as words ("small upcharge", "as needed") is present but not
a number, which is its own reason: it is the most common vague change of all.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any

#: The world table the validator reads, and the table it writes.
CHANGE_TABLE = "change_orders"
CHECK_TABLE = "change_checks"

PRICE_KEYS = ("price_usd", "amount_usd")
DAYS_KEYS = ("days", "delta_days")
ID_KEYS = ("change_id", "co")

NO_PRICE = "no price"
PRICE_NOT_NUMBER = "price not a number"
NO_DAYS = "no days"
DAYS_NOT_NUMBER = "days not a number"
NO_QUOTE_LINE = "no quote line"

#: Every reason :func:`vague_change` can give, in the order it gives them.
REASONS = (NO_PRICE, PRICE_NOT_NUMBER, NO_DAYS, DAYS_NOT_NUMBER, NO_QUOTE_LINE)


def _first(change: Mapping[str, Any], keys: tuple[str, ...]) -> Any:
    for key in keys:
        if key in change:
            return change[key]
    return None


def _absent(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def _number(value: Any) -> bool:
    """A JSON number, finite; a bool is not one and neither is a string of digits."""
    return isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)


def vague_change(change: Mapping[str, Any]) -> list[str]:
    """The reasons ``change`` cannot be signed, from :data:`REASONS`; empty when it can.

    Days must also be zero or more (a change cannot give days back); a price may be negative,
    because a credit is a change too.
    """
    reasons: list[str] = []
    price = _first(change, PRICE_KEYS)
    if _absent(price):
        reasons.append(NO_PRICE)
    elif not _number(price):
        reasons.append(PRICE_NOT_NUMBER)
    days = _first(change, DAYS_KEYS)
    if _absent(days):
        reasons.append(NO_DAYS)
    elif not _number(days) or float(days) < 0:
        reasons.append(DAYS_NOT_NUMBER)
    if _absent(change.get("quote_line")):
        reasons.append(NO_QUOTE_LINE)
    return reasons


def change_checks(world: Mapping[str, Any]) -> list[dict[str, Any]]:
    """One ``change_checks`` row per row of the world's :data:`CHANGE_TABLE`, in its order.

    The row cites the world row it judged in ``media_id`` (``world:change_orders/<id>``): the
    check is sensed from the record, not from a camera, and says so rather than leave it blank.
    """
    tables = world.get("tables", {})
    rows = tables.get(CHANGE_TABLE, []) if isinstance(tables, Mapping) else []
    out: list[dict[str, Any]] = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, Mapping):
            continue
        change_id = str(_first(row, ID_KEYS) or "")
        reasons = vague_change(row)
        out.append(
            {
                "change_id": change_id,
                "signable": not reasons,
                "reasons": reasons,
                "media_id": f"world:{CHANGE_TABLE}/{change_id}",
            }
        )
    return out

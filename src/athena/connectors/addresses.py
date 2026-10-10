"""One item of ``to`` or ``cc`` is exactly one address (README §4; ADR 0061).

The egress gate and the Gmail provider both read a recipient through :func:`one_address`, so the
address that was checked is the address that is sent. A value that parses to more than one
address, to none, or that the parse does not account for whole is never split and partly sent.
"""

from __future__ import annotations

import re
from email.utils import getaddresses

__all__ = ["one_address", "refusal_reason"]

_ADDRESS = re.compile(r"[^\s<>,;:\"()\[\]\@]+@[^\s<>,;:\"()\[\]\@]+")


def one_address(value: str) -> str | None:
    """The lower-cased bare address of ``value``, or ``None`` unless it is exactly one."""
    if "\r" in value or "\n" in value:
        return None
    pairs = getaddresses([value])
    if len(pairs) != 1:
        return None
    address = pairs[0][1].strip()
    if not _ADDRESS.fullmatch(address) or address.lower() not in value.lower():
        return None
    return address.lower()


def refusal_reason(value: str) -> str:
    """The sentence a model can act on, naming the value."""
    return f"{value!r} is not exactly one address; send one address per item of to and cc"

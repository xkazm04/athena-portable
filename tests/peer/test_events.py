"""The loopback /events bus says what it carries (ADR 0140, "Data & API").

athena/peer/events.py - the module's own account of its kinds, checked against every kind the tree
actually publishes on it, so a new publisher cannot leave the doc a reader trusts behind.
"""

from __future__ import annotations

import re
from pathlib import Path

import athena
from athena.daemon import sleep
from athena.peer import events

SRC = Path(athena.__file__).resolve().parent

#: ``publish("<kind>"``, ``_publish(`` or ``publish(\n    "<kind>"`` - every caller's spelling.
PUBLISH = re.compile(r"""publish\(\s*["']([a-z]+\.[a-z_.]+)["']""")


def published_kinds() -> set[str]:
    kinds: set[str] = set()
    for path in SRC.rglob("*.py"):
        kinds.update(PUBLISH.findall(path.read_text(encoding="utf-8")))
    # sleep.py publishes through a named constant rather than a literal.
    kinds.add(sleep.CHANGED)
    return kinds


def test_the_scan_finds_the_publishers_it_is_meant_to() -> None:
    kinds = published_kinds()
    # One of each spelling: a literal on one line, a literal on the next line, and the constant.
    assert {"peer.changed", "pair.opened", "remote.message", "sleep.changed"} <= kinds


def test_the_bus_doc_names_every_kind_published_on_it() -> None:
    doc = events.__doc__ or ""
    missing = sorted(kind for kind in published_kinds() if f"``{kind}``" not in doc)
    assert missing == []


def test_the_bus_doc_says_which_payload_carries_a_claim_nonce() -> None:
    # ``pair.opened`` carries the phone's QR address, whose fragment is the window's nonce; the
    # doc may not promise that no payload does.
    doc = " ".join((events.__doc__ or "").split())
    assert "No payload carries a token, a nonce or a claim secret." not in doc
    assert "``pair.opened``" in doc and "nonce" in doc

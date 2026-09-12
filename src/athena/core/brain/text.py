"""The small text rules the brain shares with the Personas writer (ref §8).

Four of them, and each is a parity contract rather than a preference: an excerpt is cut at 500
**bytes** on a character boundary, a filename slug is ascii-folded, a machine-written episode is
recognised by its leading marker, and an FTS5 match string has every term quoted so a user's
question can never be read as query operators.
"""

from __future__ import annotations

import re
import unicodedata

#: An episode whose body starts with one of these was written by a machine, not said by a person
#: (ref §8). They land at importance 1 and are kept out of the recency window, so a burst of
#: fleet chatter never reads back as conversation.
MACHINE_MARKERS: tuple[str, ...] = ("fleet-event ", "fleet-orchestration ")

#: Bytes, not characters: the index column mirrors what the Rust writer stores.
EXCERPT_BYTES = 500

_SLUG_STRIP = re.compile(r"[^a-z0-9]+")


def excerpt(text: str) -> str:
    """At most :data:`EXCERPT_BYTES` of UTF-8, cut on a character boundary."""
    raw = text.encode("utf-8")
    if len(raw) <= EXCERPT_BYTES:
        return text
    return raw[:EXCERPT_BYTES].decode("utf-8", errors="ignore")


def is_machine(body: str) -> bool:
    return body.startswith(MACHINE_MARKERS)


def slug(text: str, limit: int = 48) -> str:
    """A filename slug: ascii-folded, lowercase, hyphen-joined, never empty."""
    folded = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    out = _SLUG_STRIP.sub("-", folded.lower()).strip("-")
    return out[:limit].rstrip("-") or "untitled"


def fts_quote(term: str) -> str:
    return '"' + term.replace('"', '""') + '"'


def fts_match(query: str) -> str:
    """Every term quoted, so ``NOT`` or ``*`` in a user's question is a word and not an operator.

    Returns ``""`` for a query with no terms; the keyword lane reads that as "no query" and
    returns nothing rather than matching everything.
    """
    return " ".join(fts_quote(term) for term in query.split() if term.strip())

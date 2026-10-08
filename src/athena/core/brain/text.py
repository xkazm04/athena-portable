"""The small text rules the brain shares with the Personas writer (ref §8).

Four of them, and each is a parity contract rather than a preference: an excerpt is cut at 500
**bytes** on a character boundary, a filename slug is ascii-folded, a machine-written episode is
recognised by its leading marker, and an FTS5 match string has every term quoted so a user's
question can never be read as query operators (the terms joined by ``OR``, ADR 0042).
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


#: Words too common to say what a recall is about. Dropped before matching, because with any-term
#: matching (ADR 0042) "the" would bring back every episode.
STOPWORDS: frozenset[str] = frozenset(
    {
        "the",
        "and",
        "for",
        "with",
        "that",
        "this",
        "from",
        "what",
        "have",
        "has",
        "are",
        "was",
        "were",
        "you",
        "your",
        "any",
        "all",
        "about",
        "into",
        "than",
        "then",
        "them",
        "they",
        "their",
        "there",
        "here",
        "been",
        "will",
        "would",
        "could",
        "should",
        "which",
        "when",
        "where",
        "who",
        "how",
        "why",
        "can",
        "did",
        "does",
        "our",
        "out",
        "also",
        "just",
        "its",
        "it's",
        "i'm",
        "i've",
        "we're",
    }
)


def fts_terms(query: str) -> list[str]:
    """The words of ``query`` a match is made of: short words and :data:`STOPWORDS` dropped, unless
    nothing else is left."""
    terms = [term for term in query.split() if term.strip()]
    meaningful = [t for t in terms if len(t) > 2 and t.lower().strip("?.,!:;") not in STOPWORDS]
    return meaningful or terms


def fts_match(query: str) -> str:
    """Every term quoted, so ``NOT`` or ``*`` in a user's question is a word and not an operator.

    The terms are joined with ``OR`` and BM25 ranks what matches more of them first (ADR 0042): a
    question in a person's words names more things than any one memory holds, and an implicit
    ``AND`` of all of them matched nothing. Words of one or two letters and :data:`STOPWORDS` are
    dropped; a query of nothing but those keeps its words, so it is still a query.

    Returns ``""`` for a query with no terms; the keyword lane reads that as "no query" and
    returns nothing rather than matching everything.
    """
    return " OR ".join(fts_quote(term) for term in fts_terms(query))

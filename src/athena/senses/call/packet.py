"""Packet binding (spike 02, F3/F4): an appeal packet's cited sentences, hashed for the gate.

A packet is the ordered list of sentences an appeal says, each ``{"text": str, "cites": [str]}``
where a cite is a call turn (``"<media_id>#<n>"``, a ``call_turns`` row) or a read sheet field
(``"<sheet_id>.<field>"``, a ``sheet_fields`` row). :func:`packet_sha256` is the hash a chore's
``file_appeal`` takes as its ``packet_sha256`` param, so the caregiver's approval is bound to the
exact packet she was shown: alter one byte of a sentence after signing and the hash, and with it
the approval, no longer matches (ADR 0038's single-use approval does the refusing).

**Canonical form, stated once.** Sentences keep their order (a reordered letter is a different
letter) and their text byte for byte (no trimming: a changed space is a change). Cites are a set:
sorted and de-duplicated, because the order a writer listed sources in says nothing. The JSON is
``sort_keys``, no whitespace, UTF-8 unescaped; keys other than ``text`` and ``cites`` are dropped,
so a display hint on a draft cannot move its hash.

:func:`unsupported` is the F3 rule: a sentence with no cite, or with a cite that resolves to no
kept row, has no source, and any such sentence blocks signing.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Collection, Mapping, Sequence
from typing import Any

__all__ = ["canonical_packet", "packet_sha256", "unsupported"]


def canonical_packet(sentences: Sequence[Mapping[str, Any]]) -> str:
    """The canonical JSON :func:`packet_sha256` hashes; a malformed sentence is a ValueError."""
    out: list[dict[str, Any]] = []
    for i, sentence in enumerate(sentences):
        text = sentence.get("text")
        cites = sentence.get("cites", [])
        if not isinstance(text, str):
            raise ValueError(f"sentence {i}: text must be a string")
        if not isinstance(cites, list | tuple) or not all(isinstance(c, str) for c in cites):
            raise ValueError(f"sentence {i}: cites must be a list of strings")
        out.append({"cites": sorted(set(cites)), "text": text})
    return json.dumps(out, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def packet_sha256(sentences: Sequence[Mapping[str, Any]]) -> str:
    """Lower-case hex SHA-256 of :func:`canonical_packet`. Pure: same sentences, same hash."""
    return hashlib.sha256(canonical_packet(sentences).encode("utf-8")).hexdigest()


def unsupported(sentences: Sequence[Mapping[str, Any]], resolvable: Collection[str]) -> list[int]:
    """Indexes of the sentences with no source: no cite at all, or a cite not in ``resolvable``."""
    found: list[int] = []
    for i, sentence in enumerate(sentences):
        cites = [str(c) for c in sentence.get("cites", []) or []]
        if not cites or any(c not in resolvable for c in cites):
            found.append(i)
    return found

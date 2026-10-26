"""Spike 03 (Roll Call), the merge: many sightings of a thing become one line per possession.

A sighting is one segmented instance in one photo, named by the reader. The merge keys on the
room and the **normalised label** (:func:`normalise`: case, punctuation, inch marks and word order
do not split a sofa in two), and a key's sightings are one possession **however far apart they
are**: a car photographed in 2023 and again in 2025 is one car. A silence is not evidence of a
second item, and a split it caused would be a duplicate claim, the worse error (README F3: misses
are preferred over duplicates); the gap is surfaced instead as ``first_seen`` / ``last_seen``,
which the bench reads to ask whether a thing was still there. ``max_gap_days`` exists to measure
that trade (a 730-day gap split 3 of 30 lines on the Roll Call fixtures), not as a default.

The count is the most instances of the key seen **together in one photo** (two lamps in a 2023
frame are two lamps, however many photos show one), never the sum across photos, which would
double-claim. Nothing here merges two different rooms or two different labels, so a moved
armchair stays two lines for the person to join, not one guessed.

ADR 0303 records these rules.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date

from athena.senses.contract import Box

#: Words a reader adds or drops without naming a different thing.
_STOPWORDS = frozenset({"a", "an", "the", "and", "with", "of", "in"})

_INCH = re.compile(r"(\d+(?:\.\d+)?)\s*(?:\"|''|”|-?\s*inch(?:es)?\b|-?\s*in\b)", re.IGNORECASE)
_NON_WORD = re.compile(r"[^a-z0-9]+")


def normalise(label: str) -> str:
    """A label as the merge compares it: lower case, ``55"``/``55-inch``/``55 in`` -> ``55in``,
    punctuation dropped, stopwords dropped, the remaining words sorted and de-duplicated."""
    text = _INCH.sub(lambda m: f" {m.group(1)}in ", label.lower())
    words = {w for w in _NON_WORD.split(text) if w and w not in _STOPWORDS}
    return " ".join(sorted(words))


@dataclass(frozen=True)
class Sighting:
    """One named instance in one photo. ``people`` is how many people that photo held (their
    boxes are never kept: only the count travels)."""

    media_id: str
    taken: str
    room: str
    concept: str
    label: str
    track_id: str
    box: Box
    score: float
    brand: str | None = None
    people: int = 0


@dataclass(frozen=True)
class Possession:
    """One merged line, before it is numbered: its sightings in date order and its count."""

    room: str
    key: str
    sightings: tuple[Sighting, ...]
    count: int

    @property
    def label(self) -> str:
        return _most_common([s.label for s in self.sightings]) or self.sightings[0].label

    @property
    def brand(self) -> str | None:
        return _most_common([s.brand for s in self.sightings if s.brand])

    @property
    def photos(self) -> list[str]:
        return list(dict.fromkeys(s.media_id for s in self.sightings))

    @property
    def first_seen(self) -> str:
        return self.sightings[0].taken

    @property
    def last_seen(self) -> str:
        return self.sightings[-1].taken

    def best(self) -> Sighting:
        """The photo a line cites first: one without people when there is one, then the
        highest segment score, then the latest."""
        return max(self.sightings, key=lambda s: (s.people == 0, s.score, s.taken, s.media_id))


def _most_common(values: Sequence[str | None]) -> str | None:
    present = [v for v in values if v]
    if not present:
        return None
    counts = Counter(present)
    top = max(counts.values())
    return next(v for v in present if counts[v] == top)


def _days(a: str, b: str) -> int:
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def merge(sightings: Iterable[Sighting], max_gap_days: int | None = None) -> list[Possession]:
    """Every possession the sightings prove, ordered by room, first seen, then label.

    ``max_gap_days`` splits a key's sightings at a longer silence; ``None`` (the build's choice,
    ADR 0303) never splits."""
    groups: dict[tuple[str, str], list[Sighting]] = {}
    for s in sightings:
        groups.setdefault((s.room, normalise(s.label)), []).append(s)
    out: list[Possession] = []
    for (room, key), group in groups.items():
        group.sort(key=lambda s: (s.taken, s.media_id, s.track_id))
        runs: list[list[Sighting]] = [[group[0]]]
        for s in group[1:]:
            if max_gap_days is not None and _days(runs[-1][-1].taken, s.taken) > max_gap_days:
                runs.append([])
            runs[-1].append(s)
        for run in runs:
            together = Counter(s.media_id for s in run)
            out.append(Possession(room, key, tuple(run), max(together.values())))
    out.sort(key=lambda p: (p.room, p.first_seen, p.key))
    return out

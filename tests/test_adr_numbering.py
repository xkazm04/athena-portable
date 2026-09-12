"""Every decision gets one number, and no number gets two decisions (ADR 0001).

``docs/adr/`` is allocated by filename, which is a counter two authors can read at the same
instant and answer the same way. It has happened twice: the bridge's two ADRs arrived as 0008 and
0009 against a tree that already held them, and the connectors ADR arrived as 0021 beside a
hirelane one. Both were renumbered by hand after the fact, and in between the number in a
citation pointed at two documents.

Nothing else in the build reads this directory, so nothing else can notice. This test is the
reader: it checks that the numbers are unique, that they run from 0001 with no gap, and that each
file's first heading repeats the number in its own name. A collision then fails the gate in the
session that made it, which is the only session that still knows which decision it meant.
"""

from __future__ import annotations

import re
from pathlib import Path

ADR_DIR = Path(__file__).resolve().parents[1] / "docs" / "adr"

#: `NNNN-slug.md`, the one filename shape this directory has.
_FILENAME = re.compile(r"^(\d{4})-[a-z0-9-]+\.md$")

#: `# NNNN. Title`, the first line of every ADR.
_HEADING = re.compile(r"^# (\d{4})\. \S")


def _adrs() -> list[Path]:
    return sorted(p for p in ADR_DIR.iterdir() if p.is_file() and p.suffix == ".md")


def test_every_file_in_the_directory_is_a_numbered_adr() -> None:
    unnamed = [p.name for p in _adrs() if not _FILENAME.match(p.name)]
    assert unnamed == [], f"not `NNNN-slug.md`: {unnamed}"


def test_no_two_decisions_share_a_number() -> None:
    seen: dict[str, list[str]] = {}
    for path in _adrs():
        match = _FILENAME.match(path.name)
        assert match is not None
        seen.setdefault(match.group(1), []).append(path.name)

    collisions = {number: names for number, names in seen.items() if len(names) > 1}
    assert collisions == {}, (
        "two ADRs claim one number, which breaks every citation of it; "
        f"renumber the later one to the next free number: {collisions}"
    )


def test_the_numbers_run_from_one_with_no_gap() -> None:
    numbers = sorted(int(_FILENAME.match(p.name).group(1)) for p in _adrs())  # type: ignore[union-attr]
    assert numbers == list(range(1, len(numbers) + 1)), f"not a run from 1: {numbers}"


def test_each_adr_repeats_its_own_number_in_its_heading() -> None:
    wrong: list[str] = []
    for path in _adrs():
        name = _FILENAME.match(path.name)
        assert name is not None
        first = path.read_text(encoding="utf-8").splitlines()[0]
        heading = _HEADING.match(first)
        if heading is None or heading.group(1) != name.group(1):
            wrong.append(f"{path.name}: {first!r}")
    assert wrong == [], f"heading does not match the filename's number: {wrong}"

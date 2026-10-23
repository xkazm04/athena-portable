"""The chores UAT cast: every chore has two Characters of its own audience (uat/README, Chores UAT).

The Character files in ``uat/characters/chores/`` are read with the repo's own frontmatter parser
and loader (:mod:`athena.proving.characters.persona`), the same ones the LC run uses, so a file
these tests accept is a file the simulator can play. ``uat/chores/pairs.json`` is the cast list:
two distinct Characters per playbook, each of the playbook's audience, and of its category unless
the row says why a neighbour stands in (``reuse_note``).
"""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

import pytest

from athena.proving.characters.persona import load_persona, parse_frontmatter

REPO = Path(__file__).resolve().parents[2]
CAST = REPO / "uat" / "characters" / "chores"
PAIRS = REPO / "uat" / "chores" / "pairs.json"
PLAYBOOKS = REPO / "playbooks"

#: The original LC Characters; a chores Character must not reuse their ids.
LC_IDS = {"ana", "jonas", "juror", "mira", "priya"}
AUDIENCES = {"home", "work"}
CHARACTER_FILES = sorted(CAST.glob("*.md"))


def _meta(path: Path) -> dict[str, Any]:
    meta, _body = parse_frontmatter(path.read_text(encoding="utf-8"))
    return meta


def _playbooks() -> dict[str, dict[str, Any]]:
    found: dict[str, dict[str, Any]] = {}
    for path in sorted(PLAYBOOKS.glob("*/playbook.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        found[str(data["id"])] = data
    return found


def _categories() -> set[str]:
    taxonomy = json.loads((PLAYBOOKS / "taxonomy.json").read_text(encoding="utf-8"))
    return {str(c["id"]) for c in taxonomy["categories"]}


def _pairs() -> list[dict[str, Any]]:
    data = json.loads(PAIRS.read_text(encoding="utf-8"))
    assert data["schema"] == 1
    rows = data["pairs"]
    assert isinstance(rows, list)
    return rows


def _cast() -> dict[str, dict[str, Any]]:
    return {str(_meta(path)["id"]): _meta(path) for path in CHARACTER_FILES}


def test_there_is_a_cast() -> None:
    assert len(CHARACTER_FILES) >= 20


@pytest.mark.parametrize("path", CHARACTER_FILES, ids=lambda p: p.stem)
def test_each_character_parses_and_carries_its_judgement(path: Path) -> None:
    persona = load_persona(path)
    meta = _meta(path)
    assert persona.id == path.stem
    assert persona.id not in LC_IDS
    assert re.fullmatch(r"[a-z][a-z0-9-]*", persona.id)
    assert persona.name and persona.role and persona.senior_bar and persona.chore
    assert persona.journeys == ("J7", "J8")
    assert isinstance(persona.manual_minutes, int) and persona.manual_minutes > 0
    motivation = meta["motivation"]
    assert isinstance(motivation, dict) and isinstance(motivation.get("with_app_minutes"), int)
    assert meta.get("audience") in AUDIENCES
    segments = meta.get("segments")
    assert isinstance(segments, list) and segments
    assert set(segments) <= _categories()
    assert meta.get("tech_comfort") in {"low", "medium"}
    # The criteria score the run and are not played, so they are not on the simulator's card.
    assert "Scored acceptance criteria" not in persona.card

    body = path.read_text(encoding="utf-8")
    section = re.split(r"^## Scored acceptance criteria\s*$", body, flags=re.MULTILINE)
    assert len(section) == 2, "one '## Scored acceptance criteria' section"
    criteria = re.split(r"^## ", section[1], flags=re.MULTILINE)[0]
    numbered = re.findall(r"^(\d+)\.\s+\S", criteria, flags=re.MULTILINE)
    assert 5 <= len(numbered) <= 7
    assert numbered == [str(n) for n in range(1, len(numbered) + 1)]


def test_pairs_cover_every_playbook_twice_with_distinct_characters() -> None:
    rows = _pairs()
    playbooks = _playbooks()
    assert len(rows) == 2 * len(playbooks) == 190
    per_playbook = Counter(r["playbook_id"] for r in rows)
    assert set(per_playbook) == set(playbooks)
    assert set(per_playbook.values()) == {2}
    for pid in playbooks:
        cast = [r["character"] for r in rows if r["playbook_id"] == pid]
        assert len(set(cast)) == 2, pid
    assert len({r["id"] for r in rows}) == len(rows)
    assert rows == sorted(rows, key=lambda r: (r["playbook_id"], r["character"]))


def test_each_pair_fits_its_playbook() -> None:
    cast = _cast()
    playbooks = _playbooks()
    for row in _pairs():
        assert set(row) == {"id", "playbook_id", "character", "audience", "category", "reuse_note"}
        playbook = playbooks[row["playbook_id"]]
        character = cast[row["character"]]
        assert row["id"] == f"{row['playbook_id']}--{row['character']}"
        assert row["audience"] == playbook["audience"] == character["audience"], row["id"]
        assert row["category"] == playbook["category"], row["id"]
        note = row["reuse_note"]
        if row["category"] not in character["segments"]:
            assert isinstance(note, str) and note.strip(), f"{row['id']} needs a reuse_note"
        else:
            assert note is None, f"{row['id']} is in segment and needs no reuse_note"


def test_every_character_is_used_and_every_used_character_exists() -> None:
    used = {r["character"] for r in _pairs()}
    assert used == set(_cast())

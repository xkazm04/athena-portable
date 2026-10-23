"""uat chores (spark chores-uat): the cast — pairs, chores Characters and case cards, validated.

Three files, written by the cast builder, read here and nowhere else:

- ``uat/chores/pairs.json`` — ``{"schema": 1, "pairs": [{id, playbook_id, character, audience,
  category, reuse_note}]}``; ``id`` is ``<playbook_id>--<character>``.
- ``uat/characters/chores/<id>.md`` — a Character (frontmatter ``id, role, audience, segments,
  tech_comfort, journeys, motivation, senior_bar``; a body ending in ``## Scored acceptance
  criteria``, a numbered list). The simulated person is given the body WITHOUT the criteria
  (:attr:`Character.card`); the judge is given the criteria too (:attr:`Character.criteria`).
- ``uat/chores/cases/<pair-id>.json`` — the Character's concrete case for one chore
  (:func:`check_case`).

A file that breaks its contract fails loudly with :class:`CastError`, naming the file and the row.
"""

from __future__ import annotations

import json
import re
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from athena.proving.characters.persona import Persona, load_persona, parse_frontmatter

__all__ = [
    "AUDIENCES",
    "CASES_DIRNAME",
    "CHARACTERS_DIRNAME",
    "FACTS_RANGE",
    "PAIRS_FILENAME",
    "TECH_COMFORT",
    "UNKNOWNS_RANGE",
    "CastError",
    "Character",
    "Pair",
    "case_path",
    "check_case",
    "load_case",
    "load_character",
    "load_characters",
    "load_pairs",
    "parse_criteria",
]

#: Where the cast lives under the ``uat/`` overlay.
PAIRS_FILENAME = "chores/pairs.json"
CHARACTERS_DIRNAME = "characters/chores"
CASES_DIRNAME = "chores/cases"

AUDIENCES: tuple[str, ...] = ("home", "work")
TECH_COMFORT: tuple[str, ...] = ("low", "medium")
#: How many facts and unknowns a case card holds (inclusive).
FACTS_RANGE = (6, 12)
UNKNOWNS_RANGE = (2, 5)

_CRITERIA_HEADING = re.compile(r"^##\s+Scored acceptance criteria\s*$", re.MULTILINE)
_NUMBERED = re.compile(r"^\s*(\d+)\.\s+(.*\S)\s*$")
_PAIR_KEYS = ("id", "playbook_id", "character", "audience", "category", "reuse_note")


class CastError(ValueError):
    """A cast file breaks its contract; the message names the file and the row."""


# --- characters --------------------------------------------------------------------------------


@dataclass(frozen=True)
class Character:
    """One chores Character: the persona the simulator plays, and what the judge scores by."""

    id: str
    name: str
    persona: Persona
    audience: str
    segments: tuple[str, ...]
    tech_comfort: str
    #: The full body, criteria included (the judge's card).
    body: str
    #: The scored acceptance criteria, in order (criterion ``n`` is ``criteria[n - 1]``).
    criteria: tuple[str, ...]
    meta: dict[str, Any] = field(default_factory=dict)

    @property
    def card(self) -> str:
        """The body above the criteria, without the ``# Name`` heading: who the person is."""
        return self.persona.card


def parse_criteria(body: str) -> list[str]:
    """The numbered list under ``## Scored acceptance criteria`` (a wrapped line is joined)."""
    found = _CRITERIA_HEADING.search(body)
    if found is None:
        return []
    out: list[str] = []
    for line in body[found.end() :].splitlines():
        if line.startswith("## "):
            break
        numbered = _NUMBERED.match(line)
        if numbered:
            out.append(numbered.group(2))
        elif line.strip() and out:
            out[-1] = f"{out[-1]} {line.strip()}"
    return out


def load_character(path: str | Path) -> Character:
    """A chores Character, or :class:`CastError` naming what is missing."""
    path = Path(path)
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise CastError(f"{path.as_posix()}: cannot be read ({type(exc).__name__})") from exc
    meta, body = parse_frontmatter(text)
    where = path.as_posix()
    problems: list[str] = []
    cid = str(meta.get("id") or "")
    if not cid:
        problems.append("frontmatter has no id")
    elif cid != path.stem:
        problems.append(f"id {cid!r} is not the file name {path.stem!r}")
    audience = meta.get("audience")
    if audience not in AUDIENCES:
        problems.append(f"audience {audience!r} is not one of {', '.join(AUDIENCES)}")
    comfort = meta.get("tech_comfort")
    if comfort not in TECH_COMFORT:
        problems.append(f"tech_comfort {comfort!r} is not one of {', '.join(TECH_COMFORT)}")
    segments = meta.get("segments")
    if not isinstance(segments, list) or not segments:
        problems.append("segments must be a non-empty [list]")
    if not re.search(r"^#\s+\S", body, re.MULTILINE):
        problems.append("the body has no '# Name' heading")
    criteria = parse_criteria(body)
    if not criteria:
        problems.append("no numbered '## Scored acceptance criteria'")
    if problems:
        raise CastError(f"{where}: " + "; ".join(problems))
    persona = load_persona(path)
    return Character(
        id=cid,
        name=persona.name,
        persona=persona,
        audience=str(audience),
        segments=tuple(str(s) for s in segments) if isinstance(segments, list) else (),
        tech_comfort=str(comfort),
        body=body,
        criteria=tuple(criteria),
        meta=dict(meta),
    )


def load_characters(uat_dir: str | Path, ids: Collection[str] = ()) -> dict[str, Character]:
    """Every chores Character under ``<uat_dir>/characters/chores`` (or the ``ids`` asked for)."""
    folder = Path(uat_dir) / CHARACTERS_DIRNAME
    if not folder.is_dir():
        raise CastError(f"{folder.as_posix()}: no chores Characters directory")
    out: dict[str, Character] = {}
    for path in sorted(folder.glob("*.md")):
        if ids and path.stem not in ids:
            continue
        character = load_character(path)
        out[character.id] = character
    missing = sorted(set(ids) - set(out))
    if missing:
        raise CastError(f"{folder.as_posix()}: no Character named {', '.join(missing)}")
    return out


# --- pairs -------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Pair:
    id: str
    playbook_id: str
    character: str
    audience: str
    category: str
    reuse_note: str | None = None


def load_pairs(
    path: str | Path,
    *,
    categories: Collection[str] | None = None,
    playbooks: Mapping[str, Mapping[str, Any]] | None = None,
    characters: Collection[str] | None = None,
) -> list[Pair]:
    """The pairs file, every row checked; :class:`CastError` names the first bad row.

    ``categories`` (the taxonomy ids), ``playbooks`` (``{id: playbook.json}``) and
    ``characters`` (the Character ids on disk) are checked when given: a pair must name a
    playbook in the library, the playbook's own category, and a Character that exists.
    """
    path = Path(path)
    where = path.as_posix()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise CastError(f"{where}: missing") from exc
    except (OSError, json.JSONDecodeError) as exc:
        raise CastError(f"{where}: not readable JSON ({exc})") from exc
    if not isinstance(raw, dict) or raw.get("schema") != 1:
        raise CastError(f'{where}: must be an object with "schema": 1')
    rows = raw.get("pairs")
    if not isinstance(rows, list) or not rows:
        raise CastError(f'{where}: "pairs" must be a non-empty list')
    out: list[Pair] = []
    seen: set[str] = set()
    for index, row in enumerate(rows):
        name = f"{where} pairs[{index}]"
        if not isinstance(row, dict):
            raise CastError(f"{name}: not an object")
        if isinstance(row.get("id"), str):
            name += f" ({row['id']})"
        missing = [k for k in _PAIR_KEYS if k not in row]
        if missing:
            raise CastError(f"{name}: missing {', '.join(missing)}")
        for key in ("id", "playbook_id", "character", "audience", "category"):
            if not isinstance(row[key], str) or not row[key]:
                raise CastError(f"{name}: {key} must be a non-empty string")
        if row["reuse_note"] is not None and not isinstance(row["reuse_note"], str):
            raise CastError(f"{name}: reuse_note must be null or a string")
        pair = Pair(
            id=row["id"],
            playbook_id=row["playbook_id"],
            character=row["character"],
            audience=row["audience"],
            category=row["category"],
            reuse_note=row["reuse_note"],
        )
        if pair.id != f"{pair.playbook_id}--{pair.character}":
            raise CastError(f"{name}: id must be {pair.playbook_id}--{pair.character}")
        if pair.id in seen:
            raise CastError(f"{name}: duplicate id")
        seen.add(pair.id)
        if pair.audience not in AUDIENCES:
            raise CastError(f"{name}: audience {pair.audience!r} is not home or work")
        if categories is not None and pair.category not in categories:
            raise CastError(f"{name}: category {pair.category!r} is not a taxonomy id")
        if playbooks is not None:
            playbook = playbooks.get(pair.playbook_id)
            if playbook is None:
                raise CastError(f"{name}: no playbook {pair.playbook_id!r} in the library")
            own = playbook.get("category")
            if own != pair.category:
                raise CastError(f"{name}: category {pair.category!r} but the playbook's is {own!r}")
        if characters is not None and pair.character not in characters:
            raise CastError(f"{name}: no Character {pair.character!r}")
        out.append(pair)
    return out


# --- case cards --------------------------------------------------------------------------------


def case_path(uat_dir: str | Path, pair_id: str) -> Path:
    return Path(uat_dir) / CASES_DIRNAME / f"{pair_id}.json"


def _names(playbook: Mapping[str, Any], list_key: str, key: str) -> list[str]:
    rows = playbook.get(list_key)
    rows = rows if isinstance(rows, list) else []
    return [str(r.get(key)) for r in rows if isinstance(r, Mapping) and r.get(key)]


def check_case(
    value: Mapping[str, Any], playbook: Mapping[str, Any], *, body_only: bool = False
) -> str:
    """``""`` when ``value`` is a case card for ``playbook``, else the first problem.

    ``body_only`` checks only what a model writes (no ``pair``/``playbook_id``/``character``/
    ``generated_by``), which is how the case leg's answer is checked before it is stamped.
    """
    if not body_only:
        for key in ("pair", "playbook_id", "character"):
            if not isinstance(value.get(key), str) or not value.get(key):
                return f"{key} must be a non-empty string"
        if value.get("playbook_id") != playbook.get("id"):
            return f"playbook_id {value.get('playbook_id')!r} is not {playbook.get('id')!r}"
        made = value.get("generated_by")
        if not isinstance(made, Mapping) or not made.get("model"):
            return "generated_by must name the model"
    for key in ("person", "stated_up_front"):
        if not isinstance(value.get(key), str) or not str(value.get(key)).strip():
            return f"{key} must be a non-empty string"
    apps = _names(playbook, "apps", "name")
    portals = value.get("portals")
    if not isinstance(portals, list):
        return "portals must be a list"
    named: list[str] = []
    for index, row in enumerate(portals):
        if not isinstance(row, Mapping) or row.get("playbook_app") not in apps:
            return f"portals[{index}].playbook_app must be one of: {'; '.join(apps)}"
        if not isinstance(row.get("mine"), str) or not str(row.get("mine")).strip():
            return f'portals[{index}].mine must be "same" or the app they use'
        named.append(str(row["playbook_app"]))
    left = [a for a in apps if a not in named]
    if left:
        return f"portals must cover every playbook app; missing: {'; '.join(left)}"
    actions = _names(playbook, "gates", "action")
    gates = value.get("gates")
    if not isinstance(gates, list):
        return "gates must be a list"
    covered: list[str] = []
    for index, row in enumerate(gates):
        if not isinstance(row, Mapping) or row.get("action") not in actions:
            return f"gates[{index}].action must be one of: {', '.join(actions)}"
        if row.get("mine") not in ("ask", "go"):
            return f'gates[{index}].mine must be "ask" or "go"'
        covered.append(str(row["action"]))
    left = [a for a in actions if a not in covered]
    if left:
        return f"gates must cover every gated action; missing: {', '.join(left)}"
    facts = value.get("facts")
    low, high = FACTS_RANGE
    if not isinstance(facts, list) or not low <= len(facts) <= high:
        return f"facts must be a list of {low} to {high}"
    for index, row in enumerate(facts):
        if not isinstance(row, Mapping):
            return f"facts[{index}] must be an object"
        for key in ("about", "truth"):
            if not isinstance(row.get(key), str) or not str(row.get(key)).strip():
                return f"facts[{index}].{key} must be a non-empty string"
    unknowns = value.get("unknowns")
    low, high = UNKNOWNS_RANGE
    if not isinstance(unknowns, list) or not low <= len(unknowns) <= high:
        return f"unknowns must be a list of {low} to {high}"
    if not all(isinstance(u, str) and u.strip() for u in unknowns):
        return "unknowns must be non-empty strings"
    return ""


def load_case(path: str | Path, playbook: Mapping[str, Any]) -> dict[str, Any]:
    """A case card, checked against its playbook, or :class:`CastError`."""
    path = Path(path)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise CastError(f"{path.as_posix()}: no case card") from exc
    except (OSError, json.JSONDecodeError) as exc:
        raise CastError(f"{path.as_posix()}: not readable JSON ({exc})") from exc
    if not isinstance(raw, dict):
        raise CastError(f"{path.as_posix()}: not an object")
    problem = check_case(raw, playbook)
    if problem:
        raise CastError(f"{path.as_posix()}: {problem}")
    return raw


def select_pairs(
    pairs: Sequence[Pair],
    *,
    ids: Collection[str] = (),
    areas: Collection[str] = (),
    characters: Collection[str] = (),
    limit: int = 0,
) -> list[Pair]:
    """The pairs a run asked for, in file order."""
    out = [
        p
        for p in pairs
        if (not ids or p.id in ids)
        and (not areas or p.category in areas)
        and (not characters or p.character in characters)
    ]
    unknown = sorted(set(ids) - {p.id for p in pairs})
    if unknown:
        raise CastError(f"no pair named {', '.join(unknown)}")
    return out[:limit] if limit > 0 else out

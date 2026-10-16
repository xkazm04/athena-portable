"""The Adopt studio's wire contract, declared in two languages (ADR 0097).

``src/athena/contracts/adopt.py`` is the authority; ``apps/desktop/src/lib/adopt.ts`` is its port.
Nothing imports across the language boundary, so this test reads the TypeScript as text and
compares the declarations: the event kinds (``ADOPT_EVENT_KINDS`` against ``EVENT_KINDS``, in
order, and each one a member of the ``AdoptEvent`` union), each event's field names, the nested
shapes' field names, the closed vocabularies, and the leg kinds, which the desktop names only on
the wire as ``adopt.usage``'s ``leg``.
"""

from __future__ import annotations

import dataclasses
import re
from pathlib import Path
from typing import Any, get_args

from athena.contracts.adopt import (
    _EVENTS,
    EVENT_KINDS,
    LEG_KINDS,
    Alternate,
    Answer,
    AnswerVia,
    Finding,
    Lane,
    LaneKind,
    LaneStatus,
    LegKind,
    Option,
    Question,
    ShowcaseStatus,
    Slot,
    SlotKind,
    SlotSource,
    SlotStatus,
    Verdict,
)

ADOPT_TS = Path(__file__).resolve().parents[2] / "apps" / "desktop" / "src" / "lib" / "adopt.ts"

_LINE_COMMENT = re.compile(r"//[^\n]*")
_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)
_STRING = re.compile(r'"((?:[^"\\]|\\.)*)"')


def _source() -> str:
    text = ADOPT_TS.read_text(encoding="utf-8")
    return _LINE_COMMENT.sub("", _BLOCK_COMMENT.sub("", text))


def _declaration(pattern: str) -> str:
    match = re.search(pattern, _source(), re.DOTALL)
    assert match is not None, f"{pattern!r} is not declared in adopt.ts"
    return match.group(1)


def test_the_event_kinds_agree_in_order() -> None:
    body = _declaration(r"export const ADOPT_EVENT_KINDS[^=]*=\s*\[(.*?)\];")
    assert tuple(_STRING.findall(body)) == EVENT_KINDS


def test_every_event_kind_is_a_member_of_the_union() -> None:
    union = _declaration(r"export type AdoptEvent\s*=(.*?);\n\nexport")
    kinds = re.findall(r'kind:\s*"([^"]+)"', union)
    assert tuple(kinds) == EVENT_KINDS


def _union_members() -> dict[str, set[str]]:
    """``AdoptEvent``'s members as kind -> the field names the desktop reads off the wire.

    The verdict member is ``({ kind; seq } & Verdict)``, so it takes the interface's fields too.
    """
    union = _declaration(r"export type AdoptEvent\s*=(.*?);\n\nexport")
    members: dict[str, set[str]] = {}
    for match in re.finditer(r"\{([^{}]*)\}(?:\s*&\s*(\w+))?", union):
        kind = re.search(r'kind:\s*"([^"]+)"', match.group(1))
        assert kind is not None, f"a member of AdoptEvent names no kind: {match.group(0)!r}"
        names = set(re.findall(r"(\w+)\??:", match.group(1)))
        if match.group(2):
            names |= _interface(match.group(2))
        members[kind.group(1)] = names
    return members


def _interface(name: str) -> set[str]:
    body = _declaration(rf"export interface {name}\s*\{{(.*?)\n\}}")
    return set(re.findall(r"^\s*(\w+)\??:", body, re.MULTILINE))


def test_every_event_carries_the_same_fields_on_both_sides() -> None:
    """A field added to one side only is the drift a kinds-only check cannot see: the producer
    sends what it knows, the desktop reads what it declared, and the difference is silent."""
    members = _union_members()
    assert len(members) == len(EVENT_KINDS), f"read {len(members)} members, not {len(EVENT_KINDS)}"
    for cls in _EVENTS:
        python = {"kind"} | {f.name for f in dataclasses.fields(cls)}
        assert members[cls.kind] == python, cls.kind


#: The shapes nested inside the events (and the answer the desktop posts back), by name on both
#: sides. ``Verdict`` is the event's payload: the interface is the event minus ``kind`` and ``seq``.
_NESTED: tuple[tuple[str, Any], ...] = (
    ("Slot", Slot),
    ("Option", Option),
    ("Question", Question),
    ("Finding", Finding),
    ("Lane", Lane),
    ("Answer", Answer),
    ("Alternate", Alternate),
    ("Verdict", Verdict),
)


def test_every_nested_shape_names_the_same_fields() -> None:
    for name, cls in _NESTED:
        python = {f.name for f in dataclasses.fields(cls)} - {"seq"}
        assert _interface(name) == python, name


#: The closed vocabularies a slot, a lane, a showcase and an answer are typed with.
_VOCABULARIES: tuple[tuple[str, object], ...] = (
    ("SlotKind", SlotKind),
    ("SlotStatus", SlotStatus),
    ("SlotSource", SlotSource),
    ("LaneKind", LaneKind),
    ("LaneStatus", LaneStatus),
    ("ShowcaseStatus", ShowcaseStatus),
    ("AnswerVia", AnswerVia),
)


def test_every_closed_vocabulary_agrees_in_order() -> None:
    for name, literal in _VOCABULARIES:
        body = _declaration(rf"export type {name}\s*=([^;]*);")
        assert tuple(_STRING.findall(body)) == get_args(literal), name


def test_the_leg_kinds_agree() -> None:
    """``adopt.ts`` names no leg type; the Python literal and its tuple must agree, and if the
    desktop ever declares ``LegKind`` it must be the same set."""
    assert set(LEG_KINDS) == set(LegKind.__args__)  # type: ignore[attr-defined]
    match = re.search(r"export type LegKind\s*=([^;]*);", _source())
    if match is not None:
        assert tuple(_STRING.findall(match.group(1))) == LEG_KINDS

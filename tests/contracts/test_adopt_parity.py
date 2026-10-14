"""The Adopt studio's wire contract, declared in two languages (ADR 0097).

``src/athena/contracts/adopt.py`` is the authority; ``apps/desktop/src/lib/adopt.ts`` is its port.
Nothing imports across the language boundary, so this test reads the TypeScript as text and
compares the declarations: the event kinds (``ADOPT_EVENT_KINDS`` against ``EVENT_KINDS``, in
order, and each one a member of the ``AdoptEvent`` union) and the leg kinds, which the desktop
names only on the wire as ``adopt.usage``'s ``leg``.
"""

from __future__ import annotations

import re
from pathlib import Path

from athena.contracts.adopt import EVENT_KINDS, LEG_KINDS, LegKind

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


def test_the_leg_kinds_agree() -> None:
    """``adopt.ts`` names no leg type; the Python literal and its tuple must agree, and if the
    desktop ever declares ``LegKind`` it must be the same set."""
    assert set(LEG_KINDS) == set(LegKind.__args__)  # type: ignore[attr-defined]
    match = re.search(r"export type LegKind\s*=([^;]*);", _source())
    if match is not None:
        assert tuple(_STRING.findall(match.group(1))) == LEG_KINDS

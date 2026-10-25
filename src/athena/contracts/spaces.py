"""ADR 0225 (projects are walled spaces): the wire shapes of a project, and who may see what.

The person's word is **project**; the code's and the wire's is **space**, because ``proj_`` and
``project_id`` already name a chore's case (``contracts/ids.py``) and a second meaning for the same
word is how a turn ends up in the wrong conversation. A space is a person-written brief that tells
Athena what she is for there, the apps it pairs, and a wall around the memory written inside it.

**Core is the empty string.** Everything outside every space - all the memory that existed before
spaces did - is core, and core is ``""`` everywhere: the index column, the wire's ``space_id``, the
desktop's ``activeId``. Never ``null``, so no reader has two spellings of "nothing" to check for.
:data:`CORE_ITEM` (``"core"``) is only a path segment, where an empty one cannot be written.

**Visibility is one predicate**, :func:`visible_spaces`: inside a space, a turn sees core and that
space; in core it sees core alone. A memory stamped with a space whose file no longer exists is
never active, so it is never visible - the wall fails closed.

Dataclasses and constants only, like every module beside this one: no I/O, nothing that can fail
at import time. The desktop's twin is ``apps/desktop/src/lib/spaces.ts``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

__all__ = [
    "APPS_CAP",
    "BRIEF_CAP",
    "CORE",
    "CORE_ITEM",
    "HUE_MAX",
    "MEMORY_KINDS",
    "MEMORY_LIMIT",
    "MEMORY_LIMIT_MAX",
    "MEMORY_LINE_CAP",
    "NAME_CAP",
    "SPACE_SCHEMA",
    "Space",
    "SpaceCounts",
    "SpaceErased",
    "SpaceFrame",
    "SpaceMemoryKind",
    "SpaceMemoryRow",
    "SpaceSummary",
    "visible_spaces",
]

#: The shape version of a space file's data block. A reader refuses a version it does not know.
SPACE_SCHEMA = 1

#: A space's name, in characters, after its whitespace is folded: 1 to this many.
NAME_CAP = 60
#: The person's brief, in characters. Athena reads it every turn in the space (``frame.space``).
BRIEF_CAP = 1600
#: The most apps one space pairs, each a distinct web origin.
APPS_CAP = 24
#: A hue is ``0..HUE_MAX`` degrees.
HUE_MAX = 359

#: No space: Athena's core. The one spelling of "nothing" (ADR 0225).
CORE = ""
#: Core as a path segment: ``GET /spaces/core/memory``, the desktop's ``projects/core``.
CORE_ITEM = "core"

SpaceMemoryKind = Literal["episode", "fact", "procedural"]
#: The kinds a space's memory page lists, in the order it lists them.
MEMORY_KINDS: tuple[SpaceMemoryKind, ...] = ("episode", "fact", "procedural")
#: ``GET /spaces/<id>/memory``'s ``limit``: the default and the ceiling.
MEMORY_LIMIT = 50
MEMORY_LIMIT_MAX = 200
#: One memory row's ``line``, in characters (the quoted-line helper's cap).
MEMORY_LINE_CAP = 240


def visible_spaces(active: str) -> tuple[str, ...]:
    """The spaces whose memory a turn in ``active`` may see: ``("",)`` in core, else core and it.

    The one place the wall is drawn. ``active`` is a space the caller has already found on disk;
    a stamp naming any other space is outside the answer, so it is never recalled.
    """
    return (CORE,) if active == CORE else (CORE, active)


@dataclass(frozen=True)
class Space:
    """One project, as its file's data block holds it (``spaces/<id>.md``).

    ``id`` is a minted ``spc_`` id. ``apps`` are normalised web origins (``https://host[:port]``),
    unique, in the order the person added them. ``hue`` is the colour the desktop draws it in.
    ``created`` / ``updated`` are ISO 8601 UTC.
    """

    id: str
    name: str
    brief: str = ""
    apps: tuple[str, ...] = ()
    hue: int = 0
    created: str = ""
    updated: str = ""


@dataclass(frozen=True)
class SpaceCounts:
    """What a space holds: its memory by kind, and the chores linked to it."""

    episodes: int = 0
    facts: int = 0
    procedurals: int = 0
    chores: int = 0


@dataclass(frozen=True)
class SpaceSummary:
    """One space on the wire: ``GET /spaces`` rows and every answer that returns a space."""

    id: str
    name: str
    brief: str
    apps: tuple[str, ...]
    hue: int
    created: str
    updated: str
    counts: SpaceCounts = field(default_factory=SpaceCounts)


@dataclass(frozen=True)
class SpaceErased:
    """What ``DELETE /spaces/<id>`` took with it, and how many chores went back to core."""

    id: str
    episodes: int = 0
    facts: int = 0
    procedurals: int = 0
    chores_unlinked: int = 0


@dataclass(frozen=True)
class SpaceMemoryRow:
    """One memory on a space's memory page: its id, kind, one quoted line and when it was made."""

    id: str
    kind: SpaceMemoryKind
    line: str
    created: str


@dataclass(frozen=True)
class SpaceFrame:
    """What one turn in a space is told about it (``frame.space``): the space, and the lines of
    its always-tier facts and procedurals ("Kept for this project"), each already quoted and
    capped as ``memory.always``'s are, with ``kept_total`` the count before the caps."""

    space: Space
    kept: tuple[str, ...] = ()
    kept_total: int = 0

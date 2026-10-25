"""ADR 0225 (projects are walled spaces): what a turn in a space is told about it.

The frame builder asks for this once per turn with the turn's ``space_id`` and hands the answer to
the composer, which renders ``frame.space``. Core (``""``), and a space whose file is gone, answer
``None``: no block, nothing of any project in the prompt. The space is read from disk every turn,
so a brief the person edited between two turns is the brief the next one reads.
"""

from __future__ import annotations

from athena.contracts.spaces import CORE, SpaceFrame
from athena.spaces.book import SpaceBook
from athena.spaces.memory import space_always_lines

__all__ = ["space_frame"]


def space_frame(book: SpaceBook, space_id: str) -> SpaceFrame | None:
    """The space ``space_id`` and its always-tier lines, or ``None`` for core or no such space."""
    if space_id == CORE:
        return None
    space = book.get(space_id)
    if space is None:
        return None
    kept, total = space_always_lines(book.brain, space_id)
    return SpaceFrame(space=space, kept=tuple(kept), kept_total=max(total, len(kept)))

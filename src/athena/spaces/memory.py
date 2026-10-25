"""ADR 0225 (projects are walled spaces): what a space holds of the brain's memory - the seams.

Every question the space routes and the turn frame ask of the memory written inside a space is
asked through one function here, and only here, so the stamp's reader has one home:

- :func:`space_counts` - how many episodes, facts and procedurals carry the space's stamp;
- :func:`space_always_lines` - the space's always-tier facts and procedurals, for ``frame.space``'s
  "Kept for this project";
- :func:`space_memory_page` - one page of the space's memory (``GET /spaces/<id>/memory``);
- :func:`promote_to_core` - a fact or procedural's stamp removed (``POST …/memory/<id>/core``);
- :func:`erase_space_memory` - every stamped memory erased with its space (``DELETE /spaces/<id>``).

**The stamp is the next work package's.** The memory stamp itself - the optional ``space`` key in
an episode's, fact's and procedural's frontmatter, ``companion_node.space`` and its index - lands
with the recall and sleep changes (the projects contract's "Memory stamp"). Until it does, nothing
in the brain carries a space, and each function below answers what that state truthfully is:
zero memories, an empty page, no memory to promote, nothing to erase. Each body is marked
``WP2:`` where the stamped implementation replaces it; the signatures are the seam and stay.
"""

from __future__ import annotations

from athena.contracts.spaces import CORE, SpaceCounts, SpaceMemoryKind, SpaceMemoryRow
from athena.core.brain.store import Brain

__all__ = [
    "erase_space_memory",
    "promote_to_core",
    "space_always_lines",
    "space_counts",
    "space_memory_page",
]


def space_counts(brain: Brain, space_id: str, *, chores: int = 0) -> SpaceCounts:
    """The space's counts: its stamped episodes, facts and procedurals, and ``chores``, the cases
    the caller found linked to it (it reads the case files once for every space it lists).

    ``space_id`` may be :data:`~athena.contracts.spaces.CORE` for core's own counts.
    """
    del brain, space_id  # WP2: count companion_node rows WHERE space = ? GROUP BY kind.
    return SpaceCounts(episodes=0, facts=0, procedurals=0, chores=chores)


def space_always_lines(brain: Brain, space_id: str) -> tuple[tuple[str, ...], int]:
    """The space's always-tier facts and procedurals as ``frame.space`` renders them, and how many
    there were before the caps: each line already through ``core.recall.memory_line`` (quoted,
    neutralised, cut at ``ALWAYS_LINE_CAP``), ranked and capped as ``memory.always`` is
    (``ALWAYS_FACTS`` / ``ALWAYS_PROCEDURALS``). Core has none of its own here: core's always tier
    is the static ``memory.always`` block."""
    if space_id == CORE:
        return (), 0
    del brain  # WP2: the always lane over space = ? alone, rendered through memory_line.
    return (), 0


def space_memory_page(
    brain: Brain, space_id: str, kind: SpaceMemoryKind | None, limit: int
) -> tuple[list[SpaceMemoryRow], int]:
    """One page of the memory stamped with ``space_id`` (``CORE`` for core's), newest first, of
    ``kind`` or every kind, at most ``limit`` rows; and the total it was cut from."""
    del brain, space_id, kind, limit  # WP2: companion_node WHERE space = ? [AND kind = ?].
    return [], 0


def promote_to_core(brain: Brain, space_id: str, memory_id: str) -> SpaceMemoryKind | None:
    """Remove ``space_id``'s stamp from the fact or procedural ``memory_id``, so it is core's from
    now on; its kind, or ``None`` when no such memory carries that stamp. The caller has already
    refused an episode id: an episode is a record of what was said where, and stays where it was."""
    del brain, space_id, memory_id  # WP2: rewrite the file without `space`, reindex the row.
    return None


def erase_space_memory(brain: Brain, space_id: str) -> tuple[int, int, int]:
    """Erase every memory stamped with ``space_id`` - its file, its index rows (fts, fact,
    procedural, provenance) and the sleep proposals stamped with it - and answer how many
    ``(episodes, facts, procedurals)`` went. Called before the space file is removed."""
    del brain, space_id  # WP2: the erase the contract's "Erase deletes" paragraph describes.
    return 0, 0, 0

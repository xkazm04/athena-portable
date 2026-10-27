"""ADR 0225 (projects are walled spaces): what a space holds of the brain's memory.

Every question the space routes and the turn frame ask of the memory written inside a space is
asked through one function here, and only here, so the stamp's reader has one home:

- :func:`space_counts` - how many episodes, facts and procedurals carry the space's stamp;
- :func:`space_always_lines` - the space's always-tier facts and procedurals, for ``frame.space``'s
  "Kept for this project";
- :func:`space_memory_page` - one page of the space's memory (``GET /spaces/<id>/memory``);
- :func:`promote_to_core` - a fact or procedural's stamp removed (``POST …/memory/<id>/core``);
- :func:`erase_space_memory` - every stamped memory erased with its space (``DELETE /spaces/<id>``).

**The stamp is the brain's.** A memory's space is the ``space:`` key its writer put in its file
(:data:`~athena.core.brain.store.SPACE_KEY`) and the ``companion_node.space`` column a rebuild
derives from it; core is ``""``. The reads here count and list by that column through the
``companion_node_by_space (space, kind)`` index. The two acts - promote and erase - are the
brain's own (:meth:`Brain.unstamp`, :meth:`Brain.erase_space`), because both rewrite or remove
files and must hold its write lock; this module only asks them and shapes the answer.

**What the counts and the page count.** Every memory the stamp names, live or not: a demoted or
retired one is still on disk, still in the space, and still goes when the space is erased, so the
person sees exactly what an erase will take.
"""

from __future__ import annotations

from contextlib import closing

from athena.contracts.spaces import (
    CORE,
    MEMORY_KINDS,
    MEMORY_LINE_CAP,
    SpaceCounts,
    SpaceMemoryKind,
    SpaceMemoryRow,
)
from athena.core.brain.store import Brain
from athena.core.recall import memory_line, space_always

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

    ``space_id`` may be :data:`~athena.contracts.spaces.CORE` for core's own counts. One indexed
    ``COUNT`` grouped by kind.
    """
    marks = ",".join("?" for _ in MEMORY_KINDS)
    with closing(brain.read_connection()) as con:
        rows = con.execute(
            f"""SELECT kind, COUNT(*) FROM companion_node
                WHERE space = ? AND kind IN ({marks}) GROUP BY kind""",
            (space_id, *MEMORY_KINDS),
        ).fetchall()
    found = {str(kind): int(count) for kind, count in rows}
    return SpaceCounts(
        episodes=found.get("episode", 0),
        facts=found.get("fact", 0),
        procedurals=found.get("procedural", 0),
        chores=chores,
    )


def space_always_lines(brain: Brain, space_id: str) -> tuple[tuple[str, ...], int]:
    """The space's always-tier facts and procedurals as ``frame.space`` renders them, and how many
    there were before the caps: each line already through ``core.recall.memory_line`` (quoted,
    neutralised, cut at ``ALWAYS_LINE_CAP``), ranked and capped as ``memory.always`` is
    (``ALWAYS_FACTS`` / ``ALWAYS_PROCEDURALS``). Core has none of its own here: core's always tier
    is the static ``memory.always`` block."""
    if space_id == CORE:
        return (), 0
    lines, total = space_always(brain, space_id)
    return tuple(lines), total


def space_memory_page(
    brain: Brain, space_id: str, kind: SpaceMemoryKind | None, limit: int
) -> tuple[list[SpaceMemoryRow], int]:
    """One page of the memory stamped with ``space_id`` (``CORE`` for core's), newest first, of
    ``kind`` or every kind, at most ``limit`` rows; and the total it was cut from.

    Each row's ``line`` is the memory's body through the quoted-line helper at
    :data:`~athena.contracts.spaces.MEMORY_LINE_CAP`: one line, fence markers redacted, cut with an
    ellipsis and written as a JSON string - an episode's words are untrusted, and the page puts
    them in front of a person and nowhere else, so they arrive inert. The body is the FTS row's
    (the whole memory), the stored excerpt only where there is none.
    """
    kinds: tuple[str, ...] = (kind,) if kind is not None else MEMORY_KINDS
    marks = ",".join("?" for _ in kinds)
    where = f"n.space = ? AND n.kind IN ({marks})"
    with closing(brain.read_connection()) as con:
        ((total,),) = con.execute(
            f"SELECT COUNT(*) FROM companion_node n WHERE {where}", (space_id, *kinds)
        ).fetchall()
        rows = con.execute(
            f"""SELECT n.id, n.kind, COALESCE(f.body, n.body_excerpt), n.created_at
                FROM companion_node n LEFT JOIN companion_fts f ON f.rowid = n.rowid
                WHERE {where}
                ORDER BY n.created_at DESC, n.id DESC LIMIT ?""",
            (space_id, *kinds, max(0, limit)),
        ).fetchall()
    page = [
        SpaceMemoryRow(
            id=str(node_id),
            kind=_kind(str(found)),
            line=_line(str(body or "")),
            created=str(created or ""),
        )
        for node_id, found, body, created in rows
    ]
    return page, int(total)


def promote_to_core(brain: Brain, space_id: str, memory_id: str) -> SpaceMemoryKind | None:
    """Remove ``space_id``'s stamp from the fact or procedural ``memory_id``, so it is core's from
    now on; its kind, or ``None`` when no such memory carries that stamp. The caller has already
    refused an episode id: an episode is a record of what was said where, and stays where it was.
    Raises :class:`~athena.core.brain.UnstampRefused` for a closed or retired memory.
    """
    if space_id == CORE:
        return None
    moved = brain.unstamp(memory_id, space_id)
    return None if moved is None else _kind(moved)


def erase_space_memory(brain: Brain, space_id: str) -> tuple[int, int, int]:
    """Erase every memory stamped with ``space_id`` - its file, its index rows (fts, fact,
    procedural, provenance, supersedence, use and fade) and the sleep proposals stamped with it -
    and answer how many ``(episodes, facts, procedurals)`` went. Called before the space file is
    removed.

    A core memory that cites an erased episode keeps the citation, as ADR 0225 says. That is what
    the brain already does with a citation to a missing episode: recall never reads provenance, so
    the memory is recalled as before; a rebuild writes the citation back from the file without
    re-running the write gate (``reconcile.index_file``); and only a *new* write must cite live,
    visible episodes, so a forget marker for it cites whichever of its sources are still live.
    """
    if space_id == CORE:
        return 0, 0, 0
    counts = brain.erase_space(space_id)
    return counts["episode"], counts["fact"], counts["procedural"]


def _line(body: str) -> str:
    """``body`` through the quoted-line helper, at most :data:`MEMORY_LINE_CAP` characters with
    its quotes and escapes counted: the helper cuts the text, and JSON then adds two quotes and
    doubles a quote or a backslash, so the cut is taken in again by what the encoding added."""
    cap = MEMORY_LINE_CAP - 2
    line = memory_line(body, cap)
    while len(line) > MEMORY_LINE_CAP and cap > 1:
        cap -= len(line) - MEMORY_LINE_CAP
        line = memory_line(body, max(1, cap))
    return line


def _kind(value: str) -> SpaceMemoryKind:
    """A stored kind as the wire's literal. The queries ask only for these three."""
    for kind in MEMORY_KINDS:
        if kind == value:
            return kind
    raise ValueError(f"not a memory kind: {value!r}")  # pragma: no cover - the WHERE says so

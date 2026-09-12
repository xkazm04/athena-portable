"""Recall: three blocks, each bounded and each announcing its own M (README §2 invariant 4).

Three populations answer three different questions, so they are three blocks and never one list:

- **always** — the distilled memories that are true whatever was asked. A fact at importance
  :data:`ALWAYS_IMPORTANCE_FLOOR` or above is in the prompt every turn, up to a cap. This is the
  tier act 4 of the demo depends on: the fact Athena wrote about the late-paying client reaches
  the next day's turn without anyone querying for it.
- **keyword** — BM25 over FTS5 across the distilled memories the always tier did not already
  include. Query-driven, and empty when the query matches nothing. An empty lane is the answer;
  padding it with whatever ranked next would be a lie the model cannot detect.
- **episodes** — the last :data:`EPISODE_WINDOW` turns, relevance first and then a recency tail,
  oldest first so the block reads as conversation.

**Each block carries its own N of M.** :meth:`RecallBlock.footer` counts the population that
block drew from, not the size of the brain: an always block that says ``(showing 8 of 41)`` is
telling the reader that 41 memories qualified for the always tier, not that the brain holds 41
things. One global M over a union of populations is a number no block is bounded by, and a reader
who trusts it is being misled about all three. The blocks do not overlap — the keyword lane
excludes what the always tier already showed, and excludes it from its own M too — so nothing is
counted twice and nothing is printed twice.

Nothing here writes. The whole function runs on one :meth:`Brain.read_connection` handle, so it is
safe to call from a daemon read route while a turn is writing (README §3.5, ADR 0003).
"""

from __future__ import annotations

import sqlite3
from contextlib import closing
from dataclasses import dataclass, field
from typing import Any

from athena.contracts.harness import PromptBlock
from athena.core.brain.store import Brain
from athena.core.brain.text import fts_match

#: A fact or procedural at this importance or above is in every prompt, query or no query.
ALWAYS_IMPORTANCE_FLOOR = 4
#: Caps on the always tier. Two numbers, not one, so a flood of facts cannot crowd out the rules.
ALWAYS_FACTS = 8
ALWAYS_PROCEDURALS = 6

#: The episode window is a budget, not a quota: relevant turns keep their slots and a recency
#: tail fills whatever is left.
EPISODE_WINDOW = 20
#: How many query-driven slots the distilled block gets.
KEYWORD_SLOTS = 6
#: Machine-written episodes may take at most this many of the window's relevance slots (ref §8);
#: the recency tail excludes them entirely, so a load test never reads back as conversation.
MACHINE_EPISODE_SLOTS = 2

#: The kinds the keyword lane and the always tier draw from — everything except episodes, which
#: have a window of their own.
DISTILLED_KINDS: tuple[str, ...] = ("fact", "procedural")

#: Block names, in the order a prompt renders them.
ALWAYS_BLOCK = "always"
KEYWORD_BLOCK = "keyword"
EPISODE_BLOCK = "episodes"


@dataclass(frozen=True)
class Memory:
    """One recalled memory and the lane that produced it."""

    id: str
    kind: str
    excerpt: str
    path: str
    lane: str
    score: float = 0.0
    created_at: str = ""
    machine: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "excerpt": self.excerpt,
            "path": self.path,
            "lane": self.lane,
            "score": self.score,
            "created_at": self.created_at,
            "machine": self.machine,
        }

    def render(self) -> str:
        marker = "[machine] " if self.machine else ""
        return f"- {marker}{self.excerpt}"


@dataclass(frozen=True)
class RecallBlock:
    """One block of the bundle: what was shown, and how large the population it came from was.

    ``total`` is this block's own population with its ``LIMIT`` removed — the honest M. It is
    never the size of the brain and never the size of another block.
    """

    name: str
    items: tuple[Memory, ...]
    total: int

    @property
    def shown(self) -> int:
        return len(self.items)

    @property
    def truncated(self) -> bool:
        return self.shown < self.total

    def footer(self) -> str:
        """``(showing N of M)`` for this block, always — an untruncated block says so too."""
        return f"(showing {self.shown} of {self.total})"

    def render(self) -> str:
        lines = [memory.render() for memory in self.items]
        return "\n".join([*lines, self.footer()])

    def as_prompt_block(self, *, untrusted: bool = False) -> PromptBlock:
        """This block as a composable :class:`PromptBlock`, footer included.

        ``shown`` and ``total`` ride along, so the truncation hook can check the block's honesty
        against the numbers rather than against the text.
        """
        return PromptBlock(
            name=f"recall.{self.name}",
            text=self.render(),
            shown=self.shown,
            total=self.total,
            untrusted=untrusted,
        )


@dataclass
class RecallTrace:
    """What recall consulted, block by block.

    This becomes the preview a surface renders before the model answers, which is why it keeps
    the blocks rather than a flat list: the user should see that eight of forty-one always-facts
    were included, not a single number over a union of populations that nothing is bounded by.
    """

    query: str
    blocks: tuple[RecallBlock, ...] = ()
    notes: list[str] = field(default_factory=list)

    @property
    def items(self) -> list[Memory]:
        """Every memory, in block order. The blocks do not overlap, so this has no duplicates."""
        return [memory for block in self.blocks for memory in block.items]

    @property
    def shown(self) -> int:
        return sum(block.shown for block in self.blocks)

    @property
    def lanes(self) -> list[str]:
        """The blocks that actually produced something — what the preview badges."""
        return [block.name for block in self.blocks if block.shown]

    @property
    def totals(self) -> dict[str, int]:
        """Each block's own population, by name."""
        return {block.name: block.total for block in self.blocks}

    def block(self, name: str) -> RecallBlock:
        for block in self.blocks:
            if block.name == name:
                return block
        raise KeyError(f"no recall block named {name!r}; blocks: {[b.name for b in self.blocks]}")

    def footer(self) -> str:
        """One ``(showing N of M)`` line per block. There is deliberately no global M."""
        return "\n".join(f"{block.name}: {block.footer()}" for block in self.blocks)

    def as_prompt_blocks(self) -> list[PromptBlock]:
        """The blocks, ready to compose. Episode bodies are untrusted text and say so."""
        return [
            block.as_prompt_block(untrusted=block.name == EPISODE_BLOCK) for block in self.blocks
        ]

    def as_dict(self) -> dict[str, Any]:
        return {
            "query": self.query,
            "blocks": [
                {
                    "name": block.name,
                    "shown": block.shown,
                    "total": block.total,
                    "items": [memory.as_dict() for memory in block.items],
                }
                for block in self.blocks
            ],
            "notes": list(self.notes),
        }


def recall(
    brain: Brain,
    query: str,
    *,
    episode_budget: int = EPISODE_WINDOW,
    keyword_slots: int = KEYWORD_SLOTS,
    include_always: bool = True,
) -> RecallTrace:
    """Build the bundle for one turn. Read-only, on one per-call handle."""
    with closing(brain.read_connection()) as con:
        always = _always_block(con) if include_always else RecallBlock(ALWAYS_BLOCK, (), 0)
        shown_ids = {memory.id for memory in always.items}
        keyword = _keyword_block(con, query, keyword_slots, shown_ids)
        episodes = _episode_block(con, query, episode_budget)
    trace = RecallTrace(query=query, blocks=(always, keyword, episodes))
    if not keyword.total:
        trace.notes.append("no distilled memory matched the query")
    return trace


# -- the lanes ---------------------------------------------------------------------------------


def _rows(con: sqlite3.Connection, sql: str, params: tuple[Any, ...]) -> list[tuple[Any, ...]]:
    """Run a read. A malformed FTS MATCH is the caller's query, not a crash: empty is honest."""
    try:
        return [tuple(row) for row in con.execute(sql, params).fetchall()]
    except sqlite3.OperationalError:
        return []


def _count(con: sqlite3.Connection, sql: str, params: tuple[Any, ...]) -> int:
    rows = _rows(con, sql, params)
    return int(rows[0][0]) if rows else 0


_NODE_SELECT = """SELECT n.id, n.kind, n.body_excerpt, n.file_path, n.created_at, n.machine"""


def _memory(row: tuple[Any, ...], lane: str, score: float = 0.0) -> Memory:
    return Memory(
        id=str(row[0]),
        kind=str(row[1]),
        excerpt=str(row[2] or ""),
        path=str(row[3] or ""),
        lane=lane,
        score=score,
        created_at=str(row[4] or ""),
        machine=bool(row[5]),
    )


def _always_block(con: sqlite3.Connection) -> RecallBlock:
    """The query-independent tier: high-importance facts and rules, each capped on its own."""
    marks = ",".join("?" for _ in DISTILLED_KINDS)
    total = _count(
        con,
        f"""SELECT COUNT(*) FROM companion_node
            WHERE importance >= ? AND kind IN ({marks})""",
        (ALWAYS_IMPORTANCE_FLOOR, *DISTILLED_KINDS),
    )
    items: list[Memory] = []
    for kind, cap in (("fact", ALWAYS_FACTS), ("procedural", ALWAYS_PROCEDURALS)):
        items.extend(
            _memory(row, ALWAYS_BLOCK, score=float(row[6]))
            for row in _rows(
                con,
                f"""{_NODE_SELECT}, n.importance FROM companion_node n
                    WHERE n.importance >= ? AND n.kind = ?
                    ORDER BY n.importance DESC, n.created_at DESC LIMIT ?""",
                (ALWAYS_IMPORTANCE_FLOOR, kind, cap),
            )
        )
    return RecallBlock(ALWAYS_BLOCK, tuple(items), total)


def _keyword_block(
    con: sqlite3.Connection, query: str, slots: int, exclude: set[str]
) -> RecallBlock:
    """BM25 over the distilled memories the always tier did not already show.

    ``exclude`` is subtracted from the population as well as from the results, so this block's M
    is "matches you have not already read above" and not a number the block could never reach.
    """
    match = fts_match(query)
    if not match or slots <= 0:
        return RecallBlock(KEYWORD_BLOCK, (), 0)
    kind_marks = ",".join("?" for _ in DISTILLED_KINDS)
    # ``NOT IN (NULL)`` is NULL and would filter out everything, so an empty exclusion set
    # becomes a value no id can equal rather than a NULL.
    skip_marks = ",".join("?" for _ in exclude) or "''"
    params = (match, *DISTILLED_KINDS, *sorted(exclude))
    total = _count(
        con,
        f"""SELECT COUNT(*) FROM companion_fts f JOIN companion_node n ON n.id = f.node_id
            WHERE companion_fts MATCH ? AND n.importance > 0 AND n.kind IN ({kind_marks})
              AND n.id NOT IN ({skip_marks})""",
        params,
    )
    rows = _rows(
        con,
        f"""{_NODE_SELECT}, bm25(companion_fts)
            FROM companion_fts f JOIN companion_node n ON n.id = f.node_id
            WHERE companion_fts MATCH ? AND n.importance > 0 AND n.kind IN ({kind_marks})
              AND n.id NOT IN ({skip_marks})
            ORDER BY bm25(companion_fts) ASC LIMIT ?""",
        (*params, slots),
    )
    return RecallBlock(
        KEYWORD_BLOCK, tuple(_memory(row, KEYWORD_BLOCK, float(row[6])) for row in rows), total
    )


def _episode_block(con: sqlite3.Connection, query: str, budget: int) -> RecallBlock:
    """The turn window: relevance first, then a recency tail, rendered oldest first."""
    total = _count(
        con, "SELECT COUNT(*) FROM companion_node WHERE kind = 'episode' AND importance > 0", ()
    )
    if budget <= 0:
        return RecallBlock(EPISODE_BLOCK, (), total)

    chosen: dict[str, Memory] = {}
    match = fts_match(query)
    if match:
        machine_taken = 0
        for row in _rows(
            con,
            f"""{_NODE_SELECT}, bm25(companion_fts)
                FROM companion_fts f JOIN companion_node n ON n.id = f.node_id
                WHERE companion_fts MATCH ? AND n.kind = 'episode' AND n.importance > 0
                ORDER BY bm25(companion_fts) ASC LIMIT ?""",
            (match, budget * 2),
        ):
            if len(chosen) >= budget:
                break
            memory = _memory(row, KEYWORD_BLOCK, float(row[6]))
            if memory.machine:
                if machine_taken >= MACHINE_EPISODE_SLOTS:
                    continue
                machine_taken += 1
            chosen[memory.id] = memory

    remaining = budget - len(chosen)
    if remaining > 0:
        for row in _rows(
            con,
            f"""{_NODE_SELECT} FROM companion_node n
                WHERE n.kind = 'episode' AND n.importance > 0 AND n.machine = 0
                ORDER BY n.created_at DESC, n.id DESC LIMIT ?""",
            (remaining + len(chosen),),
        ):
            if len(chosen) >= budget:
                break
            memory = _memory(row, "recency")
            if memory.id not in chosen:
                chosen[memory.id] = memory

    window = sorted(chosen.values(), key=lambda memory: (memory.created_at, memory.id))
    return RecallBlock(EPISODE_BLOCK, tuple(window), total)

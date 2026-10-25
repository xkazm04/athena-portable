"""Recall: three blocks, each bounded and each announcing its own M (README §2 invariant 4).

Three populations answer three different questions, so they are three blocks and never one list:

- **always** — the distilled memories that are true whatever was asked. A fact at importance
  :data:`ALWAYS_IMPORTANCE_FLOOR` or above is in the prompt every turn, up to a cap. This is the
  tier act 4 of the demo depends on: the fact Athena wrote about the late-paying client reaches
  the next day's turn without anyone querying for it. The product's way in is a ``core.write_fact``
  card the user approved with ``every_turn: true``, which the file records so a rebuild keeps it
  (ADR 0071). The block is static and unfenced, so each memory renders as one capped, quoted line.
- **keyword** — BM25 over FTS5 across the distilled memories the always tier did not already
  include. Query-driven, and empty when the query matches nothing. An empty lane is the answer;
  padding it with whatever ranked next would be a lie the model cannot detect. Its block is not
  fenced either, so a fact or procedural here is the same one quoted line (ADR 0075).
- **episodes** — the last :data:`EPISODE_WINDOW` turns, relevance first and then a recency tail,
  oldest first so the block reads as conversation. A relevant episode longer than an excerpt is
  shown as the excerpt-sized window around its match, not its first 500 bytes (ADR 0042).

**Each block carries its own N of M.** :meth:`RecallBlock.footer` counts the population that
block drew from, not the size of the brain: an always block that says ``(showing 8 of 41)`` is
telling the reader that 41 memories qualified for the always tier, not that the brain holds 41
things. One global M over a union of populations is a number no block is bounded by, and a reader
who trusts it is being misled about all three. The blocks do not overlap — the keyword lane
excludes what the always tier already showed, and excludes it from its own M too — so nothing is
counted twice and nothing is printed twice.

The read runs on one :meth:`Brain.read_connection` handle, so it is safe to call from a daemon
read route while a turn is writing (README §3.5, ADR 0003). The one write comes after the handle is
closed: the distilled memories a recall showed are marked as used (:meth:`Brain.note_recalled`),
which is what keeps them from fading. It never waits long and never fails a recall.

**What the sleep cycle closed or faded** (ADR 0143). A memory another one supersedes is never
served - its successor is - and a retired one is at importance 0, so both lanes already pass it
by. A faded memory is still served: both distilled lanes rank by the value model
(:mod:`athena.core.brain.value`: match x confidence x decay of its fade steps x a bounded use
bonus), so it sinks below the memories in use, and one step of fade never costs a best match more
than the gap to a bare one - a fade ranks, it never hides.

**A store that cannot be read says so** (ADR 0076). The first ``sqlite3.Error`` ends the recall:
no further statement runs, every block is empty and renders ``memory could not be read: ...``
instead of a footer, and the trace is marked :attr:`RecallTrace.unavailable`. Reading a lock or a
missing table as "nothing matched" would tell the model memory is empty when it is missing.
"""

from __future__ import annotations

import json
import logging
import re
import sqlite3
from contextlib import closing
from dataclasses import dataclass, field
from typing import Any

from athena.contracts.harness import PromptBlock
from athena.core import fence
from athena.core.brain import value
from athena.core.brain.store import ALWAYS_IMPORTANCE, Brain
from athena.core.brain.text import EXCERPT_BYTES, excerpt, fts_match, fts_terms
from athena.core.catalog import canonical_line, neutralise_text

#: A fact or procedural at this importance or above is in every prompt, query or no query. It is
#: the importance an approved ``every_turn`` fact is written and rebuilt at (ADR 0071).
ALWAYS_IMPORTANCE_FLOOR = ALWAYS_IMPORTANCE
#: Caps on the always tier. Two numbers, not one, so a flood of facts cannot crowd out the rules.
ALWAYS_FACTS = 8
ALWAYS_PROCEDURALS = 6
#: Characters of one always-tier line, the ellipsis included (ADR 0071). Fourteen lines at this
#: cap, every character one JSON must escape, still fit the block's 12,000-character budget.
ALWAYS_LINE_CAP = 400

#: Characters of one keyword-lane line, the ellipsis included (ADR 0075). A stored excerpt is at
#: most this many bytes already, so the cap only bounds the line; six lines of it at worst still
#: fit the frame's 12,000-character budget.
KEYWORD_LINE_CAP = EXCERPT_BYTES

#: The episode window is a budget, not a quota: relevant turns keep their slots and a recency
#: tail fills whatever is left.
EPISODE_WINDOW = 20
#: The mark at a cut end of a window onto a longer episode.
ELLIPSIS = " … "
#: How many query-driven slots the distilled block gets.
KEYWORD_SLOTS = 6
#: Machine-written episodes may take at most this many of the window's relevance slots (ref §8);
#: the recency tail excludes them entirely, so a load test never reads back as conversation.
MACHINE_EPISODE_SLOTS = 2

#: The kinds the keyword lane and the always tier draw from — everything except episodes, which
#: have a window of their own.
DISTILLED_KINDS: tuple[str, ...] = ("fact", "procedural")

#: The SQL that keeps a superseded memory out of a lane (ADR 0143), for ``n`` a ``companion_node``.
NOT_SUPERSEDED = "n.id NOT IN (SELECT superseded_id FROM companion_supersede)"
#: The joins that bring a distilled ``n`` its value-model axes (:mod:`athena.core.brain.value`):
#: fade steps (``fd``), the stored confidence of a fact (``cf``) or procedural (``cp``), and hits.
VALUE_JOINS = """LEFT JOIN companion_fade fd ON fd.node_id = n.id
    LEFT JOIN companion_fact cf ON cf.id = n.id
    LEFT JOIN companion_procedural cp ON cp.id = n.id
    LEFT JOIN companion_recall_seen rs ON rs.node_id = n.id"""
#: Those axes as columns, in :func:`_value` order: confidence (NULL when unknown), steps, hits.
VALUE_COLUMNS = (
    "COALESCE(cf.confidence, cp.confidence), COALESCE(fd.steps, 0), COALESCE(rs.hits, 0)"
)
#: Fade steps the always tier's SQL pre-rank spells out; the sleep cycle fades to at most 3.
_PRERANK_STEPS = 8

#: What every block of a recall that could not read the store says, before SQLite's own message.
UNAVAILABLE_PREFIX = "memory could not be read: "
#: The note of a recall whose keyword lane matched nothing; ``core.recall`` renders it last.
NO_DISTILLED_MATCH = "no distilled memory matched the query"

_log = logging.getLogger(__name__)

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
        """One line of a block. A distilled memory is quoted and neutralised in either lane
        (ADR 0075); an episode renders as it is, because its block is fenced (ADR 0006).

        It branches on ``kind`` and not on ``lane``: a whole recall's episodes ride in lane
        ``keyword`` too, and a fence payload is never edited.
        """
        marker = "[machine] " if self.machine else ""
        if self.kind in DISTILLED_KINDS:
            cap = ALWAYS_LINE_CAP if self.lane == ALWAYS_BLOCK else KEYWORD_LINE_CAP
            return f"- {marker}{memory_line(self.excerpt, cap)}"
        return f"- {self.label()}{marker}{self.excerpt}"

    def role(self) -> str:
        """The role the store recorded, read from the node's file name ``<id>_<role>.md``.

        Never from the body. Empty when the name does not have that shape.
        """
        name = self.path.rsplit("/", 1)[-1]
        prefix = f"{self.id}_"
        if not name.startswith(prefix) or not name.endswith(".md"):
            return ""
        return name[len(prefix) : -len(".md")]

    def label(self) -> str:
        """``[<id> <role>] `` for an episode line (ADR 0079), built only from the store."""
        role = self.role()
        return f"[{self.id} {role}] " if role else f"[{self.id}] "


def memory_line(text: str, cap: int = ALWAYS_LINE_CAP) -> str:
    """One distilled memory as it enters an unfenced block (ADR 0075, after ADR 0071 and 0068).

    Neither memory block is fenced, and a fact the user approved can still carry words a page
    shaped. Three steps, in this order:

    1. :func:`~athena.core.catalog.canonical_line` makes it one line: whitespace runs become one
       space, control and format characters are dropped. This goes first, so a marker split by a
       zero-width character is whole again before anything looks for it.
    2. :func:`~athena.core.fence.neutralise` redacts every fence marker of the default label.
    3. It is cut to ``cap`` characters with an ellipsis and written as a JSON string, which cannot
       start a line, a heading or an ``OP:`` line.

    No nonce, so a block's hash moves only when its memories do.
    """
    swept = fence.neutralise(canonical_line(text))
    return json.dumps(neutralise_text(swept, cap), ensure_ascii=False)


#: The always tier's name for :func:`memory_line` (ADR 0071).
always_line = memory_line


@dataclass(frozen=True)
class RecallBlock:
    """One block of the bundle: what was shown, and how large the population it came from was.

    ``total`` is this block's own population with its ``LIMIT`` removed — the honest M. It is
    never the size of the brain and never the size of another block.
    """

    name: str
    items: tuple[Memory, ...]
    total: int
    #: Set only when the store could not be read: the block renders this line and no footer,
    #: because ``(showing 0 of 0)`` would claim a population nobody counted (ADR 0076).
    note: str = ""

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
        if self.note:
            return self.note
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
    #: ``True`` when the store could not be read, so an empty trace is not an honest "nothing
    #: matched" (ADR 0076). The reason is the one note.
    unavailable: bool = False

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
            "unavailable": self.unavailable,
        }


def recall(
    brain: Brain,
    query: str,
    *,
    episode_budget: int = EPISODE_WINDOW,
    keyword_slots: int = KEYWORD_SLOTS,
    include_always: bool = True,
) -> RecallTrace:
    """Build the bundle for one turn. Read-only, on one per-call handle.

    A store that cannot be read gives :func:`unavailable_trace`, and the turn still runs on it.
    """
    try:
        with closing(brain.read_connection()) as con:
            always = _always_block(con) if include_always else RecallBlock(ALWAYS_BLOCK, (), 0)
            shown_ids = {memory.id for memory in always.items}
            keyword = _keyword_block(con, query, keyword_slots, shown_ids)
            episodes = _episode_block(con, query, episode_budget)
    except sqlite3.Error as exc:
        return unavailable_trace(query, exc, (ALWAYS_BLOCK, KEYWORD_BLOCK, EPISODE_BLOCK))
    trace = RecallTrace(query=query, blocks=(always, keyword, episodes))
    if not keyword.total:
        trace.notes.append(NO_DISTILLED_MATCH)
    _note_seen(brain, trace)
    return trace


def recall_whole(
    brain: Brain,
    query: str,
    *,
    cap: int,
    limit: int | None = None,
    keyword_slots: int = KEYWORD_SLOTS,
) -> RecallTrace:
    """The recall she asks for: matched episodes whole, best first, packed under ``cap`` (ADR 0058).

    The keyword lane of distilled memory comes first, then the episodes the query matches, ranked
    by BM25 with the newer first on a tie, each with its full stored body. There is no always tier
    and no recency tail: the frame's window already carries both. Packing stops before the first
    episode that would pass ``cap``, and the block's M counts every episode that matched. The one
    episode ever left to the gate's cut is one longer than the cap on its own. Machine-written
    episodes take at most :data:`MACHINE_EPISODE_SLOTS` of the answer (ref §8), as in the frame
    window: one past that limit is skipped and packing goes on, so fleet chatter never fills
    ``cap`` ahead of anything she wrote or read, yet M still counts it.

    The read is a page, not every match: at most ``limit`` (or :data:`EPISODE_WINDOW`) episodes a
    person or a page wrote, and at most :data:`MACHINE_EPISODE_SLOTS` machine ones. The cap bounds
    the answer, and the page bounds what is read to build it.
    """
    try:
        with closing(brain.read_connection()) as con:
            keyword = _keyword_block(con, query, keyword_slots, set())
            # The note that nothing distilled matched rides after the blocks, so it is paid for
            # before any episode is packed, as the keyword block is.
            spent = _packed_chars(keyword)
            if not keyword.total:
                spent += _note_chars(NO_DISTILLED_MATCH)
            episodes = _whole_episodes(con, query, cap, limit, spent)
    except sqlite3.Error as exc:
        return unavailable_trace(query, exc, (KEYWORD_BLOCK, EPISODE_BLOCK))
    trace = RecallTrace(query=query, blocks=(keyword, episodes))
    if not keyword.total:
        trace.notes.append(NO_DISTILLED_MATCH)
    _note_seen(brain, trace)
    return trace


def _note_seen(brain: Brain, trace: RecallTrace) -> None:
    """Mark the distilled memories this recall showed as used (ADR 0143), after the read.

    Episodes do not fade, so only facts and procedurals are marked. A mark that cannot be written
    is let go: it is a ranking hint, and the recall it rode on has already been answered. A reader
    that can only read (an index opened for inspection) has nothing to mark with, and marks nothing.
    """
    seen = [memory.id for memory in trace.items if memory.kind in DISTILLED_KINDS]
    note = getattr(brain, "note_recalled", None)
    if seen and callable(note):
        note(seen)


def unavailable_trace(query: str, exc: sqlite3.Error, names: tuple[str, ...]) -> RecallTrace:
    """The trace of a recall the store refused: every block empty and saying why (ADR 0076).

    The message is SQLite's own, made one line and swept of fence markers, because the
    always tier's copy of it goes into the system prompt unfenced.
    Logged once, here, at warning level.
    """
    message = fence.neutralise(canonical_line(str(exc)))
    note = UNAVAILABLE_PREFIX + (message or type(exc).__name__)
    _log.warning("recall: %s", note)
    blocks = tuple(RecallBlock(name, (), 0, note=note) for name in names)
    return RecallTrace(query=query, blocks=blocks, notes=[note], unavailable=True)


def _packed_chars(block: RecallBlock) -> int:
    """What a block costs in the rendered answer: its header, its lines, its footer, a separator."""
    return len("### " + block.name + "\n" + block.render()) + 2


def _note_chars(note: str) -> int:
    """What a note costs in the rendered answer: ``(note)`` and the separator before it."""
    return len(f"({note})") + 2


def _whole_episodes(
    con: sqlite3.Connection, query: str, cap: int, limit: int | None, spent: int
) -> RecallBlock:
    match = _body_match(query)
    if not match:
        return RecallBlock(EPISODE_BLOCK, (), 0)
    where = "companion_fts MATCH ? AND n.kind = 'episode' AND n.importance > 0"
    total = _count(
        con,
        f"""SELECT COUNT(*) FROM companion_fts f JOIN companion_node n ON n.id = f.node_id
            WHERE {where}""",
        (match,),
    )
    # Two pages in one order, then merged in it. The loop below takes at most ``page`` items and
    # skips every machine episode past MACHINE_EPISODE_SLOTS, so no row past either page could
    # ever have been packed: this is the same answer, read in a bounded number of rows.
    page = limit if limit is not None else EPISODE_WINDOW
    rows = [
        row
        for machine, size in ((0, page), (1, MACHINE_EPISODE_SLOTS))
        for row in _rows(
            con,
            f"""SELECT n.id, n.kind, f.body, n.file_path, n.created_at, n.machine,
                    bm25(companion_fts)
                FROM companion_fts f JOIN companion_node n ON n.id = f.node_id
                WHERE {where} AND n.machine = ?
                ORDER BY bm25(companion_fts) ASC, n.created_at DESC, n.id DESC LIMIT ?""",
            (match, machine, size),
        )
    ]
    # ORDER BY bm25 ASC, created_at DESC, id DESC, as three stable sorts from the last key.
    rows.sort(key=lambda row: str(row[0]), reverse=True)
    rows.sort(key=lambda row: str(row[4] or ""), reverse=True)
    rows.sort(key=lambda row: float(row[6]))
    # The header, the worst-case footer and the notes line are reserved before any episode is.
    overhead = len(f"### {EPISODE_BLOCK}\n(showing {total} of {total})") + 2
    room = cap - spent - overhead
    items: list[Memory] = []
    machine_taken = 0
    for row in rows:
        if limit is not None and len(items) >= limit:
            break
        memory = _memory(row[:6], KEYWORD_BLOCK, float(row[6]))
        if memory.machine:
            if machine_taken >= MACHINE_EPISODE_SLOTS:
                continue
            machine_taken += 1
        cost = len(memory.render()) + 1
        if cost > room:
            if not items and spent == 0 and cost + overhead > cap:
                items.append(memory)
            break
        items.append(memory)
        room -= cost
    return RecallBlock(EPISODE_BLOCK, tuple(items), total)


def around(body: str, query: str) -> str:
    """An excerpt's worth of ``body``, centred on the first word of ``query`` it contains.

    A short body is itself. A long one is the :data:`EXCERPT_BYTES` window around its first match
    (ADR 0042), with :data:`ELLIPSIS` where it was cut — so the row a person asked about is shown
    even when it sits past the head of a page of results. No match in the body (the index can
    match a stem the text spells differently), or no query at all, gives the head, and the head of
    a long body is marked where it was cut like any other window: an unmarked head read as the
    whole turn.
    """
    if len(body.encode("utf-8")) <= EXCERPT_BYTES:
        return body
    hits = [
        m.start() for t in fts_terms(query) if (m := re.search(re.escape(t), body, re.IGNORECASE))
    ]
    start = max(0, min(hits) - EXCERPT_BYTES // 4) if hits else 0
    window = excerpt(body[start:])
    head = ELLIPSIS.lstrip() + " " if start > 0 else ""
    tail = ELLIPSIS.rstrip() if start + len(window) < len(body) else ""
    return f"{head}{window}{tail}"


# -- the lanes ---------------------------------------------------------------------------------


def _body_match(query: str) -> str:
    """:func:`~athena.core.brain.text.fts_match`, held to the ``body`` column.

    ``companion_fts`` also indexes ``tags``: ``session:<id> role:<role>`` on every episode and the
    kind on every fact and procedural. Unfiltered, the word "user" in a question matched every
    turn the user typed and "fact" matched every fact, so a lane padded itself with rows that
    said nothing asked for and counted them in its M. Empty for a query with no terms.
    """
    match = fts_match(query)
    return f"body : ({match})" if match else ""


def _rows(con: sqlite3.Connection, sql: str, params: tuple[Any, ...]) -> list[tuple[Any, ...]]:
    """Run a read. An error is not caught here: it ends the recall (ADR 0076).

    Every MATCH is built from quoted terms with control characters dropped
    (:func:`~athena.core.brain.text.fts_match`), so a user's query cannot make one malformed. What
    is left is the store itself: a lock, a missing table, an I/O error. Read as no rows, those
    told the model nothing matched, and a lock cost one busy timeout per statement.
    """
    return [tuple(row) for row in con.execute(sql, params).fetchall()]


def _count(con: sqlite3.Connection, sql: str, params: tuple[Any, ...]) -> int:
    rows = _rows(con, sql, params)
    return int(rows[0][0]) if rows else 0


#: A distilled row with its whole body (``f`` is its FTS row), for :func:`_cut` to window. The
#: stored ``body_excerpt`` is 500 bytes with no mark, and a line under its cap showed that cut as
#: the whole memory; the excerpt stands in only where no FTS row exists.
_BODY_SELECT = """SELECT n.id, n.kind, COALESCE(f.body, n.body_excerpt), n.file_path, n.created_at,
    n.machine"""


def _cut(row: tuple[Any, ...]) -> tuple[Any, ...]:
    """``row`` with its body cut to an excerpt's worth, marked where it was cut (:func:`around`)."""
    return (row[0], row[1], around(str(row[2] or ""), ""), *row[3:])


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


def _value(row: tuple[Any, ...], at: int, match: float = 1.0) -> float:
    """The value-model score of a distilled row whose :data:`VALUE_COLUMNS` start at ``at``."""
    confidence = row[at]
    return value.score(
        match=match,
        confidence=None if confidence is None else float(confidence),
        steps=int(row[at + 1] or 0),
        hits=int(row[at + 2] or 0),
        kind=str(row[1]),
    )


def _prerank(kind: str) -> str:
    """The value model with ``match = 1`` and no use bonus, as SQL, to pick a bounded page.

    Built from :func:`~athena.core.brain.value.decay` and the default confidence, so it is the
    same model and not a second one; the use bonus (at most ``1 + USAGE_MAX_BONUS``) is applied
    when the page is re-ranked.
    """
    arms = " ".join(f"WHEN {s} THEN {value.decay(s, kind)!r}" for s in range(1, _PRERANK_STEPS))
    last = value.decay(_PRERANK_STEPS, kind)
    fade = f"CASE MAX(COALESCE(fd.steps, 0), 0) WHEN 0 THEN 1.0 {arms} ELSE {last!r} END"
    trust = f"COALESCE(cf.confidence, cp.confidence, {value.DEFAULT_CONFIDENCE!r})"
    return f"({trust} * {fade})"


def _always_block(con: sqlite3.Connection) -> RecallBlock:
    """The query-independent tier: high-importance facts and rules, each capped on its own.

    Each kind reads a page of ``cap * CANDIDATE_FACTOR`` rows by the model's SQL pre-rank and
    re-ranks it with :func:`~athena.core.brain.value.score` (``match = 1``), newer first on a tie.
    """
    marks = ",".join("?" for _ in DISTILLED_KINDS)
    total = _count(
        con,
        f"""SELECT COUNT(*) FROM companion_node n
            WHERE n.importance >= ? AND n.kind IN ({marks}) AND {NOT_SUPERSEDED}""",
        (ALWAYS_IMPORTANCE_FLOOR, *DISTILLED_KINDS),
    )
    items: list[Memory] = []
    for kind, cap in (("fact", ALWAYS_FACTS), ("procedural", ALWAYS_PROCEDURALS)):
        rows = _rows(
            con,
            f"""{_BODY_SELECT}, n.importance, {VALUE_COLUMNS}
                FROM companion_node n LEFT JOIN companion_fts f ON f.rowid = n.rowid
                {VALUE_JOINS}
                WHERE n.importance >= ? AND n.kind = ? AND {NOT_SUPERSEDED}
                ORDER BY {_prerank(kind)} DESC, n.created_at DESC, n.id DESC LIMIT ?""",
            (ALWAYS_IMPORTANCE_FLOOR, kind, cap * value.CANDIDATE_FACTOR),
        )
        # Stable: rows the model values equally keep the page's newer-first order.
        rows.sort(key=lambda row: -_value(row, 7))
        items.extend(_memory(_cut(row), ALWAYS_BLOCK, score=float(row[6])) for row in rows[:cap])
    return RecallBlock(ALWAYS_BLOCK, tuple(items), total)


def _keyword_block(
    con: sqlite3.Connection, query: str, slots: int, exclude: set[str]
) -> RecallBlock:
    """BM25 over the distilled memories the always tier did not already show.

    ``exclude`` is subtracted from the population as well as from the results, so this block's M
    is "matches you have not already read above" and not a number the block could never reach.

    One candidate page of ``slots * CANDIDATE_FACTOR`` rows is read by BM25 and re-ranked by
    :func:`~athena.core.brain.value.score`, its match strength taken against the page's best row.
    Fade is one axis of that score, not a bucket ahead of the match, so unfaded memories that
    share one word with the query no longer bury a faded one that answers all of it. Equal values
    keep BM25 order, then newer first.
    """
    match = _body_match(query)
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
              AND n.id NOT IN ({skip_marks}) AND {NOT_SUPERSEDED}""",
        params,
    )
    rows = _rows(
        con,
        f"""{_BODY_SELECT}, bm25(companion_fts), {VALUE_COLUMNS}
            FROM companion_fts f JOIN companion_node n ON n.id = f.node_id
            {VALUE_JOINS}
            WHERE companion_fts MATCH ? AND n.importance > 0 AND n.kind IN ({kind_marks})
              AND n.id NOT IN ({skip_marks}) AND {NOT_SUPERSEDED}
            ORDER BY bm25(companion_fts) ASC, n.created_at DESC, n.id DESC LIMIT ?""",
        (*params, slots * value.CANDIDATE_FACTOR),
    )
    best = float(rows[0][6]) if rows else 0.0
    rows.sort(key=lambda row: -_value(row, 7, value.match_strength(float(row[6]), best)))
    return RecallBlock(
        KEYWORD_BLOCK,
        tuple(_memory(_cut(row), KEYWORD_BLOCK, float(row[6])) for row in rows[:slots]),
        total,
    )


def _episode_block(con: sqlite3.Connection, query: str, budget: int) -> RecallBlock:
    """The turn window: relevance first, then a recency tail, rendered oldest first."""
    total = _count(
        con, "SELECT COUNT(*) FROM companion_node WHERE kind = 'episode' AND importance > 0", ()
    )
    if budget <= 0:
        return RecallBlock(EPISODE_BLOCK, (), total)

    chosen: dict[str, Memory] = {}
    match = _body_match(query)
    if match:
        machine_taken = 0
        # Two pages, as in a whole recall: the turns a person or a page wrote, and at most
        # MACHINE_EPISODE_SLOTS machine ones, merged by rank. One page of ``budget * 2`` let a burst
        # of fleet chatter that outranked them fill the page, and the turn asked about never
        # reached the loop that would have capped the chatter at two.
        rows = [
            row
            for machine, size in ((0, budget), (1, MACHINE_EPISODE_SLOTS))
            for row in _rows(
                con,
                """SELECT n.id, n.kind, f.body, n.file_path, n.created_at, n.machine,
                        bm25(companion_fts)
                    FROM companion_fts f JOIN companion_node n ON n.id = f.node_id
                    WHERE companion_fts MATCH ? AND n.kind = 'episode' AND n.importance > 0
                      AND n.machine = ?
                    ORDER BY bm25(companion_fts) ASC LIMIT ?""",
                (match, machine, size),
            )
        ]
        rows.sort(key=lambda row: float(row[6]))
        # A matched episode shows where it matched (ADR 0042): the head excerpt of a page of
        # results is its first rows, and the row asked about is often further down.
        for row in rows:
            if len(chosen) >= budget:
                break
            memory = _memory(
                (row[0], row[1], around(str(row[2] or ""), query), *row[3:]),
                KEYWORD_BLOCK,
                float(row[6]),
            )
            if memory.machine:
                if machine_taken >= MACHINE_EPISODE_SLOTS:
                    continue
                machine_taken += 1
            chosen[memory.id] = memory

    remaining = budget - len(chosen)
    if remaining > 0:
        # The body, not the stored excerpt, so a turn longer than an excerpt is cut by
        # :func:`around` and marked where it was cut. The FTS row shares its node's rowid
        # (ADR 0077); without one, the excerpt is all there is.
        for row in _rows(
            con,
            """SELECT n.id, n.kind, COALESCE(f.body, n.body_excerpt), n.file_path, n.created_at,
                    n.machine
                FROM companion_node n LEFT JOIN companion_fts f ON f.rowid = n.rowid
                WHERE n.kind = 'episode' AND n.importance > 0 AND n.machine = 0
                ORDER BY n.created_at DESC, n.id DESC LIMIT ?""",
            (remaining + len(chosen),),
        ):
            if len(chosen) >= budget:
                break
            memory = _memory(_cut(row), "recency")
            if memory.id not in chosen:
                chosen[memory.id] = memory

    window = sorted(chosen.values(), key=lambda memory: (memory.created_at, memory.id))
    return RecallBlock(EPISODE_BLOCK, tuple(window), total)

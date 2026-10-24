"""The sleep cycle's runtime tables (ADR 0143): cycles, proposals, use and fade.

None of these is derivable from the markdown, so all four are outside ``INDEX_TABLES`` and a
reconcile leaves them alone (``core/brain/schema.py``). Every write takes the brain's writer through
:meth:`Brain.write_txn`; every read opens its own handle, like every other reader of the index.

**A cycle row is honest about a crash.** :meth:`SleepBook.begin` writes ``running`` before any leg
runs, and only :meth:`SleepBook.finish` settles it. A process that dies in between leaves the row
``running`` for good: it is the only evidence the crash happened, and nothing keys admission on it.
The floor and the next boundary read :meth:`SleepBook.last_settled` - the newest ``completed`` or
``partial`` row by ``finished_at`` - and nothing else.

**The proposal queue is hosted work too.** It has a cap (:data:`OPEN_PROPOSALS_CAP` open at once),
an expiry (:data:`PROPOSAL_EXPIRE_D` days), and a reaper (:meth:`SleepBook.sweep`), which also
dismisses an open proposal whose memory is gone - superseded, retired or never indexed - so a
person is never asked about something that is no longer there.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Sequence
from contextlib import closing
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Literal

from athena.contracts import ids
from athena.contracts.channel import iso
from athena.core.brain.store import DEFAULT_IMPORTANCE, Brain
from athena.core.sleep import (
    EXCERPT_CHARS,
    FADE_AFTER_D,
    FADE_BATCH,
    FADE_MAX,
    FORGOTTEN_PREFIX,
    OPEN_PROPOSALS_CAP,
    PROPOSAL_EXPIRE_D,
)

CycleStatus = Literal["running", "completed", "partial", "failed"]
ProposalKind = Literal["forget", "contradiction"]
ProposalStatus = Literal["open", "kept", "forgotten", "dismissed", "expired"]

#: The statuses a cycle settles in that move the boundary and the floor.
SETTLED: tuple[str, ...] = ("completed", "partial")

#: The SQL that keeps a superseded memory out, for ``n`` a ``companion_node`` (as recall has it).
_LIVE = (
    "n.importance > 0 AND n.kind IN ('fact', 'procedural') "
    "AND n.id NOT IN (SELECT superseded_id FROM companion_supersede)"
)

#: Every stats key a cycle reports, each present from the start (zero means counted and none).
STATS_KEYS: tuple[str, ...] = (
    "episodes_in",
    "episodes_available",
    "chars_in",
    "truncated",
    "facts_written",
    "facts_dropped",
    "procedurals_written",
    "procedurals_dropped",
    "duplicates",
    "supersedes",
    "contradictions",
    "faded",
    "forget_proposed",
    "barred",
)


def empty_stats() -> dict[str, Any]:
    """The stats of a cycle that has counted nothing yet: every key, ``truncated`` false."""
    stats: dict[str, Any] = dict.fromkeys(STATS_KEYS, 0)
    stats["truncated"] = False
    return stats


@dataclass(frozen=True)
class CycleRow:
    id: str
    started_at: str
    finished_at: str | None
    status: str
    reason: str | None
    boundary: str | None
    consumed_through: str | None
    stats: dict[str, Any] = field(default_factory=dict)

    def view(self) -> dict[str, Any]:
        """``CycleView`` (``lib/sleep.ts``)."""
        return {
            "id": self.id,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "status": self.status,
            "reason": self.reason,
            "stats": dict(self.stats) if self.stats else None,
        }


@dataclass(frozen=True)
class ProposalRow:
    id: str
    cycle_id: str
    kind: str
    node_ids: list[str]
    summary: str
    status: str
    created_at: str
    decided_at: str | None = None

    def view(self) -> dict[str, Any]:
        """``ProposalView`` (``lib/sleep.ts``)."""
        return {
            "id": self.id,
            "cycle_id": self.cycle_id,
            "kind": self.kind,
            "node_ids": list(self.node_ids),
            "summary": self.summary,
            "status": self.status,
            "created_at": self.created_at,
        }


@dataclass(frozen=True)
class Existing:
    """A live fact or procedural, as the merge leg is shown it: its key and an excerpt."""

    id: str
    kind: str
    key: str
    excerpt: str


_CYCLE_COLUMNS = (
    "id, started_at, finished_at, status, reason, boundary, consumed_through, stats_json"
)
_PROPOSAL_COLUMNS = "id, cycle_id, kind, node_ids_json, summary, status, created_at, decided_at"


def _cycle(row: Sequence[Any]) -> CycleRow:
    try:
        stats = json.loads(str(row[7] or "{}"))
    except json.JSONDecodeError:
        stats = {}
    return CycleRow(
        id=str(row[0]),
        started_at=str(row[1]),
        finished_at=None if row[2] is None else str(row[2]),
        status=str(row[3]),
        reason=None if row[4] is None else str(row[4]),
        boundary=None if row[5] is None else str(row[5]),
        consumed_through=None if row[6] is None else str(row[6]),
        stats=stats if isinstance(stats, dict) else {},
    )


def _proposal(row: Sequence[Any]) -> ProposalRow:
    try:
        node_ids = json.loads(str(row[3] or "[]"))
    except json.JSONDecodeError:
        node_ids = []
    return ProposalRow(
        id=str(row[0]),
        cycle_id=str(row[1]),
        kind=str(row[2]),
        node_ids=[str(n) for n in node_ids] if isinstance(node_ids, list) else [],
        summary=str(row[4]),
        status=str(row[5]),
        created_at=str(row[6]),
        decided_at=None if row[7] is None else str(row[7]),
    )


class SleepBook:
    """The cycle and proposal rows of one brain, and the use and fade marks recall reads."""

    def __init__(self, brain: Brain) -> None:
        self.brain = brain

    # -- reads --------------------------------------------------------------------------------

    def _one(self, sql: str, params: tuple[Any, ...] = ()) -> Sequence[Any] | None:
        with closing(self.brain.read_connection()) as con:
            row: Sequence[Any] | None = con.execute(sql, params).fetchone()
        return row

    def _all(self, sql: str, params: tuple[Any, ...] = ()) -> list[Sequence[Any]]:
        with closing(self.brain.read_connection()) as con:
            return list(con.execute(sql, params).fetchall())

    # -- cycles -------------------------------------------------------------------------------

    def begin(self, cycle_id: str, *, started_at: str, reason: str, boundary: str) -> CycleRow:
        """The ``running`` row, written before any leg runs."""
        if not ids.is_id("cycle", cycle_id):
            raise ValueError(f"not a cycle id: {cycle_id!r}")
        stats = empty_stats()
        with self.brain.write_txn() as con:
            con.execute(
                f"""INSERT INTO companion_cycle ({_CYCLE_COLUMNS})
                    VALUES (?, ?, NULL, 'running', ?, ?, NULL, ?)""",
                (cycle_id, started_at, reason, boundary, json.dumps(stats)),
            )
        return CycleRow(cycle_id, started_at, None, "running", reason, boundary, None, stats)

    def progress(self, cycle_id: str, stats: dict[str, Any]) -> None:
        """Commit what a running cycle has done so far, as it does it."""
        with self.brain.write_txn() as con:
            con.execute(
                "UPDATE companion_cycle SET stats_json = ? WHERE id = ? AND status = 'running'",
                (json.dumps(stats), cycle_id),
            )

    def finish(
        self,
        cycle_id: str,
        *,
        status: CycleStatus,
        finished_at: str,
        stats: dict[str, Any],
        consumed_through: str | None = None,
        reason: str | None = None,
    ) -> None:
        """Settle a cycle. ``consumed_through`` moves the boundary only for a settled status;
        ``reason`` replaces the admission reason (a failed cycle says why it failed)."""
        with self.brain.write_txn() as con:
            con.execute(
                """UPDATE companion_cycle
                   SET status = ?, finished_at = ?, stats_json = ?,
                       consumed_through = CASE WHEN ? IN ('completed', 'partial') THEN ?
                                               ELSE consumed_through END,
                       reason = COALESCE(?, reason)
                   WHERE id = ?""",
                (
                    status,
                    finished_at,
                    json.dumps(stats),
                    status,
                    consumed_through,
                    reason,
                    cycle_id,
                ),
            )

    def get(self, cycle_id: str) -> CycleRow | None:
        row = self._one(f"SELECT {_CYCLE_COLUMNS} FROM companion_cycle WHERE id = ?", (cycle_id,))
        return None if row is None else _cycle(row)

    def cycles(self, limit: int) -> list[CycleRow]:
        """The newest ``limit`` cycles, newest first, a ``running`` one included."""
        rows = self._all(
            f"""SELECT {_CYCLE_COLUMNS} FROM companion_cycle
                ORDER BY started_at DESC, rowid DESC LIMIT ?""",
            (max(0, limit),),
        )
        return [_cycle(row) for row in rows]

    def latest(self) -> CycleRow | None:
        rows = self.cycles(1)
        return rows[0] if rows else None

    def last_settled(self) -> CycleRow | None:
        """The newest ``completed`` or ``partial`` cycle by ``finished_at``: the floor's clock and
        the next window's boundary. A ``running`` row never answers here."""
        row = self._one(
            f"""SELECT {_CYCLE_COLUMNS} FROM companion_cycle
                WHERE status IN ('completed', 'partial') AND finished_at IS NOT NULL
                ORDER BY finished_at DESC, rowid DESC LIMIT 1"""
        )
        return None if row is None else _cycle(row)

    def last_finished(self) -> CycleRow | None:
        """The newest cycle that settled any way, ``failed`` included."""
        row = self._one(
            f"""SELECT {_CYCLE_COLUMNS} FROM companion_cycle
                WHERE status IN ('completed', 'partial', 'failed') AND finished_at IS NOT NULL
                ORDER BY finished_at DESC, rowid DESC LIMIT 1"""
        )
        return None if row is None else _cycle(row)

    def last_failed(self) -> CycleRow | None:
        row = self._one(
            f"""SELECT {_CYCLE_COLUMNS} FROM companion_cycle
                WHERE status = 'failed' AND finished_at IS NOT NULL
                ORDER BY finished_at DESC, rowid DESC LIMIT 1"""
        )
        return None if row is None else _cycle(row)

    # -- proposals ----------------------------------------------------------------------------

    def open_proposal(
        self,
        cycle_id: str,
        kind: ProposalKind,
        node_ids: Sequence[str],
        summary: str,
        *,
        now: str,
    ) -> ProposalRow | None:
        """Open one proposal, or ``None`` when :data:`OPEN_PROPOSALS_CAP` are already open (the
        caller counts it dropped). The cap is checked in the same transaction as the insert."""
        proposal_id = ids.mint("proposal")
        with self.brain.write_txn() as con:
            ((open_now,),) = con.execute(
                "SELECT COUNT(*) FROM companion_proposal WHERE status = 'open'"
            ).fetchall()
            if int(open_now) >= OPEN_PROPOSALS_CAP:
                return None
            con.execute(
                f"""INSERT INTO companion_proposal ({_PROPOSAL_COLUMNS})
                    VALUES (?, ?, ?, ?, ?, 'open', ?, NULL)""",
                (proposal_id, cycle_id, kind, json.dumps(list(node_ids)), summary, now),
            )
        return ProposalRow(proposal_id, cycle_id, kind, list(node_ids), summary, "open", now)

    def proposal(self, proposal_id: str) -> ProposalRow | None:
        row = self._one(
            f"SELECT {_PROPOSAL_COLUMNS} FROM companion_proposal WHERE id = ?", (proposal_id,)
        )
        return None if row is None else _proposal(row)

    def proposals(self, *, decided: int = 20) -> list[ProposalRow]:
        """Every open proposal, oldest first, then the newest ``decided`` that are not open."""
        open_rows = self._all(
            f"""SELECT {_PROPOSAL_COLUMNS} FROM companion_proposal
                WHERE status = 'open' ORDER BY created_at, id"""
        )
        closed = self._all(
            f"""SELECT {_PROPOSAL_COLUMNS} FROM companion_proposal
                WHERE status != 'open' ORDER BY COALESCE(decided_at, created_at) DESC, id DESC
                LIMIT ?""",
            (max(0, decided),),
        )
        return [_proposal(row) for row in (*open_rows, *closed)]

    def open_count(self) -> int:
        row = self._one("SELECT COUNT(*) FROM companion_proposal WHERE status = 'open'")
        return int(row[0]) if row else 0

    def proposed(self, kind: ProposalKind) -> set[str]:
        """Every node an open or kept proposal of ``kind`` names: not offered again."""
        rows = self._all(
            """SELECT node_ids_json FROM companion_proposal
               WHERE kind = ? AND status IN ('open', 'kept')""",
            (kind,),
        )
        named: set[str] = set()
        for (raw,) in rows:
            try:
                value = json.loads(str(raw))
            except json.JSONDecodeError:
                continue
            if isinstance(value, list):
                named.update(str(v) for v in value)
        return named

    def decide(self, proposal_id: str, status: ProposalStatus, *, now: str) -> bool:
        """Close an open proposal; ``False`` when it was not open any more."""
        with self.brain.write_txn() as con:
            changed = con.execute(
                """UPDATE companion_proposal SET status = ?, decided_at = ?
                   WHERE id = ? AND status = 'open'""",
                (status, now, proposal_id),
            ).rowcount
        return bool(changed)

    def sweep(self, now: datetime) -> tuple[int, int]:
        """Expire the open proposals older than :data:`PROPOSAL_EXPIRE_D` days and dismiss the
        ones whose memory is gone. Answers ``(expired, dismissed)``."""
        stamp = iso(now)
        cut = iso(now - timedelta(days=PROPOSAL_EXPIRE_D))
        with self.brain.write_txn() as con:
            expired = con.execute(
                """UPDATE companion_proposal SET status = 'expired', decided_at = ?
                   WHERE status = 'open' AND created_at < ?""",
                (stamp, cut),
            ).rowcount
            gone: list[str] = []
            for proposal_id, raw in con.execute(
                "SELECT id, node_ids_json FROM companion_proposal WHERE status = 'open'"
            ).fetchall():
                try:
                    node_ids = json.loads(str(raw))
                except json.JSONDecodeError:
                    node_ids = []
                if not isinstance(node_ids, list) or not node_ids:
                    gone.append(str(proposal_id))
                    continue
                live = _live_ids(con, [str(n) for n in node_ids])
                if len(live) < len(node_ids):
                    gone.append(str(proposal_id))
            con.executemany(
                """UPDATE companion_proposal SET status = 'dismissed', decided_at = ?
                   WHERE id = ? AND status = 'open'""",
                [(stamp, proposal_id) for proposal_id in gone],
            )
        return int(expired), len(gone)

    # -- the memories a cycle reads and judges -----------------------------------------------------

    def memory(self, node_id: str) -> Existing | None:
        """One live fact or procedural with its key (a fact's) or trigger (a procedural's)."""
        row = self._one(
            f"""SELECT n.id, n.kind, COALESCE(fc.fact_key, pr.trigger_pattern, ''),
                       n.body_excerpt
                FROM companion_node n
                LEFT JOIN companion_fact fc ON fc.id = n.id
                LEFT JOIN companion_procedural pr ON pr.id = n.id
                WHERE n.id = ? AND {_LIVE}""",
            (node_id,),
        )
        if row is None:
            return None
        return Existing(str(row[0]), str(row[1]), str(row[2]), str(row[3] or "")[:EXCERPT_CHARS])

    def scope_of(self, node_id: str) -> str | None:
        """A fact's scope, or ``None`` for anything else."""
        row = self._one("SELECT scope FROM companion_fact WHERE id = ?", (node_id,))
        return None if row is None else str(row[0])

    def shortlist(self, kind: str, match: str, limit: int) -> list[Existing]:
        """The ``limit`` live memories of ``kind`` that best match ``match`` (an FTS expression),
        each with an excerpt of at most :data:`EXCERPT_CHARS` characters."""
        if not match or limit <= 0:
            return []
        key_column = "fc.fact_key" if kind == "fact" else "pr.trigger_pattern"
        rows = self._all(
            f"""SELECT n.id, n.kind, COALESCE({key_column}, ''), f.body
                FROM companion_fts f JOIN companion_node n ON n.id = f.node_id
                LEFT JOIN companion_fact fc ON fc.id = n.id
                LEFT JOIN companion_procedural pr ON pr.id = n.id
                WHERE companion_fts MATCH ? AND n.kind = ? AND {_LIVE}
                ORDER BY bm25(companion_fts) ASC LIMIT ?""",
            (f"body : ({match})", kind, limit),
        )
        return [Existing(str(r[0]), str(r[1]), str(r[2]), _excerpt(str(r[3] or ""))) for r in rows]

    def bars(self) -> dict[tuple[str, str, str], str]:
        """Every key a person's forget bars from being learned again, as
        ``(kind, scope, normalized key) -> the marker's id`` (ADR 0143).

        A forget writes a ``forgotten:`` marker that supersedes the memory; the episodes that
        grounded it stay, so the next cycle would derive it again and the person would see the
        correction reversed. The bar is keyed on the forgotten memory's own kind, scope and key -
        never on its wording, which would also bar a restatement's negation. Only the person lifts
        it: a live memory under the same kind, scope and key written after the marker (an
        approved ``core.write_fact``; a cycle cannot write one, it is barred) ends the bar. A
        fade, an expiry or a cap never writes a marker, so none of them bars anything.
        """
        rows = self._all(
            """SELECT m.id, m.created_at, o.kind,
                      COALESCE(ofc.scope, opr.scope, ''),
                      COALESCE(ofc.fact_key, opr.trigger_pattern, '')
               FROM companion_fact mf
               JOIN companion_node m ON m.id = mf.id
               JOIN companion_supersede s ON s.node_id = m.id
               JOIN companion_node o ON o.id = s.superseded_id
               LEFT JOIN companion_fact ofc ON ofc.id = o.id
               LEFT JOIN companion_procedural opr ON opr.id = o.id
               WHERE mf.fact_key LIKE ? AND o.kind IN ('fact', 'procedural')""",
            (FORGOTTEN_PREFIX + "%",),
        )
        if not rows:
            return {}
        newest: dict[tuple[str, str, str], tuple[str, str]] = {}
        for marker, created, kind, scope, key in rows:
            mark = (str(kind), str(scope), norm_key(str(key)))
            if mark not in newest or str(created) > newest[mark][1]:
                newest[mark] = (str(marker), str(created))
        written: dict[tuple[str, str, str], str] = {}
        for kind, scope, key, created in self._all(
            f"""SELECT n.kind, COALESCE(fc.scope, pr.scope, ''),
                       COALESCE(fc.fact_key, pr.trigger_pattern, ''), n.created_at
                FROM companion_node n
                LEFT JOIN companion_fact fc ON fc.id = n.id
                LEFT JOIN companion_procedural pr ON pr.id = n.id
                WHERE {_LIVE}"""
        ):
            mark = (str(kind), str(scope), norm_key(str(key)))
            if mark in newest and str(created) > written.get(mark, ""):
                written[mark] = str(created)
        return {
            mark: marker
            for mark, (marker, created) in newest.items()
            if written.get(mark, "") <= created
        }

    def same_key(self, kind: str, key: str) -> Existing | None:
        """A live memory of ``kind`` whose key (or trigger) is ``key``, ignoring case and spacing:
        the deterministic prefilter the merge degrades to when its leg fails."""
        wanted = norm_key(key)
        column, table = (
            ("fact_key", "companion_fact")
            if kind == "fact"
            else ("trigger_pattern", "companion_procedural")
        )
        for node_id, found, body in self._all(
            f"""SELECT n.id, t.{column}, n.body_excerpt
                FROM {table} t JOIN companion_node n ON n.id = t.id WHERE {_LIVE}"""
        ):
            if norm_key(str(found)) == wanted:
                return Existing(str(node_id), kind, str(found), _excerpt(str(body or "")))
        return None

    # -- fade -----------------------------------------------------------------------------------

    def fade(self, now: datetime) -> int:
        """Fade one step every live memory older than :data:`FADE_AFTER_D` days that recall has not
        shown for as long, and that has not faded a step for as long. At most :data:`FADE_BATCH`
        memories, at most :data:`FADE_MAX` steps. Answers how many faded."""
        stamp = iso(now)
        cut = iso(now - timedelta(days=FADE_AFTER_D))
        with self.brain.write_txn() as con:
            rows = con.execute(
                f"""SELECT n.id FROM companion_node n
                    LEFT JOIN companion_fade fd ON fd.node_id = n.id
                    LEFT JOIN companion_recall_seen rs ON rs.node_id = n.id
                    WHERE {_LIVE} AND n.created_at < ?
                      AND (rs.last_at IS NULL OR rs.last_at < ?)
                      AND (fd.at IS NULL OR fd.at < ?)
                      AND COALESCE(fd.steps, 0) < ?
                    ORDER BY n.created_at, n.id LIMIT ?""",
                (cut, cut, cut, FADE_MAX, FADE_BATCH),
            ).fetchall()
            con.executemany(
                """INSERT INTO companion_fade (node_id, steps, at) VALUES (?, 1, ?)
                   ON CONFLICT (node_id) DO UPDATE SET
                     steps = MIN(steps + 1, ?), at = excluded.at""",
                [(str(row[0]), stamp, FADE_MAX) for row in rows],
            )
        return len(rows)

    def steps(self, node_id: str) -> int:
        row = self._one("SELECT steps FROM companion_fade WHERE node_id = ?", (node_id,))
        return int(row[0]) if row else 0

    def forget_candidates(self) -> list[Existing]:
        """Live facts faded all the way at no more than the default importance: what a forget
        proposal offers, oldest fade first. Report-only: nothing here retires anything."""
        rows = self._all(
            f"""SELECT n.id, n.kind, fc.fact_key, n.body_excerpt
                FROM companion_node n JOIN companion_fade fd ON fd.node_id = n.id
                JOIN companion_fact fc ON fc.id = n.id
                WHERE {_LIVE} AND n.kind = 'fact' AND n.importance <= ? AND fd.steps >= ?
                ORDER BY fd.at, n.id""",
            (DEFAULT_IMPORTANCE, FADE_MAX),
        )
        return [Existing(str(r[0]), str(r[1]), str(r[2]), _excerpt(str(r[3] or ""))) for r in rows]


def _live_ids(con: sqlite3.Connection, node_ids: list[str]) -> set[str]:
    marks = ",".join("?" for _ in node_ids)
    rows = con.execute(
        f"SELECT n.id FROM companion_node n WHERE n.id IN ({marks}) AND {_LIVE}",
        tuple(node_ids),
    ).fetchall()
    return {str(row[0]) for row in rows}


def _excerpt(body: str) -> str:
    """At most :data:`EXCERPT_CHARS` characters of a body, on one line, marked where it was cut."""
    flat = " ".join(body.split())
    return flat if len(flat) <= EXCERPT_CHARS else flat[: EXCERPT_CHARS - 1] + "…"


def norm_key(key: str) -> str:
    """A key or trigger as the merge prefilter and the forget bar compare it: case and spacing
    do not make two keys different."""
    return " ".join(key.casefold().split())

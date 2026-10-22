"""ADR 0127 (a case's turns are stamped under it): which turns were runs of which case.

A turn names its case (``TurnContext.case_id``, ADR 0126) and still talks in its own tab's
conversation, so nothing about where a turn landed says which case it was a run of. This table
does: one row per turn sent under a case, written by the daemon as the turn begins and closed as
it ends, and the receipt of a case's run is folded from the cards and ledger rows those turn ids
filed (``Approvals.of_turns``, ``Ledger.turns_total``). A turn's ``started_at`` puts it in a run:
the run is every turn of the case that began since its last receipt, so a ledger row written
before the turn's first card, or a card answered days later, is in the run of the turn that made
it.

``ended_at`` bounds what else the turn wrote in its conversation: the "may have completed"
episodes the lane appends while the turn holds the daemon's one-turn lock. A turn that never
ended (the daemon died under it) has ``ended_at`` empty, and its window is its start alone, so
it claims no episode rather than every later one.

The rows live in ``index.sqlite`` beside the approvals and the ledger, with the same ``CREATE
TABLE IF NOT EXISTS`` idiom and deliberately absent from ``core/brain/schema.py``'s
``INDEX_TABLES``: a reconcile leaves them alone, as it leaves the cards and the rows they join
(ADR 0005). Deleting the index loses an open run's turns together with its cards and its cost;
a closed run is a receipt in the case file by then (ADR 0124).
"""

from __future__ import annotations

from collections.abc import Sequence
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from athena.contracts import ids
from athena.contracts.channel import iso, now_iso
from athena.core.brain.store import Brain

__all__ = ["CASE_TURN_SCHEMA", "CaseTurn", "CaseTurnError", "CaseTurns"]

#: The table a case's turns live in. Absent from ``INDEX_TABLES`` on purpose.
CASE_TURN_SCHEMA: tuple[str, ...] = (
    """CREATE TABLE IF NOT EXISTS companion_case_turn (
        turn_id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_case_turn ON companion_case_turn(case_id, started_at)",
)


class CaseTurnError(ValueError):
    """An id that is not the kind it names."""


@dataclass(frozen=True)
class CaseTurn:
    """One turn sent under a case: where it talked, and when it began and ended."""

    turn_id: str
    case_id: str
    conversation: str
    started_at: str
    #: ``""`` while the turn runs, and for one the daemon never saw end.
    ended_at: str = ""


class CaseTurns:
    """The case-turn table over one brain's index. Construction is idempotent."""

    def __init__(self, brain: Brain) -> None:
        self.brain = brain
        with brain.write_txn() as con:
            for statement in CASE_TURN_SCHEMA:
                con.execute(statement)

    def record(
        self, case_id: str, turn_id: str, conversation: str, *, now: datetime | None = None
    ) -> CaseTurn:
        """Stamp turn ``turn_id`` under case ``case_id`` as it begins. A turn id stamped once
        keeps its first row: a turn is a run of one case."""
        if not ids.is_id("project", case_id):
            raise CaseTurnError(f"not a case id: {case_id!r}")
        if not ids.is_id("turn", turn_id):
            raise CaseTurnError(f"not a turn id: {turn_id!r}")
        if not ids.is_id("conversation", conversation):
            raise CaseTurnError(f"not a conversation id: {conversation!r}")
        stamp = iso(now) if now is not None else now_iso()
        with self.brain.write_txn() as con:
            con.execute(
                """INSERT OR IGNORE INTO companion_case_turn
                   (turn_id, case_id, conversation_id, started_at) VALUES (?, ?, ?, ?)""",
                (turn_id, case_id, conversation, stamp),
            )
        return CaseTurn(turn_id, case_id, conversation, stamp)

    def finish(self, turn_id: str, *, now: datetime | None = None) -> None:
        """The turn ended; its first end is kept."""
        stamp = iso(now) if now is not None else now_iso()
        with self.brain.write_txn() as con:
            con.execute(
                "UPDATE companion_case_turn SET ended_at = ? "
                "WHERE turn_id = ? AND ended_at IS NULL",
                (stamp, turn_id),
            )

    def of_case(self, case_id: str, *, since: str = "", until: str = "") -> list[CaseTurn]:
        """The case's turns that began in ``since <= started_at < until`` (``""`` open), oldest
        first. Every one of them: a run's receipt counts them all, so this is not bounded."""
        where = "case_id = ?"
        args: list[Any] = [case_id]
        if since:
            where += " AND started_at >= ?"
            args.append(since)
        if until:
            where += " AND started_at < ?"
            args.append(until)
        with closing(self.brain.read_connection()) as con:
            raws = con.execute(
                "SELECT turn_id, case_id, conversation_id, started_at, ended_at "
                f"FROM companion_case_turn WHERE {where} ORDER BY started_at, rowid",
                args,
            ).fetchall()
        return [_turn(raw) for raw in raws]

    def case_of(self, turn_id: str) -> str | None:
        """The case turn ``turn_id`` was stamped under, or ``None``."""
        with closing(self.brain.read_connection()) as con:
            raw = con.execute(
                "SELECT case_id FROM companion_case_turn WHERE turn_id = ?", (turn_id,)
            ).fetchone()
        return None if raw is None else str(raw[0])


def _turn(raw: Sequence[Any]) -> CaseTurn:
    return CaseTurn(
        turn_id=str(raw[0]),
        case_id=str(raw[1]),
        conversation=str(raw[2]),
        started_at=str(raw[3]),
        ended_at=str(raw[4] or ""),
    )

"""The ledger — one row per model invocation, failures included (README §2 invariant 6; ADR 0005).

Cost is visible or it is not controlled. Every invocation writes exactly one row: which engine and
model ran it, which conversation and origin it belonged to, which surface asked, what triggered it,
how many rounds it took, the tokens, the cost, the milliseconds, and — when it failed — ``is_error``
with a reason from the closed set in ``contracts.harness.ERROR_REASONS``.

Three properties are worth stating because each is a way ledgers usually go wrong.

**Failures are rows, not gaps.** A turn that died is the expensive one; a ledger that only records
successes shows a cheap week. ``record`` takes ``is_error`` and refuses to write a success that
carries a reason or an error that carries none — an error with no reason becomes ``unknown``
rather than ``NULL``, because a row nobody can group by is a log line.

**The reason vocabulary is closed.** Anything unrecognised collapses to ``unknown`` through
``contracts.harness.normalize_reason``. A reason invented at a call site would be a column with
unbounded cardinality that still does not say why, so the normalisation happens here, once, on the
way in — never at the reader, which would have to trust what was stored.

**Nothing secret, ever.** The columns are counts, ids and durations. No prompt text, no tool
arguments, no token. What a row says about the prompt is how big it was and what it cost.

The ledger mints no ids: rule 10 of the build is one ``ids.py`` per language, and there is no turn
prefix in it. Row identity is SQLite's ``AUTOINCREMENT`` — honest, since "one row per invocation"
is exactly what a monotonic row id counts — and ``turn_id`` carries whatever id the harness already
minted for the turn (``TurnResult.turn_id``), or nothing.

Rows live in the brain's ``index.sqlite`` beside the approvals, created with the same
``CREATE TABLE IF NOT EXISTS`` idiom and deliberately absent from ``core/brain/schema.py``'s
``INDEX_TABLES``, so a reconcile — which empties exactly what the markdown can rebuild — leaves the
record of what was spent alone (ADR 0005). The constructor takes a
:class:`~athena.core.brain.store.Brain` for the reason given in ``core/approvals.py``: a
connection-provider port would have to name ``sqlite3`` in a seam that holds dataclasses and
Protocols with no I/O, while the brain is a sibling module of this one inside ``athena.core``.
"""

from __future__ import annotations

from collections.abc import Sequence
from contextlib import closing
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from athena.contracts.channel import TurnSummary
from athena.contracts.harness import ERROR_REASONS, normalize_reason
from athena.contracts.registry import is_origin
from athena.core.brain.store import Brain

__all__ = [
    "ERROR_REASONS",
    "ROLLUP_KEYS",
    "TRIGGERS",
    "Ledger",
    "LedgerError",
    "LedgerPage",
    "LedgerRow",
    "RollupRow",
]

#: The triggers seen so far. Documentation, not a gate: an unknown trigger is stored verbatim,
#: because refusing to record a turn is a worse failure than a rollup key nobody recognises.
TRIGGERS: tuple[str, ...] = ("chat", "voice", "mcp", "schedule", "resume")

#: ``rollup(by=...)`` → the column it groups on. The dimensions the activity module of README §1
#: act 4 offers, and no free-form column name ever reaches SQL.
ROLLUP_KEYS: dict[str, str] = {
    "engine": "engine",
    "model": "model",
    "conversation": "conversation_id",
    "origin": "origin",
    "surface": "surface",
}


class LedgerError(ValueError):
    """A row the ledger will not write."""


#: The ledger's table. Absent from ``core/brain/schema.py``'s ``INDEX_TABLES``: disk cannot
#: rebuild what a turn cost, so a reconcile must not clear it.
LEDGER_SCHEMA: tuple[str, ...] = (
    """CREATE TABLE IF NOT EXISTS companion_turn (
        row_id INTEGER PRIMARY KEY AUTOINCREMENT,
        turn_id TEXT,
        engine TEXT NOT NULL,
        model TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        origin TEXT NOT NULL,
        surface TEXT NOT NULL,
        trigger_kind TEXT NOT NULL,
        rounds INTEGER NOT NULL DEFAULT 1,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL,
        cost_estimated INTEGER NOT NULL DEFAULT 0,
        ms INTEGER NOT NULL DEFAULT 0,
        is_error INTEGER NOT NULL DEFAULT 0,
        error_reason TEXT,
        created_at TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_turn_created ON companion_turn(created_at)",
    "CREATE INDEX IF NOT EXISTS idx_turn_error ON companion_turn(is_error, error_reason)",
)


@dataclass(frozen=True)
class LedgerRow:
    """One invocation, as it was stored."""

    row_id: int
    engine: str
    model: str
    conversation: str
    origin: str
    surface: str
    trigger: str
    rounds: int = 1
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float | None = None
    cost_estimated: bool = False
    ms: int = 0
    is_error: bool = False
    error_reason: str | None = None
    turn_id: str | None = None
    created_at: str = ""

    def to_summary(self) -> TurnSummary:
        """The ``turn.summary`` event this row mirrors (README §2 invariant 6)."""
        return TurnSummary(
            model=self.model,
            engine=self.engine,
            input_tokens=self.input_tokens,
            output_tokens=self.output_tokens,
            cost_usd=self.cost_usd,
            cost_estimated=self.cost_estimated,
            duration_ms=self.ms,
            rounds=self.rounds,
        )


@dataclass(frozen=True)
class RollupRow:
    """What one key of a :meth:`Ledger.rollup` cost."""

    key: str
    turns: int = 0
    errors: int = 0
    rounds: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    ms: int = 0


@dataclass(frozen=True)
class LedgerPage:
    """A bounded read that says what it left out (README §2 invariant 4).

    ``total`` is every row in the ledger, not the rows returned — the footer is a claim about the
    population, and its wording is ``ExecResult.footer``'s to the character.
    """

    rows: tuple[LedgerRow, ...]
    total: int

    @property
    def shown(self) -> int:
        return len(self.rows)

    @property
    def truncated(self) -> bool:
        return self.shown < self.total

    def footer(self) -> str:
        """``(showing N of M)``, or ``""`` when the page is the whole ledger."""
        if not self.truncated:
            return ""
        return f"(showing {self.shown} of {self.total})"


#: The projection :func:`_row` reads, in order. One string, so every SELECT agrees with it.
_COLUMNS = (
    "row_id, engine, model, conversation_id, origin, surface, trigger_kind, rounds, "
    "input_tokens, output_tokens, cost_usd, cost_estimated, ms, is_error, error_reason, "
    "turn_id, created_at"
)


def _row(raw: Sequence[Any]) -> LedgerRow:
    return LedgerRow(
        row_id=int(raw[0]),
        engine=str(raw[1]),
        model=str(raw[2]),
        conversation=str(raw[3]),
        origin=str(raw[4]),
        surface=str(raw[5]),
        trigger=str(raw[6]),
        rounds=int(raw[7]),
        input_tokens=int(raw[8]),
        output_tokens=int(raw[9]),
        cost_usd=None if raw[10] is None else float(raw[10]),
        cost_estimated=bool(raw[11]),
        ms=int(raw[12]),
        is_error=bool(raw[13]),
        error_reason=None if raw[14] is None else str(raw[14]),
        turn_id=None if raw[15] is None else str(raw[15]),
        created_at=str(raw[16]),
    )


class Ledger:
    """The usage ledger over one brain's index. Construction is idempotent."""

    def __init__(self, brain: Brain) -> None:
        self.brain = brain
        with brain.write_txn() as con:
            for statement in LEDGER_SCHEMA:
                con.execute(statement)

    # -- writing -------------------------------------------------------------------------------

    def record(
        self,
        *,
        engine: str,
        model: str,
        conversation: str,
        origin: str,
        surface: str,
        trigger: str,
        rounds: int = 1,
        input_tokens: int = 0,
        output_tokens: int = 0,
        cost_usd: float | None = None,
        cost_estimated: bool = False,
        ms: int = 0,
        is_error: bool = False,
        error_reason: str | None = None,
        turn_id: str | None = None,
        now: datetime | None = None,
    ) -> LedgerRow:
        """Write the one row this invocation gets.

        ``rounds`` is model → tool → model rounds *inside* one turn (README §3.2 step 3): up to
        eight of them are still one row, because one row is one turn's cost and not one HTTP call.

        **Zero is a real number here**, and it is the one exception to "one row per model
        invocation". A refusal that no model was asked about — the browser lane recording a card
        the user declined — is a row this ledger must hold, because act 4 of the demo reads the
        declines back, and the honest count of model rounds behind it is none. Writing ``1``
        instead would inflate every rollup by one invocation that never happened, so the guard
        below refuses a *negative* count and nothing else.
        """
        if not engine:
            raise LedgerError("a ledger row must name the engine that ran it")
        if not is_origin(origin):
            raise LedgerError(f"not a tool origin: {origin!r}")
        if not surface:
            raise LedgerError("a ledger row must name the surface that asked")
        if rounds < 0:
            raise LedgerError(f"a round count cannot be negative: {rounds!r}")
        # Normalise on the way in, once. A reader that had to normalise would be trusting that
        # every writer did, which is the same as not having a closed set at all.
        reason = normalize_reason(error_reason)
        if is_error and reason is None:
            reason = "unknown"
        if not is_error:
            reason = None
        stamp = _iso(now or datetime.now(UTC))
        with self.brain.write_txn() as con:
            cursor = con.execute(
                """INSERT INTO companion_turn
                   (turn_id, engine, model, conversation_id, origin, surface, trigger_kind,
                    rounds, input_tokens, output_tokens, cost_usd, cost_estimated, ms,
                    is_error, error_reason, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    turn_id,
                    engine,
                    model,
                    conversation,
                    origin,
                    surface,
                    trigger,
                    rounds,
                    input_tokens,
                    output_tokens,
                    cost_usd,
                    1 if cost_estimated else 0,
                    ms,
                    1 if is_error else 0,
                    reason,
                    stamp,
                ),
            )
            row_id = int(cursor.lastrowid or 0)
        return LedgerRow(
            row_id=row_id,
            engine=engine,
            model=model,
            conversation=conversation,
            origin=origin,
            surface=surface,
            trigger=trigger,
            rounds=rounds,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=cost_usd,
            cost_estimated=cost_estimated,
            ms=ms,
            is_error=is_error,
            error_reason=reason,
            turn_id=turn_id,
            created_at=stamp,
        )

    # -- reading -------------------------------------------------------------------------------

    def recent(self, limit: int = 20) -> LedgerPage:
        """The newest rows first, bounded and announced.

        Ordered by ``row_id`` and not by ``created_at``: two turns inside the same millisecond
        would otherwise come back in an order the ledger does not actually know.
        """
        bound = max(limit, 0)
        with closing(self.brain.read_connection()) as con:
            total = int(con.execute("SELECT COUNT(*) FROM companion_turn").fetchone()[0])
            raws = con.execute(
                f"SELECT {_COLUMNS} FROM companion_turn ORDER BY row_id DESC LIMIT ?", (bound,)
            ).fetchall()
        return LedgerPage(rows=tuple(_row(raw) for raw in raws), total=total)

    def rollup(self, by: str = "model") -> list[RollupRow]:
        """Sum the ledger per key of one dimension, dearest first.

        ``by`` is looked up in :data:`ROLLUP_KEYS` rather than interpolated, so the dimension is a
        closed set and no caller can name a column — or anything else — that reaches SQL.
        """
        column = ROLLUP_KEYS.get(by)
        if column is None:
            raise LedgerError(f"rollup dimension must be one of {sorted(ROLLUP_KEYS)}: {by!r}")
        # ``column`` is a value of ROLLUP_KEYS and never the caller's string, which is what makes
        # this interpolation safe; SQLite takes no parameter in a GROUP BY position.
        query = (
            f"SELECT {column}, COUNT(*), SUM(is_error), SUM(rounds), SUM(input_tokens), "
            f"SUM(output_tokens), SUM(COALESCE(cost_usd, 0.0)), SUM(ms) "
            f"FROM companion_turn GROUP BY {column}"
        )
        with closing(self.brain.read_connection()) as con:
            raws = con.execute(query).fetchall()
        rows = [
            RollupRow(
                key=str(raw[0]),
                turns=int(raw[1]),
                errors=int(raw[2] or 0),
                rounds=int(raw[3] or 0),
                input_tokens=int(raw[4] or 0),
                output_tokens=int(raw[5] or 0),
                cost_usd=float(raw[6] or 0.0),
                ms=int(raw[7] or 0),
            )
            for raw in raws
        ]
        return sorted(rows, key=lambda r: (-r.cost_usd, -r.turns, r.key))


def _iso(moment: datetime) -> str:
    """UTC with an explicit offset — the stamp the brain's writer emits, and what parses back."""
    aware = moment if moment.tzinfo else moment.replace(tzinfo=UTC)
    return aware.astimezone(UTC).isoformat()

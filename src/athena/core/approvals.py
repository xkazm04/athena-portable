"""The approval table — the gate's durable half (README §3.2 steps 4 and 6, §3.3; ADR 0005).

Lifecycle, and there is no other edge::

    pending --resolve("approve")---------------> approved
    pending --resolve(another offered token)---> declined
    pending --expire_due(now >= expires_at)----> expired   (reason "expired")

Three rules hold the module together.

**The row is the grant.** :meth:`Approvals.describe` returns the action and the parameters the row
was created for, canonicalised. README §3.2 step 6 replays the gate with an approval id once the
user has answered, and the replay is honest only if the thing being executed is the thing that was
shown on the card. A row therefore never learns new parameters: ``describe`` is read-only and
:meth:`ApprovalGrant.matches` is what the replay asks.

**Only an offered token resolves, and only one token approves.** ``resolve`` compares the answer
against the row's own ``options`` by exact string equality — no case folding, no synonym table,
no punctuation stripping. The answer reaches the table through a model paraphrasing a human, and a
table that guesses what "sure, go ahead" meant is a gate the model can talk its way through
(README §2 invariant 3). Of the offered tokens exactly one opens the gate, :data:`APPROVE_TOKEN`;
every other offered token records the user's answer and leaves the row ``declined``, because this
table answers one question — *was this action authorised* — and anything that is not a yes is a no.

**Expiry is checked at resolve, not only by the sweep.** :meth:`expire_due` is a background broom;
a resolve that arrives after ``expires_at`` expires the row itself and refuses. A stale card in a
panel that has been open all night can never be clicked into an approval.

The rows live in the brain's ``index.sqlite`` because an approval is state about this brain, and a
brain is portable by copying one directory (README §2 invariant 1). They are created here with the
same ``CREATE TABLE IF NOT EXISTS`` idiom ``core/brain/schema.py`` uses, and their names are
deliberately absent from that module's ``INDEX_TABLES``: a reconcile empties exactly the tables
disk can rebuild, so an approval survives one (ADR 0005).

The constructor takes a :class:`~athena.core.brain.store.Brain` rather than a connection-provider
port. ``contracts/`` is the seam *between packages* and holds dataclasses and Protocols with no
I/O; a port for handing out ``sqlite3`` connections belongs in neither, and approvals, the ledger
and the brain are all modules of ``athena.core``. Depending on a sibling module crosses no seam and
forks no contract type, and the writer lock plus ``read_connection()`` the brain already owns are
exactly the two handles this table needs.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from contextlib import closing
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any

from athena.contracts import ids
from athena.contracts.channel import DecisionOption, DecisionRequested, DecisionResolved
from athena.contracts.registry import is_origin
from athena.core.brain.store import Brain

__all__ = [
    "APPROVE_TOKEN",
    "DEFAULT_OPTIONS",
    "DEFAULT_TTL",
    "EXPIRED_REASON",
    "ApprovalError",
    "ApprovalGrant",
    "ApprovalRow",
    "ApprovalStatus",
    "Approvals",
    "PendingPage",
]

#: A card lives for a day. Long enough that a decision raised in the morning is still answerable
#: after lunch, short enough that last week's proposal is never executed against this week's page.
DEFAULT_TTL = timedelta(hours=24)

#: What a card offers when the caller does not say. Two tokens, both spelled out.
DEFAULT_OPTIONS: tuple[str, ...] = ("approve", "decline")

#: The one token that opens the gate. Fail closed: a card offering ``("send", "skip")`` can never
#: be mistaken for consent, because neither token is this one.
APPROVE_TOKEN = "approve"

#: The reason an expired row carries, a member of ``contracts.harness.ERROR_REASONS``.
EXPIRED_REASON = "expired"


class ApprovalStatus(StrEnum):
    """The four states of a row. ``pending`` is the only one anything moves out of."""

    PENDING = "pending"
    APPROVED = "approved"
    DECLINED = "declined"
    EXPIRED = "expired"


class ApprovalError(ValueError):
    """A rule the table refuses: an unknown row, a stale one, or an answer it never offered."""


#: The tables an approval lives in. Absent from ``core/brain/schema.py``'s ``INDEX_TABLES`` on
#: purpose — a reconcile rebuilds what the markdown tree owns and leaves runtime state alone.
APPROVAL_SCHEMA: tuple[str, ...] = (
    """CREATE TABLE IF NOT EXISTS companion_approval (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        params_json TEXT NOT NULL,
        origin TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        surface TEXT NOT NULL,
        options_json TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        capture_id TEXT,
        status TEXT NOT NULL,
        choice TEXT,
        answer TEXT,
        reason TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        resolved_at TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_approval_live ON companion_approval(status, expires_at)",
    "CREATE INDEX IF NOT EXISTS idx_approval_created ON companion_approval(created_at)",
)


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(moment: datetime) -> str:
    """UTC, with an explicit offset — so the strings sort the way the instants do."""
    aware = moment if moment.tzinfo else moment.replace(tzinfo=UTC)
    return aware.astimezone(UTC).isoformat()


def _canonical(params: Mapping[str, Any]) -> str:
    """The one spelling of a parameter set, so two of them compare by string.

    Sorted keys and no whitespace, which is also what is stored: a replay that arrives with the
    same pairs in another order is the same grant, and one extra pair is not.
    """
    try:
        return json.dumps(dict(params), sort_keys=True, separators=(",", ":"))
    except (TypeError, ValueError) as exc:
        raise ApprovalError(f"approval params must be JSON-serialisable: {exc}") from exc


@dataclass(frozen=True)
class ApprovalGrant:
    """What :meth:`Approvals.describe` returns: the card, as the gate replay must read it."""

    id: str
    action: str
    params: dict[str, Any]
    status: str
    origin: str
    conversation: str
    surface: str
    capture_id: str | None = None
    choice: str | None = None

    @property
    def approved(self) -> bool:
        return self.status == ApprovalStatus.APPROVED

    def matches(self, action: str, params: Mapping[str, Any]) -> bool:
        """Is this the exact action and parameter set the user was shown?

        The half of README §3.2 step 6 that makes a replay a replay. Both sides go through
        :func:`_canonical`, so key order never decides it and a tuple that became a list on the
        way through JSON still matches.
        """
        return action == self.action and _canonical(params) == _canonical(self.params)


@dataclass(frozen=True)
class ApprovalRow:
    """One row of ``companion_approval``."""

    id: str
    action: str
    params: dict[str, Any]
    origin: str
    conversation: str
    surface: str
    options: tuple[str, ...]
    status: str
    created_at: str
    expires_at: str
    summary: str = ""
    capture_id: str | None = None
    choice: str | None = None
    answer: str | None = None
    reason: str | None = None
    resolved_at: str | None = None

    @property
    def pending(self) -> bool:
        return self.status == ApprovalStatus.PENDING

    def to_event(self) -> DecisionRequested:
        """The card a surface renders. The options are the only answers ``resolve`` will take."""
        return DecisionRequested(
            id=self.id,
            action=self.action,
            params=dict(self.params),
            rationale=self.summary,
            options=tuple(DecisionOption(id=token, label=token) for token in self.options),
            expires_at=self.expires_at,
            origin=self.origin,
            surface=self.surface,
            capture_id=self.capture_id,
        )

    def resolution_event(self) -> DecisionResolved:
        """What every surface is told once the row left ``pending``."""
        return DecisionResolved(
            id=self.id,
            choice=self.choice or "",
            by="user",
            at=self.resolved_at or "",
        )


@dataclass(frozen=True)
class PendingPage:
    """A bounded read of the inbox that says what it left out (README §2 invariant 4).

    ``total`` counts the live pending rows, not the rows returned, which is the only way
    :meth:`footer` can be true. The wording is ``ExecResult.footer``'s, to the character.
    """

    rows: tuple[ApprovalRow, ...]
    total: int

    @property
    def shown(self) -> int:
        return len(self.rows)

    @property
    def truncated(self) -> bool:
        return self.shown < self.total

    def footer(self) -> str:
        """``(showing N of M)``, or ``""`` when the page is the whole inbox."""
        if not self.truncated:
            return ""
        return f"(showing {self.shown} of {self.total})"


#: The projection :func:`_row` reads, in order. One string, so every SELECT agrees with it.
_COLUMNS = (
    "id, action, params_json, origin, conversation_id, surface, options_json, status, "
    "created_at, expires_at, summary, capture_id, choice, answer, reason, resolved_at"
)


def _row(raw: Sequence[Any]) -> ApprovalRow:
    return ApprovalRow(
        id=str(raw[0]),
        action=str(raw[1]),
        params=dict(json.loads(str(raw[2]))),
        origin=str(raw[3]),
        conversation=str(raw[4]),
        surface=str(raw[5]),
        options=tuple(str(o) for o in json.loads(str(raw[6]))),
        status=str(raw[7]),
        created_at=str(raw[8]),
        expires_at=str(raw[9]),
        summary=str(raw[10] or ""),
        capture_id=None if raw[11] is None else str(raw[11]),
        choice=None if raw[12] is None else str(raw[12]),
        answer=None if raw[13] is None else str(raw[13]),
        reason=None if raw[14] is None else str(raw[14]),
        resolved_at=None if raw[15] is None else str(raw[15]),
    )


class Approvals:
    """The approval table over one brain's index. Construction is idempotent."""

    def __init__(self, brain: Brain) -> None:
        self.brain = brain
        with brain.write_txn() as con:
            for statement in APPROVAL_SCHEMA:
                con.execute(statement)

    # -- writing -------------------------------------------------------------------------------

    def create(
        self,
        action: str,
        params: Mapping[str, Any],
        *,
        origin: str,
        conversation: str,
        surface: str,
        options: Sequence[str] = DEFAULT_OPTIONS,
        ttl: timedelta = DEFAULT_TTL,
        summary: str = "",
        capture_id: str | None = None,
        now: datetime | None = None,
    ) -> ApprovalRow:
        """File a card and return the row it became.

        Everything is validated here rather than at the gate, because this row is what the replay
        of README §3.2 step 6 will be measured against: an origin that does not parse, an id that
        is not a capture id or a parameter set that does not survive JSON would each make the
        stored grant a different thing from the one the user saw.
        """
        if not action or "." not in action:
            raise ApprovalError(f"action must be a namespaced tool name: {action!r}")
        if not is_origin(origin):
            raise ApprovalError(f"not a tool origin: {origin!r}")
        if not ids.is_id("conversation", conversation):
            raise ApprovalError(f"not a conversation id: {conversation!r}")
        if not surface:
            raise ApprovalError("an approval must name the surface that raised it")
        tokens = tuple(options)
        if not tokens or any(not t for t in tokens) or len(set(tokens)) != len(tokens):
            raise ApprovalError(f"options must be non-empty and distinct: {tokens!r}")
        if capture_id is not None and not ids.is_id("capture", capture_id):
            raise ApprovalError(f"not a capture id: {capture_id!r}")
        if ttl <= timedelta(0):
            raise ApprovalError(f"an approval needs a positive ttl: {ttl!r}")

        stored_params = _canonical(params)  # before the transaction: a refusal is not a rollback
        moment = now or _now()
        row = ApprovalRow(
            id=ids.mint("approval"),
            action=action,
            params=dict(params),
            origin=origin,
            conversation=conversation,
            surface=surface,
            options=tokens,
            status=ApprovalStatus.PENDING,
            created_at=_iso(moment),
            expires_at=_iso(moment + ttl),
            summary=summary,
            capture_id=capture_id,
        )
        with self.brain.write_txn() as con:
            con.execute(
                """INSERT INTO companion_approval
                   (id, action, params_json, origin, conversation_id, surface, options_json,
                    summary, capture_id, status, created_at, expires_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    row.id,
                    row.action,
                    stored_params,
                    row.origin,
                    row.conversation,
                    row.surface,
                    json.dumps(list(row.options)),
                    row.summary,
                    row.capture_id,
                    str(row.status),
                    row.created_at,
                    row.expires_at,
                ),
            )
        return row

    def resolve(
        self,
        approval_id: str,
        choice: str,
        answer: str | None = None,
        *,
        now: datetime | None = None,
    ) -> ApprovalRow:
        """Record the user's answer. Refuses everything the row did not offer.

        Four refusals, and each is a way a gate has been walked through before: an unknown id, a
        row that is not ``pending`` any more (a double click, or a second surface answering the
        same card), a row whose time is up, and an answer that is not one of the tokens on the
        card. Only the fourth leaves the row usable; the third expires it on the way out.
        """
        row = self.get(approval_id)
        if row is None:
            raise ApprovalError(f"unknown approval {approval_id}")
        moment = now or _now()
        if row.pending and moment >= _parse(row.expires_at):
            self.expire_due(moment)
            raise ApprovalError(f"approval {approval_id} expired at {row.expires_at}")
        if not row.pending:
            raise ApprovalError(f"approval {approval_id} is {row.status}, not pending")
        if choice not in row.options:
            raise ApprovalError(
                f"{choice!r} is not one of the answers approval {approval_id} offered: "
                f"{list(row.options)}"
            )
        status = ApprovalStatus.APPROVED if choice == APPROVE_TOKEN else ApprovalStatus.DECLINED
        with self.brain.write_txn() as con:
            # Conditional on ``pending``: two processes that both read the card race here and
            # exactly one of them changes a row. The loser's read below sees the winner's answer.
            con.execute(
                """UPDATE companion_approval
                   SET status = ?, choice = ?, answer = ?, resolved_at = ?
                   WHERE id = ? AND status = 'pending'""",
                (str(status), choice, answer, _iso(moment), approval_id),
            )
        resolved = self.get(approval_id)
        if resolved is None:  # pragma: no cover - the row cannot vanish under its own writer
            raise ApprovalError(f"unknown approval {approval_id}")
        return resolved

    def expire_due(self, now: datetime | None = None) -> list[str]:
        """Mark every pending row past its expiry, with reason ``expired``. Returns their ids."""
        moment = _iso(now or _now())
        with self.brain.write_txn() as con:
            raws = con.execute(
                "SELECT id FROM companion_approval WHERE status = 'pending' AND expires_at <= ?",
                (moment,),
            ).fetchall()
            expired = [str(raw[0]) for raw in raws]
            if expired:
                con.execute(
                    """UPDATE companion_approval
                       SET status = 'expired', reason = ?, resolved_at = ?
                       WHERE status = 'pending' AND expires_at <= ?""",
                    (EXPIRED_REASON, moment, moment),
                )
        return expired

    # -- reading -------------------------------------------------------------------------------

    def get(self, approval_id: str) -> ApprovalRow | None:
        with closing(self.brain.read_connection()) as con:
            raw = con.execute(
                f"SELECT {_COLUMNS} FROM companion_approval WHERE id = ?", (approval_id,)
            ).fetchone()
        return None if raw is None else _row(raw)

    def describe(self, approval_id: str) -> ApprovalGrant:
        """The action and parameters this row was created for, so the gate can be replayed.

        Deliberately not ``get`` with a comment: the replay path should be handed the narrow
        thing it is allowed to ask about, and :meth:`ApprovalGrant.matches` is that question.
        """
        row = self.get(approval_id)
        if row is None:
            raise ApprovalError(f"unknown approval {approval_id}")
        return ApprovalGrant(
            id=row.id,
            action=row.action,
            params=dict(row.params),
            status=row.status,
            origin=row.origin,
            conversation=row.conversation,
            surface=row.surface,
            capture_id=row.capture_id,
            choice=row.choice,
        )

    def pending(self, limit: int = 20, *, now: datetime | None = None) -> PendingPage:
        """The live inbox, oldest first, bounded and announced.

        Ordered by ``created_at`` and then by ``rowid``, which is insertion order. The tiebreak
        matters more than it looks: five cards filed inside one millisecond share a timestamp, and
        the previous tiebreak was ``id`` — random hex, so "oldest first" came out shuffled about
        four times in five. An inbox whose order is arbitrary is an inbox where the user answers
        the wrong card.

        A row past its expiry is not listed even before the sweep has run, so the panel and the
        table agree about what is answerable at the same instant.
        """
        moment = _iso(now or _now())
        bound = max(limit, 0)
        with closing(self.brain.read_connection()) as con:
            total = int(
                con.execute(
                    "SELECT COUNT(*) FROM companion_approval "
                    "WHERE status = 'pending' AND expires_at > ?",
                    (moment,),
                ).fetchone()[0]
            )
            raws = con.execute(
                f"""SELECT {_COLUMNS} FROM companion_approval
                    WHERE status = 'pending' AND expires_at > ?
                    ORDER BY created_at ASC, rowid ASC LIMIT ?""",
                (moment, bound),
            ).fetchall()
        return PendingPage(rows=tuple(_row(raw) for raw in raws), total=total)


def _parse(stamp: str) -> datetime:
    """An ISO stamp this module wrote, back as an aware instant."""
    parsed = datetime.fromisoformat(stamp)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)

"""ADR 0124 (your runs come back to the chore): a case's runs, folded into receipts.

A run under a case keeps each tab's own conversation: the desktop sends the case's ``proj_`` id
as ``case_id`` on every ``POST /run`` while the playbook is active, which routes nothing, and
the daemon stamps each such turn under the case (``core.case_turns``, ADR 0127). A **receipt** is
what one run came to, joined by those turn ids from three records this module never writes:

- the approval table: the cards those turns filed (``turn_id``), counted by state (approved, of
  which the gate spent ``consumed``; declined; expired; pending), the first :data:`CARDS_CAP`
  shown;
- the episodes: every call that **may have completed** (``outcome_unknown``, ADR 0101), found by
  the lane's own verb :data:`~athena.lane.browser_lane.MAY_HAVE_COMPLETED`, written in a stamped
  turn's conversation while that turn ran (the daemon runs one turn at a time);
- the ledger: rows, errors, dollars and milliseconds, summed over those turn ids.

Dollars are **asked**: the amount parameter of each approved card (the bench's ``_filed_total``
rule over its own ``AMOUNT_PARAMS``), "asked, from N cards you approved". Nothing here reads a
truth file or claims what came back.

**A run** is every turn of the case that began since the end of its last receipt (or ever).
Pressing "done" on the active playbook closes it: :func:`fold` with ``until`` now, appended to
the case file's block as a dated ``receipts`` entry
(:meth:`~athena.adopt.cases.CaseBook.append_receipt`), so it survives deleting ``index.sqlite``
(the approval, ledger and case-turn tables are not rebuilt from disk). A card is in the run of
the turn that filed it, and so is a ledger row, whenever each was written.

**The next run starts where the last stopped** (ADR 0126): :func:`carry_forward` turns a case's
last receipt into the ``SinceLastRun`` the daemon hands the next turn's frame (calls whose outcome
is not known first, then approved, then declined; keys and dates, never an instruction), with the
start of that run, which the gate's "you approved this exact call" looks back to.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from contextlib import closing
from dataclasses import asdict
from datetime import UTC, datetime
from typing import Any

from athena.contracts import ids
from athena.contracts.adopt import RECEIPT_SCHEMA, Receipt, ReceiptCard, ReceiptNote, cap_text
from athena.core.approvals import ApprovalRow, Approvals
from athena.core.brain.store import Brain
from athena.core.case_turns import CaseTurn, CaseTurns
from athena.core.ledger import Ledger
from athena.core.prompt import SinceLastRun
from athena.lane.browser_lane import MAY_HAVE_COMPLETED

__all__ = [
    "AMOUNT_PARAMS",
    "ASKED_CEILING",
    "CARDS_CAP",
    "NOTES_CAP",
    "PARAMS_CAP",
    "PARAM_TEXT_CAP",
    "as_dict",
    "card_amount",
    "carry_forward",
    "empty",
    "fold",
    "of_cards",
    "receipt_line",
    "receipt_of",
    "stored",
]

#: The parameters a card names its money in, in the order they are looked for. The bench's own
#: ``AMOUNT_PARAMS`` (``tests/adopt/test_receipts.py`` holds the two equal).
AMOUNT_PARAMS = ("amount_usd", "amount_disputed_usd")
#: How many cards a receipt lists; past it the receipt says ``(showing N of M)``.
CARDS_CAP = 20
#: How many "may have completed" calls a receipt lists.
NOTES_CAP = 10
#: How many of a card's parameters a receipt keeps (amount parameters first), and how long each.
PARAMS_CAP = 6
PARAM_TEXT_CAP = 120
NOTE_TEXT_CAP = 240
#: How many approved cards the asked dollars are summed over. A run never comes near it.
ASKED_CEILING = 500


def card_amount(params: Mapping[str, Any]) -> float | None:
    """The card's own amount parameter, in dollars, or ``None``."""
    for name in AMOUNT_PARAMS:
        value = params.get(name)
        if isinstance(value, int | float) and not isinstance(value, bool):
            return float(value)
    return None


def _card(row: ApprovalRow) -> ReceiptCard:
    order = [k for k in AMOUNT_PARAMS if k in row.params]
    order += sorted(k for k in row.params if k not in AMOUNT_PARAMS)
    kept = order[:PARAMS_CAP]
    return ReceiptCard(
        id=row.id,
        action=row.action,
        status=row.status,
        consumed=row.consumed_at is not None,
        created_at=row.created_at,
        resolved_at=row.resolved_at or "",
        params={k: cap_text(_text(row.params[k]), PARAM_TEXT_CAP) for k in kept},
        more_params=len(order) - len(kept),
        amount_usd=card_amount(row.params),
    )


def _text(value: Any) -> str:
    return value if isinstance(value, str) else str(value)


def _footer(shown: int, total: int) -> str:
    return "" if shown >= total else f"(showing {shown} of {total})"


def _notes(brain: Brain, turns: Sequence[CaseTurn]) -> tuple[list[ReceiptNote], int]:
    """The run's "may have completed" episodes, oldest first, and how many there are: each one
    written in a stamped turn's conversation between that turn's start and end. A turn with no
    end (the daemon died under it) is its start alone, so it claims nothing written after."""
    windows = [[t.conversation, t.started_at, t.ended_at or t.started_at] for t in turns]
    where = (
        "n.kind = 'episode' AND n.body_excerpt LIKE ? AND EXISTS ("
        "SELECT 1 FROM json_each(?) w WHERE n.session_id = json_extract(w.value, '$[0]') "
        "AND n.created_at >= json_extract(w.value, '$[1]') "
        "AND n.created_at <= json_extract(w.value, '$[2]'))"
    )
    args: list[Any] = [f"%{MAY_HAVE_COMPLETED}%", json.dumps(windows)]
    with closing(brain.read_connection()) as con:
        total = int(
            con.execute(f"SELECT COUNT(*) FROM companion_node n WHERE {where}", args).fetchone()[0]
        )
        raws = con.execute(
            f"SELECT n.id, n.created_at FROM companion_node n WHERE {where} "
            "ORDER BY n.created_at, n.id LIMIT ?",
            [*args, NOTES_CAP],
        ).fetchall()
    notes = []
    for raw in raws:
        try:
            body = brain.read_body(str(raw[0]))
        except (OSError, KeyError, ValueError, UnicodeDecodeError):
            body = ""
        notes.append(
            ReceiptNote(
                episode_id=str(raw[0]),
                at=str(raw[1]),
                text=cap_text(" ".join(body.split()), NOTE_TEXT_CAP),
            )
        )
    return notes, total


def fold(
    brain: Brain,
    approvals: Approvals,
    ledger: Ledger,
    case_turns: CaseTurns,
    case_id: str,
    *,
    since: str = "",
    until: str = "",
    closed_by: str = "",
    closed_at: str = "",
) -> Receipt:
    """The receipt of ``case_id``'s run: its turns that began in ``since <= t < until`` (``""``
    leaves an end open), and the cards, ledger rows and episodes those turns wrote (ADR 0127)."""
    turns = case_turns.of_case(case_id, since=since, until=until)
    turn_ids = [t.turn_id for t in turns]
    page = approvals.of_turns(turn_ids, limit=CARDS_CAP)
    approved = approvals.of_turns(turn_ids, status="approved", limit=ASKED_CEILING)
    amounts = [a for row in approved.rows if (a := card_amount(row.params)) is not None]
    cost = ledger.turns_total(turn_ids)
    notes, notes_total = _notes(brain, turns)
    starts = [t.started_at for t in turns]
    finishes = [t.ended_at or t.started_at for t in turns]
    stamps = [s for s in (*starts, page.first_at, cost.first_at, *(n.at for n in notes)) if s]
    ends = [s for s in (*finishes, page.last_at, cost.last_at, *(n.at for n in notes)) if s]
    cards = tuple(_card(row) for row in page.rows)
    return Receipt(
        case_id=case_id,
        conversation_id="",
        since=since,
        until=until,
        first_at=min(stamps) if stamps else "",
        last_at=max(ends) if ends else "",
        turns=len(turns),
        approved=page.by_status.get("approved", 0),
        consumed=page.consumed,
        declined=page.by_status.get("declined", 0),
        expired=page.by_status.get("expired", 0),
        pending=page.by_status.get("pending", 0),
        asked_usd=round(sum(amounts), 2) if amounts else None,
        asked_cards=len(amounts),
        calls=cost.calls,
        errors=cost.errors,
        cost_usd=round(cost.cost_usd, 6),
        unpriced=cost.unpriced,
        ms=cost.ms,
        cards=cards,
        cards_total=page.total,
        cards_footer=_footer(len(cards), page.total),
        notes=tuple(notes),
        notes_total=notes_total,
        notes_footer=_footer(len(notes), notes_total),
        closed_by=closed_by,
        closed_at=closed_at,
    )


def of_cards(
    case_id: str, rows: Sequence[ApprovalRow], *, until: str = "", closed_at: str = ""
) -> Receipt:
    """A receipt of a run known by its cards rather than by a conversation (ADR 0126): the
    bench's second run, whose turns stay in each portal's own conversation. Counts and the first
    :data:`CARDS_CAP` cards from ``rows`` as the approval table holds them; no ledger, no notes."""
    states = ("approved", "declined", "expired", "pending")
    count = {state: sum(1 for r in rows if r.status == state) for state in states}
    approved = [r for r in rows if r.status == "approved"]
    amounts = [a for r in approved if (a := card_amount(r.params)) is not None]
    cards = tuple(_card(row) for row in rows[:CARDS_CAP])
    stamps = sorted(r.created_at for r in rows if r.created_at)
    return Receipt(
        case_id=case_id,
        conversation_id="",
        since=stamps[0] if stamps else "",
        until=until,
        first_at=stamps[0] if stamps else "",
        last_at=stamps[-1] if stamps else "",
        approved=count["approved"],
        consumed=sum(1 for r in approved if r.consumed_at is not None),
        declined=count["declined"],
        expired=count["expired"],
        pending=count["pending"],
        asked_usd=round(sum(amounts), 2) if amounts else None,
        asked_cards=len(amounts),
        cards=cards,
        cards_total=len(rows),
        cards_footer=_footer(len(cards), len(rows)),
        closed_by="done",
        closed_at=closed_at,
    )


def empty(receipt: Receipt) -> bool:
    """Nothing ran in the window: no turn, no card, no ledger row, no call that may have
    completed."""
    return (
        receipt.turns == 0
        and receipt.cards_total == 0
        and receipt.calls == 0
        and receipt.notes_total == 0
    )


def receipt_line(receipt: Receipt) -> str:
    """One line of the case file's "Your runs" section, for a person reading the markdown."""
    when = (receipt.closed_at or receipt.until or receipt.last_at)[:10] or "an open run"
    parts = [
        f"{receipt.approved} approved ({receipt.consumed} let through)",
        f"{receipt.declined} declined",
        f"{receipt.expired} expired",
        f"{receipt.pending} waiting",
    ]
    if receipt.notes_total:
        parts.append(f"{receipt.notes_total} may have completed")
    if receipt.asked_usd is not None:
        n = receipt.asked_cards
        parts.append(
            f"${receipt.asked_usd:,.2f} asked, from {n} card{'' if n == 1 else 's'} you approved"
        )
    parts.append(f"${receipt.cost_usd:,.2f} over {receipt.calls} ledger rows")
    return f"- run closed {when}: " + ", ".join(parts)


# --- the next run's frame (ADR 0126) -------------------------------------------------------------

#: How many of a card's key parameters a "since last run" line names, and how long each.
CARRY_PARAMS = 3
CARRY_PARAM_TEXT = 60
#: How long one "since last run" line may be.
CARRY_LINE_CAP = 240


def carry_forward(receipt: Receipt) -> SinceLastRun:
    """What ``receipt``'s run came to, for the next run's frame (``core.prompt.SinceLastRun``).

    Lines in this order: cards that expired or were still waiting when the run closed, then calls
    that may have completed, then approved cards, then declined ones; each names its action, at
    most :data:`CARRY_PARAMS` key parameters and a date. The total is every card and every "may
    have completed" call the receipt counted, so a receipt that kept only its first cards says
    so. ``started`` is where the run began: the receipt's window start, or its first activity for
    a case's first run.
    """
    unknown = [c for c in receipt.cards if c.status in ("expired", "pending")]
    approved = [c for c in receipt.cards if c.status == "approved"]
    declined = [c for c in receipt.cards if c.status == "declined"]
    lines = [_carry_card(c) for c in unknown]
    lines += [
        cap_text(f"may have completed ({_day(n.at)}): {n.text}", CARRY_LINE_CAP)
        for n in receipt.notes
    ]
    lines += [_carry_card(c) for c in (*approved, *declined)]
    started = receipt.since or receipt.first_at
    closed = receipt.closed_at or receipt.until or receipt.last_at
    first, last = _day(started), _day(closed)
    window = first if first == last else f"{first} to {last}"
    return SinceLastRun(
        window=window or "date not recorded",
        lines=tuple(lines),
        total=receipt.cards_total + receipt.notes_total,
        started=started,
    )


def _carry_card(card: ReceiptCard) -> str:
    keys = list(card.params)[:CARRY_PARAMS]
    named = ", ".join(f"{k}={cap_text(card.params[k], CARRY_PARAM_TEXT)}" for k in keys)
    more = len(card.params) - len(keys) + card.more_params
    if more:
        named += f" (+{more} more)"
    if card.status == "approved":
        how = f"approved {_day(card.resolved_at)}" + ("" if card.consumed else ", not let through")
    elif card.status == "declined":
        how = f"declined {_day(card.resolved_at)}"
    elif card.status == "expired":
        how = f"expired unanswered (filed {_day(card.created_at)})"
    else:
        how = f"still waiting when the run closed (filed {_day(card.created_at)})"
    return cap_text(f"{how}: {card.action} {named}".rstrip(), CARRY_LINE_CAP)


def _day(stamp: str) -> str:
    """``"Oct 15"`` for an ISO stamp, in local time; ``""`` for none or a stamp that is not one."""
    if not stamp:
        return ""
    try:
        value = datetime.fromisoformat(stamp)
    except ValueError:
        return ""
    local = (value if value.tzinfo else value.replace(tzinfo=UTC)).astimezone()
    return f"{local.strftime('%b')} {local.day}"


# --- reading a stored receipt --------------------------------------------------------------------


def receipt_of(raw: Any) -> Receipt | None:
    """A receipt from the case file's ``receipts`` list, each field read to its type; ``None``
    for an entry that is not one (no case id, another schema)."""
    if not isinstance(raw, Mapping) or raw.get("schema") != RECEIPT_SCHEMA:
        return None
    case_id = _s(raw.get("case_id"))
    if not ids.is_id("project", case_id):
        return None
    cards = tuple(
        ReceiptCard(
            id=_s(c.get("id")),
            action=_s(c.get("action")),
            status=_s(c.get("status")),
            consumed=c.get("consumed") is True,
            created_at=_s(c.get("created_at")),
            resolved_at=_s(c.get("resolved_at")),
            params={str(k): _s(v) for k, v in _d(c.get("params")).items()},
            more_params=_i(c.get("more_params")),
            amount_usd=_f(c.get("amount_usd")),
        )
        for c in _l(raw.get("cards"))
        if isinstance(c, Mapping)
    )
    notes = tuple(
        ReceiptNote(episode_id=_s(n.get("episode_id")), at=_s(n.get("at")), text=_s(n.get("text")))
        for n in _l(raw.get("notes"))
        if isinstance(n, Mapping)
    )
    return Receipt(
        case_id=case_id,
        conversation_id=_s(raw.get("conversation_id")),
        since=_s(raw.get("since")),
        until=_s(raw.get("until")),
        first_at=_s(raw.get("first_at")),
        last_at=_s(raw.get("last_at")),
        turns=_i(raw.get("turns")),
        approved=_i(raw.get("approved")),
        consumed=_i(raw.get("consumed")),
        declined=_i(raw.get("declined")),
        expired=_i(raw.get("expired")),
        pending=_i(raw.get("pending")),
        asked_usd=_f(raw.get("asked_usd")),
        asked_cards=_i(raw.get("asked_cards")),
        calls=_i(raw.get("calls")),
        errors=_i(raw.get("errors")),
        cost_usd=_f(raw.get("cost_usd")) or 0.0,
        unpriced=_i(raw.get("unpriced")),
        ms=_i(raw.get("ms")),
        cards=cards,
        cards_total=_i(raw.get("cards_total")),
        cards_footer=_s(raw.get("cards_footer")),
        notes=notes,
        notes_total=_i(raw.get("notes_total")),
        notes_footer=_s(raw.get("notes_footer")),
        closed_by=_s(raw.get("closed_by")),
        closed_at=_s(raw.get("closed_at")),
    )


def stored(extra: Mapping[str, Any]) -> list[Receipt]:
    """The receipts a case file's block holds, oldest first; unreadable entries passed over."""
    return [r for x in _l(extra.get("receipts")) if (r := receipt_of(x)) is not None]


def as_dict(receipt: Receipt) -> dict[str, Any]:
    return asdict(receipt)


def _s(value: Any) -> str:
    return value if isinstance(value, str) else ""


def _i(value: Any) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def _f(value: Any) -> float | None:
    if isinstance(value, int | float) and not isinstance(value, bool):
        return float(value)
    return None


def _d(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _l(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []

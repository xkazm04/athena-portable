"""The decision routes: ``POST /decisions/<id>`` and ``GET /decisions`` (README §3.2 steps 4 and 6).

One cohesive unit: the user's answer to a card, and the inbox of cards still waiting. The answer
replays the gate under :func:`_decision_ctx`, which reads the same ``disabled_origins`` list the
run route parses, so the parsers stay in :mod:`athena.daemon.routes` and this module imports them —
one way only. :mod:`athena.daemon.routes` imports :func:`decide` and :func:`decisions` back at the
foot of its module, once everything this module takes from it is defined, so the route table and
``routes.decide`` are unchanged.
"""

from __future__ import annotations

from dataclasses import replace
from typing import TYPE_CHECKING, Any

from athena.contracts import ids
from athena.contracts.registry import Lane, TurnContext, parse_origin
from athena.core.approvals import ApprovalError, ApprovalRow
from athena.daemon.routes import (
    ANSWER_CAP,
    NO_PAGE_SENTENCE,
    PENDING_CEILING,
    ListTooLong,
    Reply,
    Request,
    announced,
    bounded,
    capped,
    disabled_origins_from,
    error,
    stamp_case_turn,
)

if TYPE_CHECKING:
    from athena.daemon.server import AthenaDaemon

__all__ = ["decide", "decisions"]


# --- POST /decisions/<id> ------------------------------------------------------------------------


def decide(daemon: AthenaDaemon, request: Request, approval_id: str) -> Reply:
    """The user's answer to one card (README §3.2 step 6).

    The lane resolves the row, replays the gate with the approval id and hands back either an
    ``execute`` instruction — a host tool the page runs, carrying the parameters off the *row* and
    not off this request — or the result of a core tool that ran here. The conversation comes off
    the row too, so a card filed under a project is answered and recorded under that project.

    The answer holds its card's lock (:meth:`AthenaDaemon.card`, ADR 0152) and never the daemon's
    write lock: a core or connector card runs its executor inside the replay, an outbound call of
    up to twenty seconds, and no manifest, other card or spoken answer waits on it. The lock covers
    resolve through spend, so two answers to one card still run one after the other.
    """
    choice = str(request.body.get("choice", "")).strip()
    if not choice:
        return error(400, "validator_failed", "a decision needs a choice")
    answer = request.body.get("answer")

    try:
        grant = daemon.approvals.describe(approval_id)
    except ApprovalError as exc:
        return error(404, "unknown_ref", str(exc))

    stated = str(request.body.get("origin", "")).strip()
    refusal = _origin_refusal(daemon, grant.origin, stated)
    if refusal is not None:
        return refusal

    try:
        disabled = disabled_origins_from(request.body)
    except ListTooLong as exc:  # refused whole, as ``POST /run`` refuses it
        return error(400, "validator_failed", str(exc))
    ctx = _decision_ctx(daemon, grant.origin, grant.conversation, disabled)
    # A card filed by a turn under a case is answered under that case too, so the row the answer
    # writes (a decline is ledgered) is in the case's run with the card (ADR 0127).
    row = daemon.approvals.get(approval_id)
    case_id = daemon.case_turns.case_of(row.turn_id) if row and row.turn_id else None
    if case_id is not None:
        ctx = replace(ctx, case_id=case_id)
    with daemon.card(approval_id):
        stamped = stamp_case_turn(daemon, ctx)
        try:
            resolution = daemon.lane.answer_decision(approval_id, choice, ctx)
        finally:
            if stamped:
                daemon.case_turns.finish(ctx.turn_id)
    if resolution.reason is not None and resolution.reason != "user_denied":
        return error(409, resolution.reason, resolution.detail)

    if answer is not None and str(answer).strip():
        # The user typed something beside the button. It is theirs, so it is recorded as an
        # episode of the same conversation and never mixed into the grant the replay proved —
        # the grant is what the user was shown, and a sentence beside it does not change it.
        daemon.brain.append_episode(
            f"[decision] the user added: {capped(str(answer), ANSWER_CAP)}",
            "user",
            session_id=grant.conversation,
        )

    execute = [] if resolution.execute is None else [_execute_row(resolution.execute)]
    return 200, {
        "ok": True,
        "id": approval_id,
        "status": "approved" if resolution.approved else "declined",
        "choice": choice,
        "conversation_id": grant.conversation,
        "execute": execute,
        "output": "" if resolution.result is None else resolution.result.output,
        "events": [event.to_dict() for event in resolution.events],
    }


def _execute_row(instruction: Any) -> dict[str, Any]:
    """One ``execute`` instruction on the wire: what to run, with which parameters, where."""
    return {
        "call_id": instruction.call_id,
        "name": instruction.name,
        "params": dict(instruction.params),
        "origin": instruction.origin,
        "tier": instruction.tier,
        "approval_id": instruction.approval_id,
        # The tab the card was proposed on and its document generation (ADR 0103); null on an
        # unbound row, which runs where it always did.
        "tab_id": instruction.tab_id,
        "tab_nav": instruction.tab_nav,
    }


def _origin_refusal(daemon: AthenaDaemon, grant_origin: str, stated: str) -> Reply | None:
    """Refuse a surface answering another origin's card.

    An origin on the body is optional — the row already knows which app it belongs to — but when
    one is given it must be a live session for *that* app. A panel that answered a neighbouring
    page's card would be the browser half of ``foreign_origin``, and it is refused with the same
    word the gate uses.
    """
    if not stated:
        return None
    session = daemon.sessions.get(stated)
    if session is None:
        return error(403, "foreign_origin", NO_PAGE_SENTENCE)
    try:
        parsed = parse_origin(grant_origin)
    except ValueError as exc:  # pragma: no cover - a row cannot hold an unparseable origin
        return error(500, "unknown", str(exc))
    if parsed.kind == "host" and parsed.id != session.app_id:
        return error(
            403,
            "foreign_origin",
            f"{stated} is pinned to host:{session.app_id} and this card belongs to {grant_origin}",
        )
    return None


def _decision_ctx(
    daemon: AthenaDaemon,
    grant_origin: str,
    conversation: str,
    disabled_origins: frozenset[str] = frozenset(),
) -> TurnContext:
    """The context the gate is replayed under.

    It is built from the *card's* origin rather than from the request, so structural policy sees
    the app the card belongs to and the page origin that app's manifest was published from. A card
    for an app whose session has since gone carries no page origin, and rule 3 then compares the
    app alone — which is the honest amount that is still known.
    """
    try:
        parsed = parse_origin(grant_origin)
    except ValueError:  # pragma: no cover - a row cannot hold an unparseable origin
        parsed = None
    app_id = parsed.id if parsed is not None and parsed.kind == "host" else None
    page_origin = None
    if app_id is not None:
        page_origin = next(
            (s.origin for s in daemon.sessions.all() if s.app_id == app_id),
            None,
        )
    return TurnContext(
        conversation_id=conversation,
        turn_id=ids.mint("turn"),
        lane=Lane.BROWSER,
        surface="panel",
        app_id=app_id,
        page_origin=page_origin,
        disabled_origins=disabled_origins,
    )


# --- GET /decisions ------------------------------------------------------------------------------


def decisions(daemon: AthenaDaemon, request: Request) -> Reply:
    """The inbox: every card still waiting on the user, oldest first (README §3.2 step 4).

    One list across origins and projects, because a card knows its conversation and not its page.
    Read only — answering still goes through ``POST /decisions/<id>`` and the gate. ``total`` is
    the live pending population up to :data:`PENDING_CEILING`, and the footer says what was shown.
    """
    limit = bounded(request.query.get("limit"))
    page = daemon.approvals.pending(PENDING_CEILING)
    rows = [_decision_row(row) for row in page.rows[:limit]]
    return 200, announced(rows, page.total, "pending")


def _decision_row(row: ApprovalRow) -> dict[str, Any]:
    return {
        "id": row.id,
        "action": row.action,
        "params": dict(row.params),
        "rationale": row.summary,
        "options": list(row.options),
        "origin": row.origin,
        "conversation_id": row.conversation,
        "surface": row.surface,
        "created_at": row.created_at,
        "expires_at": row.expires_at,
        "tab_id": row.tab_id,
        "tab_nav": row.tab_nav,
    }

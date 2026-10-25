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
    turn_space,
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
    # The answer runs in the project the filing turn ran in (ADR 0225) - its case's when it has
    # one, as a turn does - so the episode a decline writes and the fact an approval writes are
    # stamped where they were asked for. A project erased since is not answered into.
    space = turn_space(daemon, ctx.case_id, row.space_id if row is not None else "")
    if space and not daemon.space_open(space):
        return error(400, "unknown_ref", f"no such space: the card's project {space} is gone")
    ctx = replace(ctx, space_id=space)
    with daemon.card(approval_id), daemon.in_space(space) as entered:
        if not entered:
            return error(400, "unknown_ref", f"no such space: {space} is being erased")
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
            space=space,
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

    Each row also says whether approving it would run (ADR 0158): ``will_run``, and ``blocked``
    with the refusal the replay would give, a plain sentence and the one act that fixes it. The
    optional ``?disabled_origins=`` (a comma list) is the shell's switched-off table, capped and
    refused whole as ``POST /run`` refuses it.
    """
    limit = bounded(request.query.get("limit"))
    names = [name for name in request.query.get("disabled_origins", "").split(",") if name.strip()]
    try:
        disabled = disabled_origins_from({"disabled_origins": names})
    except ListTooLong as exc:  # refused whole, as ``POST /run`` refuses it, never cut
        return error(400, "validator_failed", str(exc))
    page = daemon.approvals.pending(PENDING_CEILING)
    rows = [_decision_row(row, _preflight(daemon, row, disabled)) for row in page.rows[:limit]]
    return 200, announced(rows, page.total, "pending")


def _decision_row(row: ApprovalRow, blocked: dict[str, Any] | None) -> dict[str, Any]:
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
        "will_run": blocked is None,
        "blocked": blocked,
    }


# --- the inbox's preflight (ADR 0158) ------------------------------------------------------------


def _preflight(
    daemon: AthenaDaemon, row: ApprovalRow, disabled: frozenset[str]
) -> dict[str, Any] | None:
    """What the replay would refuse this card with if it were approved now, or ``None``.

    The same two reads :meth:`~athena.lane.browser_lane.BrowserLane.answer_decision` makes before
    it runs anything, in the same order and under the same context: the catalog entry (gone is
    ``tools_gone``), then the gate's own :meth:`~athena.harness.policy.Policy.authorize`. Both are
    pure, so the inbox resolves, consumes and writes nothing. It is the gate's rules asked early,
    not a second gate: the replay still decides.
    """
    try:
        entry = daemon.catalog.get(row.action)
    except ValueError:
        return _gone(daemon, row.origin)
    ctx = _decision_ctx(daemon, row.origin, row.conversation, disabled)
    decision = daemon.gate.policy.authorize(entry, row.params, ctx)
    if decision.allow:
        return None
    return _blocked(daemon, decision.rule, decision.reason or "unknown", str(entry.parsed_origin))


def _gone(daemon: AthenaDaemon, origin: str) -> dict[str, Any]:
    """A card whose tools left the catalog: the page closed, or the connector went."""
    try:
        parsed = parse_origin(origin)
    except ValueError:  # pragma: no cover - a row cannot hold an unparseable origin
        parsed = None
    if parsed is not None and parsed.kind == "connector":
        return {
            "reason": "unknown_ref",
            "rule": "tools_gone",
            "sentence": f"{parsed.id} is no longer connected, so this cannot run. Reconnect it "
            "and approve again.",
            "remedy": {"act": "reconnect", "connector": parsed.id},
        }
    app = parsed.id if parsed is not None else origin
    page = daemon.gate.policy.pinned_origins.get(app)
    return {
        "reason": "unknown_ref",
        "rule": "tools_gone",
        "sentence": f"The {app} page this acts on is no longer open, so its tools are gone. Open "
        "it again and approve.",
        "remedy": {"act": "open_app", "origin": page},
    }


def _blocked(daemon: AthenaDaemon, rule: str, reason: str, origin: str) -> dict[str, Any]:
    """A policy refusal as the inbox says it: the rule, a sentence a person reads, one fix."""
    parsed = parse_origin(origin)
    name = parsed.id or origin
    sentence = "This cannot run from the inbox."
    remedy: dict[str, Any] | None = None
    if rule == "origin_enabled":
        sentence = f"{name} is switched off, so this will not run. Switch it on to approve it."
        remedy = {"act": "switch_on", "origin": origin}
    elif rule == "origin_pinning":
        page = daemon.gate.policy.pinned_origins.get(name)
        sentence = (
            f"The {name} tab is no longer on the site it was opened from. Open it again to "
            "approve this."
        )
        remedy = {"act": "open_app", "origin": page}
    elif rule == "connector_enabled":
        sentence = f"{name} is not connected right now. Reconnect it to approve this."
        remedy = {"act": "reconnect", "connector": name}
    return {"reason": reason, "rule": rule, "sentence": sentence, "remedy": remedy}

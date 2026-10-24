"""The three hooks every engine runs behind (README §3.2 steps 3 to 6, §3.3; ADR 0004, 0007).

- :class:`GateHook` — the policy. Class first, validator always, executor only if both allow.
- :class:`LedgerHook` — one row per turn, failures included, written exactly once.
- :class:`TruncationHook` — a tripwire on every composed block, never a cap and never a block.

They are plain classes and not engine callbacks, because that is what makes the gate the *same*
behind the Claude dialect, the codex dialect and any later engine: an engine calls these, it does
not reimplement them. A model never decides whether something is gated, and neither does a
dialect.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from athena.contracts import ids
from athena.contracts.channel import DecisionRequested
from athena.contracts.harness import PromptBlock, TurnResult, normalize_reason
from athena.contracts.registry import ExecResult, OpenApp, ToolClass, ToolEntry, TurnContext
from athena.harness.ports import (
    ApprovalsPort,
    CatalogPort,
    FlagPort,
    LedgerPort,
    SpentLookupPort,
)

__all__ = [
    "Cancel",
    "GateDecision",
    "GateHook",
    "GateOutcome",
    "LedgerHook",
    "Proceed",
    "TruncationHook",
    "TurnFlag",
    "another_tab",
    "open_app_for",
]


# --- what the gate answers -----------------------------------------------------------------------


@dataclass(frozen=True)
class Proceed:
    """The call may execute now, with these parameters."""

    params: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Cancel:
    """The call does not happen, and the model is told why.

    ``reason`` is a member of ``ERROR_REASONS`` — normalised on construction, so a reason invented
    at a call site becomes ``unknown`` here rather than becoming a ledger column value nobody can
    group by. ``detail`` is the sentence beside it and carries no secret.
    """

    reason: str
    detail: str = ""
    approval_id: str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "reason", normalize_reason(self.reason) or "unknown")


GateDecision = Proceed | Cancel


@dataclass(frozen=True)
class GateOutcome:
    """One trip through the gate: what was decided, what ran, and the card it filed if it filed one.

    ``result`` is ``None`` in two different situations and the caller must keep them apart: the
    call was refused, or the call was allowed and the tool has no executor here because the page
    runs it (README §3.2 step 5). :attr:`allowed` is the question to ask.
    """

    decision: GateDecision
    result: ExecResult | None = None
    card: DecisionRequested | None = None

    @property
    def allowed(self) -> bool:
        return isinstance(self.decision, Proceed)


def _capture_for(entry: ToolEntry, ctx: TurnContext) -> str | None:
    """The capture a card carries: the focused tab's, and only for the session's own host origin.

    The surface captured the tab it is looking at. A connector's, core's or another app's call is
    not about that page, so a screenshot on its card would show the user something else (README
    §3.5, ADR 0066).
    """
    if ctx.capture_id is None or not ctx.app_id or entry.origin != f"host:{ctx.app_id}":
        return None
    return ctx.capture_id


def _tab_for(entry: ToolEntry, ctx: TurnContext) -> dict[str, int]:
    """The tab binding a card carries (ADR 0103, 0106).

    The surface said which tab and which document generation it ran the request against. A call
    on that page's app is bound to them, so its approval runs there or not at all. A call of
    another open, trusted app is bound to *that* app's tab, as the surface listed it in
    ``open_apps`` - never to anything a model said. A connector's or core's call is not about a
    tab and stays unbound. Destination binding, not a class change: whether the call files a card
    is decided before this is read.
    """
    opened = open_app_for(entry, ctx)
    if opened is not None:
        bound = {"tab_id": opened.tab_id}
        if opened.tab_nav is not None:
            bound["tab_nav"] = opened.tab_nav
        return bound
    if ctx.tab_id is None or not ctx.app_id or entry.origin != f"host:{ctx.app_id}":
        return {}
    bound = {"tab_id": ctx.tab_id}
    if ctx.tab_nav is not None:
        bound["tab_nav"] = ctx.tab_nav
    return bound


def another_tab(entry: ToolEntry, ctx: TurnContext) -> bool:
    """Is this a host tool of an app other than the one the session is pinned to (ADR 0106)?

    Such a call is never run unattended, whatever its class: a ``READ`` or ``AUTO`` tool of
    another tab is ``GATED`` here, so the only thing a session can do with another app's tools is
    propose a card. A session with no pin (MCP) has no "other" app.
    """
    origin = entry.parsed_origin
    return origin.kind == "host" and bool(ctx.app_id) and origin.id != ctx.app_id


def open_app_for(entry: ToolEntry, ctx: TurnContext) -> OpenApp | None:
    """The open, trusted tab of another app this call would be proposed on, or ``None``.

    Read from ``ctx.open_apps``, which the surface sets from the shell's tab list and the origins
    table. Fails closed twice over: an app the same request also names first sight
    (``gated_origins``) or switched off (``disabled_origins``) is not open here, and an app listed
    more than once is ambiguous about its tab and is not open either.
    """
    if not another_tab(entry, ctx):
        return None
    name = str(entry.parsed_origin)
    if name in ctx.gated_origins or name in ctx.disabled_origins:
        return None
    found = [app for app in ctx.open_apps if app.origin == name]
    return found[0] if len(found) == 1 else None


def _cross_tab_line(entry: ToolEntry, ctx: TurnContext) -> str:
    """The card's line for a proposal on another tab, or ``""`` (ADR 0106)."""
    if not another_tab(entry, ctx):
        return ""
    return f"proposed from the host:{ctx.app_id} tab; it runs on the {entry.origin} tab"


#: The shortest a card's "you approved this exact call" ever looks back: the day a card lives,
#: ``athena.core.approvals.SPENT_LOOKBACK`` (``tests/harness/test_ports.py`` holds the two equal).
SPENT_AT_LEAST = timedelta(hours=24)


def _may_have_run(
    approvals: ApprovalsPort,
    action: str,
    params: Mapping[str, Any],
    since: str | None = None,
    *,
    now: datetime | None = None,
) -> str:
    """The card's line for a call the user approved and the gate let through recently.

    A write that outlived its deadline is ``outcome_unknown`` on the surface, which gates the tool
    until a card about it is answered (ADR 0101). That card must not read like a first ask: the
    same call may already have happened. Informs, never blocks; ``""`` when there is nothing to say.

    "Recently" is the last day, unless the turn is under a chore whose case has a stored run
    (``since``, ``TurnContext.spent_since``, ADR 0126): then it reaches back to where that run
    began, never less than a day, and the line names the date as well as the time, because the
    yes may be weeks old.
    """
    if not isinstance(approvals, SpentLookupPort):
        return ""
    began = _stamp(since) if since else None
    if began is None:
        stamp = approvals.spent_recently(action, params)
    else:
        within = max((now or datetime.now(UTC)) - began, SPENT_AT_LEAST)
        stamp = approvals.spent_recently(action, params, within=within)
    if not stamp:
        return ""
    at = _stamp(stamp)
    if at is None:
        return ""
    local = at.astimezone()
    clock = local.strftime("%H:%M")
    if began is None:
        return f"You approved this exact call at {clock} and it may already have run."
    day = f"{local.strftime('%b')} {local.day}"
    return f"You approved this exact call on {day} at {clock} and it may already have run."


def _stamp(text: str) -> datetime | None:
    """An ISO stamp as an aware datetime (UTC when it names no zone), or ``None``."""
    try:
        value = datetime.fromisoformat(text)
    except ValueError:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


class GateHook:
    """The gate (README §3.3). Every tool call in this repository passes through here.

    The order is the policy and is not an implementation detail. The validator runs *before* the
    class is acted on, so a ``GATED`` call with parameters that could never have executed is
    refused instead of becoming a card the user is asked to approve — the user's attention is the
    scarcest thing at the gate, and a card that would fail anyway spends it for nothing.
    """

    def __init__(self, catalog: CatalogPort, approvals: ApprovalsPort) -> None:
        self.catalog = catalog
        self.approvals = approvals

    # -- the decision ------------------------------------------------------------------------------

    def before_tool_call(
        self,
        entry: ToolEntry,
        params: Mapping[str, Any],
        ctx: TurnContext,
        *,
        rationale: str = "",
    ) -> GateOutcome:
        """Decide, and file a card if the class says to. Nothing executes on this path."""
        verdict = self.catalog.validate(entry.name, dict(params), ctx)
        if not verdict.ok:
            return GateOutcome(
                Cancel(
                    verdict.reason or "validator_failed",
                    verdict.detail or f"{entry.name}: the catalog refused these parameters",
                )
            )

        if self.catalog.classify(entry.name) is not ToolClass.GATED and not _tightened(entry, ctx):
            return GateOutcome(Proceed(dict(params)))

        capture = _capture_for(entry, ctx)
        notice = "\n".join(
            line
            for line in (
                _may_have_run(self.approvals, entry.name, params, ctx.spent_since),
                _taint_line(entry, ctx),
                _cross_tab_line(entry, ctx),
            )
            if line
        )
        # Only a card that has a capture names one, so a table that predates the column is asked
        # nothing new; the same for the tab binding, so an unbound card asks nothing new either.
        optional: dict[str, Any] = {"capture_id": capture} if capture else {}
        optional.update(_tab_for(entry, ctx))
        # The turn that filed it, so a case's run finds its cards by turn (ADR 0127). A context
        # built by hand with no minted turn id files the card as it always did.
        if ids.is_id("turn", ctx.turn_id):
            optional["turn_id"] = ctx.turn_id
        card = self.approvals.create(
            entry.name,
            dict(params),
            origin=entry.origin,
            conversation=ctx.conversation_id,
            surface=ctx.surface,
            summary=f"{rationale}\n{notice}" if rationale and notice else (rationale or notice),
            **optional,
        )
        return GateOutcome(
            Cancel(
                "pending_approval",
                f"{entry.name} is gated; approval {card.id} is waiting on the user",
                approval_id=card.id,
            ),
            card=card.to_event(),
        )

    # -- the decision, then the execution ----------------------------------------------------------

    def run_tool(
        self,
        entry: ToolEntry,
        params: Mapping[str, Any],
        ctx: TurnContext,
        *,
        rationale: str = "",
        approval_id: str | None = None,
    ) -> GateOutcome:
        """The one path to an executor. There is no other way to reach one.

        ``approval_id`` is README §3.2 step 6: the gate replayed once the user has answered. The
        replay proves the grant covers *this* action with *these* parameters before anything runs,
        so an approved card can never be spent on a second, different call — and it spends the
        grant as it lets the call through, so the same card can never run the same call twice
        either, whoever the caller is (ADR 0038).
        """
        if approval_id is not None:
            refusal = self._check_grant(entry, params, approval_id)
            if refusal is not None:
                return GateOutcome(refusal)
            return GateOutcome(Proceed(dict(params)), self._execute(entry, dict(params), ctx))

        outcome = self.before_tool_call(entry, params, ctx, rationale=rationale)
        if not isinstance(outcome.decision, Proceed):
            return outcome
        return GateOutcome(
            outcome.decision, self._execute(entry, outcome.decision.params, ctx), outcome.card
        )

    def _check_grant(
        self, entry: ToolEntry, params: Mapping[str, Any], approval_id: str
    ) -> Cancel | None:
        try:
            grant = self.approvals.describe(approval_id)
        except ValueError as exc:
            return Cancel("unknown_ref", f"approval {approval_id}: {exc}", approval_id=approval_id)
        if not grant.approved:
            reason = _STATUS_REASONS.get(grant.status, "pending_approval")
            return Cancel(
                reason,
                f"approval {approval_id} is {grant.status}, not approved",
                approval_id=approval_id,
            )
        if not grant.matches(entry.name, params):
            # Deliberately ``validator_failed`` and not ``user_denied``: the user granted
            # something, and what arrived is not it. The refusal is about the parameters.
            return Cancel(
                "validator_failed",
                f"approval {approval_id} was not granted for {entry.name} with these parameters",
                approval_id=approval_id,
            )
        # Single use is policy, so it lives here and not in whichever caller happens to hold the
        # id (ADR 0038). The spend is the table's one conditional write, so of two replays racing
        # on one approval exactly one gets ``True``; and it happens *before* anything executes, so
        # a crash mid-execute leaves a spent grant rather than a replayable one. Fail closed: an
        # action the user approved once may run at most once, never at least once.
        if not self.approvals.consume(approval_id):
            # ``False`` also means a decline (ADR 0060) or an expiry closed the row between the
            # read above and this write; the user who said no is not told the action ran.
            try:
                now = self.approvals.describe(approval_id)
            except ValueError:
                now = None
            if now is not None and now.status in ("declined", "expired"):
                return Cancel(
                    _STATUS_REASONS[now.status],
                    f"approval {approval_id} is {now.status}, not approved",
                    approval_id=approval_id,
                )
            return Cancel(
                "approval_spent",
                f"approval {approval_id} has already been spent on {entry.name}",
                approval_id=approval_id,
            )
        return None

    def _execute(
        self, entry: ToolEntry, params: dict[str, Any], ctx: TurnContext
    ) -> ExecResult | None:
        if entry.executor is None:
            # A host tool. The gate allowed it; the page runs it and the answer arrives in the
            # next turn's frame (README §3.2 step 5). The lane holds no executor for it.
            return None
        return self.enforce_cap(entry, entry.executor(params, ctx))

    # -- the READ cap -----------------------------------------------------------------------------

    @staticmethod
    def enforce_cap(entry: ToolEntry, result: ExecResult) -> ExecResult:
        """Cap a ``READ`` answer and make it say what it cut (README §3.3, §2 invariant 4).

        The cap is the catalog's (``cap_chars``, 1,600 by default), not the executor's: an
        executor that returns a page of HTML must not be trusted to decide how much of it the
        model sees. An answer that is already honest about its truncation is left exactly as it is.
        """
        cap = entry.cap_chars
        if cap is None or len(result.output) <= cap:
            return _announced(result)
        total = result.total if result.total is not None else len(result.output)
        return _announced(
            ExecResult(
                ok=result.ok,
                output=result.output[:cap],
                shown=cap,
                total=max(total, cap + 1),
                error=result.error,
                tier=result.tier,
                ms=result.ms,
            )
        )


#: An approval that is not approved, mapped onto the closed reason set.
_STATUS_REASONS: Mapping[str, str] = {
    "pending": "pending_approval",
    "declined": "user_denied",
    "expired": "expired",
}


#: The shell hand that reads another open tab (``hands.rs`` ``TABS_READ``, ADR 0105).
TABS_READ = "tabs_read"


def _reads_another_tab(entry: ToolEntry) -> bool:
    """Is this the shell's ``tabs_read`` hand? A page's own tool of that name is tier 1, not it."""
    return entry.tier == 2 and entry.name.rsplit(".", 1)[-1] == TABS_READ


def _tainted(entry: ToolEntry, ctx: TurnContext) -> bool:
    """Whether text read from another tab this exchange makes this host call ``GATED`` (ADR 0105).

    Once a ``tabs_read`` has returned another tab's text, a figure from it could ride into any call
    on the focused page, an ``AUTO`` one included, with nobody seeing it. So until the user speaks
    again every host call files a card - page tools and hands alike - except the reading hand
    itself, which acts nowhere and only brings back more of what is already in the turn.
    """
    if not ctx.tainted_by or entry.parsed_origin.kind != "host":
        return False
    return not _reads_another_tab(entry)


def _taint_line(entry: ToolEntry, ctx: TurnContext) -> str:
    """The card's line naming the tabs whose text this turn read, or ``""`` (ADR 0105)."""
    if not _tainted(entry, ctx):
        return ""
    return f"uses text read from {', '.join(sorted(ctx.tainted_by))}"


def _tightened(entry: ToolEntry, ctx: TurnContext) -> bool:
    """Whether the user's origins table makes this host tool ``GATED`` for this turn (ADR 0063).

    A page's flags are its own claim, so they are believed only once the user has trusted the
    origin: on first sight every host tool files a card, and a tool the user pinned ``GATED``
    files one whatever its flags say. Both lists ride on the context and can only tighten. Core
    and connector entries are not the page's to describe, so they are untouched. Text read from
    another tab this exchange tightens the same way (:func:`_tainted`, ADR 0105), and so does any
    call of an app other than the session's own (:func:`another_tab`, ADR 0106): structural policy
    lets one through only to be proposed, and this is what makes it a proposal.
    """
    origin = entry.parsed_origin
    if origin.kind != "host":
        return False
    return (
        str(origin) in ctx.gated_origins
        or entry.name in ctx.gated_tools
        or _tainted(entry, ctx)
        or another_tab(entry, ctx)
    )


def _announced(result: ExecResult) -> ExecResult:
    """``result`` with its ``(showing N of M)`` footer, if it needs one and does not have it."""
    if result.announces_truncation():
        return result
    return ExecResult(
        ok=result.ok,
        output=f"{result.output}\n{result.footer()}",
        shown=result.shown,
        total=result.total,
        error=result.error,
        tier=result.tier,
        ms=result.ms,
    )


# --- the ledger ----------------------------------------------------------------------------------


@dataclass(frozen=True)
class TurnFlag:
    """A tripwire that fired on one turn. Not an error; a thing to go and look at."""

    turn_id: str
    name: str
    detail: str


class LedgerHook:
    """One row per turn, written exactly once (README §2 invariant 6).

    The recorded turn ids are remembered, because a retry path that calls this twice would
    double-count a turn's cost — and a ledger that over-counts is worse than no ledger, since it
    is believed. An error row always carries a reason from the closed set; ``unknown`` is a
    reason, and a blank one is not.

    Flags are held here rather than written to a column, because ``companion_turn`` has none: the
    hook is the one object that knows both the turn id and the tripwire, and making a flag durable
    is a schema change with its own commit (ADR 0007).
    """

    def __init__(self, ledger: LedgerPort) -> None:
        self.ledger = ledger
        self.flags: list[TurnFlag] = []
        self._recorded: set[str] = set()

    def after_turn(
        self,
        result: TurnResult,
        *,
        conversation: str,
        origin: str,
        surface: str,
        trigger: str = "cli",
    ) -> int | None:
        """Write this turn's row. Returns the row id, or ``None`` if it was already written."""
        if result.turn_id in self._recorded:
            return None
        if result.is_error:
            result.error_reason = normalize_reason(result.error_reason) or "unknown"
        row = self.ledger.record(
            engine=result.engine,
            model=result.model,
            conversation=conversation,
            origin=origin,
            surface=surface,
            trigger=trigger,
            rounds=result.rounds,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
            cost_usd=result.cost_usd,
            cost_estimated=result.cost_estimated,
            ms=result.duration_ms,
            is_error=result.is_error,
            error_reason=result.error_reason,
            turn_id=result.turn_id,
            peak_mb=result.peak_mb,
        )
        # Marked only once the write returned, so a failed write can be retried.
        self._recorded.add(result.turn_id)
        return row.row_id

    def flag(self, turn_id: str, name: str, detail: str) -> None:
        self.flags.append(TurnFlag(turn_id=turn_id, name=name, detail=detail))

    def flags_for(self, turn_id: str) -> list[TurnFlag]:
        return [flag for flag in self.flags if flag.turn_id == turn_id]


# --- truncation ----------------------------------------------------------------------------------


class TruncationHook:
    """Every bounded block says what it left out, or somebody hears about it.

    This hook must never block a turn. A block that is truncated without a footer is a prompt that
    understates what it is hiding — bad, and worth finding — but a turn that refuses to run is
    worse, and a hook that can veto a prompt eventually vetoes one on stage. So: a warning, and a
    flag against the turn id.
    """

    def __init__(self, flags: FlagPort | None = None) -> None:
        self.flags = flags
        self.warnings: list[str] = []

    def before_prompt(self, blocks: Sequence[PromptBlock], turn_id: str = "") -> list[str]:
        warnings = [
            f"block {block.name!r} is truncated but does not announce it "
            f"(expected {block.footer()!r})"
            for block in blocks
            if not block.announces_truncation()
        ]
        self.warnings.extend(warnings)
        if warnings and self.flags is not None and turn_id:
            self.flags.flag(turn_id, "truncation_unannounced", "; ".join(warnings))
        return warnings

    @staticmethod
    def block_sizes(blocks: Sequence[PromptBlock]) -> dict[str, int]:
        return {block.name: block.size for block in blocks}

    @staticmethod
    def block_hashes(blocks: Sequence[PromptBlock]) -> dict[str, str]:
        """Per-block content hashes — what a later turn compares to see prompt-cache churn."""
        return {block.name: block.hash for block in blocks}

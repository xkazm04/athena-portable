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
from typing import Any

from athena.contracts.channel import DecisionRequested
from athena.contracts.harness import PromptBlock, TurnResult, normalize_reason
from athena.contracts.registry import ExecResult, ToolClass, ToolEntry, TurnContext
from athena.harness.ports import ApprovalsPort, CatalogPort, FlagPort, LedgerPort

__all__ = [
    "Cancel",
    "GateDecision",
    "GateHook",
    "GateOutcome",
    "LedgerHook",
    "Proceed",
    "TruncationHook",
    "TurnFlag",
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

        if self.catalog.classify(entry.name) is not ToolClass.GATED:
            return GateOutcome(Proceed(dict(params)))

        card = self.approvals.create(
            entry.name,
            dict(params),
            origin=entry.origin,
            conversation=ctx.conversation_id,
            surface=ctx.surface,
            summary=rationale,
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
        so an approved card can never be spent on a second, different call.
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
        self._recorded.add(result.turn_id)
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
        )
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

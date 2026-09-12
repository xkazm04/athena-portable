"""The browser lane — one turn, streamed, holding no gated executor (README §3.1, §3.2; ADR 0010).

One lane, because the browser is the only environment this build has (README §3.5). It does four
things and delegates everything else:

1. **Compose.** :class:`~athena.lane.turn_frame.FrameBuilder` turns what the surface sent into the
   static half and the turn frame (README §3.2 step 2).
2. **Run.** The harness runs up to eight provider rounds as one turn and one ledger row, passing
   every proposed call through the gate (README §3.2 steps 3 and 4). The lane streams what comes
   out and adds nothing to it.
3. **Record.** Each turn writes episodes: the user's message, the results the surface returned for
   last turn's calls, and the answer. Every one carries ``[host:<origin>]`` and ``[project:<id>]``
   markers and, for a result, the tier that answered — which is what makes act 4 of the demo
   answerable by app, by project and by tier.
4. **Answer a card.** :meth:`BrowserLane.answer_decision` resolves the approval, replays the gate
   with the approval id, and returns an ``execute`` instruction for a host tool or the result of a
   core tool that ran here (README §3.2 step 6).

**What the lane does not do is the point of the lane.** A host tool has no executor anywhere in
this process — ``ToolEntry`` refuses to be constructed with one — so a call the gate allows leaves
as a ``tool.call`` event and the page runs it; its answer arrives in the next turn's frame, fenced.
A gated call becomes a ``decision.requested`` card and stops. Nothing gated executes during a turn,
including a gated *core* tool such as ``core.write_fact``, whose executor exists only for the
replay after the user has answered. ADR 0010 is why, and :func:`assert_no_host_executor` is the
structural half of it.

The lane never decides policy. It never reads a tool's class, never compares approval parameters,
and never writes an approval row: the catalog classifies, the gate decides, the approval table
grants. A lane that did any of those would be the second place each of them lives.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Any, ClassVar

from athena.contracts import ids
from athena.contracts.channel import (
    ChannelEvent,
    DecisionResolved,
    ToolCall,
    ToolResult,
    TurnError,
    TurnFinished,
    now_iso,
)
from athena.contracts.registry import ExecResult, Lane, ToolEntry, TurnContext
from athena.harness.hooks import Cancel
from athena.lane.ports import (
    ApprovalsPort,
    BrainPort,
    CatalogPort,
    GatePort,
    GrantPort,
    HarnessPort,
    HostState,
    LedgerPort,
)
from athena.lane.turn_frame import FrameBuilder, SurfaceTurn

__all__ = [
    "BrowserLane",
    "Execute",
    "Resolution",
    "assert_no_host_executor",
    "held_host_executors",
    "marked",
]


# --- the structural claim -------------------------------------------------------------------


def held_host_executors(entries: Sequence[ToolEntry]) -> list[str]:
    """Host entries carrying an executor. Always empty, and checked anyway (ADR 0010).

    ``ToolEntry.__post_init__`` refuses a host tool with an executor, so this can only be
    non-empty if that rule is relaxed. It is the cheapest possible tripwire on the property the
    whole lane is built around, and it costs one pass over a list of a dozen names per turn.
    """
    return sorted(
        entry.name
        for entry in entries
        if entry.parsed_origin.kind == "host" and entry.executor is not None
    )


def assert_no_host_executor(entries: Sequence[ToolEntry]) -> None:
    """Raise if the lane was handed a host tool it could run itself. A wiring bug, not a model
    behaviour, so it raises here rather than being caught by the gate later."""
    held = held_host_executors(entries)
    if held:
        raise ValueError(
            "the browser lane may hold no executor for a host tool; the page runs it on "
            f"approval (README §3.2 step 5): {', '.join(held)}"
        )


# --- episode markers ------------------------------------------------------------------------


def marked(
    text: str, *, origin: str = "", project_id: str | None = None, tier: int | None = None
) -> str:
    """One episode body with the markers the record is grouped by.

    ``[host:<app_id> tier2] [project:proj_…] the text``. The markers are a prefix of the body and
    not frontmatter because the brain's markdown stays byte-compatible with the Personas writer
    (README §2 invariant 1) — its header is a fixed five keys, and a sixth would make a brain
    unreadable by the tool that wrote the format.
    """
    parts: list[str] = []
    if origin:
        parts.append(f"[{origin} tier{tier}]" if tier else f"[{origin}]")
    if project_id:
        parts.append(f"[project:{project_id}]")
    parts.append(text.strip())
    return " ".join(part for part in parts if part)


# --- what answering a card produced -----------------------------------------------------------


@dataclass(frozen=True)
class Execute:
    """An instruction to the surface: run this on the page, it has been approved.

    It carries the action and the parameters the *approval row* holds, not the ones a caller
    passed in. The gate has already proved the grant covers exactly these (README §3.2 step 6),
    and re-reading them from the row is what keeps an approved card from being spent on a
    neighbouring call.
    """

    approval_id: str
    call_id: str
    name: str
    params: dict[str, Any]
    origin: str
    tier: int = 0

    def to_event(self) -> ToolCall:
        return ToolCall(
            call_id=self.call_id,
            name=self.name,
            params=dict(self.params),
            origin=self.origin,
            tier=self.tier,
        )


@dataclass(frozen=True)
class Resolution:
    """What :meth:`BrowserLane.answer_decision` did.

    Exactly one of :attr:`execute` and :attr:`result` is ever set, and both are ``None`` when
    nothing will happen — a decline, an expired row, an unknown id, or a call the gate refused on
    the replay. :attr:`reason` says which, from the closed set.
    """

    approval_id: str
    choice: str
    approved: bool
    execute: Execute | None = None
    result: ExecResult | None = None
    reason: str | None = None
    detail: str = ""
    events: tuple[ChannelEvent, ...] = ()

    @property
    def ok(self) -> bool:
        """``True`` when the answer was recorded, whatever the answer was. A decline is not an
        error; a card that could not be answered at all is."""
        return self.reason is None or self.reason == "user_denied"


# --- the lane ---------------------------------------------------------------------------------


@dataclass
class BrowserLane:
    """One conversation's turn, and the answer to one card. Everything else is a port."""

    harness: HarnessPort
    catalog: CatalogPort
    gate: GatePort
    approvals: ApprovalsPort
    brain: BrainPort
    ledger: LedgerPort
    frames: FrameBuilder
    #: The one lane in this build. A field would suggest there is a second.
    lane: ClassVar[Lane] = Lane.BROWSER
    #: What the ledger calls a row this lane wrote outside a turn.
    decision_trigger: str = "decision"

    # -- tools ---------------------------------------------------------------------------------

    def tools(self) -> list[ToolEntry]:
        """Everything addressable in this lane, checked for the property ADR 0010 rests on."""
        entries = self.catalog.for_lane(self.lane)
        assert_no_host_executor(entries)
        return entries

    # -- one turn ------------------------------------------------------------------------------

    async def run(
        self,
        message: str,
        ctx: TurnContext,
        *,
        host_state: HostState | None = None,
        tool_results: Sequence[ToolResult] = (),
        active_project: Mapping[str, Any] | None = None,
        pending_decisions: Sequence[str] = (),
    ) -> AsyncIterator[ChannelEvent]:
        """Stream one turn: compose, run, record.

        The events are the harness's own and reach the surface unchanged — a lane that rewrote
        them would be a second opinion about what a decision card said. The last event is
        ``turn.finished`` or ``turn.error``, always, because the harness guarantees it.
        """
        turn = SurfaceTurn(
            message=message,
            host_state=dict(host_state or {}),
            tool_results=tuple(tool_results),
            active_project=active_project,
            pending_decisions=tuple(pending_decisions),
        )
        self._record_results(turn.tool_results, ctx)
        composed = self.frames.build(ctx.conversation_id, turn)
        self._append(message, "user", ctx)

        entries = self.tools()
        finished: TurnFinished | None = None
        failed = False
        async for event in self.harness.run_turn(
            ctx.conversation_id,
            composed.static.blocks,
            composed.frame.blocks,
            entries,
            ctx,
            message,
        ):
            if isinstance(event, TurnError):
                failed = True
            elif isinstance(event, TurnFinished):
                finished = event
            yield event

        if failed:
            # The frame is deliberately not remembered. A turn that ended in an engine error may
            # never have reached the model, and a delta measured against a frame nobody read
            # would tell the next turn that nothing moved.
            return
        self.frames.remember(ctx.conversation_id, composed.frame)
        if finished is not None and finished.text.strip():
            self._append(finished.text, "assistant", ctx)

    # -- answering a card ----------------------------------------------------------------------

    def answer_decision(self, approval_id: str, choice: str, ctx: TurnContext) -> Resolution:
        """Resolve one card and replay the gate with its id (README §3.2 step 6).

        The conversation comes off the approval row and not off ``ctx``: a card filed during a
        project-scoped run belongs to that project's conversation, and the episode this writes has
        to land there whichever surface answered it.
        """
        try:
            self.approvals.resolve(approval_id, choice)
        except ValueError as exc:
            return self._refused(approval_id, choice, self._why(approval_id), str(exc), ctx)
        try:
            grant = self.approvals.describe(approval_id)
        except ValueError as exc:
            return self._refused(approval_id, choice, "unknown_ref", str(exc), ctx)

        resolved = DecisionResolved(id=approval_id, choice=choice, by="user", at=now_iso())
        turn_ctx = replace(
            ctx,
            conversation_id=grant.conversation or ctx.conversation_id,
            approval_id=approval_id,
            turn_id=ctx.turn_id or ids.mint("turn"),
        )

        if not grant.approved:
            self._append(
                f"[decision] the user declined {grant.action} {_params(grant.params)}",
                "system",
                turn_ctx,
                origin=grant.origin,
            )
            self._row(grant, turn_ctx, reason="user_denied")
            return Resolution(
                approval_id=approval_id,
                choice=choice,
                approved=False,
                reason="user_denied",
                detail=f"the user declined {grant.action}",
                events=(resolved,),
            )

        try:
            entry = self.catalog.get(grant.action)
        except ValueError as exc:
            return self._refused(approval_id, choice, "unknown_ref", str(exc), turn_ctx)

        outcome = self.gate.run_tool(entry, grant.params, turn_ctx, approval_id=approval_id)
        if isinstance(outcome.decision, Cancel):
            return self._refused(
                approval_id,
                choice,
                outcome.decision.reason,
                outcome.decision.detail,
                turn_ctx,
                grant=grant,
                approved=True,
            )

        self._append(
            f"[decision] the user approved {grant.action} {_params(grant.params)}",
            "system",
            turn_ctx,
            origin=grant.origin,
        )
        if outcome.result is None:
            # A host tool. The gate allowed it and the page executes it; the lane holds no
            # executor for one and never has (ADR 0010).
            instruction = Execute(
                approval_id=approval_id,
                call_id=f"{turn_ctx.turn_id}_exec",
                name=entry.name,
                params=dict(grant.params),
                origin=entry.origin,
                tier=entry.tier,
            )
            return Resolution(
                approval_id=approval_id,
                choice=choice,
                approved=True,
                execute=instruction,
                events=(resolved, instruction.to_event()),
            )

        answer = ToolResult(
            call_id=f"{turn_ctx.turn_id}_exec",
            name=entry.name,
            ok=outcome.result.ok,
            output=outcome.result.output,
            truncated=outcome.result.truncated,
            error=outcome.result.error,
            tier=outcome.result.tier or entry.tier,
            ms=outcome.result.ms,
        )
        return Resolution(
            approval_id=approval_id,
            choice=choice,
            approved=True,
            result=outcome.result,
            events=(resolved, answer),
        )

    # -- the record ----------------------------------------------------------------------------

    def _record_results(self, results: Sequence[ToolResult], ctx: TurnContext) -> None:
        """One system episode per result the surface returned for last turn's calls.

        This is where the tier lands in the record (README §3.4): the page's own tool is tier 1,
        a generic hand is tier 2, a connector is tier 3, and the activity explorer can answer
        "what did it do, through which tier" without inferring it from a name.
        """
        origin = self._origin(ctx)
        for result in results:
            verb = "returned" if result.ok else f"failed ({result.error or 'unknown'})"
            self._append(
                f"{result.name} {verb}: {result.output}".strip(),
                "system",
                ctx,
                origin=origin,
                tier=result.tier or None,
            )

    def _append(
        self,
        text: str,
        role: str,
        ctx: TurnContext,
        *,
        origin: str = "",
        tier: int | None = None,
    ) -> None:
        body = marked(
            text,
            origin=origin or self._origin(ctx),
            project_id=ctx.project_id,
            tier=tier,
        )
        if not body.strip():
            return
        self.brain.append_episode(body, role, session_id=ctx.conversation_id)

    def _row(self, grant: GrantPort, ctx: TurnContext, *, reason: str) -> None:
        """The ledger row a resolution writes.

        Only a refusal is recorded, and ``rounds = 0`` says so: no model was invoked to answer a
        card. Act 4 of the demo reads exactly this — both declines ledgered ``user_denied`` — and
        a success row here would double-count a turn whose cost the harness already wrote.
        """
        self.ledger.record(
            engine=self.harness.name or "lane",
            model="",
            conversation=grant.conversation or ctx.conversation_id,
            origin=grant.origin,
            surface=ctx.surface,
            trigger=self.decision_trigger,
            rounds=0,
            is_error=True,
            error_reason=reason,
            turn_id=ctx.turn_id or None,
        )

    def _refused(
        self,
        approval_id: str,
        choice: str,
        reason: str,
        detail: str,
        ctx: TurnContext,
        *,
        grant: GrantPort | None = None,
        approved: bool = False,
    ) -> Resolution:
        if grant is not None:
            self._row(grant, ctx, reason=reason)
        return Resolution(
            approval_id=approval_id,
            choice=choice,
            approved=approved,
            reason=reason,
            detail=detail,
        )

    def _why(self, approval_id: str) -> str:
        """Why a resolve was refused, read back from the row if it is still there.

        A row that is gone is ``unknown_ref``; one that expired is ``expired``; one that is still
        there and not expired refused the *answer*, so the card is still waiting on the user and
        ``pending_approval`` is what the closed set calls that.
        """
        try:
            status = self.approvals.describe(approval_id).status
        except ValueError:
            return "unknown_ref"
        return "expired" if status == "expired" else "pending_approval"

    @staticmethod
    def _origin(ctx: TurnContext) -> str:
        return f"host:{ctx.app_id}" if ctx.app_id else "core"


def _params(params: Mapping[str, Any]) -> str:
    """The parameters on a decision episode, canonically, so two episodes compare."""
    return json.dumps(dict(params), sort_keys=True, default=str)

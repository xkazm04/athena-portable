"""The browser lane: one turn, streamed, holding no gated executor (README §3.1, §3.2).

The lane is the thing between a surface and an engine. It composes the two halves of the prompt,
runs the harness, relays the channel events, and does the three pieces of bookkeeping a turn owes
the brain — the user's message as an episode, a ``READ`` answer as a system episode, and what the
model said as an assistant episode.

**It never executes a gated tool during a turn.** A ``GATED`` op becomes an approval row and a
``decision.requested`` card, and the turn continues without it. The executor is reached exactly
once, later, on :meth:`BrowserLane.resolve` — the gate replayed with the approval id, proving the
grant covers this action and these parameters before anything runs (README §3.2 step 6). That is
why the gated path is a *second* method here and not a branch inside ``run``: a lane that could
reach an executor mid-turn is a lane where one refactor puts a gated call back on the streaming
path, and nothing in the stream would look different.

**A host tool's answer never comes back through the lane.** The gate allows it, the lane emits
``tool.call``, and the surface runs it on the page. The result arrives in the *next* request's
``tool_results`` and is fenced into that turn's frame (README §3.2 step 5). The lane holds no
executor for a host tool and the catalog refuses to build one.
"""

from __future__ import annotations

import time
from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

from athena.contracts import ids
from athena.contracts.channel import (
    ChannelEvent,
    DecisionResolved,
    ToolCall,
    ToolResult,
    TurnFinished,
)
from athena.contracts.harness import Harness
from athena.contracts.registry import Lane, ToolClass, ToolEntry, TurnContext
from athena.core.constitution import Constitution
from athena.core.prompt import Composed, compose
from athena.harness.hooks import Cancel, GateHook, Proceed
from athena.harness.policy import PolicyCatalog, StructuralPolicy, default_policy
from athena.harness.ports import ApprovalsPort, CatalogPort, LedgerPort
from athena.lane.turn_frame import FrameMemory, TurnRequest

__all__ = [
    "DECISION_DIGEST",
    "BrowserLane",
    "EpisodePort",
    "InboxPort",
    "RecallFn",
    "Resolution",
]

#: How many pending cards the frame's decision digest names before it announces the rest.
DECISION_DIGEST = 10

#: The status ``Approvals.resolve`` leaves a row in when the user said yes. Compared as a string
#: because the lane holds a port and not the enum, and the table is the authority on the spelling.
APPROVED = "approved"

#: The engine name a decision row is ledgered under. A decline is not a model invocation and has
#: no engine; what actually ran is the gate, and saying so keeps the column groupable.
GATE_ENGINE = "gate"


# --- the ports the lane runs on -------------------------------------------------------------------


@runtime_checkable
class EpisodePort(Protocol):
    """The brain, as the lane writes to it. One method, because the lane only ever appends."""

    def append_episode(self, content: str, role: str = ..., **kwargs: Any) -> Any: ...


@runtime_checkable
class InboxPort(ApprovalsPort, Protocol):
    """The approval table, as the lane reads and closes it.

    Wider than ``ApprovalsPort`` by three methods, and each is a thing only the lane does: it
    digests the inbox into the frame, it closes a card when the user answers, and it reads the row
    back to learn what the card was for.
    """

    def resolve(self, approval_id: str, choice: str, answer: str | None = ...) -> Any: ...

    def get(self, approval_id: str) -> Any: ...

    def pending(self, limit: int = ...) -> Any: ...


class RecallFn(Protocol):
    """``athena.core.recall.recall`` with its brain already bound."""

    def __call__(self, query: str) -> Any: ...


@dataclass(frozen=True)
class Resolution:
    """What answering a card produced (README §3.2 step 6).

    Exactly one of ``instruction`` and ``result`` is ever set, and which one says where the tool
    lives: a host tool comes back as an *instruction* the surface must run on the page, a core or
    connector tool as the *result* of running it here. A decline sets neither.
    """

    resolved: DecisionResolved
    approved: bool
    instruction: ToolCall | None = None
    result: ToolResult | None = None
    reason: str | None = None

    @property
    def events(self) -> tuple[ChannelEvent, ...]:
        """Everything a surface should see, in the order it should see it."""
        out: list[ChannelEvent] = [self.resolved]
        if self.instruction is not None:
            out.append(self.instruction)
        if self.result is not None:
            out.append(self.result)
        return tuple(out)


# --- the lane -------------------------------------------------------------------------------------


@dataclass
class BrowserLane:
    """One turn in, a stream of channel events out (README §3.1).

    Every collaborator is a port. ``wiring`` binds the real ones; a test binds fakes and drives a
    whole turn with no SQLite, no subprocess and no provider.
    """

    catalog: CatalogPort
    approvals: InboxPort
    constitution: Constitution
    harness: Harness
    ledger: LedgerPort
    episodes: EpisodePort | None = None
    recall: RecallFn | None = None
    policy: StructuralPolicy = field(default_factory=default_policy)
    memory: FrameMemory = field(default_factory=FrameMemory)
    lane: Lane = Lane.BROWSER

    def __post_init__(self) -> None:
        self._policy_catalog = PolicyCatalog(self.catalog, self.policy)
        self.gate = GateHook(self._policy_catalog, self.approvals)

    # -- the turn ---------------------------------------------------------------------------------

    async def run(self, request: TurnRequest) -> AsyncIterator[ChannelEvent]:
        """Compose, run, relay, record. The last event is ``turn.finished`` or ``turn.error``."""
        turn_id = ids.mint("turn")
        ctx = request.context(turn_id, lane=self.lane)
        bound = self._policy_catalog.for_ctx(ctx)
        entries = bound.for_lane(self.lane)

        composed = self._compose(request, bound)
        self._append(request.message, role="user")

        classes = {entry.name: entry.cls for entry in entries}
        async for event in self.harness.run_turn(
            request.conversation_id,
            composed.static.blocks,
            composed.frame.blocks,
            entries,
            ctx,
            request.message,
        ):
            self._observe(event, classes)
            yield event

        self.memory.remember(request.conversation_id, composed.frame.host_state)

    def _compose(self, request: TurnRequest, catalog: PolicyCatalog) -> Composed:
        """Both halves of the prompt for this turn (ADR 0006).

        Recall runs *before* the message is appended, so the memory block is what Athena knew when
        the user spoke rather than an echo of the sentence she is about to answer.
        """
        trace = self.recall(request.message) if self.recall is not None else None
        return compose(
            constitution=self.constitution,
            catalog=catalog,
            lane=self.lane,
            recall=trace,
            host_state=request.host_state,
            previous_host_state=self.memory.previous_host_state(request.conversation_id),
            tool_results=request.tool_results,
            active_project=request.project,
            pending_decisions=self._digest(),
        )

    def _digest(self) -> list[str]:
        """One line per pending card, bounded by the composer and announced by it."""
        page = self.approvals.pending(DECISION_DIGEST)
        return [
            f"{row.id} — {row.action}: {row.summary or 'no rationale given'}" for row in page.rows
        ]

    def _observe(self, event: ChannelEvent, classes: Mapping[str, ToolClass]) -> None:
        """The brain's share of a turn (README §3.2 step 4).

        A ``READ`` answer becomes a system episode because that is what makes it citable: a fact
        distilled from it later has to name a live episode id, and an answer that only ever
        existed in a prompt has none (README §2 invariant 2).
        """
        if isinstance(event, ToolResult) and classes.get(event.name) is ToolClass.READ and event.ok:
            self._append(f"{event.name} → {event.output}", role="system")
        elif isinstance(event, TurnFinished) and event.text:
            self._append(event.text, role="assistant")

    def _append(self, content: str, *, role: str) -> None:
        """Append an episode, if a brain is attached. A lane with none still runs a turn."""
        if self.episodes is None or not content.strip():
            return
        self.episodes.append_episode(content.strip(), role)

    # -- the gated path, closed later --------------------------------------------------------------

    def resolve(
        self, approval_id: str, choice: str, answer: str | None = None, *, surface: str = "panel"
    ) -> Resolution:
        """Answer a card, and replay the gate if the answer was yes (README §3.2 step 6).

        The parameters come from the *row*, never from the caller. A resolve endpoint that took
        parameters would be a second way to reach an executor, and the whole point of the replay is
        that what runs is what the user was shown.
        """
        row = self.approvals.resolve(approval_id, choice, answer)
        resolved: DecisionResolved = row.resolution_event()
        if str(row.status) != APPROVED:
            self._ledger_decision(row, "user_denied")
            return Resolution(resolved=resolved, approved=False, reason="user_denied")

        entry = self._entry(row.action)
        if entry is None:
            self._ledger_decision(row, "unknown_ref")
            return Resolution(resolved=resolved, approved=True, reason="unknown_ref")

        ctx = TurnContext(
            conversation_id=row.conversation,
            turn_id=ids.mint("turn"),
            lane=self.lane,
            surface=surface,
            app_id=_app_of(entry),
            approval_id=approval_id,
        )
        started = time.monotonic()
        outcome = self.gate.run_tool(entry, row.params, ctx, approval_id=approval_id)
        ms = int((time.monotonic() - started) * 1000)

        if isinstance(outcome.decision, Cancel):
            self._ledger_decision(row, outcome.decision.reason)
            return Resolution(resolved=resolved, approved=True, reason=outcome.decision.reason)

        assert isinstance(outcome.decision, Proceed)
        call_id = f"{approval_id}_exec"
        if outcome.result is None:
            # A host tool. The page runs it and the answer rides in the next turn's frame.
            return Resolution(
                resolved=resolved,
                approved=True,
                instruction=ToolCall(
                    call_id=call_id,
                    name=entry.name,
                    params=dict(row.params),
                    origin=entry.origin,
                    tier=entry.tier,
                ),
            )
        return Resolution(
            resolved=resolved,
            approved=True,
            result=ToolResult(
                call_id=call_id,
                name=entry.name,
                ok=outcome.result.ok,
                output=outcome.result.output,
                truncated=outcome.result.truncated,
                error=outcome.result.error,
                tier=outcome.result.tier,
                ms=outcome.result.ms or ms,
            ),
        )

    def _ledger_decision(self, row: Any, reason: str) -> None:
        """A decision that did not execute is a row, so act 4 can show it (README §1, invariant 6).

        Zero tokens and no cost, so it cannot move a rollup; ``trigger`` is ``decision`` and the
        engine is the gate, because the gate is what actually ran. A decline the record cannot
        show is a decline the user has no evidence of having made.
        """
        self.ledger.record(
            engine=GATE_ENGINE,
            model="",
            conversation=row.conversation,
            origin=row.origin,
            surface=row.surface,
            trigger="decision",
            rounds=1,
            is_error=True,
            error_reason=reason,
        )

    def _entry(self, name: str) -> ToolEntry | None:
        for entry in self.catalog.for_lane(self.lane):
            if entry.name == name:
                return entry
        return None

    # -- what a surface needs to render before a turn ----------------------------------------------

    def capabilities(self, request: TurnRequest) -> list[ToolEntry]:
        """What this turn may call, after structural policy has had its say."""
        ctx = request.context(ids.mint("turn"), lane=self.lane)
        return self._policy_catalog.for_ctx(ctx).for_lane(self.lane)


def _app_of(entry: ToolEntry) -> str | None:
    origin = entry.parsed_origin
    return origin.id if origin.kind == "host" else None

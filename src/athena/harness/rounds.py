"""The round loop every engine runs inside (README §3.2 steps 2 to 5; ADR 0007, ADR 0031).

This is the turn, with the engine taken out. The prompt halves, the eight-round budget, the
``OP:`` grammar, the gate, the fence around what a tool returned, the one ledger row — all of it
is here, once, and an engine supplies exactly one method: :meth:`RoundHarness._round`, which asks
the model once and hands back what it said. ``CliHarness`` answers it by running a binary;
``ApiHarness`` answers it by calling a :data:`~athena.harness.ports.ModelFn`. Neither can bring a
gate of its own, because the gate is a field of this class and the dispatcher is a method of it.

**Eight rounds are one turn and one ledger row.** The model proposes ops, the gate decides, the
executors that ran hand their answers back, and the model gets another round — up to eight
(README §3.2 step 3). A round only follows a round in which something actually executed: a gated
op is waiting on the user, a host tool is waiting on the page, and a dropped envelope is told to
the model in the next turn's frame. One turn is one row whatever happened inside it.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator, Mapping, Sequence
from dataclasses import dataclass
from typing import ClassVar

from athena.contracts import ids
from athena.contracts.channel import (
    ChannelEvent,
    DecisionRequested,
    TextDelta,
    ToolCall,
    ToolResult,
    TurnError,
    TurnFinished,
    TurnSummary,
)
from athena.contracts.harness import PromptBlock, TurnResult
from athena.contracts.registry import ExecResult, ToolEntry, TurnContext
from athena.core.fence import fresh_nonce, wrap_untrusted
from athena.harness.hooks import Cancel, GateHook, LedgerHook, TruncationHook
from athena.harness.op_grammar import Op, ParsedTurn, parse_turn

__all__ = [
    "MAX_ROUNDS",
    "TURN_TIMEOUT_S",
    "Failure",
    "RoundHarness",
]

#: A turn is allowed twenty-five minutes. It is a wall, not a budget: a turn that has not
#: produced anything in that long is a hung engine, not a slow thought.
TURN_TIMEOUT_S = 25 * 60

#: Model → tool → model rounds inside one turn (README §3.2 step 3).
MAX_ROUNDS = 8

Failure = tuple[str, str]
"""``(reason from ERROR_REASONS, a sentence for a person)``. Never carries a secret."""


@dataclass
class RoundHarness:
    """Satisfies ``athena.contracts.Harness`` once an engine supplies :meth:`_round`."""

    gate: GateHook
    ledger: LedgerHook
    truncation: TruncationHook
    model: str = ""
    max_rounds: int = MAX_ROUNDS
    timeout_s: int = TURN_TIMEOUT_S
    #: The engine name the ledger records. A field and not a property because ``Harness``
    #: declares it one; a subclass fills it in when it is left empty.
    name: str = ""

    #: What the turn says when the engine answered cleanly and said nothing at all.
    silent_detail: ClassVar[str] = "the engine finished cleanly and produced no text"

    def __post_init__(self) -> None:
        self._last: TurnResult | None = None

    async def last_result(self) -> TurnResult | None:
        return self._last

    # -- what an engine supplies ------------------------------------------------------------------

    def _turn_started(self, conversation_id: str, static_text: str) -> None:
        """A hook for engines that keep per-conversation state. Most keep none."""

    async def _round(
        self,
        conversation_id: str,
        static_text: str,
        history: Sequence[str],
        replies: Sequence[str],
        result: TurnResult,
    ) -> tuple[str, Failure | None]:
        """Ask the model once. Returns ``(assistant text, failure)``; exactly one is meaningful.

        ``history`` is what Athena said this turn — the opening message, then one fenced results
        message per round that executed something — and ``replies`` is what the model said in
        the rounds before this one. Usage is added to ``result`` as it arrives.
        """
        raise NotImplementedError

    # -- the turn ---------------------------------------------------------------------------------

    async def run_turn(
        self,
        conversation_id: str,
        static_blocks: Sequence[PromptBlock],
        frame: Sequence[PromptBlock],
        tools: Sequence[ToolEntry],
        ctx: TurnContext,
        user_message: str,
    ) -> AsyncIterator[ChannelEvent]:
        # Defined before anything that can raise: every exit below writes a row from these.
        turn_id = ctx.turn_id or ""
        started = time.monotonic()
        result = TurnResult(turn_id=turn_id, engine=self.name, model=self.model, rounds=0)
        replies: list[str] = []
        texts: list[str] = []
        tts: str | None = None
        failure: Failure | None = None

        try:
            # The setup is inside the guarded region: a raise here is a turn with a row and an
            # error, not a turn with neither (README §2, AGENTS.md "Ledger everything").
            if not turn_id:
                turn_id = ids.mint("turn")
                result.turn_id = turn_id
            result.block_hashes = TruncationHook.block_hashes([*static_blocks, *frame])
            self.truncation.before_prompt([*static_blocks, *frame], turn_id)

            entries = {entry.name: entry for entry in tools}
            self._told: set[tuple[str, str]] = set()
            static_text = _joined(static_blocks)
            self._turn_started(conversation_id, static_text)
            history = [_opening_message(frame, user_message)]

            for _round in range(1, self.max_rounds + 1):
                result.rounds = _round
                round_text, round_failure = await self._round(
                    conversation_id, static_text, history, replies, result
                )
                if round_failure is not None:
                    failure = round_failure
                    break
                replies.append(round_text)

                parsed = parse_turn(round_text)
                if parsed.text:
                    texts.append(parsed.text)
                    yield TextDelta(text=parsed.text)
                if tts is None and parsed.tts:
                    tts = parsed.tts

                # Call ids carry the round: a turn's rounds each number their ops from zero, and a
                # core result in one round must never be read as the answer to a page call in
                # another.
                events, feedback = self._dispatch(
                    parsed, entries, ctx, f"{turn_id}_r{_round}", result
                )
                for event in events:
                    yield event
                if feedback:
                    # Told about a refusal, a model takes the silence of its page calls for failure
                    # and sends them again; say they are in flight (ADR 0041).
                    in_flight = _in_flight(events)
                    if in_flight:
                        feedback.append(
                            ToolResult(
                                call_id=f"{turn_id}_r{_round}_in_flight",
                                name="page",
                                ok=True,
                                output=(
                                    f"Your calls to {', '.join(in_flight)} went to the page; their "
                                    "answers come with your next turn. Do not call them again."
                                ),
                            )
                        )
                if not feedback:
                    break
                history.append(_results_message(feedback))
        except (GeneratorExit, asyncio.CancelledError):
            # The consumer closed the stream or the task was cancelled; a billed call may already
            # have happened. Write the row and re-raise: an async generator that yields after
            # GeneratorExit raises RuntimeError, so nothing is yielded here.
            self._close_row(result, started, "cancelled", conversation_id, ctx)
            raise
        except Exception as exc:
            # The type name only: an exception's message can quote a request body.
            reason = self._close_row(result, started, "unknown", conversation_id, ctx)
            yield TurnError(reason=reason, detail=type(exc).__name__)
            return

        result.text = "\n\n".join(texts).strip()
        if failure is None and not result.text and not result.tool_calls:
            failure = ("engine_error", self.silent_detail)

        result.duration_ms = int((time.monotonic() - started) * 1000)
        if failure is not None:
            result.is_error = True
            result.error_reason = failure[0]
            self._finish(result, conversation_id, ctx)
            yield TurnError(reason=result.error_reason or "unknown", detail=failure[1])
            return

        unwritten = self._finish(result, conversation_id, ctx)
        if unwritten is not None:
            # A turn with no row is not reported as a success (AGENTS.md "Ledger everything").
            yield TurnError(
                reason="unknown",
                detail=f"The turn ran, but its ledger row could not be written ({unwritten}).",
            )
            return
        yield TurnSummary(
            model=result.model,
            engine=result.engine,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
            cost_usd=result.cost_usd,
            cost_estimated=result.cost_estimated,
            duration_ms=result.duration_ms,
            rounds=result.rounds,
        )
        yield TurnFinished(text=result.text, tts=tts)

    # -- the dispatcher ----------------------------------------------------------------------------

    def _dispatch(
        self,
        parsed: ParsedTurn,
        entries: Mapping[str, ToolEntry],
        ctx: TurnContext,
        turn_id: str,
        result: TurnResult,
    ) -> tuple[list[ChannelEvent], list[ToolResult]]:
        """Every op through the gate. Returns the events to stream and what to feed back.

        What *executed* is fed back, and so is a refusal or a dropped op, once per name and reason
        (ADR 0041). A gated op is waiting on the user and a host tool is waiting on the page —
        neither is a reason to spend another round asking the same model again.
        """
        events: list[ChannelEvent] = []
        feedback: list[ToolResult] = []

        for index, error in enumerate(parsed.errors):
            dropped = ToolResult(
                call_id=f"{turn_id}_op{index}",
                name="OP",
                ok=False,
                output=f"op dropped: {error.detail}\n{error.line}",
                error=error.reason,
            )
            events.append(dropped)
            self._tell(dropped, feedback)

        for index, op in enumerate(parsed.ops):
            call_id = f"{turn_id}_{index:02d}"
            entry = entries.get(op.action)
            if entry is None:
                dropped = ToolResult(
                    call_id=call_id,
                    name=op.action or op.op,
                    ok=False,
                    output=(
                        f"op dropped: {op.action!r} is not a name you can address here; "
                        "the names you can call are in your capabilities, and an op names one "
                        f"in its action field\n{op.raw}".rstrip()
                    ),
                    error="unknown_ref",
                )
                events.append(dropped)
                self._tell(dropped, feedback)
                continue
            events.extend(self._one_op(op, entry, call_id, ctx, result, feedback))
        return events, feedback

    def _tell(self, result: ToolResult, feedback: list[ToolResult]) -> None:
        """Feed a refused or dropped op back in this turn, once per name and reason (ADR 0041),
        so a model that repeats it ends the turn instead of spending the round budget on it."""
        told = (result.name, result.error or "")
        if told not in self._told:
            self._told.add(told)
            feedback.append(result)

    def _one_op(
        self,
        op: Op,
        entry: ToolEntry,
        call_id: str,
        ctx: TurnContext,
        result: TurnResult,
        feedback: list[ToolResult],
    ) -> list[ChannelEvent]:
        events: list[ChannelEvent] = [
            ToolCall(
                call_id=call_id,
                name=entry.name,
                params=dict(op.params),
                origin=entry.origin,
                tier=entry.tier,
            )
        ]
        result.tool_calls.append({"call_id": call_id, "name": entry.name, "params": op.params})
        outcome = self.gate.run_tool(entry, op.params, ctx, rationale=op.rationale)

        if isinstance(outcome.decision, Cancel):
            if outcome.card is not None:
                events.append(_card(outcome.card, op.rationale))
            refusal = ToolResult(
                call_id=call_id,
                name=entry.name,
                ok=False,
                output=outcome.decision.detail or outcome.decision.reason,
                error=outcome.decision.reason,
                tier=entry.tier,
            )
            events.append(refusal)
            # A card waits on the user. A refusal is final, and the model is told in this turn
            # (ADR 0041): a turn that ends on a refused read leaves her promising a result that
            # will never come.
            if outcome.card is None:
                self._tell(refusal, feedback)
            return events

        if outcome.result is None:
            # A host tool: the gate allowed it and the page runs it (README §3.2 step 5). The
            # call is the instruction; the answer arrives in the next turn's frame.
            return events

        answer = _tool_result(call_id, entry.name, outcome.result)
        feedback.append(answer)
        events.append(answer)
        return events

    # -- the row ----------------------------------------------------------------------------------

    def _close_row(
        self,
        result: TurnResult,
        started: float,
        reason: str,
        conversation_id: str,
        ctx: TurnContext,
    ) -> str:
        """Write the row of a turn that ended by a raise or a closed stream. Returns the reason."""
        result.duration_ms = int((time.monotonic() - started) * 1000)
        result.is_error = True
        result.error_reason = reason
        self._finish(result, conversation_id, ctx)
        return result.error_reason or "unknown"

    def _finish(self, result: TurnResult, conversation_id: str, ctx: TurnContext) -> str | None:
        """The one guarded row write every exit uses.

        A failed write is tried once more (``LedgerHook`` keeps it retryable and a raise in
        ``Ledger.record`` rolls its single INSERT back, so no row is doubled). If it fails again
        the ledger's exception does not leave the turn: the caller gets the exception's type name
        (never its message) and ends the turn with its own terminal event.
        """
        self._last = result
        failed: str | None = None
        for _attempt in range(2):
            try:
                self.ledger.after_turn(
                    result,
                    conversation=conversation_id,
                    origin=f"host:{ctx.app_id}" if ctx.app_id else "core",
                    surface=ctx.surface,
                    trigger=ctx.trigger,
                )
            except Exception as exc:
                failed = type(exc).__name__
            else:
                return None
        return failed


# --- messages ------------------------------------------------------------------------------------


def _in_flight(events: Sequence[ChannelEvent]) -> list[str]:
    """The host calls of a round that went to the page and have no answer yet, by bare name."""
    answered = {e.call_id for e in events if isinstance(e, ToolResult)}
    return [
        e.name.rsplit(".", 1)[-1]
        for e in events
        if isinstance(e, ToolCall) and e.origin != "core" and e.call_id not in answered
    ]


def _joined(blocks: Sequence[PromptBlock]) -> str:
    return "\n\n".join(block.text.rstrip() for block in blocks) + "\n" if blocks else ""


def _opening_message(frame: Sequence[PromptBlock], user_message: str) -> str:
    """The frame, then what the user said. Every turn sends this; only this can move."""
    parts = [block.text.rstrip() for block in frame]
    parts.append(f"## The message\n\n{user_message.strip()}")
    return "\n\n".join(parts) + "\n"


def _results_message(results: Sequence[ToolResult]) -> str:
    """What the tools you just called returned — fenced, because a tool's output is not a command.

    A connector's answer is a third party's text and a page's is the page's. Neither is an
    instruction, and the fence says so with a nonce the content cannot guess or replay.
    """
    body = "\n\n".join(f"- {item.name} → {_outcome(item)}\n{_body(item)}" for item in results)
    return (
        "## Results from the tools you just called\n\n"
        f"{wrap_untrusted(body, nonce=fresh_nonce())}\n"
    )


def _outcome(item: ToolResult) -> str:
    return "ok" if item.ok else f"error: {item.error or 'unknown'}"


def _body(item: ToolResult) -> str:
    return item.output.strip() or "(no output)"


def _card(card: DecisionRequested, rationale: str) -> DecisionRequested:
    """The card the gate filed, with the model's own reason for asking on it."""
    if card.rationale or not rationale:
        return card
    return DecisionRequested(
        id=card.id,
        decision_kind=card.decision_kind,
        action=card.action,
        params=dict(card.params),
        rationale=rationale,
        options=card.options,
        expires_at=card.expires_at,
        origin=card.origin,
        surface=card.surface,
        capture_id=card.capture_id,
    )


def _tool_result(call_id: str, name: str, result: ExecResult) -> ToolResult:
    return ToolResult(
        call_id=call_id,
        name=name,
        ok=result.ok,
        output=result.output,
        truncated=result.truncated,
        error=result.error,
        tier=result.tier,
        ms=result.ms,
    )

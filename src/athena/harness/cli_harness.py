"""One CLI harness, two dialects (README §3.1, §3.2 steps 2 to 5; ADR 0007).

A CLI engine is the user's own ``claude`` or ``codex`` binary, billed to the subscription they
already have: no key is typed at setup, which is act 1 of the demo. Both are driven by *this*
class. The difference between them is a :class:`CliDialect` — which arguments to pass, what goes
on stdin, how to read one line of stdout — and nothing else. The gate, the ledger row, the
grammar and the round budget are the harness's, so swapping engines changes who is billed and
not what Athena may do.

**The two halves of the prompt reach the CLI differently, and that is the point.** The static
blocks are written to a file and passed as the system prompt on the *first* invocation of a
conversation; every later turn resumes that session and sends the frame alone, because a resumed
CLI session keeps the system prompt it was opened with. That is exactly the finding ADR 0006
answers, and this is the class where it would otherwise have been re-made: composing both halves
into the system prompt would freeze host state on turn one and nothing would look broken.

A dialect that cannot resume (``codex``) is handed the static half on stdin on every invocation
instead, because a stateless CLI has no session to keep it in. The rule is unchanged either way:
nothing that can move between turns is ever composed into the static half.

**Eight rounds are one turn and one ledger row.** The model proposes ops, the gate decides, the
executors that ran hand their answers back, and the model gets another round — up to eight
(README §3.2 step 3). A round only follows a round in which something actually executed: a gated
op is waiting on the user, a host tool is waiting on the page, and a dropped envelope is told to
the model in the next turn's frame. One turn is one row whatever happened inside it.
"""

from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

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
from athena.harness.transports import CliRequest, SubprocessTransport, Transport

__all__ = [
    "CLAUDE",
    "CLAUDE_EXTRA_ARGS",
    "CODEX",
    "DIALECTS",
    "MAX_ROUNDS",
    "TURN_TIMEOUT_S",
    "CliDialect",
    "CliHarness",
    "Decoded",
]

#: A CLI turn is allowed twenty-five minutes. It is a wall, not a budget: a turn that has not
#: produced a line in that long is a hung process, not a slow thought.
TURN_TIMEOUT_S = 25 * 60

#: Model → tool → model rounds inside one turn (README §3.2 step 3).
MAX_ROUNDS = 8

#: The CLI's own tools stay off inside Athena: a page is operated through the gate, never through
#: a shell. ``dontAsk`` denies whatever permission prompt remains rather than blocking on a
#: terminal nobody is looking at.
CLAUDE_EXTRA_ARGS: tuple[str, ...] = ("--restricted", "--permission-mode", "dontAsk")


# --- one decoded line ----------------------------------------------------------------------------


@dataclass(frozen=True)
class Decoded:
    """One line of a CLI's stdout, in the vocabulary both dialects share.

    Anything a dialect does not recognise decodes to ``None`` and is skipped. That is deliberate
    tolerance in one direction only: an unknown *line* is noise, while an unknown ``type`` that
    used to carry the session id would show up as a conversation that never resumes, which the
    fixtures catch.
    """

    kind: str  # "session" | "text" | "result"
    text: str = ""
    session_id: str | None = None
    is_error: bool = False
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float | None = None


# --- dialects ------------------------------------------------------------------------------------


@dataclass(frozen=True)
class CliDialect:
    """How one CLI is spoken to.

    ``resumes`` and ``system_on_stdin`` are the same fact from two sides: a CLI that can resume a
    session is told the law once and reminded of the world every turn; one that cannot is told
    both every time.
    """

    name: str
    executable: str
    system_on_stdin: bool = False
    resumes: bool = True

    def argv(
        self,
        *,
        prompt_file: str | None,
        model: str,
        resume: str | None,
        extra_args: Sequence[str],
    ) -> list[str]:
        raise NotImplementedError

    def decode(self, record: Mapping[str, Any]) -> Decoded | None:
        raise NotImplementedError


@dataclass(frozen=True)
class ClaudeDialect(CliDialect):
    """``claude -p -`` with a stream-json stdout and a system prompt read from a file."""

    def argv(
        self,
        *,
        prompt_file: str | None,
        model: str,
        resume: str | None,
        extra_args: Sequence[str],
    ) -> list[str]:
        argv = ["-p", "-", "--output-format", "stream-json", "--verbose"]
        if resume:
            argv += ["--resume", resume]
        if model:
            argv += ["--model", model]
        if prompt_file:
            argv += ["--system-prompt-file", prompt_file]
        return argv + list(extra_args)

    def decode(self, record: Mapping[str, Any]) -> Decoded | None:
        kind = record.get("type")
        if kind == "system":
            return Decoded("session", session_id=_str_or_none(record.get("session_id")))
        if kind == "assistant":
            text = "".join(_assistant_text(record))
            return Decoded("text", text=text) if text else None
        if kind == "result":
            usage = record.get("usage")
            usage = usage if isinstance(usage, Mapping) else {}
            cost = record.get("total_cost_usd")
            return Decoded(
                "result",
                is_error=bool(record.get("is_error")),
                input_tokens=_int(usage.get("input_tokens")),
                output_tokens=_int(usage.get("output_tokens")),
                cost_usd=float(cost) if isinstance(cost, int | float) else None,
            )
        return None


@dataclass(frozen=True)
class CodexDialect(CliDialect):
    """``codex exec --json``: a sandboxed, read-only, single-shot invocation.

    It is not resumed. The CLI's own sandbox is set to ``read-only`` because everything Athena is
    allowed to do goes through the gate, and an engine that could touch the disk on its own would
    be a second, ungated set of hands. Its conversation continuity comes from the frame — recalled
    episodes and last turn's results — which is what the two-output composer makes possible.
    """

    def argv(
        self,
        *,
        prompt_file: str | None,
        model: str,
        resume: str | None,
        extra_args: Sequence[str],
    ) -> list[str]:
        argv = ["exec", "--json", "--skip-git-repo-check", "-s", "read-only"]
        if model:
            argv += ["-m", model]
        return argv + list(extra_args) + ["-"]

    def decode(self, record: Mapping[str, Any]) -> Decoded | None:
        kind = record.get("type")
        if kind == "thread.started":
            return Decoded("session", session_id=_str_or_none(record.get("thread_id")))
        if kind == "item.completed":
            item = record.get("item")
            if isinstance(item, Mapping) and item.get("type") == "agent_message":
                return Decoded("text", text=str(item.get("text", "")))
            return None
        if kind == "turn.completed":
            usage = record.get("usage")
            usage = usage if isinstance(usage, Mapping) else {}
            return Decoded(
                "result",
                input_tokens=_int(usage.get("input_tokens")),
                output_tokens=_int(usage.get("output_tokens")),
            )
        if kind in ("turn.failed", "error"):
            return Decoded("result", is_error=True)
        return None


CLAUDE = ClaudeDialect(name="claude_code", executable="claude")
CODEX = CodexDialect(name="codex", executable="codex", system_on_stdin=True, resumes=False)
DIALECTS: dict[str, CliDialect] = {CLAUDE.name: CLAUDE, CODEX.name: CODEX}


# --- the harness ---------------------------------------------------------------------------------


@dataclass
class CliHarness:
    """Satisfies ``athena.contracts.Harness``. One turn in, a stream of channel events out."""

    gate: GateHook
    ledger: LedgerHook
    truncation: TruncationHook
    transport: Transport = field(default_factory=SubprocessTransport)
    dialect: CliDialect = CLAUDE
    #: Where the composed system prompt is written. One file per conversation, overwritten.
    prompt_root: str = "."
    #: Where the CLI is run. Never the repository: the engine has no business in a checkout.
    cwd: str = "."
    model: str = ""
    max_rounds: int = MAX_ROUNDS
    extra_args: tuple[str, ...] = ()
    timeout_s: int = TURN_TIMEOUT_S
    #: The engine name the ledger records. Empty means "the dialect's own", which is the only
    #: sensible default; it is a field and not a property because ``Harness`` declares it one.
    name: str = ""

    def __post_init__(self) -> None:
        self.name = self.name or self.dialect.name
        self._last: TurnResult | None = None
        #: conversation id → the CLI's own session id, for ``--resume``.
        self._sessions: dict[str, str] = {}

    def session_id(self, conversation_id: str) -> str | None:
        """The CLI session this conversation is resumed from, if one has been opened."""
        return self._sessions.get(conversation_id)

    async def last_result(self) -> TurnResult | None:
        return self._last

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
        turn_id = ctx.turn_id or ids.mint("turn")
        started = time.monotonic()
        result = TurnResult(turn_id=turn_id, engine=self.name, model=self.model, rounds=0)
        result.block_hashes = TruncationHook.block_hashes([*static_blocks, *frame])
        self.truncation.before_prompt([*static_blocks, *frame], turn_id)

        entries = {entry.name: entry for entry in tools}
        static_text = _joined(static_blocks)
        history = [_opening_message(frame, user_message)]
        texts: list[str] = []
        tts: str | None = None
        failure: tuple[str, str] | None = None

        for _round in range(1, self.max_rounds + 1):
            result.rounds = _round
            request = self._request(conversation_id, static_text, history)
            round_text, decoded_failure = await self._invoke(request, conversation_id, result)
            if decoded_failure is not None:
                failure = decoded_failure
                break

            parsed = parse_turn(round_text)
            if parsed.text:
                texts.append(parsed.text)
                yield TextDelta(text=parsed.text)
            if tts is None and parsed.tts:
                tts = parsed.tts

            events, feedback = self._dispatch(parsed, entries, ctx, turn_id, result)
            for event in events:
                yield event
            if not feedback:
                break
            history.append(_results_message(feedback))

        result.text = "\n\n".join(texts).strip()
        if failure is None and not result.text and not result.tool_calls:
            failure = ("engine_error", "the CLI exited cleanly and produced no text")

        result.duration_ms = int((time.monotonic() - started) * 1000)
        if failure is not None:
            result.is_error = True
            result.error_reason = failure[0]
            self._finish(result, conversation_id, ctx)
            yield TurnError(reason=result.error_reason or "unknown", detail=failure[1])
            return

        self._finish(result, conversation_id, ctx)
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

    # -- one invocation ---------------------------------------------------------------------------

    async def _invoke(
        self, request: CliRequest, conversation_id: str, result: TurnResult
    ) -> tuple[str, tuple[str, str] | None]:
        """Run the CLI once. Returns ``(assistant text, failure)``; exactly one is meaningful."""
        segments: list[str] = []
        try:
            async for line in self.transport.run(request):
                record = _decode(line)
                decoded = self.dialect.decode(record) if record is not None else None
                if decoded is None:
                    continue
                if decoded.kind == "session" and decoded.session_id:
                    self._sessions[conversation_id] = decoded.session_id
                elif decoded.kind == "text" and decoded.text:
                    segments.append(decoded.text)
                elif decoded.kind == "result":
                    _apply_usage(result, decoded)
                    if decoded.is_error:
                        return "", ("engine_error", "the CLI reported an error and stopped")
        except TimeoutError:
            return "", ("timeout", f"the CLI produced no line for {request.timeout_s}s")
        except OSError as exc:
            # argv is a list and never a shell string, so the message carries no user text and
            # no secret — and "engine_error" with nothing after it is a bug report nobody can act
            # on. The reason is the fixed-set ledger value; this is the sentence beside it.
            return "", ("engine_error", f"{type(exc).__name__}: {exc}")
        return "".join(segments), None

    def _request(
        self, conversation_id: str, static_text: str, history: Sequence[str]
    ) -> CliRequest:
        resume = self._sessions.get(conversation_id) if self.dialect.resumes else None
        prompt_file: str | None = None
        if resume is None and not self.dialect.system_on_stdin:
            prompt_file = self._write_prompt(conversation_id, static_text)
        if self.dialect.system_on_stdin:
            # A CLI with no session to keep the law in is told it every time.
            stdin = "\n\n---\n\n".join([static_text.rstrip(), *history])
        elif resume is None:
            stdin = history[0] if len(history) == 1 else "\n\n---\n\n".join(history)
        else:
            stdin = history[-1]
        return CliRequest(
            argv=self.dialect.argv(
                prompt_file=prompt_file,
                model=self.model,
                resume=resume,
                extra_args=self.extra_args,
            ),
            stdin=stdin,
            cwd=self.cwd,
            system_prompt_file=prompt_file,
            timeout_s=self.timeout_s,
        )

    def _write_prompt(self, conversation_id: str, static_text: str) -> str:
        directory = Path(self.prompt_root) / "prompts"
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"athena-{conversation_id}.md"
        path.write_text(static_text, encoding="utf-8")
        return str(path)

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

        Only what *executed* is fed back. A gated op is waiting on the user, a host tool is
        waiting on the page, and a dropped envelope is told to the model in the next turn's frame
        — none of the three is a reason to spend another round asking the same model again.
        """
        events: list[ChannelEvent] = []
        feedback: list[ToolResult] = []

        for index, error in enumerate(parsed.errors):
            events.append(
                ToolResult(
                    call_id=f"{turn_id}_op{index}",
                    name="OP",
                    ok=False,
                    output=f"op dropped: {error.detail}\n{error.line}",
                    error=error.reason,
                )
            )

        for index, op in enumerate(parsed.ops):
            call_id = f"{turn_id}_{index:02d}"
            entry = entries.get(op.action)
            if entry is None:
                events.append(
                    ToolResult(
                        call_id=call_id,
                        name=op.action or op.op,
                        ok=False,
                        output=f"op dropped: {op.action!r} is not a name you can address here",
                        error="unknown_ref",
                    )
                )
                continue
            events.extend(self._one_op(op, entry, call_id, ctx, result, feedback))
        return events, feedback

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
            events.append(
                ToolResult(
                    call_id=call_id,
                    name=entry.name,
                    ok=False,
                    output=outcome.decision.detail or outcome.decision.reason,
                    error=outcome.decision.reason,
                    tier=entry.tier,
                )
            )
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

    def _finish(self, result: TurnResult, conversation_id: str, ctx: TurnContext) -> None:
        self._last = result
        self.ledger.after_turn(
            result,
            conversation=conversation_id,
            origin=f"host:{ctx.app_id}" if ctx.app_id else "core",
            surface=ctx.surface,
            trigger=ctx.trigger,
        )


# --- messages ------------------------------------------------------------------------------------


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


# --- decoding helpers ----------------------------------------------------------------------------


def _decode(line: str) -> Mapping[str, Any] | None:
    stripped = line.strip()
    if not stripped:
        return None
    try:
        value = json.loads(stripped)
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, Mapping) else None


def _assistant_text(record: Mapping[str, Any]) -> list[str]:
    message = record.get("message")
    if not isinstance(message, Mapping):
        return []
    content = message.get("content")
    if isinstance(content, str):
        return [content]
    if not isinstance(content, list):
        return []
    return [
        str(block.get("text", ""))
        for block in content
        if isinstance(block, Mapping) and block.get("type") == "text" and block.get("text")
    ]


def _apply_usage(result: TurnResult, decoded: Decoded) -> None:
    result.input_tokens += decoded.input_tokens
    result.output_tokens += decoded.output_tokens
    if decoded.cost_usd is not None:
        result.cost_usd = (result.cost_usd or 0.0) + decoded.cost_usd
        result.cost_estimated = False


def _int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _str_or_none(value: Any) -> str | None:
    return str(value) if isinstance(value, str) and value else None

"""One CLI harness, two dialects (README §3.1, §3.2 steps 2 to 5; ADR 0007).

A CLI engine is the user's own ``claude`` or ``codex`` binary, billed to the subscription they
already have: no key is typed at setup, which is act 1 of the demo. Both are driven by *this*
class. The difference between them is a :class:`CliDialect` — which arguments to pass, what goes
on stdin, how to read one line of stdout — and nothing else. The gate, the ledger row, the
grammar and the round budget are :class:`~athena.harness.rounds.RoundHarness`'s, shared with the
API engine (ADR 0031), so swapping engines changes who is billed and not what Athena may do.

**The two halves of the prompt reach the CLI differently, and that is the point.** The static
blocks are written to a file and passed as the system prompt on the *first* invocation of a
conversation; every later turn resumes that session and sends the frame alone, because a resumed
CLI session keeps the system prompt it was opened with. That is exactly the finding ADR 0006
answers, and this is the class where it would otherwise have been re-made: composing both halves
into the system prompt would freeze host state on turn one and nothing would look broken.

A dialect that cannot resume (``codex``) is handed the static half on stdin on every invocation
instead, because a stateless CLI has no session to keep it in. The rule is unchanged either way:
nothing that can move between turns is ever composed into the static half.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, ClassVar

from athena.contracts.harness import TurnResult
from athena.harness.rounds import MAX_ROUNDS, TURN_TIMEOUT_S, Failure, RoundHarness
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
class CliHarness(RoundHarness):
    """Satisfies ``athena.contracts.Harness``. One turn in, a stream of channel events out.

    The turn itself — rounds, gate, dispatcher, ledger row — is :class:`RoundHarness`'s. What
    lives here is how one round reaches a CLI: argv, stdin, the prompt file and the session.
    """

    transport: Transport = field(default_factory=SubprocessTransport)
    dialect: CliDialect = CLAUDE
    #: Where the composed system prompt is written. One file per conversation, overwritten.
    prompt_root: str = "."
    #: Where the CLI is run. Never the repository: the engine has no business in a checkout.
    cwd: str = "."
    extra_args: tuple[str, ...] = ()

    silent_detail: ClassVar[str] = "the CLI exited cleanly and produced no text"

    def __post_init__(self) -> None:
        super().__post_init__()
        self.name = self.name or self.dialect.name
        #: conversation id → the CLI's own session id, for ``--resume``.
        self._sessions: dict[str, str] = {}
        #: conversation id -> the static half the CLI session was opened with. A resumed session
        #: keeps the law it was first told, so a static half that has changed (a switched-off
        #: app's tools leaving the capability block) opens a new session instead of resuming.
        self._static_seen: dict[str, str] = {}

    def session_id(self, conversation_id: str) -> str | None:
        """The CLI session this conversation is resumed from, if one has been opened."""
        return self._sessions.get(conversation_id)

    def _turn_started(self, conversation_id: str, static_text: str) -> None:
        if self._static_seen.get(conversation_id, static_text) != static_text:
            self._sessions.pop(conversation_id, None)
        self._static_seen[conversation_id] = static_text

    async def _round(
        self,
        conversation_id: str,
        static_text: str,
        history: Sequence[str],
        replies: Sequence[str],
        result: TurnResult,
    ) -> tuple[str, Failure | None]:
        # ``replies`` is unused on purpose: a resumed session remembers what it said, and a
        # single-shot CLI is given the results of its rounds rather than its own words back.
        request = self._request(conversation_id, static_text, history)
        return await self._invoke(request, conversation_id, result)

    # -- one invocation ---------------------------------------------------------------------------

    async def _invoke(
        self, request: CliRequest, conversation_id: str, result: TurnResult
    ) -> tuple[str, Failure | None]:
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
        except (ValueError, asyncio.LimitOverrunError):
            # StreamReader.readline raises one of these for a line over the reader limit.
            return "", ("engine_error", "the CLI wrote a line longer than the reader's line limit")
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

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

**A round ends in a typed exit (ADR 0109).** The transport reports how the process ended beside
its lines, and the dialect reads the exit, the result record and the stderr tail together into
one of a few closed classes. A thread that is gone, or that is itself the cause (too long to
continue), is released and the round is asked again once, unresumed, in the same turn; every
other failure keeps the thread and ends the turn with that class's fixed sentence.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, ClassVar, Literal

from athena.contracts.harness import TurnResult
from athena.harness.rounds import MAX_ROUNDS, TURN_TIMEOUT_S, Failure, RoundHarness
from athena.harness.transports import CliRequest, ExitStatus, SubprocessTransport, Transport

__all__ = [
    "CLAUDE",
    "CLAUDE_EXTRA_ARGS",
    "CODEX",
    "DIALECTS",
    "FAILURE_SENTENCES",
    "MAX_ROUNDS",
    "TURN_TIMEOUT_S",
    "CliDialect",
    "CliHarness",
    "Decoded",
    "FailureClass",
]

#: The CLI's own tools stay off inside Athena: a page is operated through the gate, never through
#: a shell. ``dontAsk`` denies whatever permission prompt remains rather than blocking on a
#: terminal nobody is looking at.
CLAUDE_EXTRA_ARGS: tuple[str, ...] = ("--restricted", "--permission-mode", "dontAsk")

# --- how a round failed --------------------------------------------------------------------------

FailureClass = Literal["gone", "poisoned", "auth", "limit", "transient", "unknown"]
"""Why a CLI round failed, as far as its exit can tell. Closed: a person acts on each one."""

#: A failed thread is released and the round asked again once only for these: the thread is
#: gone, or the thread is itself the cause. Anything else would fail the same way on a new one.
RESEED: frozenset[FailureClass] = frozenset({"gone", "poisoned"})

#: The sentence a person reads for each class. Fixed text only: a CLI's own error can quote the
#: request, so nothing it wrote reaches a ``TurnError`` or a ledger row. ``unknown`` has none
#: here; it names the exit code instead (:meth:`CliDialect.classify`).
FAILURE_SENTENCES: dict[FailureClass, str] = {
    "gone": "the CLI lost this conversation's thread and could not start a fresh one",
    "poisoned": "this conversation is too long for the CLI, even started afresh",
    "auth": "the CLI is not signed in; sign in to it and try again",
    "limit": "the CLI's usage limit is reached; try again when it resets",
    "transient": "the CLI's service is busy or unreachable; try again in a moment",
}

# --- one decoded line ----------------------------------------------------------------------------


@dataclass(frozen=True)
class Decoded:
    """One line of a CLI's stdout, in the vocabulary both dialects share.

    Anything a dialect does not recognise decodes to ``None`` and is skipped. That is deliberate
    tolerance in one direction only: an unknown *line* is noise, while an unknown ``type`` that
    used to carry the session id would show up as a conversation that never resumes, which the
    fixtures catch.
    """

    kind: str  # "session" | "text" | "result" | "notice"
    text: str = ""
    session_id: str | None = None
    is_error: bool = False
    #: A failed result record's subtype and its own words, read only by
    #: :meth:`CliDialect.classify`. Never shown and never stored: they can quote the request.
    subtype: str = ""
    said: str = ""
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
    #: What this CLI says when it fails, lowercased, first match wins. Dated: a CLI release can
    #: reword any of these, and an unmatched failure is still a failure, read as ``unknown``.
    signatures: tuple[tuple[str, FailureClass], ...] = ()

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

    def classify(
        self, status: ExitStatus, outcome: Decoded | None
    ) -> tuple[FailureClass, str] | None:
        """``None`` for a round that finished, else its class and the sentence for a person.

        A round finished when the CLI exited 0 *and* wrote a result record that is not an error.
        A stream that stops without one is a crash, whatever it printed before.
        """
        failed_record = outcome is not None and outcome.is_error
        if status.returncode == 0 and outcome is not None and not failed_record:
            return None
        said = [status.stderr_tail]
        if outcome is not None and failed_record:
            said += [outcome.subtype, outcome.said]
        lowered = "\n".join(said).lower()
        for signature, kind in self.signatures:
            if signature in lowered:
                return kind, FAILURE_SENTENCES[kind]
        code = f"exit code {status.returncode}"
        if outcome is None:
            return "unknown", f"the CLI stopped before it finished ({code})"
        return "unknown", f"the CLI reported an error and stopped ({code})"


#: ``claude`` 2.x, as of 2026-10. Gone and poisoned come first: a "prompt is too long" can arrive
#: inside an "API Error: 400" line, and it is the thread, not the service, that has to change.
CLAUDE_SIGNATURES: tuple[tuple[str, FailureClass], ...] = (
    ("no conversation found with session id", "gone"),
    ("prompt is too long", "poisoned"),
    ("exceed context limit", "poisoned"),
    ("invalid api key", "auth"),
    ("please run /login", "auth"),
    ("oauth token has expired", "auth"),
    ("authentication_error", "auth"),
    ("usage limit", "limit"),
    ("rate_limit_error", "limit"),
    ("overloaded", "transient"),
    ("api error: 5", "transient"),
    ("connection error", "transient"),
    ("econnreset", "transient"),
    ("etimedout", "transient"),
)

#: ``codex exec`` 0.x, as of 2026-10. It never resumes, so it has no "gone".
CODEX_SIGNATURES: tuple[tuple[str, FailureClass], ...] = (
    ("context_length_exceeded", "poisoned"),
    ("context window", "poisoned"),
    ("not logged in", "auth"),
    ("unauthorized", "auth"),
    ("usage limit", "limit"),
    ("rate limit", "limit"),
    ("stream error", "transient"),
    ("service unavailable", "transient"),
    ("overloaded", "transient"),
    ("error sending request", "transient"),
)


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
            is_error = bool(record.get("is_error"))
            return Decoded(
                "result",
                is_error=is_error,
                input_tokens=_int(usage.get("input_tokens")),
                output_tokens=_int(usage.get("output_tokens")),
                cost_usd=float(cost) if isinstance(cost, int | float) else None,
                # On success ``result`` is the reply itself, which is nobody's error.
                subtype=_text(record.get("subtype")) if is_error else "",
                said=_text(record.get("result")) if is_error else "",
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
        # ``--ephemeral``: the thread is never resumed, so keep the prompt off the CLI's disk.
        argv = ["exec", "--json", "--ephemeral", "--skip-git-repo-check", "-s", "read-only"]
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
            error = record.get("error")
            message = error.get("message") if isinstance(error, Mapping) else record.get("message")
            # ``error`` is a notice mid-stream (a reconnect, a retried request): the turn is
            # only failed by ``turn.failed``, or by a stream that ends with nothing after it.
            return Decoded(
                "result" if kind == "turn.failed" else "notice",
                is_error=True,
                said=_text(message),
            )
        return None


CLAUDE = ClaudeDialect(name="claude_code", executable="claude", signatures=CLAUDE_SIGNATURES)
CODEX = CodexDialect(
    name="codex",
    executable="codex",
    system_on_stdin=True,
    resumes=False,
    signatures=CODEX_SIGNATURES,
)
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
        resumed = self.dialect.resumes and conversation_id in self._sessions
        request = self._request(conversation_id, static_text, history)
        text, failure, kind = await self._invoke(request, conversation_id, result)
        if resumed and kind in RESEED:
            # The thread is gone, or it is the cause. Release it and ask once more, unresumed:
            # the static half as the system prompt and the whole turn so far on stdin, which is
            # what the first round of a conversation sends. The frame's recall is the reseed.
            # The second answer is final whatever it is, because it resumed nothing.
            self._sessions.pop(conversation_id, None)
            request = self._request(conversation_id, static_text, history)
            text, failure, _ = await self._invoke(request, conversation_id, result)
        return text, failure

    # -- one invocation ---------------------------------------------------------------------------

    async def _invoke(
        self, request: CliRequest, conversation_id: str, result: TurnResult
    ) -> tuple[str, Failure | None, FailureClass | None]:
        """Run the CLI once, and keep the child's peak working set on the turn's row however the
        run ended (ADR 0143): the turn's figure is the largest of its rounds'."""
        try:
            return await self._read(request, conversation_id, result)
        finally:
            peak = request.exit.peak_mb
            if peak is not None and (result.peak_mb is None or peak > result.peak_mb):
                result.peak_mb = peak

    async def _read(
        self, request: CliRequest, conversation_id: str, result: TurnResult
    ) -> tuple[str, Failure | None, FailureClass | None]:
        """Run the CLI once. Returns ``(assistant text, failure, its class)``.

        The text is meaningful only when there is no failure; the class only when the exit was
        read and classified (a timeout or a broken pipe has none, and is never reseeded).
        """
        segments: list[str] = []
        outcome: Decoded | None = None
        notice: Decoded | None = None
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
                    # Read on to the end: the exit is reported after the last line. A failed
                    # record stays the outcome even if a later one says otherwise.
                    if outcome is None or not outcome.is_error:
                        outcome = decoded
                elif decoded.kind == "notice":
                    notice = decoded
        except TimeoutError:
            # The request waits at most what is left of the turn, so a line that never came is
            # the turn's wall (ADR 0115). The cut run reported no usage: the row's cost is a floor.
            result.cost_estimated = True
            return "", self._wall(), None
        except (ValueError, asyncio.LimitOverrunError):
            # StreamReader.readline raises one of these for a line over the reader limit.
            failure = ("engine_error", "the CLI wrote a line longer than the reader's line limit")
            return "", failure, None
        except OSError as exc:
            # argv is a list and never a shell string, so the message carries no user text and
            # no secret — and "engine_error" with nothing after it is a bug report nobody can act
            # on. The reason is the fixed-set ledger value; this is the sentence beside it.
            return "", ("engine_error", f"{type(exc).__name__}: {exc}"), None
        if outcome is None:
            # No result record at all: the last notice is what the CLI said about why.
            outcome = notice
        verdict = self.dialect.classify(request.exit.status, outcome)
        if verdict is not None:
            kind, sentence = verdict
            # The plan's usage limit is its own reason, so the vitals can count it as a blank run
            # rather than a broken engine (ADR 0143); every other class stays engine_error.
            return "", ("usage_limit" if kind == "limit" else "engine_error", sentence), kind
        return "".join(segments), None, None

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
            # What is left of the turn's wall, not the wall again: eight rounds share it (ADR 0115).
            timeout_s=self._remaining_s(),
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


def _text(value: Any) -> str:
    return value if isinstance(value, str) else ""

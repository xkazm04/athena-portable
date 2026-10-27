"""ADR 0097 (legs by kind): every model call of the Adopt studio goes through one door.

A *leg* is one job handed to a model: write the next question card, audit the slots, research a
rule, shape a world. :meth:`LegRunner.run_leg` is the only place a leg is run, and its ``kind`` is
required, because the tier — which Claude 5.5 model, at which effort — is configuration per kind
(``tiers.json``), chosen by the tier bench rather than by taste.

**The Claude CLI, never the API (ADR 0007).** A leg is ``claude -p`` on the subscription, its
environment stripped of ``ANTHROPIC_API_KEY`` by the transport (:func:`~athena.harness.transports.
child_env`). The flags are one function, :func:`cli_argv`: no built-in tools unless the caller
names them (``allowed_tools`` — WebSearch and WebFetch for a research lane, Read for a document
lane), settings and MCP servers ignored, nothing persisted, prompts denied rather than asked.

**Measured.** Every invocation gets ``ms`` and ``first_text_ms`` (the first text delta, read from
``--include-partial-messages``), one ledger row — a failure and a malformed answer included —
and one ``on_usage`` call the session turns into an ``adopt.usage`` event.

**JSON legs are checked and retried once.** The answer is extracted (:func:`~athena.proving.roles.
extract_json`), its top level checked against the leg's schema (:func:`~athena.core.validators.
check_schema`) and then by the caller's own ``check``; a problem is sent back once with the
answer it found wrong, and a second problem is a ``malformed`` leg the loop degrades around.

**Not only the studio's.** The sleep cycle's two legs (ADR 0143), ``sleep.compress`` and
``sleep.merge``, are run through this door too: a ``sleep.*`` kind is its own ledger ``trigger``
(``sleep.compress``, where an adopt leg's is ``adopt.<kind>``) on the surface ``sleep``.

**A warm session for the interviewer.** Personas measured 2.2 s against 4.4 s to first text with
one long-lived ``--input-format stream-json`` process per conversation, so the ``interview`` kind
keeps one (:class:`WarmSession`) for the life of an adopt session. It is killed on close and
expiry; a process that died is replaced by a cold call, never by a stall.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import queue
import subprocess
import threading
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from athena.contracts.adopt import LEG_KINDS, LegKind, Tier
from athena.contracts.harness import fnv1a_64, normalize_reason
from athena.core.validators import check_schema
from athena.harness.cli_harness import CLAUDE
from athena.harness.transports import CliRequest, SubprocessTransport, Transport, child_env
from athena.proving.roles import extract_json

__all__ = [
    "ALLOWED_MODELS",
    "DEFAULT_TIMEOUT_S",
    "ENGINE",
    "EXECUTABLE",
    "TIERS_PATH",
    "LedgerSink",
    "LegResult",
    "LegRunner",
    "SubprocessWarm",
    "UsageFn",
    "WarmProcess",
    "WarmSession",
    "WarmSpawner",
    "cli_argv",
    "load_tiers",
]

TIERS_PATH = Path(__file__).with_name("tiers.json")

#: The ledger's engine column for every leg, and the binary behind it.
ENGINE = "claude_code"
EXECUTABLE = "claude"

#: Claude 5.5 only (operator rule; never mixed with 4.5 in one series).
ALLOWED_MODELS: tuple[str, ...] = ("claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5")
EFFORTS: tuple[str, ...] = ("low", "medium")

#: How long a leg may go without a line before it is a ``timeout``. A research lane browses.
DEFAULT_TIMEOUT_S: dict[str, float] = {
    "interview": 120.0,
    "audit": 180.0,
    "research": 240.0,
    "shape": 300.0,
    "persona": 120.0,
    "judge": 180.0,
    "sleep.compress": 300.0,
    "sleep.merge": 300.0,
}

#: What a malformed answer is sent back with, once.
RETRY_NOTE = (
    "Your previous answer could not be used: {problem}\n"
    "Answer again with only the JSON object the instructions describe, nothing before or after it."
)

#: Ledger columns for a leg (README §2 invariant 6): an adopt leg belongs to no page.
ORIGIN = "core"
SURFACE = "adopt"
#: A leg kind under this prefix is the sleep cycle's (ADR 0143): its own trigger and surface.
SLEEP_PREFIX = "sleep."
SLEEP_SURFACE = "sleep"


# --- tiers --------------------------------------------------------------------------------------


def load_tiers(path: str | Path = TIERS_PATH) -> dict[str, Tier]:
    """``tiers.json`` as ``{kind: Tier}``, every kind present, every value allowed — or raise.

    A bad file fails loudly at studio construction rather than at the first leg: a typo in a
    model id would otherwise surface as a CLI error mid-conversation.
    """
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError(f"{path}: not a JSON object")
    tiers: dict[str, Tier] = {}
    for kind in LEG_KINDS:
        entry = raw.get(kind)
        if not isinstance(entry, dict):
            raise ValueError(f"{path}: no tier for leg kind {kind!r}")
        model, effort = entry.get("model"), entry.get("effort")
        if model not in ALLOWED_MODELS:
            raise ValueError(f"{path}: {kind}.model {model!r} is not one of {ALLOWED_MODELS}")
        if effort not in EFFORTS:
            raise ValueError(f"{path}: {kind}.effort {effort!r} is not one of {EFFORTS}")
        tiers[kind] = Tier(model=str(model), effort="low" if effort == "low" else "medium")
    return tiers


# --- the flags ----------------------------------------------------------------------------------


def cli_argv(
    tier: Tier,
    *,
    system_file: str,
    allowed_tools: Sequence[str] = (),
    add_dirs: Sequence[str] = (),
    warm: bool = False,
) -> list[str]:
    """The one flag set every leg is run with (the executable is the transport's).

    ``--tools ""`` turns every built-in tool off; naming tools turns exactly those on, and
    ``--restricted`` keeps WebFetch and every code-running tool off unless ``--tools`` names them
    (claude 2.1.299 ``--help``). ``--permission-mode dontAsk`` denies whatever would prompt, so a
    child never waits on a terminal nobody is looking at.
    """
    tools = ",".join(allowed_tools)
    argv = [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--model",
        tier.model,
        "--effort",
        tier.effort,
        "--system-prompt-file",
        system_file,
        "--tools",
        tools,
        "--restricted",
        "--strict-mcp-config",
        "--permission-mode",
        "dontAsk",
        "--no-session-persistence",
    ]
    if allowed_tools:
        argv += ["--allowedTools", tools]
    for directory in add_dirs:
        argv += ["--add-dir", directory]
    if warm:
        argv += ["--input-format", "stream-json"]
    return argv


# --- ports --------------------------------------------------------------------------------------


class LedgerSink(Protocol):
    """What a leg needs of :class:`~athena.core.ledger.Ledger`: one row per invocation."""

    def record(
        self,
        *,
        engine: str,
        model: str,
        conversation: str,
        origin: str,
        surface: str,
        trigger: str,
        rounds: int = ...,
        input_tokens: int = ...,
        output_tokens: int = ...,
        cost_usd: float | None = ...,
        ms: int = ...,
        is_error: bool = ...,
        error_reason: str | None = ...,
    ) -> object: ...


class WarmProcess(Protocol):
    """One long-lived ``--input-format stream-json`` CLI process."""

    def send(self, line: str) -> None: ...

    def read_line(self, timeout: float) -> str | None:
        """The next stdout line; ``None`` at end of stream; ``TimeoutError`` when none came."""
        ...

    def alive(self) -> bool: ...

    def kill(self) -> None: ...


#: ``(argv without the executable, cwd) -> a started process``. Tests pass a fake.
WarmSpawner = Callable[[Sequence[str], str], WarmProcess]

#: Called once per invocation with what ``adopt.usage`` carries.
UsageFn = Callable[["LegResult"], None]


class SubprocessWarm:  # pragma: no cover - real I/O
    """The real warm process: ``claude`` with pipes and a reader thread feeding a queue."""

    def __init__(self, argv: Sequence[str], cwd: str, executable: str = EXECUTABLE) -> None:
        resolved = SubprocessTransport(executable).resolve()
        creationflags = 0x08000000 if os.name == "nt" else 0
        self._proc = subprocess.Popen(
            [resolved, *argv],
            cwd=cwd,
            env=child_env(os.environ),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            creationflags=creationflags,
        )
        self._lines: queue.Queue[str | None] = queue.Queue()
        threading.Thread(target=self._pump, name="adopt-warm-reader", daemon=True).start()

    def _pump(self) -> None:
        stdout = self._proc.stdout
        try:
            if stdout is not None:
                for raw in stdout:
                    self._lines.put(raw.decode("utf-8", errors="replace").rstrip("\r\n"))
        finally:
            self._lines.put(None)

    def send(self, line: str) -> None:
        stdin = self._proc.stdin
        if stdin is None:
            raise OSError("the warm process has no stdin")
        stdin.write((line + "\n").encode("utf-8"))
        stdin.flush()

    def read_line(self, timeout: float) -> str | None:
        try:
            return self._lines.get(timeout=timeout)
        except queue.Empty:
            raise TimeoutError(f"no line in {timeout:g}s") from None

    def alive(self) -> bool:
        return self._proc.poll() is None

    def kill(self) -> None:
        if self._proc.poll() is None:
            self._proc.kill()
        with contextlib.suppress(subprocess.TimeoutExpired):
            self._proc.wait(timeout=5)


def subprocess_warm(argv: Sequence[str], cwd: str) -> WarmProcess:  # pragma: no cover - real I/O
    return SubprocessWarm(argv, cwd)


# --- one invocation -----------------------------------------------------------------------------


@dataclass(frozen=True)
class LegResult:
    """What one leg produced. ``value`` is the checked JSON object for a JSON leg.

    ``error_reason`` is in ``ERROR_REASONS`` or ``None``; a malformed answer after the retry is
    ``parse_error`` with ``malformed`` true, which is what the loop degrades on.
    """

    kind: str
    ok: bool
    model: str
    effort: str
    text: str = ""
    value: dict[str, Any] | None = None
    ms: int = 0
    first_text_ms: int | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float | None = None
    error_reason: str | None = None
    detail: str = ""
    attempts: int = 1
    warm: bool = False
    malformed: bool = False


@dataclass
class _Reading:
    """The stream-json records of one answer, folded as they arrive."""

    started: float
    segments: list[str] = field(default_factory=list)
    result_text: str = ""
    first_text_ms: int | None = None
    done: bool = False
    is_error: bool = False
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float | None = None

    def feed(self, line: str) -> None:
        record = _record(line)
        if record is None:
            return
        kind = record.get("type")
        if kind == "stream_event":
            if _delta_text(record):
                self._first()
            return
        decoded = CLAUDE.decode(record)
        if decoded is None:
            return
        if decoded.kind == "text" and decoded.text:
            self._first()
            self.segments.append(decoded.text)
        elif decoded.kind == "result":
            self.done = True
            self.is_error = decoded.is_error
            self.input_tokens += decoded.input_tokens
            self.output_tokens += decoded.output_tokens
            if decoded.cost_usd is not None:
                self.cost_usd = (self.cost_usd or 0.0) + decoded.cost_usd
            result = record.get("result")
            self.result_text = result if isinstance(result, str) else ""

    def _first(self) -> None:
        if self.first_text_ms is None:
            self.first_text_ms = _ms(self.started)

    @property
    def text(self) -> str:
        return ("".join(self.segments) or self.result_text).strip()


@dataclass(frozen=True)
class _Attempt:
    text: str
    ms: int
    first_text_ms: int | None
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float | None = None
    error_reason: str | None = None
    detail: str = ""
    warm: bool = False


def _attempt_from(reading: _Reading, *, warm: bool) -> _Attempt:
    text = reading.text
    reason, detail = None, ""
    if reading.is_error:
        reason, detail = "engine_error", "the CLI reported an error and stopped"
    elif not text:
        reason, detail = "engine_error", "the CLI answered with no text"
    return _Attempt(
        text=text,
        ms=_ms(reading.started),
        first_text_ms=reading.first_text_ms,
        input_tokens=reading.input_tokens,
        output_tokens=reading.output_tokens,
        cost_usd=reading.cost_usd,
        error_reason=reason,
        detail=detail,
        warm=warm,
    )


# --- the warm session ---------------------------------------------------------------------------


class WarmSession:
    """One long-lived CLI process for one adopt session's ``interview`` legs.

    Spawned on first use with the tier and system prompt it will always have — a warm process
    keeps the system prompt it was opened with, so the prefix is stable by construction. A
    process that died (end of stream before a result, a failed write) is killed and the ask
    answers ``None``: the caller makes a cold call. After :attr:`MAX_DEATHS` deaths the session
    stays cold.
    """

    MAX_DEATHS = 2

    def __init__(
        self, spawn: WarmSpawner, tier: Tier, system_file: str, cwd: str, *, kind: str
    ) -> None:
        self.spawn = spawn
        self.tier = tier
        self.system_file = system_file
        self.cwd = cwd
        self.kind = kind
        self.deaths = 0
        self.closed = False
        self._proc: WarmProcess | None = None
        self._lock = threading.Lock()

    def ask(self, prompt: str, timeout_s: float) -> _Attempt | None:
        """One user message, read to its ``result``. ``None`` means "make a cold call"."""
        with self._lock:
            if self.closed or self.deaths >= self.MAX_DEATHS:
                return None
            proc = self._proc
            try:
                if proc is None or not proc.alive():
                    proc = self._proc = self.spawn(
                        cli_argv(self.tier, system_file=self.system_file, warm=True), self.cwd
                    )
                reading = _Reading(time.monotonic())
                proc.send(_user_line(prompt))
                while not reading.done:
                    line = proc.read_line(timeout_s)
                    if line is None:
                        self._die()
                        return None
                    reading.feed(line)
            except TimeoutError:
                self._die()
                return _Attempt(
                    "",
                    int(timeout_s * 1000),
                    None,
                    error_reason="timeout",
                    detail=f"the CLI produced no line for {timeout_s:g}s",
                    warm=True,
                )
            except OSError:
                self._die()
                return None
            return _attempt_from(reading, warm=True)

    def _die(self) -> None:
        self.deaths += 1
        if self._proc is not None:
            with contextlib.suppress(OSError):
                self._proc.kill()
        self._proc = None

    def close(self) -> None:
        """Kill the process. Idempotent; a closed session never spawns again."""
        with self._lock:
            self.closed = True
            if self._proc is not None:
                with contextlib.suppress(OSError):
                    self._proc.kill()
                self._proc = None


# --- the door -----------------------------------------------------------------------------------


@dataclass
class LegRunner:
    """The one door. Holds the tiers, the transport, the ledger and where prompts are written."""

    transport: Transport = field(default_factory=lambda: SubprocessTransport(EXECUTABLE))
    ledger: LedgerSink | None = None
    tiers: dict[str, Tier] = field(default_factory=load_tiers)
    #: Where system prompts are written, one file per distinct text (a stable, cacheable prefix).
    prompt_dir: Path = field(default_factory=lambda: Path("."))
    spawn_warm: WarmSpawner = field(default=subprocess_warm)
    timeouts: Mapping[str, float] = field(default_factory=lambda: dict(DEFAULT_TIMEOUT_S))
    #: Ledger writes that raised. A failed write never fails the leg; it is counted here.
    ledger_failures: int = 0

    def tier_for(self, kind: str) -> Tier:
        return self.tiers[kind]

    def system_file(self, system: str) -> str:
        """The system prompt on disk, named by its hash so an unchanged prompt is one file."""
        self.prompt_dir.mkdir(parents=True, exist_ok=True)
        path = self.prompt_dir / f"system-{fnv1a_64(system)}.md"
        if not path.is_file():
            path.write_text(system, encoding="utf-8")
        return str(path)

    def warm_session(self, kind: LegKind, system: str, cwd: str) -> WarmSession:
        """A warm session for ``kind`` at that kind's tier. Spawns lazily, on the first ask."""
        return WarmSession(
            self.spawn_warm, self.tier_for(kind), self.system_file(system), cwd, kind=kind
        )

    def run_leg(
        self,
        kind: LegKind,
        system: str,
        prompt: str,
        *,
        json_schema: Mapping[str, Any] | None,
        tier: Tier | None = None,
        session: WarmSession | None = None,
        check: Callable[[dict[str, Any]], str] | None = None,
        allowed_tools: Sequence[str] = (),
        add_dirs: Sequence[str] = (),
        cwd: str | None = None,
        conversation: str = "",
        on_usage: UsageFn | None = None,
        timeout_s: float | None = None,
    ) -> LegResult:
        """Run one leg. Never raises for a model's failure; the result says what happened.

        ``json_schema`` ``None`` is a text leg. ``check`` is the caller's deeper validation of a
        parsed object (``""`` = fine, else the problem, which is retried once like a schema
        problem). ``session`` is used only when its tier is this leg's tier.
        """
        if kind not in LEG_KINDS:
            raise ValueError(f"unknown leg kind {kind!r}; one of {', '.join(LEG_KINDS)}")
        chosen = tier or self.tier_for(kind)
        warm = session if session is not None and session.tier == chosen else None
        wait = timeout_s if timeout_s is not None else self.timeouts.get(kind, 180.0)
        workdir = cwd or str(self.prompt_dir)
        system_file = self.system_file(system)

        def once(text: str, cold_text: str | None = None) -> _Attempt:
            """``text`` to the warm process; a cold call (none, or it died) gets ``cold_text``,
            which a retry needs: a cold process never saw the prompt the note refers to."""
            got = warm.ask(text, wait) if warm is not None else None
            if got is None:
                argv = cli_argv(
                    chosen, system_file=system_file, allowed_tools=allowed_tools, add_dirs=add_dirs
                )
                got = self._cold(argv, cold_text or text, workdir, wait, system_file)
            return got

        first = once(prompt)
        if json_schema is None or first.error_reason is not None:
            result = self._result(kind, chosen, first, attempts=1)
            self._account(result, conversation, on_usage)
            return result
        value, problem = _checked(first.text, json_schema, check)
        if not problem:
            result = self._result(kind, chosen, first, attempts=1, value=value)
            self._account(result, conversation, on_usage)
            return result
        # The first answer is a row of its own: it was an invocation, and it was unusable.
        self._account(
            self._result(kind, chosen, first, attempts=1, reason="parse_error", detail=problem),
            conversation,
            on_usage,
        )
        note = RETRY_NOTE.format(problem=problem)
        # A warm process remembers its own wrong answer; a cold call is told the prompt again.
        cold_retry = f"{prompt}\n\n{note}"
        second = once(note if first.warm else cold_retry, cold_retry)
        if second.error_reason is not None:
            result = self._result(kind, chosen, second, attempts=2)
            self._account(result, conversation, on_usage)
            return result
        value, problem = _checked(second.text, json_schema, check)
        if problem:
            result = self._result(
                kind,
                chosen,
                second,
                attempts=2,
                reason="parse_error",
                detail=f"malformed: {problem}",
                malformed=True,
            )
        else:
            result = self._result(kind, chosen, second, attempts=2, value=value)
        self._account(result, conversation, on_usage)
        return result

    # -- internals ----------------------------------------------------------------------------

    def _cold(
        self, argv: list[str], stdin: str, cwd: str, timeout_s: float, system_file: str
    ) -> _Attempt:
        request = CliRequest(
            argv=argv,
            stdin=stdin,
            cwd=cwd,
            system_prompt_file=system_file,
            timeout_s=max(1, int(timeout_s)),
        )
        reading = _Reading(time.monotonic())

        async def pump() -> None:
            async for line in self.transport.run(request):
                reading.feed(line)

        try:
            asyncio.run(pump())
        except TimeoutError:
            return _Attempt(
                "",
                _ms(reading.started),
                reading.first_text_ms,
                error_reason="timeout",
                detail=f"the CLI produced no line for {timeout_s:g}s",
            )
        except (ValueError, asyncio.LimitOverrunError):
            return _Attempt(
                "",
                _ms(reading.started),
                reading.first_text_ms,
                error_reason="engine_error",
                detail="the CLI wrote a line longer than the reader's line limit",
            )
        except OSError as exc:
            return _Attempt(
                "",
                _ms(reading.started),
                reading.first_text_ms,
                error_reason="engine_error",
                detail=f"{type(exc).__name__}: {exc}",
            )
        return _attempt_from(reading, warm=False)

    def _result(
        self,
        kind: str,
        tier: Tier,
        attempt: _Attempt,
        *,
        attempts: int,
        value: dict[str, Any] | None = None,
        reason: str | None = None,
        detail: str = "",
        malformed: bool = False,
    ) -> LegResult:
        error = normalize_reason(reason or attempt.error_reason)
        return LegResult(
            kind=kind,
            ok=error is None,
            model=tier.model,
            effort=tier.effort,
            text=attempt.text,
            value=value if error is None else None,
            ms=attempt.ms,
            first_text_ms=attempt.first_text_ms,
            input_tokens=attempt.input_tokens,
            output_tokens=attempt.output_tokens,
            cost_usd=attempt.cost_usd,
            error_reason=error,
            detail=detail or attempt.detail,
            attempts=attempts,
            warm=attempt.warm,
            malformed=malformed,
        )

    def account(
        self,
        result: LegResult,
        conversation: str,
        on_usage: UsageFn | None,
        *,
        engine: str,
    ) -> None:
        """Account a call made outside :meth:`run_leg` (the documents lane's opt-in vision reader)
        exactly as a leg is: one ledger row under ``engine``, one usage call."""
        self._account(result, conversation, on_usage, engine=engine)

    def _account(
        self,
        result: LegResult,
        conversation: str,
        on_usage: UsageFn | None,
        *,
        engine: str = ENGINE,
    ) -> None:
        """One ledger row and one usage call for one invocation, whatever it produced."""
        sleep = result.kind.startswith(SLEEP_PREFIX)
        if self.ledger is not None:
            try:
                self.ledger.record(
                    engine=engine,
                    model=result.model,
                    conversation=conversation or (SLEEP_SURFACE if sleep else "adopt"),
                    origin=ORIGIN,
                    surface=SLEEP_SURFACE if sleep else SURFACE,
                    trigger=result.kind if sleep else f"adopt.{result.kind}",
                    rounds=1,
                    input_tokens=result.input_tokens,
                    output_tokens=result.output_tokens,
                    cost_usd=result.cost_usd,
                    ms=result.ms,
                    is_error=not result.ok,
                    error_reason=result.error_reason,
                )
            except Exception:
                self.ledger_failures += 1
        if on_usage is not None:
            on_usage(result)


# --- helpers ------------------------------------------------------------------------------------


def _checked(
    text: str,
    schema: Mapping[str, Any],
    check: Callable[[dict[str, Any]], str] | None,
) -> tuple[dict[str, Any] | None, str]:
    try:
        value = extract_json(text)
    except ValueError as exc:
        return None, str(exc)
    if not isinstance(value, dict):
        return None, "the answer is not a JSON object"
    verdict = check_schema(value, dict(schema))
    if not verdict.ok:
        return None, verdict.detail
    if check is not None:
        problem = check(value)
        if problem:
            return None, problem
    return value, ""


def _record(line: str) -> Mapping[str, Any] | None:
    stripped = line.strip()
    if not stripped:
        return None
    try:
        value = json.loads(stripped)
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, Mapping) else None


def _delta_text(record: Mapping[str, Any]) -> str:
    event = record.get("event")
    if not isinstance(event, Mapping) or event.get("type") != "content_block_delta":
        return ""
    delta = event.get("delta")
    if not isinstance(delta, Mapping) or delta.get("type") != "text_delta":
        return ""
    text = delta.get("text")
    return text if isinstance(text, str) else ""


def _user_line(prompt: str) -> str:
    """One user message on a stream-json stdin."""
    return json.dumps(
        {"type": "user", "message": {"role": "user", "content": [{"type": "text", "text": prompt}]}}
    )


def _ms(started: float) -> int:
    return int((time.monotonic() - started) * 1000)

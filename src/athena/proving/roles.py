"""Role clients: Nemotron on Token Factory, and the Claude Haiku control (README §9; ADR 0030).

A *role* is a job the Proving Ground hands a model that is not Athena: an attacker that writes
hostile content, a user a Character is played by, a judge. Two engines play roles:

- :class:`NebiusRole` — NVIDIA Nemotron through the very :class:`~athena.harness.tokenfactory.
  TokenFactoryModel` the ``nebius`` engine runs on (stdlib ``urllib``, key from
  ``NEBIUS_API_KEY``, never printed). The model follows the operator's ladder: it starts on
  :data:`~athena.harness.tokenfactory.LIGHTNING_MODEL` and is escalated to
  :data:`~athena.harness.tokenfactory.DEFAULT_MODEL` (Super) only when its proof fails.
- :class:`ClaudeRole` — the control: ``claude -p --model claude-haiku-4-5-20251001
  --output-format json`` with the prompt on stdin, its own tools off, its cost read from
  ``total_cost_usd``.

Every call goes through :class:`RoleCaller`, which is the only place a role is invoked: it checks
the engine's purse first (:mod:`~athena.proving.budget`), writes one :mod:`~athena.proving.runlog`
row whatever happened, and — for :meth:`RoleCaller.call_json` — parses and schema-checks the
answer. **NVIDIA output is assumed mediocre until measured**: an answer that is not JSON, or JSON
of the wrong shape, is *counted* (:class:`Validity`) and returned as ``None``. Nothing here
raises on a bad answer, because a bad answer is a result.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import tempfile
import threading
import time
from collections.abc import AsyncIterator, Callable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, ClassVar, Protocol

from athena.contracts.harness import normalize_reason
from athena.core.validators import check_schema
from athena.harness.ports import ModelChunk, ModelMessage, ModelRequest
from athena.harness.tokenfactory import (
    DEFAULT_MODEL,
    LIGHTNING_MODEL,
    HttpPost,
    HttpReply,
    TokenFactoryModel,
    urllib_post,
)
from athena.proving.budget import CLAUDE, NEMOTRON, Budget, BudgetExhausted
from athena.proving.runlog import RunLog

__all__ = [
    "HAIKU_MODEL",
    "RUNGS",
    "THINKING_OFF",
    "ClaudeRole",
    "JsonAnswer",
    "NebiusRole",
    "ProcessResult",
    "RoleCaller",
    "RoleClient",
    "RoleReply",
    "Runner",
    "Validity",
    "extract_json",
    "load_env_file",
    "subprocess_runner",
    "with_body_fields",
]

#: The control. Pinned by id, so a run is comparable with the next one.
HAIKU_MODEL = "claude-haiku-4-5-20251001"

#: The operator's ladder (design note, "Resume 2026-10-07"): Lightning first, Super if too poor.
RUNGS: dict[str, str] = {"lightning": LIGHTNING_MODEL, "super": DEFAULT_MODEL}


# --- one answer ----------------------------------------------------------------------------------


@dataclass(frozen=True)
class RoleReply:
    """What one role call produced. ``error_reason`` is in ``ERROR_REASONS``, or ``None``."""

    text: str
    engine: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float | None = None
    ms: int = 0
    error_reason: str | None = None
    detail: str = ""

    @property
    def ok(self) -> bool:
        return self.error_reason is None


class RoleClient(Protocol):
    """A model that can play a role. ``engine`` names the purse it is charged to."""

    @property
    def engine(self) -> str: ...

    @property
    def model(self) -> str: ...

    def complete(self, system: str, prompt: str) -> RoleReply: ...


# --- Nemotron ------------------------------------------------------------------------------------


#: The request field Token Factory honours to turn a Nemotron model's reasoning off: the chat
#: template's own switch, passed through by the server. Measured 2026-10-07 on Lightning (WP3 A/B,
#: ADR 0034): ``reasoning_effort``, ``reasoning: {enabled: false}``, a ``/no_think`` system line
#: and "detailed thinking off" were all accepted and all ignored; only this one removed the
#: reasoning. A role answers a schema, so it has no use for a hidden essay before the JSON.
THINKING_OFF: dict[str, Any] = {"chat_template_kwargs": {"enable_thinking": False}}


def with_body_fields(post: HttpPost, fields: Mapping[str, Any]) -> HttpPost:
    """``post`` with ``fields`` merged into every JSON request body it sends.

    The engine's request builder stays the engine's (``TokenFactoryModel``); a role only adds the
    request fields it needs. A body that is not a JSON object is sent unchanged.
    """
    if not fields:
        return post

    def wrapped(url: str, headers: Mapping[str, str], body: bytes, timeout: float) -> HttpReply:
        try:
            payload = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return post(url, headers, body, timeout)
        if isinstance(payload, dict):
            payload.update(dict(fields))
            body = json.dumps(payload).encode("utf-8")
        return post(url, headers, body, timeout)

    return wrapped


@dataclass
class NebiusRole:
    """A role on Nemotron. One non-streamed Chat Completions call per :meth:`complete`.

    ``thinking`` is off by default: the model answers the role's JSON directly instead of
    reasoning first (:data:`THINKING_OFF`). Measured, not assumed — see ADR 0034.
    """

    model: str = LIGHTNING_MODEL
    max_tokens: int = 8192
    thinking: bool = False
    post: HttpPost = field(default=urllib_post, repr=False)
    api_key: str | None = field(default=None, repr=False)
    engine: ClassVar[str] = NEMOTRON

    def complete(self, system: str, prompt: str) -> RoleReply:
        started = time.monotonic()
        post = self.post if self.thinking else with_body_fields(self.post, THINKING_OFF)
        fn = TokenFactoryModel(model=self.model, post=post, api_key=self.api_key)
        request = ModelRequest(
            system=system,
            messages=[ModelMessage(role="user", content=prompt)],
            model=self.model,
            max_tokens=self.max_tokens,
        )
        try:
            chunks = asyncio.run(_collect(fn(request)))
        except Exception as exc:  # the ModelFn turns failures into chunks; this is the backstop
            return RoleReply(
                "",
                NEMOTRON,
                self.model,
                ms=_ms(started),
                error_reason="engine_error",
                detail=type(exc).__name__,
            )
        text: list[str] = []
        reply = RoleReply("", NEMOTRON, self.model)
        input_tokens = output_tokens = 0
        cost: float | None = None
        served = self.model
        for chunk in chunks:
            if chunk.kind == "text":
                text.append(chunk.text)
            elif chunk.kind == "usage":
                input_tokens += chunk.input_tokens
                output_tokens += chunk.output_tokens
                served = chunk.model or served
                if chunk.cost_usd is not None:
                    cost = (cost or 0.0) + chunk.cost_usd
            elif chunk.kind == "error":
                return RoleReply(
                    "",
                    NEMOTRON,
                    self.model,
                    ms=_ms(started),
                    error_reason=normalize_reason(chunk.reason) or "engine_error",
                    detail=chunk.text,
                )
        said = "".join(text).strip()
        reply = RoleReply(
            said,
            NEMOTRON,
            served,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=cost,
            ms=_ms(started),
        )
        if not said:
            return RoleReply(
                "",
                NEMOTRON,
                served,
                input_tokens,
                output_tokens,
                cost,
                reply.ms,
                error_reason="engine_error",
                detail="the model answered with no text",
            )
        return reply


async def _collect(stream: AsyncIterator[ModelChunk]) -> list[ModelChunk]:
    return [chunk async for chunk in stream]


# --- the Claude control --------------------------------------------------------------------------


@dataclass(frozen=True)
class ProcessResult:
    returncode: int
    stdout: str


Runner = Callable[[Sequence[str], str, float, str | None], ProcessResult]
"""``(argv, stdin, timeout, cwd) -> result``. Raises ``TimeoutError`` or ``OSError``.

The seam the tests replace: nothing under ``tests/`` spawns ``claude``.
"""


def subprocess_runner(
    argv: Sequence[str], stdin: str, timeout: float, cwd: str | None
) -> ProcessResult:  # pragma: no cover - real I/O
    try:
        done = subprocess.run(
            list(argv),
            input=stdin.encode("utf-8"),
            capture_output=True,
            timeout=timeout,
            cwd=cwd,
            check=False,
        )
    except subprocess.TimeoutExpired:
        raise TimeoutError("claude did not answer in time") from None
    return ProcessResult(done.returncode, done.stdout.decode("utf-8", errors="replace"))


@dataclass
class ClaudeRole:
    """A role on the Claude control, through the user's own ``claude`` CLI.

    The CLI's built-in tools are off (``--tools ""``), settings and MCP servers are ignored
    (``--restricted``, ``--strict-mcp-config``) and no session is kept: a role call is one prompt
    and one answer. The system prompt goes in a file, because Windows caps a command line.
    """

    model: str = HAIKU_MODEL
    executable: str = "claude"
    timeout_s: float = 300.0
    cwd: str | None = None
    run: Runner = field(default=subprocess_runner, repr=False)
    engine: ClassVar[str] = CLAUDE

    def complete(self, system: str, prompt: str) -> RoleReply:
        started = time.monotonic()
        with tempfile.TemporaryDirectory(prefix="athena-role-") as scratch:
            system_file = Path(scratch) / "system.md"
            system_file.write_text(system, encoding="utf-8")
            argv = [
                self.executable,
                "-p",
                "--model",
                self.model,
                "--output-format",
                "json",
                "--system-prompt-file",
                str(system_file),
                "--tools",
                "",
                "--restricted",
                "--strict-mcp-config",
                "--no-session-persistence",
            ]
            try:
                done = self.run(argv, prompt, self.timeout_s, self.cwd or scratch)
            except TimeoutError:
                return RoleReply(
                    "",
                    CLAUDE,
                    self.model,
                    ms=_ms(started),
                    error_reason="timeout",
                    detail=f"claude did not answer in {self.timeout_s:g}s",
                )
            except OSError as exc:
                return RoleReply(
                    "",
                    CLAUDE,
                    self.model,
                    ms=_ms(started),
                    error_reason="engine_error",
                    detail=f"could not run claude: {type(exc).__name__}",
                )
        return _claude_reply(done, self.model, _ms(started))


def _claude_reply(done: ProcessResult, model: str, ms: int) -> RoleReply:
    try:
        record = json.loads(done.stdout.strip().splitlines()[-1] if done.stdout.strip() else "")
    except (json.JSONDecodeError, IndexError):
        return RoleReply(
            "",
            CLAUDE,
            model,
            ms=ms,
            error_reason="parse_error",
            detail=f"claude exited {done.returncode} without a JSON result",
        )
    if not isinstance(record, Mapping):
        return RoleReply("", CLAUDE, model, ms=ms, error_reason="parse_error")
    usage = record.get("usage")
    usage = usage if isinstance(usage, Mapping) else {}
    input_tokens = sum(
        _int(usage.get(key))
        for key in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")
    )
    cost = record.get("total_cost_usd")
    cost_usd = float(cost) if isinstance(cost, int | float) else None
    text = str(record.get("result") or "").strip()
    error = None
    detail = ""
    if record.get("is_error") or done.returncode != 0:
        error, detail = "engine_error", f"claude reported an error ({record.get('subtype')})"
    elif not text:
        error, detail = "engine_error", "claude answered with no text"
    return RoleReply(
        text,
        CLAUDE,
        model,
        input_tokens=input_tokens,
        output_tokens=_int(usage.get("output_tokens")),
        cost_usd=cost_usd,
        ms=ms,
        error_reason=error,
        detail=detail,
    )


# --- JSON out of a model -------------------------------------------------------------------------

_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL)


def extract_json(text: str) -> Any:
    """The outermost JSON value in a model's answer, or raise ``ValueError``.

    Tolerant of the usual wrapping — a code fence, a sentence before or after — and of nothing
    else. Of every value that parses, the one spanning the most text wins, so a forged ``OP:``
    object quoted *inside* an attack is never mistaken for the answer. A model that cannot
    produce parseable JSON after that has failed the schema, and the caller counts it.
    """
    candidates = [match.strip() for match in _FENCE.findall(text)]
    candidates.append(text.strip())
    decoder = json.JSONDecoder()
    best: tuple[int, Any] | None = None
    for candidate in candidates:
        for index, char in enumerate(candidate):
            if char not in "{[":
                continue
            try:
                value, end = decoder.raw_decode(candidate[index:])
            except json.JSONDecodeError:
                continue
            if best is None or end > best[0]:
                best = (end, value)
    if best is None:
        raise ValueError("no JSON value in the answer")
    return best[1]


@dataclass
class Validity:
    """Schema outcomes per ``(role, model)``: how often a model's answer was usable."""

    counts: dict[str, dict[str, int]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self._lock = threading.Lock()

    def count(self, key: str, outcome: str) -> None:
        with self._lock:
            bucket = self.counts.setdefault(key, {"ok": 0, "not_json": 0, "bad_shape": 0})
            bucket[outcome] = bucket.get(outcome, 0) + 1


@dataclass(frozen=True)
class JsonAnswer:
    """A role call that should have answered JSON. ``value`` is ``None`` when it did not."""

    reply: RoleReply
    value: Any = None
    problem: str = ""

    @property
    def ok(self) -> bool:
        return self.reply.ok and self.value is not None


@dataclass
class RoleCaller:
    """The one door every role call goes through: purse first, ledger row always."""

    budget: Budget
    log: RunLog
    validity: Validity = field(default_factory=Validity)

    def call(self, client: RoleClient, role: str, system: str, prompt: str) -> RoleReply:
        """One call, one row. A spent purse is a ``budget_exhausted`` row and no call."""
        reply = self._invoke(client, system, prompt)
        self._row(role, reply)
        return reply

    def _invoke(self, client: RoleClient, system: str, prompt: str) -> RoleReply:
        try:
            self.budget.require(client.engine)
        except BudgetExhausted as exc:
            return RoleReply(
                "", client.engine, client.model, error_reason="budget_exhausted", detail=str(exc)
            )
        reply = client.complete(system, prompt)
        self.budget.charge(client.engine, reply.cost_usd)
        return reply

    def call_json(
        self,
        client: RoleClient,
        role: str,
        system: str,
        prompt: str,
        schema: Mapping[str, Any],
    ) -> JsonAnswer:
        """Call, parse, check the top-level shape. A bad answer is counted, never raised."""
        reply = self._invoke(client, system, prompt)
        key = f"{role}:{client.model}"
        if not reply.ok:
            self._row(role, reply)
            return JsonAnswer(reply, problem=reply.detail or str(reply.error_reason))
        try:
            value = extract_json(reply.text)
        except ValueError as exc:
            self.validity.count(key, "not_json")
            self._row(role, reply, schema_ok=False, excerpt=reply.text)
            return JsonAnswer(reply, problem=str(exc))
        verdict = check_schema(value, dict(schema)) if isinstance(value, dict) else None
        if verdict is None or not verdict.ok:
            problem = verdict.detail if verdict is not None else "the answer is not a JSON object"
            self.validity.count(key, "bad_shape")
            self._row(role, reply, schema_ok=False, excerpt=reply.text)
            return JsonAnswer(reply, problem=problem)
        self.validity.count(key, "ok")
        self._row(role, reply, schema_ok=True)
        return JsonAnswer(reply, value=value)

    def _row(
        self, role: str, reply: RoleReply, *, schema_ok: bool | None = None, excerpt: str = ""
    ) -> None:
        self.log.record(
            role=role,
            engine=reply.engine,
            model=reply.model,
            input_tokens=reply.input_tokens,
            output_tokens=reply.output_tokens,
            cost_usd=reply.cost_usd,
            ms=reply.ms,
            error_reason=reply.error_reason,
            schema_ok=schema_ok,
            excerpt=excerpt,
        )


# --- the key -------------------------------------------------------------------------------------


def load_env_file(path: str | Path, environ: dict[str, str] | None = None) -> list[str]:
    """Read ``KEY=value`` lines from a ``.env`` into the environment, without overriding.

    Returns the *names* it set — never a value. A missing file sets nothing. Quotes around a
    value are stripped; ``#`` lines and blanks are skipped. This is all the parsing a gitignored
    one-key file needs, and it keeps the core free of a dotenv dependency.
    """
    target = environ if environ is not None else os.environ
    file = Path(path)
    if not file.is_file():
        return []
    names: list[str] = []
    for raw in file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, _, value = line.removeprefix("export ").partition("=")
        name = name.strip()
        value = value.strip().strip('"').strip("'")
        if name and name not in target:
            target[name] = value
            names.append(name)
    return names


def _ms(started: float) -> int:
    return int((time.monotonic() - started) * 1000)


def _int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0

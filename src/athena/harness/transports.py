"""How a CLI is actually run, behind one port (README §3.1).

:class:`Transport` is the seam between "compose a turn" and "spawn a process". The harness holds
the first and has no opinion about the second, which is what lets the whole engine be exercised
against a recorded transcript — no binary, no network, no login, and a drifted event format is a
red test rather than a surprise on stage (plan §13, the CLI-format risk).

Two implementations. :class:`SubprocessTransport` spawns the real thing;
:class:`ScriptedTransport` replays lines, one list per round, and records the requests it was
handed so a test can assert what was sent as well as what came back.

**How a run ended crosses the port beside its lines, not among them (ADR 0109).** ``run`` yields
``str`` and nothing else, so every consumer that only wants the lines keeps reading them as it
always did. A transport that knows its exit reports it to the request's :class:`ExitHandle` after
the last line; one that does not leaves the handle at a clean exit, which is what it claimed
before the handle existed.
"""

from __future__ import annotations

import asyncio
import os
import shutil
from collections.abc import AsyncIterator, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol, runtime_checkable

#: Reader limit for the child's stdout. asyncio's 64 KiB default raises on one long stream-json
#: record (a tool result or a full message is a single line); 8 MiB leaves real headroom.
STREAM_LIMIT = 8 * 1024 * 1024

#: How much of the child's stderr is kept: its last few KiB, which is where a CLI says why it
#: stopped. Read only to classify the exit; never shown, never stored (ADR 0109).
STDERR_TAIL = 4096

#: How long the stderr tail is waited for once the child has exited. A grandchild that inherited
#: the pipe can hold it open; the exit is reported without the tail rather than not at all.
STDERR_GRACE_S = 5.0

__all__ = [
    "CliRequest",
    "ExitHandle",
    "ExitStatus",
    "ScriptedTransport",
    "SubprocessTransport",
    "Transport",
    "TransportError",
    "child_env",
    "rounds_from_transcript",
]

#: A recorded transcript separates rounds with a blank line, and any line whose first non-space
#: character is ``#`` is a note to the reader. Both are stripped before the harness sees anything,
#: so a fixture can say where it came from without becoming an event.
COMMENT = "#"


#: Set, the ``claude`` CLI bills this key instead of the subscription (ADR 0007).
API_KEY_ENV = "ANTHROPIC_API_KEY"


def child_env(base: Mapping[str, str], extra: Mapping[str, str] | None = None) -> dict[str, str]:
    """The environment for a spawned engine CLI: ``base`` then ``extra``, without the API key.

    The operator's rule (README §3.1, ADR 0007): model runs go only through the engine CLI on the
    subscription, never a paid API. A key in either mapping would move billing off the
    subscription and contradict what the engine probe reported, so neither is allowed through.
    Everything else (``PATH`` included) is kept. Pure: neither input is mutated.
    """
    merged = {**base, **(extra or {})}
    merged.pop(API_KEY_ENV, None)
    return merged


class TransportError(OSError):
    """The CLI could not be run at all. The turn ends as ``engine_error``."""


@dataclass(frozen=True)
class ExitStatus:
    """How one run of a CLI ended: its exit code and the tail of what it wrote to stderr.

    ``stderr_tail`` is for the dialect to classify and for nothing else: a CLI's error text can
    quote the request, so it never reaches a sentence, an event or a ledger row.
    """

    returncode: int = 0
    stderr_tail: str = ""


class ExitHandle:
    """Where one run reports its :class:`ExitStatus`. It starts at a clean exit.

    One handle per :class:`CliRequest`, so two runs never share one. A transport that cannot tell
    how its run ended leaves it alone, and the run reads as exit 0, which is what such a
    transport's lines always meant.
    """

    __slots__ = ("status",)

    def __init__(self) -> None:
        self.status = ExitStatus()

    def report(self, status: ExitStatus) -> None:
        self.status = status


@dataclass(frozen=True)
class CliRequest:
    """One invocation of one CLI.

    ``system_prompt_file`` is a path and not a string because the composed static half exceeds the
    Windows command-line limit; ``stdin`` carries the frame and the user message. A dialect that
    has no system-prompt flag gets ``None`` here and puts the static half on stdin instead.
    """

    argv: Sequence[str]
    stdin: str
    cwd: str
    system_prompt_file: str | None = None
    env: dict[str, str] = field(default_factory=dict)
    #: How long this run may wait for a line: what is left of the turn's wall (ADR 0115).
    timeout_s: float = 25 * 60
    #: How this run ended, reported by the transport after its last line. Not part of the
    #: request's value: two requests that say the same thing are equal whatever became of them.
    exit: ExitHandle = field(default_factory=ExitHandle, compare=False, repr=False)


@runtime_checkable
class Transport(Protocol):
    """Yields the CLI's stdout lines, one at a time, as they arrive.

    A transport that knows how the run ended reports it to ``request.exit`` after the last line.
    """

    def run(self, request: CliRequest) -> AsyncIterator[str]: ...


class SubprocessTransport:
    """The real spawn.

    The executable is resolved on PATH *before* it is spawned, and on Windows that is not
    cosmetic: ``CreateProcess`` appends only ``.exe`` to a bare name, so a CLI installed by npm as
    ``name.CMD`` with an extensionless shim beside it cannot be started by its bare name at all —
    while a probe that resolves with ``shutil.which`` first would report it available. An engine
    whose probe passes and whose every turn fails is the worst of the two answers, so the probe
    and the spawn resolve the same way. An unresolvable name is passed through unchanged, which
    keeps the failure a plain ``FileNotFoundError`` naming what was looked for.
    """

    def __init__(self, executable: str = "claude") -> None:
        self.executable = executable

    def resolve(self) -> str:
        return shutil.which(self.executable) or self.executable

    async def run(self, request: CliRequest) -> AsyncIterator[str]:  # pragma: no cover - real I/O
        # CREATE_NO_WINDOW: the daemon runs as a sidecar and a console flashing on every turn is
        # a visible defect on a machine the user is demonstrating.
        creationflags = 0x08000000 if os.name == "nt" else 0
        try:
            proc = await asyncio.create_subprocess_exec(
                self.resolve(),
                *request.argv,
                cwd=request.cwd,
                env=child_env(os.environ, request.env),
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                creationflags=creationflags,
                limit=STREAM_LIMIT,
            )
        except OSError as exc:
            raise TransportError(f"{self.executable}: {exc}") from exc
        if proc.stdin is None or proc.stdout is None:
            raise TransportError(f"{self.executable}: no pipes on the spawned process")
        proc.stdin.write(request.stdin.encode("utf-8"))
        await proc.stdin.drain()
        proc.stdin.close()
        said = asyncio.create_task(_tail(proc.stderr)) if proc.stderr is not None else None
        try:
            while True:
                raw = await asyncio.wait_for(proc.stdout.readline(), timeout=request.timeout_s)
                if not raw:
                    break
                yield raw.decode("utf-8", errors="replace").rstrip("\n")
            # Read to the end: report how the run ended (ADR 0109). The tail is waited for only
            # briefly, since a grandchild holding the pipe must not withhold the exit itself.
            returncode = await proc.wait()
            tail = ""
            if said is not None:
                try:
                    tail = await asyncio.wait_for(asyncio.shield(said), timeout=STDERR_GRACE_S)
                except TimeoutError:
                    tail = ""
            request.exit.report(ExitStatus(returncode=returncode, stderr_tail=tail))
        finally:
            if proc.returncode is None:
                proc.kill()
            await proc.wait()
            if said is not None and not said.done():
                said.cancel()


class ScriptedTransport:
    """Replays recorded rounds. One list of lines per invocation, in order.

    A round the script does not have raises :class:`TransportError`, and that is deliberate: an
    engine that asked for a ninth round when the fixture has eight is a test whose premise moved,
    and returning an empty stream would hide it behind an empty reply.
    """

    def __init__(
        self,
        rounds: Iterable[Sequence[str]],
        *,
        fail_with: Exception | None = None,
        exits: Mapping[int, ExitStatus] | None = None,
    ):
        self.rounds: list[list[str]] = [list(lines) for lines in rounds]
        self.requests: list[CliRequest] = []
        self.fail_with = fail_with
        #: How invocation ``i`` (from 0) ends. One that is not named exits 0.
        self.exits: dict[int, ExitStatus] = dict(exits or {})

    @classmethod
    def from_transcript(cls, path: str | Path) -> ScriptedTransport:
        """Load a recorded transcript: blank-line-separated rounds, ``#`` lines ignored."""
        return cls(rounds_from_transcript(Path(path).read_text(encoding="utf-8")))

    @classmethod
    def broken(cls, error: Exception | None = None) -> ScriptedTransport:
        """A transport that cannot run at all — the engine is missing, or the spawn failed."""
        return cls([], fail_with=error or TransportError("claude: not on PATH"))

    async def run(self, request: CliRequest) -> AsyncIterator[str]:
        self.requests.append(request)
        if self.fail_with is not None:
            raise self.fail_with
        index = len(self.requests) - 1
        if index >= len(self.rounds):
            raise TransportError(
                f"the script has {len(self.rounds)} round(s); round {index + 1} was asked for"
            )
        for line in self.rounds[index]:
            yield line
        request.exit.report(self.exits.get(index, ExitStatus()))


async def _tail(stream: asyncio.StreamReader) -> str:  # pragma: no cover - real I/O
    """Read ``stream`` to EOF and keep its last :data:`STDERR_TAIL` bytes."""
    kept = b""
    while chunk := await stream.read(65536):
        kept = (kept + chunk)[-STDERR_TAIL:]
    return kept.decode("utf-8", errors="replace")


def rounds_from_transcript(text: str) -> list[list[str]]:
    """Split a transcript into rounds. Comment lines and blank-line runs are not events."""
    rounds: list[list[str]] = []
    current: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith(COMMENT):
            continue
        if not line:
            if current:
                rounds.append(current)
                current = []
            continue
        current.append(line)
    if current:
        rounds.append(current)
    return rounds

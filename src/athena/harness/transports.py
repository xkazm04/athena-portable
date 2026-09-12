"""How a CLI is actually run, behind one port (README §3.1).

:class:`Transport` is the seam between "compose a turn" and "spawn a process". The harness holds
the first and has no opinion about the second, which is what lets the whole engine be exercised
against a recorded transcript — no binary, no network, no login, and a drifted event format is a
red test rather than a surprise on stage (plan §13, the CLI-format risk).

Two implementations. :class:`SubprocessTransport` spawns the real thing;
:class:`ScriptedTransport` replays lines, one list per round, and records the requests it was
handed so a test can assert what was sent as well as what came back.
"""

from __future__ import annotations

import asyncio
import os
import shutil
from collections.abc import AsyncIterator, Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol, runtime_checkable

__all__ = [
    "CliRequest",
    "ScriptedTransport",
    "SubprocessTransport",
    "Transport",
    "TransportError",
    "rounds_from_transcript",
]

#: A recorded transcript separates rounds with a blank line, and any line whose first non-space
#: character is ``#`` is a note to the reader. Both are stripped before the harness sees anything,
#: so a fixture can say where it came from without becoming an event.
COMMENT = "#"


class TransportError(OSError):
    """The CLI could not be run at all. The turn ends as ``engine_error``."""


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
    timeout_s: int = 25 * 60


@runtime_checkable
class Transport(Protocol):
    """Yields the CLI's stdout lines, one at a time, as they arrive."""

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
                env={**os.environ, **request.env},
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                creationflags=creationflags,
            )
        except OSError as exc:
            raise TransportError(f"{self.executable}: {exc}") from exc
        if proc.stdin is None or proc.stdout is None:
            raise TransportError(f"{self.executable}: no pipes on the spawned process")
        proc.stdin.write(request.stdin.encode("utf-8"))
        await proc.stdin.drain()
        proc.stdin.close()
        try:
            while True:
                raw = await asyncio.wait_for(proc.stdout.readline(), timeout=request.timeout_s)
                if not raw:
                    break
                yield raw.decode("utf-8", errors="replace").rstrip("\n")
        finally:
            if proc.returncode is None:
                proc.kill()
            await proc.wait()


class ScriptedTransport:
    """Replays recorded rounds. One list of lines per invocation, in order.

    A round the script does not have raises :class:`TransportError`, and that is deliberate: an
    engine that asked for a ninth round when the fixture has eight is a test whose premise moved,
    and returning an empty stream would hide it behind an empty reply.
    """

    def __init__(self, rounds: Iterable[Sequence[str]], *, fail_with: Exception | None = None):
        self.rounds: list[list[str]] = [list(lines) for lines in rounds]
        self.requests: list[CliRequest] = []
        self.fail_with = fail_with

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

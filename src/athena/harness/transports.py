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

**What the run weighed crosses the same way (ADR 0143).** The real spawn measures the peak
working set of the engine child (:class:`PeakMemory`) and puts it on the handle as ``peak_mb``
however the run ended, a wall or a kill included; the turn keeps the largest of its rounds' and
the ledger stores it, so the vitals gate can charge the next task what a turn really costs here.
It is ``None`` where it could not be read. Only the child is measured, not its children: a CLI
that is a native binary (``claude.exe``) is all of it, a shim that starts an interpreter is not.
"""

from __future__ import annotations

import asyncio
import ctypes
import os
import shutil
import sys
from collections.abc import AsyncIterator, Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol, runtime_checkable

#: Reader limit for the child's stdout. asyncio's 64 KiB default raises on one long stream-json
#: record (a tool result or a full message is a single line); 8 MiB leaves real headroom.
STREAM_LIMIT = 8 * 1024 * 1024

#: How much of the child's stderr is kept: its last few KiB, which is where a CLI says why it
#: stopped. Read only to classify the exit; never shown, never stored (ADR 0109).
STDERR_TAIL = 4096

#: ``CREATE_NO_WINDOW`` on Windows, nothing elsewhere. The daemon runs as a windowless sidecar, and
#: every console child it starts without this flashes a window on a machine the user is
#: demonstrating. Every spawn of an engine CLI passes it: a turn's here, a probe's in ``engines``.
NO_WINDOW = 0x08000000 if os.name == "nt" else 0

#: How long the stderr tail is waited for once the child has exited. A grandchild that inherited
#: the pipe can hold it open; the exit is reported without the tail rather than not at all.
STDERR_GRACE_S = 5.0

#: How often the child's high-water mark is read where the OS keeps it only while the process lives
#: (Linux ``VmHWM``). Windows reads it once, from a handle held open across the exit.
PEAK_EVERY_S = 1.0

__all__ = [
    "ENGINE_KEYS",
    "NO_WINDOW",
    "STRIPPED",
    "CliRequest",
    "ExitHandle",
    "ExitStatus",
    "PeakMemory",
    "ScriptedTransport",
    "SubprocessTransport",
    "Transport",
    "TransportError",
    "child_env",
    "rounds_from_transcript",
    "vm_hwm_kb",
]

#: A recorded transcript separates rounds with a blank line, and any line whose first non-space
#: character is ``#`` is a note to the reader. Both are stripped before the harness sees anything,
#: so a fixture can say where it came from without becoming an event.
COMMENT = "#"


#: Set, the ``claude`` CLI bills this key instead of the subscription (ADR 0007).
API_KEY_ENV = "ANTHROPIC_API_KEY"

#: Per CLI engine, the variables that bill it to a key or route it to another cloud, as of
#: 2026-10-16 (``claude`` 2.1, ``codex-cli`` 0.160). Dated: a CLI release can add a switch. No CLI
#: engine here owns a key: ``claude`` runs on the Claude subscription and ``codex`` on the ChatGPT
#: plan, both signed in through the CLI itself, so :func:`child_env` strips every one of them from
#: every child, whichever CLI it is (ADR 0007). ``OPENAI_API_KEY`` is in the daemon's environment
#: whenever the OpenAI voice backend is configured from it, which is how it would reach ``codex``.
#:
#: ``nebius`` is not a CLI: the daemon calls Token Factory in process, so its key has no business
#: in any child. The one child that does call Nemotron, the Proving Ground's own run
#: (``proving/server/runner.py``), is handed ``NEBIUS_API_KEY`` by name after this door.
ENGINE_KEYS: dict[str, tuple[str, ...]] = {
    "claude_code": (
        API_KEY_ENV,
        "ANTHROPIC_AUTH_TOKEN",
        "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_VERTEX",
    ),
    "codex": ("OPENAI_API_KEY", "CODEX_API_KEY"),
    "nebius": ("NEBIUS_API_KEY",),
    #: Set, ``muse`` bills Meta's pay-as-you-go API instead of the Muse Code plan.
    "muse_code": ("META_API_KEY",),
}

#: What :func:`child_env` never lets through, compared in upper case: a Windows child reads its
#: environment case-insensitively, so ``openai_api_key`` is the same variable there.
STRIPPED: frozenset[str] = frozenset(name for names in ENGINE_KEYS.values() for name in names)

#: The identity of a parent Claude Code session, as of 2026-10-16 (``claude`` 2.1): the five names
#: the harness-engines scan found leaking into every child. Dated: a CLI release can add one. Not a
#: ``CLAUDE_CODE_*`` prefix, which would also remove real configuration (``CLAUDE_CODE_OAUTH_TOKEN``
#: and ``CLAUDE_CODE_GIT_BASH_PATH``), and kept out of :data:`ENGINE_KEYS`, one entry per engine.
SESSION_MARKERS: tuple[str, ...] = (
    "CLAUDECODE",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_MESSAGING_SOCKET",
    "CLAUDE_CODE_MESSAGING_TOKEN",
)

_SESSION_MARKERS_UPPER: frozenset[str] = frozenset(SESSION_MARKERS)


def child_env(base: Mapping[str, str], extra: Mapping[str, str] | None = None) -> dict[str, str]:
    """The environment for a spawned engine CLI: ``base`` then ``extra``, without any engine key.

    The operator's rule (README §3.1, ADR 0007): model runs go only through the engine CLI on the
    person's plan, never a paid API. A key in either mapping would move billing off the plan and
    contradict what the engine probe reported, and a key the child does not own is one more secret
    in a process that reads untrusted pages. So none of :data:`STRIPPED` is let through, in any
    case. A parent Claude Code session's markers (:data:`SESSION_MARKERS`) go the same way.
    Everything else (``PATH`` included) is kept. Pure: neither input is mutated.
    """
    merged = {**base, **(extra or {})}
    return {
        name: value
        for name, value in merged.items()
        if name.upper() not in STRIPPED and name.upper() not in _SESSION_MARKERS_UPPER
    }


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

    __slots__ = ("peak_mb", "status")

    def __init__(self) -> None:
        self.status = ExitStatus()
        #: The child's peak working set in MiB, set by a transport that measured it (ADR 0143).
        self.peak_mb: int | None = None

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
        try:
            proc = await asyncio.create_subprocess_exec(
                self.resolve(),
                *request.argv,
                cwd=request.cwd,
                env=child_env(os.environ, request.env),
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                creationflags=NO_WINDOW,
                limit=STREAM_LIMIT,
            )
        except OSError as exc:
            raise TransportError(f"{self.executable}: {exc}") from exc
        if proc.stdin is None or proc.stdout is None:
            raise TransportError(f"{self.executable}: no pipes on the spawned process")
        said = asyncio.create_task(_tail(proc.stderr)) if proc.stderr is not None else None
        peak = PeakMemory(proc.pid)
        watch = asyncio.create_task(_watch(peak)) if peak.sampled else None
        try:
            try:
                proc.stdin.write(request.stdin.encode("utf-8"))
                await proc.stdin.drain()
            except (BrokenPipeError, ConnectionResetError):
                # The CLI exited, or shut its input, before reading all it was sent: one that
                # refused at startup. That is not how the run failed; its exit code and its stderr
                # are, and they are read below like any other run's (ADR 0109).
                pass
            finally:
                proc.stdin.close()
            while True:
                raw = await asyncio.wait_for(proc.stdout.readline(), timeout=request.timeout_s)
                if not raw:
                    break
                yield raw.decode("utf-8", errors="replace").rstrip("\n")
            peak.sample()  # stdout is closed and the child is likely still there to be read
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
            if watch is not None:
                watch.cancel()
            request.exit.peak_mb = peak.finish()
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
        peaks: Mapping[int, int] | None = None,
    ):
        self.rounds: list[list[str]] = [list(lines) for lines in rounds]
        self.requests: list[CliRequest] = []
        self.fail_with = fail_with
        #: How invocation ``i`` (from 0) ends. One that is not named exits 0.
        self.exits: dict[int, ExitStatus] = dict(exits or {})
        #: What invocation ``i`` weighed at its peak, MiB. One that is not named was not measured.
        self.peaks: dict[int, int] = dict(peaks or {})

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
        request.exit.peak_mb = self.peaks.get(index)
        for line in self.rounds[index]:
            yield line
        request.exit.report(self.exits.get(index, ExitStatus()))


# --- the child's peak working set (ADR 0143) ------------------------------------------------------


def _proc_status(pid: int) -> str | None:
    """``/proc/<pid>/status``, or ``None`` once the process is gone (or on a system without it)."""
    try:
        with open(f"/proc/{pid}/status", encoding="ascii", errors="replace") as handle:
            return handle.read()
    except OSError:
        return None


def vm_hwm_kb(status: str | None) -> int | None:
    """The ``VmHWM:`` line of a Linux process status - its peak resident set, kB - or ``None``."""
    for line in (status or "").splitlines():
        if line.startswith("VmHWM:"):
            parts = line.split()
            if len(parts) >= 2 and parts[1].isdigit():
                return int(parts[1])
    return None


class PeakMemory:
    """The peak working set of one child process, MiB, or ``None`` where it cannot be read.

    - **Windows** opens its own handle on the child as soon as it is spawned and keeps it across
      the exit: a process object lives while a handle is held, so ``GetProcessMemoryInfo`` reads
      ``PeakWorkingSetSize`` after the child has ended, a killed child included.
    - **Linux** has no such counter after the exit, so ``VmHWM`` - the kernel's own high-water
      mark - is read every :data:`PEAK_EVERY_S` while the child runs (:meth:`sample`), and the
      largest is kept.
    - **Anything else** measures nothing.

    Nothing here raises: a figure that could not be read is ``None``.
    """

    def __init__(
        self,
        pid: int,
        *,
        platform: str = sys.platform,
        read_status: Callable[[int], str | None] = _proc_status,
    ) -> None:
        self.pid = pid
        self._linux = platform.startswith("linux")
        self._read_status = read_status
        self._peak_kb: int | None = None
        self._handle: int | None = _win_open(pid) if platform == "win32" else None
        self._done = False
        self._result: int | None = None

    @property
    def sampled(self) -> bool:
        """Whether this platform needs :meth:`sample` called while the child runs."""
        return self._linux

    def sample(self) -> None:
        if not self._linux or self._done:
            return
        kb = vm_hwm_kb(self._read_status(self.pid))
        if kb is not None and (self._peak_kb is None or kb > self._peak_kb):
            self._peak_kb = kb

    def finish(self) -> int | None:
        """The peak, once the child has exited. Idempotent; releases the Windows handle."""
        if self._done:
            return self._result
        if self._handle is not None:
            peak_bytes = _win_peak(self._handle)
            _win_close(self._handle)
            self._handle = None
            self._result = None if peak_bytes is None else round(peak_bytes / 1_048_576)
        else:
            self.sample()
            self._result = None if self._peak_kb is None else round(self._peak_kb / 1024)
        self._done = True
        return self._result


async def _watch(peak: PeakMemory) -> None:  # pragma: no cover - real I/O
    while True:
        peak.sample()
        await asyncio.sleep(PEAK_EVERY_S)


#: ``PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ``: what ``GetProcessMemoryInfo`` needs.
_PEAK_ACCESS = 0x1000 | 0x0010


class _ProcessMemoryCounters(ctypes.Structure):
    """``PROCESS_MEMORY_COUNTERS`` (psapi.h)."""

    _fields_ = (
        ("cb", ctypes.c_uint32),
        ("PageFaultCount", ctypes.c_uint32),
        ("PeakWorkingSetSize", ctypes.c_size_t),
        ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
        ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t),
        ("PeakPagefileUsage", ctypes.c_size_t),
    )


def _win_open(pid: int) -> int | None:
    if sys.platform != "win32":
        return None
    try:
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.OpenProcess.restype = ctypes.c_void_p
        kernel32.OpenProcess.argtypes = [ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32]
        handle = kernel32.OpenProcess(_PEAK_ACCESS, 0, pid)
    except (OSError, AttributeError):
        return None
    return int(handle) if handle else None


def _win_peak(handle: int) -> int | None:
    """``PeakWorkingSetSize`` in bytes for an open process handle, or ``None``."""
    if sys.platform != "win32":
        return None
    try:
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        query = kernel32.K32GetProcessMemoryInfo
        query.restype = ctypes.c_int
        query.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint32]
        counters = _ProcessMemoryCounters()
        counters.cb = ctypes.sizeof(counters)
        if not query(ctypes.c_void_p(handle), ctypes.byref(counters), counters.cb):
            return None
    except (OSError, AttributeError):
        return None
    return int(counters.PeakWorkingSetSize)


def _win_close(handle: int) -> None:
    if sys.platform != "win32":
        return
    try:
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
        kernel32.CloseHandle(ctypes.c_void_p(handle))
    except (OSError, AttributeError):
        return


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

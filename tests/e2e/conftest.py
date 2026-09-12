"""A real daemon in a real process, reached over a real socket (README §3.5; ADR 0011).

Everything in ``tests/daemon/`` runs the daemon in the test's own process: the server is real, the
socket is real, and the objects behind it are the ones the test built. What that cannot prove is
the part a shell actually depends on — that ``athena serve`` *starts*, prints one parseable ready
line, answers on the port it named, and leaves nothing behind when it is killed. These tests spawn
it.

Two entry points are spawned and they differ in one seam:

* ``athena serve`` itself — the console script from ``[project.scripts]`` — for the claims that are
  about the process (the ready line, the token file, exit hygiene, ``athena doctor``);
* ``tests/e2e/serve_scripted.py`` for the claims that are about a turn, which needs a deterministic
  engine. It installs a :class:`~athena.harness.transports.ScriptedTransport` and then calls the
  daemon's own ``serve``, so the gate, the catalog and the routes are not doubled (ADR 0007).

**Isolation is the hard rule here.** Another session's dev servers and desktop shell are listening
on this machine while these tests run. So: every daemon binds ``--port 0``; every daemon gets its
own token; ``ATHENA_HOME`` points inside ``tmp_path``, which is what keeps the connector vault out
of ``~/.athena/connectors`` (it has no flag of its own); ``--voice-backend none`` is the default,
because ``auto`` would pick up a provider key from the environment; and ``OPENAI_API_KEY`` is
removed from the child's environment so nothing here can reach a network.

The HTTP helpers — the response shape, the SSE frame parser, the recorded ``claude`` round, the
``OP:`` envelope, the two-tool manifest — are imported from ``tests/daemon/conftest.py`` rather
than written again: a second SSE parser is a second opinion about what a frame is.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import threading
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from http.client import HTTPConnection
from pathlib import Path
from typing import Any

import pytest

from athena.daemon.server import TOKEN_HEADER

# ``tests/`` is on ``sys.path`` (it is the first directory above a test package with no
# ``__init__.py``, which is where pytest's prepend import mode inserts), so the daemon suite's
# helpers are importable by their package name.
from daemon.conftest import (  # the shared HTTP helpers, deliberately reused
    APP_ID,
    PAGE_ORIGIN,
    Response,
    claude_round,
    manifest_body,
    op,
)

__all__ = [
    "APP_ID",
    "ENGINE",
    "MODEL",
    "PAGE_ORIGIN",
    "TOKEN",
    "Daemon",
    "Spawn",
    "child_pids",
    "claude_round",
    "manifest_body",
    "op",
    "port_answers",
    "transcript_text",
]

#: The dialect every daemon here runs. Real dialect, real argv, real stream-json decoding; only
#: the process behind it is a recording.
ENGINE = "claude_code"
MODEL = "fake-model"
#: Not a secret: a per-daemon token that never leaves this machine. Each spawn may override it.
TOKEN = "e2e-token-not-a-secret"

#: How long to wait for the ready line. Generous: a cold import of the package plus a brain
#: schema on a loaded Windows machine is seconds, and a flaky spawn is worse than a slow one.
READY_TIMEOUT_S = 90.0
#: How long a spawned daemon is given to exit after ``terminate``.
EXIT_TIMEOUT_S = 30.0

_REPO = Path(__file__).resolve().parents[2]
_SCRIPT = Path(__file__).resolve().parent / "serve_scripted.py"


def athena_console_script() -> Path:
    """The ``athena`` console script of the interpreter running these tests.

    ``[project.scripts]`` is the entry point a person types and the one the shell spawns, so the
    process claims are proved against it and not against ``python -c``. There is no
    ``athena/__main__.py``, so ``python -m athena`` is not an alternative.
    """
    binaries = Path(sys.executable).parent
    for name in ("athena.exe", "athena"):
        candidate = binaries / name
        if candidate.is_file():
            return candidate
    raise RuntimeError(
        f"no athena console script beside {sys.executable}; run `uv sync --extra dev` first"
    )


def transcript_text(rounds: Sequence[Sequence[str]]) -> str:
    """Recorded rounds as one NDJSON transcript: a blank line separates two rounds.

    The format is ``athena.harness.transports.rounds_from_transcript``'s and there is no second
    writer of it; a test that wants a comment line puts one in its own text.
    """
    header = (
        "# SYNTHETIC. Written by tests/e2e for one daemon, in the shape of\n"
        "# `claude -p - --output-format stream-json`. One round per provider invocation.\n"
    )
    return header + "\n\n".join("\n".join(lines) for lines in rounds) + "\n"


@dataclass
class Daemon:
    """One spawned daemon: what it said on stdout, and how to reach it."""

    process: subprocess.Popen[str]
    ready: dict[str, Any]
    token: str
    home: Path
    argv: tuple[str, ...]
    transcript: Path | None = None
    stopped: bool = field(default=False, repr=False)

    @property
    def url(self) -> str:
        return str(self.ready["url"])

    @property
    def host(self) -> str:
        return self.url.removeprefix("http://").partition(":")[0]

    @property
    def port(self) -> int:
        return int(self.url.removeprefix("http://").partition(":")[2])

    @property
    def alive(self) -> bool:
        return self.process.poll() is None

    # -- one request ----------------------------------------------------------------------------

    def request(
        self,
        path: str,
        *,
        method: str = "GET",
        token: str | None = None,
        origin: str = "",
        json_body: Mapping[str, Any] | None = None,
        timeout: float = 60.0,
        authenticated: bool = True,
    ) -> Response:
        """One request on its own connection, which is the only kind this daemon answers.

        ``authenticated`` is the default and sends this daemon's token; ``token=`` sends exactly
        what it is given (including ``""``), which is how the 401 claims are made.
        """
        body = None if json_body is None else json.dumps(dict(json_body))
        headers: dict[str, str] = {}
        if token is not None:
            headers[TOKEN_HEADER] = token
        elif authenticated:
            headers[TOKEN_HEADER] = self.token
        if origin:
            headers["Origin"] = origin
        if body is not None:
            headers["Content-Type"] = "application/json"
        connection = HTTPConnection(self.host, self.port, timeout=timeout)
        try:
            connection.request(method, path, body=body, headers=headers)
            reply = connection.getresponse()
            raw = reply.read()
            payload: dict[str, Any] = {}
            if raw and "json" in (reply.getheader("Content-Type") or ""):
                decoded = json.loads(raw)
                payload = decoded if isinstance(decoded, dict) else {}
            return Response(reply.status, dict(reply.getheaders()), payload, raw)
        finally:
            connection.close()

    # -- the two things every turn test does first ----------------------------------------------

    def register(
        self, app_id: str = APP_ID, page_origin: str = PAGE_ORIGIN, **overrides: Any
    ) -> Response:
        return self.request(
            "/manifest", method="POST", json_body=manifest_body(app_id, page_origin, **overrides)
        )

    def run(self, message: str, *, origin: str = PAGE_ORIGIN, **body: Any) -> Response:
        return self.request(
            "/run", method="POST", json_body={"message": message, "origin": origin, **body}
        )

    def decide(self, approval_id: str, choice: str, **body: Any) -> Response:
        return self.request(
            f"/decisions/{approval_id}", method="POST", json_body={"choice": choice, **body}
        )

    # -- the end --------------------------------------------------------------------------------

    def stop(self) -> int:
        """Terminate the daemon *and its tree*, and return the exit code.

        The tree, not the process, and on Windows that is the whole point. ``athena`` is installed
        as a launcher executable which runs the interpreter as a **child**, so ``terminate`` — one
        ``TerminateProcess`` — reaches the launcher and leaves the daemon itself listening. The
        shell knows this and kills the tree for the same reason (``apps/desktop/src-tauri/src/
        daemon.rs``, ADR 0015); a test suite that did not would leave an orphan holding a port on
        a machine other sessions are working on.

        The kill goes first, while the parent is still alive: ``taskkill /T`` walks the tree from a
        *live* pid, and against a pid that has already exited it finds no children to take.
        """
        if self.stopped:
            return int(self.process.returncode or 0)
        self.stopped = True
        process = self.process
        if process.poll() is None:
            _kill_tree(process)
        try:
            process.wait(timeout=EXIT_TIMEOUT_S)
        except subprocess.TimeoutExpired:  # pragma: no cover - a daemon that will not die
            process.kill()
            process.wait(timeout=EXIT_TIMEOUT_S)
        for pipe in (process.stdout, process.stderr):
            if pipe is not None:
                pipe.close()
        return int(process.returncode or 0)


def _kill_tree(process: subprocess.Popen[str]) -> None:
    """Kill a process and everything it started.

    ``taskkill /F /T`` on Windows, because the console-script launcher runs the daemon as a child
    and only the tree kill reaches it. Elsewhere ``terminate`` then ``kill`` on the process
    itself, which is the whole tree when the interpreter is exec'd rather than spawned.
    """
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(process.pid)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        return
    process.terminate()  # pragma: no cover - this suite runs on Windows here
    try:  # pragma: no cover
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:  # pragma: no cover
        process.kill()


def child_pids(pid: int) -> list[int]:
    """The pids whose parent is ``pid`` right now, so "no child behind" can be asserted.

    Windows keeps a process's parent pid after the parent has exited, so this finds exactly the
    orphan a tree kill is meant to prevent. ``[]`` on any platform without the query.
    """
    if os.name != "nt":  # pragma: no cover - this suite runs on Windows here
        return []
    done = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            f"(Get-CimInstance Win32_Process -Filter 'ParentProcessId={pid}').ProcessId",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    return [int(word) for word in done.stdout.split() if word.isdigit()]


def port_answers(host: str, port: int, timeout: float = 1.0) -> bool:
    """Whether anything is listening on ``host:port`` right now.

    A ``connect`` and not a ``bind``: ``HTTPServer`` sets ``SO_REUSEADDR``, which on Windows lets
    a second socket bind an address that is still in use — so a successful bind would prove
    nothing about an orphan, and a refused connection proves there is none.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(timeout)
        try:
            probe.connect((host, port))
        except OSError:
            return False
    return True


class Spawn:
    """Starts daemons and guarantees they are gone when the test ends."""

    def __init__(self, tmp_path: Path) -> None:
        self.tmp_path = tmp_path
        self.started: list[Daemon] = []
        self._homes = 0

    def home(self) -> Path:
        """A fresh ``ATHENA_HOME`` under ``tmp_path``: the brain, the token file and the vault."""
        self._homes += 1
        path = self.tmp_path / f"home{self._homes}"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def environ(self, home: Path) -> dict[str, str]:
        env = dict(os.environ)
        env["ATHENA_HOME"] = str(home)
        env["PYTHONUNBUFFERED"] = "1"
        env["PYTHONIOENCODING"] = "utf-8"
        # ``--voice-backend auto`` would find a key and open a real provider; nothing in this
        # suite may reach a network.
        env.pop("OPENAI_API_KEY", None)
        return env

    def flags(
        self,
        home: Path,
        *,
        token: str | None,
        voice: str,
        connectors: bool,
        extra: Sequence[str],
    ) -> list[str]:
        flags = [
            "--port",
            "0",
            "--brain",
            str(home / "brain"),
            "--token-file",
            str(home / "daemon.json"),
            "--engine",
            ENGINE,
            "--model",
            MODEL,
            "--voice-backend",
            voice,
        ]
        if token is not None:
            flags += ["--token", token]
        if not connectors:
            flags.append("--no-connectors")
        return [*flags, *extra]

    def real(
        self,
        *,
        token: str | None = TOKEN,
        voice: str = "none",
        connectors: bool = False,
        home: Path | None = None,
        extra: Sequence[str] = (),
    ) -> Daemon:
        """``athena serve``, the console script, with no substitution of any kind."""
        where = home if home is not None else self.home()
        argv = [
            str(athena_console_script()),
            "serve",
            *self.flags(where, token=token, voice=voice, connectors=connectors, extra=extra),
        ]
        return self._start(argv, where, token=token)

    def scripted(
        self,
        rounds: Sequence[Sequence[str]] = (),
        *,
        token: str | None = TOKEN,
        voice: str = "none",
        utterances: Sequence[str] = (),
        connectors: bool = False,
        home: Path | None = None,
        extra: Sequence[str] = (),
        transcript: Path | None = None,
    ) -> Daemon:
        """The same daemon with a recorded engine (``tests/e2e/serve_scripted.py``).

        ``rounds`` is one list of recorded stdout lines per provider invocation, in the order the
        daemon will be asked for them — across *every* turn of this daemon's life, because a
        transcript is consumed in order and a round the script does not have raises.
        """
        where = home if home is not None else self.home()
        path = transcript if transcript is not None else where / "transcript.ndjson"
        if transcript is None:
            path.write_text(transcript_text(rounds), encoding="utf-8")
        argv = [
            sys.executable,
            str(_SCRIPT),
            "--transcript",
            str(path),
            *self.flags(where, token=token, voice=voice, connectors=connectors, extra=extra),
        ]
        for utterance in utterances:
            argv += ["--utterance", utterance]
        return self._start(argv, where, token=token, transcript=path)

    # -- the machinery --------------------------------------------------------------------------

    def _start(
        self,
        argv: Sequence[str],
        home: Path,
        *,
        token: str | None,
        transcript: Path | None = None,
    ) -> Daemon:
        process = subprocess.Popen(
            list(argv),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            cwd=str(self.tmp_path),
            env=self.environ(home),
        )
        try:
            line = _first_line(process, READY_TIMEOUT_S)
        except BaseException:
            _kill_tree(process)
            raise
        payload = json.loads(line)
        if not payload.get("ok"):
            _kill_tree(process)
            raise AssertionError(f"the daemon refused to start: {line.strip()}")
        daemon = Daemon(
            process=process,
            ready=payload,
            token=token if token is not None else _token_from(home / "daemon.json"),
            home=home,
            argv=tuple(argv),
            transcript=transcript,
        )
        self.started.append(daemon)
        return daemon

    def stop_all(self) -> None:
        for daemon in reversed(self.started):
            daemon.stop()


def _token_from(path: Path) -> str:
    return str(json.loads(path.read_text(encoding="utf-8"))["token"])


def _first_line(process: subprocess.Popen[str], timeout: float) -> str:
    """The daemon's first stdout line, or an explanation of why there is none.

    A thread, because a pipe cannot be polled on Windows. A daemon that never printed is killed by
    the caller and the failure says whether the process died and what it put on stderr.
    """
    assert process.stdout is not None
    box: list[str] = []

    def read() -> None:
        line = process.stdout.readline() if process.stdout is not None else ""
        box.append(line)

    reader = threading.Thread(target=read, name="ready-line", daemon=True)
    reader.start()
    reader.join(timeout)
    if not box or not box[0].strip():
        code = process.poll()
        stderr = ""
        if code is not None and process.stderr is not None:
            stderr = process.stderr.read()[-2000:]
        raise AssertionError(
            f"no ready line within {timeout}s (exit code {code}); stderr: {stderr!r}"
        )
    return box[0]


@pytest.fixture
def spawn(tmp_path: Path) -> Iterator[Spawn]:
    """The spawner. Every daemon it starts is terminated before the test ends, always."""
    spawner = Spawn(tmp_path)
    try:
        yield spawner
    finally:
        spawner.stop_all()

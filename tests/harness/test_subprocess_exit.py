"""The real spawn reports how its process ended (ADR 0109), and never stalls on its stderr.

``ScriptedTransport`` reports an exit by construction, so the typed-exit cases in
``test_cli_exit.py`` cannot tell whether :class:`SubprocessTransport` does. These run a real
child (this interpreter with ``-c``) so the spawn itself is what is measured.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

from athena.harness.transports import STDERR_TAIL, CliRequest, SubprocessTransport


def _run(script: str, cwd: Path, timeout_s: float = 20.0) -> tuple[list[str], CliRequest]:
    request = CliRequest(argv=["-c", script], stdin="", cwd=str(cwd), timeout_s=timeout_s)
    transport = SubprocessTransport(sys.executable)

    async def collect() -> list[str]:
        return [line async for line in transport.run(request)]

    return asyncio.run(collect()), request


def test_a_non_zero_exit_and_its_stderr_reach_the_request_s_exit_handle(tmp_path: Path) -> None:
    script = (
        "import sys\n"
        "print('one'); print('two')\n"
        "sys.stderr.write('session not found\\n')\n"
        "sys.exit(3)\n"
    )
    lines, request = _run(script, tmp_path)

    assert [line.rstrip("\r") for line in lines] == ["one", "two"]
    assert request.exit.status.returncode == 3
    assert "session not found" in request.exit.status.stderr_tail


def test_a_clean_exit_reads_as_exit_zero_with_its_lines(tmp_path: Path) -> None:
    lines, request = _run("print('done')", tmp_path)

    assert [line.rstrip("\r") for line in lines] == ["done"]
    assert request.exit.status.returncode == 0


def test_a_cli_that_floods_stderr_before_its_stdout_does_not_stall_the_round(
    tmp_path: Path,
) -> None:
    # A guard: asyncio already buffers the child's stderr, so this passed before the tail was
    # read too. Reading the tail must not turn a loud CLI into one that stalls its round.
    script = (
        "import sys\n"
        "sys.stderr.write('x' * (2 * 1024 * 1024))\n"
        "sys.stderr.flush()\n"
        "print('after')\n"
    )
    lines, request = _run(script, tmp_path, timeout_s=10.0)

    assert [line.rstrip("\r") for line in lines] == ["after"]
    assert request.exit.status.returncode == 0


#: Every variable that would bill a CLI child to a key, or hand one CLI the other's key (ADR 0007:
#: both CLIs run on the person's plan). Written out here rather than read from ``transports``, so
#: the test is not the list it checks. ``NEBIUS_API_KEY`` is not here yet: the Proving Ground's
#: own child still needs it through this door (``transports.ENGINE_KEYS``).
ENGINE_KEYS = (
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "OPENAI_API_KEY",
    "CODEX_API_KEY",
)


def test_no_engine_key_reaches_a_spawned_cli_and_the_child_still_starts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    for name in ENGINE_KEYS:
        monkeypatch.setenv(name, f"sentinel-{name.lower()}")
    monkeypatch.setenv("ATHENA_TEST_KEPT", "kept")
    request = CliRequest(
        argv=["-c", "import os\nfor name in sorted(os.environ):\n    print(name.upper())"],
        stdin="",
        cwd=str(tmp_path),
        # A request's own env goes through the same door, whatever case it is spelled in.
        env={"openai_api_key": "sentinel-request", "ATHENA_TEST_EXTRA": "1"},
        timeout_s=20.0,
    )

    async def collect() -> list[str]:
        return [line async for line in SubprocessTransport(sys.executable).run(request)]

    seen = {line.rstrip("\r") for line in asyncio.run(collect())}

    assert request.exit.status.returncode == 0
    assert {"ATHENA_TEST_KEPT", "ATHENA_TEST_EXTRA"} <= seen
    assert sorted(seen & set(ENGINE_KEYS)) == []


def test_a_cli_that_exits_before_reading_its_input_still_reports_its_exit(tmp_path: Path) -> None:
    """A CLI that refuses at startup (a flag a release removed, no sign-in) exits unread.

    The frame is larger than a pipe's buffer, so writing it meets a closed pipe. That is not the
    run's failure: the CLI's exit code and its stderr are, and they are what ADR 0109 classifies.
    """
    script = "import sys\nsys.stderr.write('error: unknown option --restricted\\n')\nsys.exit(2)\n"
    request = CliRequest(
        argv=["-c", script], stdin="x" * (4 * 1024 * 1024), cwd=str(tmp_path), timeout_s=20.0
    )

    async def collect() -> list[str]:
        return [line async for line in SubprocessTransport(sys.executable).run(request)]

    assert asyncio.run(collect()) == []
    assert request.exit.status.returncode == 2
    assert "unknown option" in request.exit.status.stderr_tail


def test_the_stderr_tail_keeps_only_the_end_of_what_was_written(tmp_path: Path) -> None:
    script = "import sys\nsys.stderr.write('HEAD' + 'y' * 100000 + 'THE-LAST-WORDS')\nsys.exit(1)\n"
    _, request = _run(script, tmp_path)

    tail = request.exit.status.stderr_tail
    assert request.exit.status.returncode == 1
    assert tail.endswith("THE-LAST-WORDS")
    assert "HEAD" not in tail
    assert len(tail) <= STDERR_TAIL

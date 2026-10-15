"""The real spawn reports how its process ended (ADR 0109), and never stalls on its stderr.

``ScriptedTransport`` reports an exit by construction, so the typed-exit cases in
``test_cli_exit.py`` cannot tell whether :class:`SubprocessTransport` does. These run a real
child (this interpreter with ``-c``) so the spawn itself is what is measured.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

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


def test_the_stderr_tail_keeps_only_the_end_of_what_was_written(tmp_path: Path) -> None:
    script = "import sys\nsys.stderr.write('HEAD' + 'y' * 100000 + 'THE-LAST-WORDS')\nsys.exit(1)\n"
    _, request = _run(script, tmp_path)

    tail = request.exit.status.stderr_tail
    assert request.exit.status.returncode == 1
    assert tail.endswith("THE-LAST-WORDS")
    assert "HEAD" not in tail
    assert len(tail) <= STDERR_TAIL

"""The ready line: one JSON line, the bound port, and nothing secret on stdout (ADR 0011).

The interesting test here spawns a real daemon in a real subprocess with ``--port 0`` and reads
one line. Nothing else proves the ordering the sidecar depends on — bind, print, *then* serve —
because a line printed by a function that never bound a socket would look exactly the same.
"""

from __future__ import annotations

import json
import subprocess
import sys
from http.client import HTTPConnection
from io import StringIO
from pathlib import Path

from athena.daemon.ready import announce, failure_line, ready_line
from athena.daemon.server import TOKEN_HEADER

#: ``serve()`` behind a ``-c`` so no console script has to exist yet; ``athena serve`` lands in
#: the commit that adds the CLI.
_ENTRY = "import sys; from athena.daemon import serve; sys.exit(serve())"


def _spawn(tmp_path: Path, *args: str) -> subprocess.Popen[str]:
    return subprocess.Popen(
        [sys.executable, "-c", _ENTRY, *args],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        cwd=str(tmp_path),
    )


def test_a_daemon_on_port_zero_prints_one_line_with_the_port_it_bound(tmp_path: Path) -> None:
    token_file = tmp_path / "daemon.json"
    process = _spawn(
        tmp_path,
        "--port",
        "0",
        "--brain",
        str(tmp_path / "brain"),
        "--token-file",
        str(token_file),
        "--engine",
        "fake_engine",
    )
    try:
        assert process.stdout is not None
        payload = json.loads(process.stdout.readline())

        assert payload["ok"] is True
        assert payload["engine"] == "fake_engine"
        assert payload["token_file"] == str(token_file)
        assert payload["brain"] == str(tmp_path / "brain")
        host, _, port = payload["url"].removeprefix("http://").partition(":")
        assert host == "127.0.0.1"
        assert 0 < int(port) < 65536

        # The line was printed after the socket was bound: the port answers immediately, with no
        # retry loop, and the token is in the file the line named rather than on the line.
        assert "token" not in payload
        token = json.loads(token_file.read_text(encoding="utf-8"))["token"]
        connection = HTTPConnection(host, int(port), timeout=10)
        try:
            connection.request("GET", "/health", headers={TOKEN_HEADER: token})
            reply = connection.getresponse()
            body = json.loads(reply.read())
        finally:
            connection.close()

        assert reply.status == 200
        assert body["engine"] == "fake_engine"
        assert process.poll() is None, "the daemon stopped instead of serving"
    finally:
        # Never a ``with`` block: exiting one waits for a process that is still serving forever.
        process.terminate()
        process.wait(timeout=30)
        for pipe in (process.stdout, process.stderr):
            if pipe is not None:
                pipe.close()


def test_a_daemon_that_cannot_start_says_why_and_exits_non_zero(tmp_path: Path) -> None:
    """A brain root that is a file: the failure line instead of the ready line, and no server."""
    occupied = tmp_path / "not-a-directory"
    occupied.write_text("in the way", encoding="utf-8")
    process = _spawn(
        tmp_path,
        "--port",
        "0",
        "--brain",
        str(occupied),
        "--token-file",
        str(tmp_path / "daemon.json"),
    )
    stdout, _ = process.communicate(timeout=60)

    assert process.returncode != 0
    payload = json.loads(stdout.strip())
    assert payload["ok"] is False
    assert payload["reason"] == "unknown"
    assert payload["detail"]


def test_the_ready_line_is_one_line_even_when_a_value_contains_a_newline() -> None:
    line = ready_line(
        url="http://127.0.0.1:17490",
        token_file="~/.athena/daemon.json",
        engine="claude_code\nnot a second line",
        brain="~/.athena/brain",
    )

    assert "\n" not in line
    assert json.loads(line)["engine"] == "claude_code\nnot a second line"


def test_a_failure_line_speaks_the_one_refusal_vocabulary() -> None:
    assert json.loads(failure_line("engine_error", "no claude on PATH")) == {
        "ok": False,
        "reason": "engine_error",
        "detail": "no claude on PATH",
    }
    assert json.loads(failure_line("made up"))["reason"] == "unknown"


def test_announce_writes_one_line_and_flushes() -> None:
    stream = StringIO()

    announce(ready_line(url="http://127.0.0.1:1", token_file=None, engine="fake"), stream)

    assert stream.getvalue().endswith("\n")
    assert len(stream.getvalue().splitlines()) == 1
    assert json.loads(stream.getvalue())["token_file"] is None

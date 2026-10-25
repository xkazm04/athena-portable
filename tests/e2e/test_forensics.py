"""A failing e2e test explains itself: each spawned daemon's own account rides the report.

Every daemon here is a subprocess. Its stderr used to be piped and never read after the ready
line, and the ``spawn`` fixture kills it before pytest prints a failure, so the only witnesses -
the live daemon's ``/ledger``, the fake providers' request log, what it said on stderr - were gone
by the time anyone looked. A turn that broke arrives as a 200 (an ``engine_error`` turn is a
ledger row, not an HTTP error), so the assert that fails is usually several steps from the cause.

``forensics.py`` builds one bounded, redacted section per daemon; ``conftest.py`` drains stderr
from spawn time and, only on a failed call phase, attaches those sections while the daemons are
still alive. These tests prove each part, and that a green test pays nothing for it.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

from . import forensics as forensics_module
from .conftest import TOKEN, Spawn, claude_round, op
from .forensics import STDERR_MAX_CHARS, STDERR_MAX_LINES, forensics
from .test_connectors_journey import CLIENT_SECRET, connect_gmail

#: A token distinctive enough that its absence from a section proves the redaction, not luck.
LOUD_TOKEN = "e2e-forensics-token-0123456789abcdef"
REFUSED_ROUND = claude_round(
    "Searching your mail.\n" + op("connector.gmail.search_mail", query="invoice")
)

_TESTS = Path(__file__).resolve().parents[1]

#: A stand-in daemon: prints a ready line, then floods stderr before it serves. Without a drain
#: the flood fills the pipe and the child blocks before ``serve_forever``.
CHATTY = """
import http.server, json, sys

class Health(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = b'{"ok": true}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass

server = http.server.HTTPServer(("127.0.0.1", 0), Health)
ready = {"ok": True, "url": "http://127.0.0.1:%d" % server.server_port}
print(json.dumps(ready), flush=True)
for n in range(200):
    sys.stderr.write("chatter %04d " % n + "x" * 1010 + "\\n")
sys.stderr.write("the last thing it said\\n")
sys.stderr.flush()
server.serve_forever()
"""


def test_a_chatty_daemon_keeps_answering_because_its_stderr_is_drained_into_a_bounded_tail(
    spawn: Spawn, tmp_path: Path
) -> None:
    script = tmp_path / "chatty.py"
    script.write_text(CHATTY, encoding="utf-8")
    daemon = spawn._start([sys.executable, str(script)], spawn.home(), token=TOKEN)

    reply = daemon.request("/health", timeout=15)

    assert reply.status == 200, "a full stderr pipe would have blocked the child before it served"
    assert daemon.stderr_tail is not None
    deadline_text = daemon.stderr_tail.wait_for("the last thing it said", timeout=15)
    assert "the last thing it said" in deadline_text
    lines = daemon.stderr_tail.lines()
    assert 0 < len(lines) <= STDERR_MAX_LINES
    assert len(daemon.stderr_tail.text()) <= STDERR_MAX_CHARS
    assert "chatter 0000" not in daemon.stderr_tail.text(), "the tail keeps the end, not the start"


def test_forensics_of_a_turn_that_overdrew_its_script_names_the_engine_error(
    spawn: Spawn,
) -> None:
    daemon = spawn.scripted([REFUSED_ROUND], token=LOUD_TOKEN, exact=False)
    daemon.register()
    daemon.run("search my mail for invoices")

    section = forensics(daemon)

    assert "argv:" in section
    assert "serve_scripted.py" in section
    assert "alive: yes" in section
    assert "trigger=" in section and "is_error=True" in section
    assert "error_reason=engine_error" in section
    assert "turn ended engine_error" in section
    assert "round 2 was asked for; the script has 1" in section, "the transcript audit, too"
    assert LOUD_TOKEN not in section, "the daemon's token is redacted, as the logs redact"
    assert "--token [redacted]" in section


def test_forensics_of_a_fake_providers_daemon_tails_the_far_side_log_without_a_credential(
    spawn: Spawn,
) -> None:
    daemon = spawn.scripted(fake_providers=True)
    connect_gmail(daemon)

    section = forensics(daemon)

    assert "fake providers" in section
    assert "POST oauth2.googleapis.com/token -> 200" in section
    logged = section.split("fake providers", 1)[1].split("\n\n", 1)[0]
    request_lines = [line for line in logged.splitlines()[1:] if "->" in line]
    assert 0 < len(request_lines) <= forensics_module.FAKE_LOG_LINES
    assert "Authorization" not in section and "Bearer" not in section
    assert "ya29." not in section and CLIENT_SECRET not in section


# -- the report hook, proved on a real inner pytest run ------------------------------------------

INNER_CONFTEST = """
import e2e.conftest as harness
import e2e.forensics as forensics_module

spawn = harness.spawn
if hasattr(harness, "pytest_runtest_makereport"):
    pytest_runtest_makereport = harness.pytest_runtest_makereport

_real = forensics_module.forensics
CALLS = []


def _counting(daemon):
    CALLS.append(daemon.alive)
    return _real(daemon)


forensics_module.forensics = _counting


def pytest_sessionfinish(session):
    with open("forensics-calls.txt", "w", encoding="utf-8") as handle:
        handle.write(",".join("alive" if alive else "dead" for alive in CALLS))
"""

INNER_TESTS = """
from e2e.conftest import claude_round


def test_red(spawn):
    daemon = spawn.scripted([claude_round("Hello.")])
    daemon.register()
    daemon.run("say hello")
    assert daemon.alive and False, "deliberately red"


def test_green(spawn):
    daemon = spawn.scripted([claude_round("Hello.")])
    daemon.register()
    daemon.run("say hello", rounds=1)
"""


def inner_run(tmp_path: Path, selector: str) -> tuple[subprocess.CompletedProcess[str], str]:
    """Run the two inner tests' ``selector`` in a fresh pytest process, under this harness."""
    where = tmp_path / "inner"
    where.mkdir()
    (where / "conftest.py").write_text(INNER_CONFTEST, encoding="utf-8")
    (where / "test_inner.py").write_text(INNER_TESTS, encoding="utf-8")
    env = dict(os.environ)
    env["PYTHONPATH"] = os.pathsep.join(filter(None, [str(_TESTS), env.get("PYTHONPATH", "")]))
    done = subprocess.run(
        [
            sys.executable,
            "-m",
            "pytest",
            "-p",
            "no:cacheprovider",
            "-q",
            "--rootdir",
            str(where),
            "-k",
            selector,
            str(where / "test_inner.py"),
        ],
        cwd=str(where),
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=300,
        check=False,
    )
    calls = where / "forensics-calls.txt"
    return done, calls.read_text(encoding="utf-8") if calls.is_file() else "<no record>"


def test_a_failing_test_carries_one_daemon_section_collected_before_teardown(
    tmp_path: Path,
) -> None:
    done, calls = inner_run(tmp_path, "test_red")

    assert done.returncode == 1, done.stdout + done.stderr
    assert "deliberately red" in done.stdout
    assert done.stdout.count("athena daemon 1") == 1, done.stdout
    assert "athena daemon 2" not in done.stdout
    assert "alive: yes" in done.stdout, "collected while the daemon could still answer"
    assert "1 asked of 1 scripted" in done.stdout
    assert calls == "alive", "one collection, made before the fixture's teardown killed it"


def test_a_passing_test_collects_nothing_and_asks_the_daemon_nothing_more(
    tmp_path: Path,
) -> None:
    done, calls = inner_run(tmp_path, "test_green")

    assert done.returncode == 0, done.stdout + done.stderr
    assert "athena daemon" not in done.stdout
    assert calls == "", "zero cost on green: forensics never ran, so no /ledger request was made"


def test_a_daemon_with_no_ready_line_still_fails_with_its_exit_code_and_stderr_tail(
    spawn: Spawn,
) -> None:
    argv = [sys.executable, "-c", "import sys; sys.stderr.write('boom: no brain'); sys.exit(3)"]

    with pytest.raises(AssertionError) as raised:
        spawn._start(argv, spawn.home(), token=TOKEN)

    message = str(raised.value)
    assert message.startswith("no ready line within 90.0s (exit code 3); stderr: ")
    assert message.endswith("stderr: 'boom: no brain'")
    assert spawn.started == []

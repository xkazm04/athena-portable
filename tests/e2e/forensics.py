"""What a spawned daemon can say about a failed test, gathered while it can still say it.

A daemon in this suite is a subprocess, and a turn that broke arrives as a 200: the CLI harness
turns an engine failure into a ledger ``error_reason`` (``engine_error``), not into an HTTP error.
So the assert that fails is usually several steps from the cause, and the only witnesses - the
live daemon's ``/ledger``, the fake providers' request log, what it wrote on stderr - are gone
once the ``spawn`` fixture's teardown kills it.

This module is the reader for those witnesses:

* :class:`StderrTail` drains a daemon's stderr on a thread from spawn time into a bounded tail,
  so a chatty child never blocks on a full pipe and its last words survive;
* :func:`forensics` renders one bounded text section for one daemon: argv, liveness, the
  transcript audit, the ledger's last rows (read through the daemon's own ``/ledger`` route -
  assert through the reader, not around it), the fake providers' log tail and the stderr tail.

Every section is redacted the way the connector logs are (``athena.connectors.vault.redact``):
the daemon's own token is replaced, and anything shaped like a bearer token or a provider key is
stripped. The fake log is rendered from a whitelist of fields, so a field that held a credential
could not ride along even if one were ever logged.

``conftest.py`` calls :func:`forensics` only for a failed call phase; a green test pays nothing.
"""

from __future__ import annotations

import json
import re
import threading
from collections import deque
from collections.abc import Iterable
from typing import IO, TYPE_CHECKING, Any

from athena.connectors.vault import redact

if TYPE_CHECKING:
    from .conftest import Daemon

#: The stderr tail keeps at most this many lines, and at most this many characters of them.
STDERR_MAX_LINES = 200
STDERR_MAX_CHARS = 16 * 1024
#: How many of the ledger's newest rows, and of the fake providers' last requests, a section shows.
LEDGER_ROWS = 5
FAKE_LOG_LINES = 20
#: A section is read from a daemon that may be wedged; it never waits longer than this per request.
LEDGER_TIMEOUT_S = 5.0

_FAKE_LOG = ("fake-providers", "log.ndjson")
_TOKEN_FLAG = re.compile(r"(--token\s+)(\S+)")


class StderrTail:
    """A pipe drained on a daemon thread into the last lines it carried, bounded twice."""

    def __init__(self, pipe: IO[str], *, name: str = "stderr-drain") -> None:
        self._lines: deque[str] = deque(maxlen=STDERR_MAX_LINES)
        self._chars = 0
        self._lock = threading.Condition()
        self._thread = threading.Thread(target=self._drain, args=(pipe,), name=name, daemon=True)
        self._thread.start()

    def _drain(self, pipe: IO[str]) -> None:
        try:
            for line in pipe:
                self._keep(line)
        except (OSError, ValueError):  # the pipe was closed under the reader on the way out
            pass
        finally:
            with self._lock:
                self._lock.notify_all()

    def _keep(self, line: str) -> None:
        line = line[-STDERR_MAX_CHARS:]
        with self._lock:
            if len(self._lines) == self._lines.maxlen:
                self._chars -= len(self._lines[0])
            self._lines.append(line)
            self._chars += len(line)
            while self._chars > STDERR_MAX_CHARS:
                self._chars -= len(self._lines.popleft())
            self._lock.notify_all()

    def lines(self) -> list[str]:
        with self._lock:
            return list(self._lines)

    def text(self) -> str:
        return "".join(self.lines())

    def join(self, timeout: float) -> None:
        """Wait up to ``timeout`` for the pipe to end (the child exited and closed it)."""
        self._thread.join(timeout)

    def wait_for(self, needle: str, timeout: float) -> str:
        """The tail once it holds ``needle``, or as it stands when the pipe ends or time is up."""
        with self._lock:
            self._lock.wait_for(
                lambda: needle in "".join(self._lines) or not self._thread.is_alive(), timeout
            )
            return "".join(self._lines)


def forensics(daemon: Daemon) -> str:
    """One daemon's own account, as a bounded, redacted text section for a pytest report."""
    parts = [
        f"argv: {' '.join(daemon.argv)}",
        f"home: {daemon.home}",
        f"alive: {'yes' if daemon.alive else 'no (exit code ' + str(daemon.process.poll()) + ')'}",
    ]
    if daemon.transcript is not None:
        audit = daemon.transcript_failure()
        parts.append(f"transcript: {daemon.accounting()}" + (f" - {audit}" if audit else ""))
    parts.append(_ledger(daemon))
    fake = _fake_log(daemon)
    if fake:
        parts.append(fake)
    parts.append(_stderr(daemon))
    return _redacted("\n\n".join(parts), [daemon.token])


def _redacted(text: str, secrets: Iterable[str]) -> str:
    return redact(_TOKEN_FLAG.sub(r"\1[redacted]", text), secrets)


def _ledger(daemon: Daemon) -> str:
    if not daemon.alive:
        return "ledger: not read (the daemon is not running)"
    try:
        reply = daemon.request(f"/ledger?limit={LEDGER_ROWS}", timeout=LEDGER_TIMEOUT_S)
    except OSError as exc:
        return f"ledger: unreadable ({type(exc).__name__}: {exc})"
    if reply.status != 200:
        return f"ledger: unreadable (HTTP {reply.status})"
    rows: list[dict[str, Any]] = list(reply.body.get("rows") or [])
    if not rows:
        return "ledger: no rows (no turn reached the engine)"
    lines = [f"ledger, newest first ({len(rows)} of {reply.body.get('total', len(rows))}):"]
    for row in rows:
        lines.append(
            f"  turn {row.get('turn_id')} trigger={row.get('trigger')}"
            f" rounds={row.get('rounds')} is_error={row.get('is_error')}"
            f" error_reason={row.get('error_reason') or '-'}"
        )
    newest = rows[0]
    if newest.get("is_error"):
        lines.append(f"turn ended {newest.get('error_reason') or 'in an error'}")
    return "\n".join(lines)


def _fake_log(daemon: Daemon) -> str:
    path = daemon.home.joinpath(*_FAKE_LOG)
    if not path.is_file():
        return ""
    try:
        raw = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        return f"fake providers: log unreadable ({type(exc).__name__})"
    entries: list[dict[str, Any]] = []
    for line in raw:
        try:
            decoded = json.loads(line)
        except ValueError:
            continue
        if isinstance(decoded, dict) and "status" in decoded:
            entries.append(decoded)
    tail = entries[-FAKE_LOG_LINES:]
    lines = [f"fake providers, last {len(tail)} of {len(entries)} requests:"]
    for entry in tail:
        # A whitelist of fields: nothing the fake did not mean to show can ride along.
        answered = "" if entry.get("answered", True) else " (not answered)"
        lines.append(
            f"  {entry.get('method')} {entry.get('host')}{entry.get('path')}"
            f" -> {entry.get('status')}{answered}"
        )
    return "\n".join(lines)


def _stderr(daemon: Daemon) -> str:
    tail = daemon.stderr_tail
    if tail is None:
        return "stderr: not drained"
    text = tail.text().rstrip("\n")
    if not text:
        return "stderr: (nothing)"
    return f"stderr, last {len(tail.lines())} line(s):\n{text}"

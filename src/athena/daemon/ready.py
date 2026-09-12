"""The ready line: how a parent process learns where the daemon is (README §3.5; ADR 0011).

The shell spawns the daemon as a sidecar with ``--port 0``, because two windows must not fight
over one fixed port. The kernel then picks the port and only the bound socket knows it, so the
daemon has to *say* it. It says it once, on stdout, as one line of JSON, at exactly one moment:
after the socket is bound and before ``serve_forever``. A parent that reads that line knows the
daemon is already listening, so there is no poll-until-it-answers loop and no race where the
first request arrives at a closed port.

Two shapes, and nothing else is ever written to stdout:

``{"ok": true, "url": ..., "token_file": ..., "engine": ..., "brain": ...}``
    Listening. ``url`` carries the bound port, whatever ``--port`` asked for. ``token_file`` is
    the path the token was minted into, or ``null`` when the token came in on the command line —
    it is a **path**, never the token, because stdout is inherited, logged and screenshotted.

``{"ok": false, "reason": ..., "detail": ...}``
    Not listening, and the process exits non-zero. ``reason`` is a member of
    ``contracts.harness.ERROR_REASONS``, so a supervisor branches on the same closed vocabulary
    the ledger records.

``json.dumps`` escapes every newline it is handed, so a value containing one cannot split the
line in two; a reader may take one ``readline`` and parse it.
"""

from __future__ import annotations

import json
import sys
from typing import TextIO

from athena.contracts.harness import normalize_reason

__all__ = ["announce", "failure_line", "ready_line"]


def ready_line(*, url: str, token_file: str | None, engine: str, brain: str = "") -> str:
    """The one line a listening daemon prints. One JSON object, no trailing newline."""
    return json.dumps(
        {
            "ok": True,
            "url": url,
            "token_file": token_file,
            "engine": engine,
            "brain": brain,
        }
    )


def failure_line(reason: str, detail: str = "") -> str:
    """The one line a daemon that could not start prints before exiting non-zero."""
    return json.dumps(
        {"ok": False, "reason": normalize_reason(reason) or "unknown", "detail": detail}
    )


def announce(line: str, stream: TextIO | None = None) -> None:
    """Write one ready line and flush it.

    The flush is the point: a parent blocked on ``readline`` against a pipe would otherwise wait
    for a buffer that only fills when the daemon eventually dies.
    """
    out = sys.stdout if stream is None else stream
    out.write(f"{line}\n")
    out.flush()

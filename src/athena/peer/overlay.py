"""Is there a private overlay on this machine, and what is this device's address on it (ADR 0140).

The peer listener binds the overlay interface's own address and nothing else, so before it binds it
asks the overlay client. Three answers, the ``overlay.state`` of ``GET /devices``:

``absent``
    No ``tailscale`` binary, or it would not run: nothing is installed, and the listener stays down.
``logged_out``
    The client is installed but its backend is not ``Running`` (``NeedsLogin``, ``Stopped``, ...).
``up``
    Running, with an IPv4 overlay address from ``tailscale ip -4``.

Both commands are fixed argv lists - no shell, no string from anywhere else - with a short timeout
and no window on Windows. :class:`TailscaleProbe` is the default; a test hands the host any
callable returning an :class:`Overlay` instead, which is how the suite runs with no overlay at all.
"""

from __future__ import annotations

import ipaddress
import json
import os
import shutil
import subprocess
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from athena.harness.transports import NO_WINDOW

__all__ = ["PROBE_TIMEOUT_S", "Overlay", "OverlayProbe", "OverlayState", "TailscaleProbe"]

OverlayState = Literal["absent", "logged_out", "up"]
PROBE_TIMEOUT_S = 3.0


@dataclass(frozen=True)
class Overlay:
    state: OverlayState
    #: This device's overlay IPv4 address when ``up``; ``None`` otherwise.
    address: str | None = None


OverlayProbe = Callable[[], Overlay]


class TailscaleProbe:
    """``tailscale status --json`` for the state, then ``tailscale ip -4`` for the address."""

    def __init__(self, executable: str | None = None) -> None:
        self.executable = executable

    def __call__(self) -> Overlay:
        binary = self.executable or _find_tailscale()
        if binary is None:
            return Overlay("absent")
        status = _run([binary, "status", "--json"])
        if status is None:
            return Overlay("absent")
        try:
            backend = json.loads(status).get("BackendState")
        except (json.JSONDecodeError, AttributeError):
            backend = None
        if backend != "Running":
            return Overlay("logged_out")
        address = _first_v4(_run([binary, "ip", "-4"]) or "")
        return Overlay("up", address) if address else Overlay("logged_out")


def _find_tailscale() -> str | None:
    found = shutil.which("tailscale")
    if found:
        return found
    program_files = os.environ.get("PROGRAMFILES")
    if program_files:
        candidate = Path(program_files) / "Tailscale" / "tailscale.exe"
        if candidate.is_file():
            return str(candidate)
    return None


def _run(argv: list[str]) -> str | None:
    try:
        done = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=PROBE_TIMEOUT_S,
            check=False,
            creationflags=NO_WINDOW,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    # ``status --json`` exits non-zero when logged out but still prints the JSON.
    return done.stdout or None


def _first_v4(text: str) -> str | None:
    for line in text.split():
        try:
            ip = ipaddress.ip_address(line.strip())
        except ValueError:
            continue
        if isinstance(ip, ipaddress.IPv4Address):
            return str(ip)
    return None

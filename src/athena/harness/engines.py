"""Which engine, and is it usable on this machine (README §3.1; ADR 0007).

An engine is a name for a dialect plus the binary behind it. Two exist: ``claude_code`` runs the
user's ``claude`` CLI against their Claude subscription, ``codex`` runs their ``codex`` CLI
against their ChatGPT plan. Neither asks for an API key, which is why act 1 of the demo has
nothing to type.

:func:`probe` answers first-launch's only real question — *can this machine run a turn* — and it
**never raises**. A setup screen that crashes because a binary was missing is a setup screen that
cannot tell the user what is missing, and that is the whole job it has. Every failure comes back
as an :class:`EngineStatus` with ``available = False`` and a sentence naming what to do.

A probe proves the binary answers ``--version``. It does not prove the user is logged in, and it
does not run inference. ``logged_in`` is a *cheap* signal — the credential file the CLI writes
where it writes it — and it is ``None`` when there is no cheap way to tell, because "I do not
know" and "no" are different answers to give a user staring at a setup screen.
"""

from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from athena.contracts.harness import Harness
from athena.harness.cli_harness import (
    CLAUDE,
    CLAUDE_EXTRA_ARGS,
    CODEX,
    DIALECTS,
    CliDialect,
    CliHarness,
)
from athena.harness.hooks import GateHook, LedgerHook, TruncationHook
from athena.harness.transports import SubprocessTransport

__all__ = [
    "ENGINES",
    "EngineStatus",
    "build_harness",
    "probe",
    "probe_all",
]

#: The engines this build offers, in the order a setup screen should try them.
ENGINES: tuple[str, ...] = (CLAUDE.name, CODEX.name)

#: How long a version probe may take. Long enough for a cold npm shim on Windows, short enough
#: that a setup screen does not look frozen.
PROBE_TIMEOUT_S = 20

#: Where each CLI writes the credential it is logged in with, relative to the user's home. A
#: guess about a *file*, never about the answer: if none of these exist the signal is ``None``.
_CREDENTIAL_PATHS: dict[str, tuple[str, ...]] = {
    CLAUDE.name: (".claude/.credentials.json", ".claude.json"),
    CODEX.name: (".codex/auth.json",),
}


@dataclass(frozen=True)
class EngineStatus:
    """What a probe found. ``detail`` is written for a person, not for a log."""

    name: str
    available: bool
    detail: str
    version: str = ""
    #: ``True`` / ``False`` when a credential file could be looked for, ``None`` when it could not.
    logged_in: bool | None = None


def probe(name: str, *, executable: str | None = None, home: Path | None = None) -> EngineStatus:
    """Is this engine usable here? Never raises; every failure is a status with a reason."""
    dialect = DIALECTS.get(name)
    if dialect is None:
        return EngineStatus(name, False, f"unknown engine; expected one of {', '.join(ENGINES)}")
    binary = executable or dialect.executable
    path = shutil.which(binary)
    if path is None:
        return EngineStatus(name, False, f"{binary} is not on PATH")
    try:
        # argv is a list and never a shell string.
        done = subprocess.run(
            [path, "--version"],
            capture_output=True,
            text=True,
            timeout=PROBE_TIMEOUT_S,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return EngineStatus(name, False, f"{binary} --version failed: {type(exc).__name__}")
    lines = (done.stdout or done.stderr or "").strip().splitlines()
    version = lines[0].strip() if lines else ""
    if done.returncode != 0:
        return EngineStatus(
            name, False, f"{binary} --version exited {done.returncode}", version=version
        )
    signed_in = _logged_in(name, home)
    return EngineStatus(
        name,
        True,
        version or f"{binary} answers --version",
        version=version,
        logged_in=signed_in,
    )


def probe_all(*, home: Path | None = None) -> list[EngineStatus]:
    """Every engine, in the order a setup screen should offer them."""
    return [probe(name, home=home) for name in ENGINES]


def _logged_in(name: str, home: Path | None = None) -> bool | None:
    """Does a credential file exist where this CLI writes one? ``None`` if we cannot tell.

    Nothing is read. The file's *existence* is the whole signal, because its contents are a
    secret and a health check that opens a credential is a health check that can leak one.
    """
    candidates = _CREDENTIAL_PATHS.get(name)
    if not candidates:
        return None
    root = home or Path.home()
    try:
        return any((root / candidate).exists() for candidate in candidates)
    except OSError:
        return None


def build_harness(
    engine: str,
    *,
    gate: GateHook,
    ledger: LedgerHook,
    truncation: TruncationHook,
    prompt_root: str,
    cwd: str,
    model: str = "",
    executable: str | None = None,
    extra_args: tuple[str, ...] | None = None,
) -> Harness:
    """The harness for one engine, bound to the gate and the ledger the caller already owns.

    The gate is an argument and not something this function constructs, and that is the whole of
    ADR 0007: an engine cannot bring its own policy, because it is handed one.
    """
    dialect = DIALECTS.get(engine)
    if dialect is None:
        raise ValueError(f"unknown engine {engine!r}; expected one of {', '.join(ENGINES)}")
    return CliHarness(
        gate=gate,
        ledger=ledger,
        truncation=truncation,
        transport=SubprocessTransport(executable or dialect.executable),
        dialect=dialect,
        prompt_root=prompt_root,
        cwd=cwd,
        model=model,
        extra_args=extra_args if extra_args is not None else _default_args(dialect),
    )


def _default_args(dialect: CliDialect) -> tuple[str, ...]:
    return CLAUDE_EXTRA_ARGS if dialect.name == CLAUDE.name else ()

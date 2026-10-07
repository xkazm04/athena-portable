"""Which engine, and is it usable on this machine (README §3.1; ADR 0007).

An engine is a name for a dialect plus the binary behind it, or for a model function. Three
exist: ``claude_code`` runs the user's ``claude`` CLI against their Claude subscription, ``codex``
runs their ``codex`` CLI against their ChatGPT plan, and ``nebius`` calls NVIDIA Nemotron on
Nebius Token Factory with ``NEBIUS_API_KEY`` (ADR 0031). The two CLIs ask for no key, which is
why act 1 of the demo has nothing to type; ``nebius`` is the measured engine of the Proving
Ground, not the daily one.

:func:`probe` answers first-launch's only real question — *can this machine run a turn* — and it
**never raises**. A setup screen that crashes because a binary was missing is a setup screen that
cannot tell the user what is missing, and that is the whole job it has. Every failure comes back
as an :class:`EngineStatus` with ``available = False`` and a sentence naming what to do.

A probe proves the binary answers ``--version``. It does not prove the user is logged in, and it
does not run inference. For ``nebius`` there is no binary: the probe is whether the key is set,
and it reads presence only. ``logged_in`` is a *cheap* signal — the credential file the CLI writes
where it writes it — and it is ``None`` when there is no cheap way to tell, because "I do not
know" and "no" are different answers to give a user staring at a setup screen.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from athena.contracts.harness import Harness
from athena.harness.api_harness import ApiHarness
from athena.harness.cli_harness import (
    CLAUDE,
    CLAUDE_EXTRA_ARGS,
    CODEX,
    DIALECTS,
    CliDialect,
    CliHarness,
)
from athena.harness.hooks import GateHook, LedgerHook, TruncationHook
from athena.harness.ports import ModelFn
from athena.harness.tokenfactory import (
    API_KEY_ENV,
    DEFAULT_MODEL,
    TokenFactoryModel,
    key_present,
)
from athena.harness.tokenfactory import (
    ENGINE as NEBIUS,
)
from athena.harness.transports import SubprocessTransport

__all__ = [
    "API_ENGINES",
    "ENGINES",
    "EngineStatus",
    "build_api_harness",
    "build_harness",
    "probe",
    "probe_all",
]

#: The engines this build offers, in the order a setup screen should try them.
ENGINES: tuple[str, ...] = (CLAUDE.name, CODEX.name, NEBIUS)

#: The engines that are an API behind a key rather than a binary on ``PATH``.
API_ENGINES: tuple[str, ...] = (NEBIUS,)

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


def probe(
    name: str,
    *,
    executable: str | None = None,
    home: Path | None = None,
    env: Mapping[str, str] | None = None,
) -> EngineStatus:
    """Is this engine usable here? Never raises; every failure is a status with a reason."""
    if name == NEBIUS:
        return _probe_key(env)
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


def probe_all(
    *,
    home: Path | None = None,
    executables: Mapping[str, str] | None = None,
    env: Mapping[str, str] | None = None,
) -> list[EngineStatus]:
    """Every engine, in the order a setup screen should offer them.

    ``executables`` overrides the binary per engine name, so a test (or a daemon pointed at a
    non-default install) probes the file it means rather than whatever is on ``PATH``.
    """
    given = executables or {}
    return [probe(name, executable=given.get(name), home=home, env=env) for name in ENGINES]


def _probe_key(env: Mapping[str, str] | None) -> EngineStatus:
    """``nebius`` is available iff its key is set. Presence only: the key is never read out.

    No request is made. A probe that spent a call to prove the key works would be a setup screen
    that bills the user for opening it.
    """
    if key_present(env if env is not None else os.environ):
        return EngineStatus(NEBIUS, True, f"{API_KEY_ENV} is set")
    return EngineStatus(NEBIUS, False, f"{API_KEY_ENV} is not set")


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
    model_fn: ModelFn | None = None,
) -> Harness:
    """The harness for one engine, bound to the gate and the ledger the caller already owns.

    The gate is an argument and not something this function constructs, and that is the whole of
    ADR 0007: an engine cannot bring its own policy, because it is handed one. ``model_fn``
    replaces Token Factory for an API engine — a test's scripted model, never a second gate.
    """
    if engine in API_ENGINES:
        return build_api_harness(
            gate=gate, ledger=ledger, truncation=truncation, model=model, model_fn=model_fn
        )
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


def build_api_harness(
    *,
    gate: GateHook,
    ledger: LedgerHook,
    truncation: TruncationHook,
    model: str = "",
    model_fn: ModelFn | None = None,
) -> ApiHarness:
    """The ``nebius`` engine: Token Factory as a ModelFn, behind the shared round loop."""
    chosen = model or DEFAULT_MODEL
    return ApiHarness(
        gate=gate,
        ledger=ledger,
        truncation=truncation,
        model=chosen,
        name=NEBIUS,
        model_fn=model_fn or TokenFactoryModel(model=chosen),
    )


def _default_args(dialect: CliDialect) -> tuple[str, ...]:
    return CLAUDE_EXTRA_ARGS if dialect.name == CLAUDE.name else ()

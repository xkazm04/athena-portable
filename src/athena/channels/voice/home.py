"""voice-io / ADR 0028 (Athena's voice is set up in a studio), README section 3.1.

Where the local speech engines live, and how a probe reads them. Nothing here runs an engine.

**One home, shared with Personas.** The engines are large — the Kokoro model alone is a third of a
gigabyte — and a person who already set them up for Personas should not download them twice. So
Athena reads the same tree Personas writes: ``$PERSONAS_HOME`` else ``~/.personas``, with
``companion-tts/{bin,kokoro}`` for speech out and ``companion-stt/{bin,models}`` for speech in.
Personas' own ``PERSONAS_KOKORO_BIN`` / ``PERSONAS_WHISPER_BIN`` overrides are honoured too, so a
developer's escape hatch works the same in both products.

**Pure and injectable.** :func:`resolve_homes` takes the environment and the user's home as
arguments, so a test points it at ``tmp_path`` and never sees the machine's real install.

**A probe says one of three things.** ``absent`` (a file is missing — the reason names which),
``broken`` (the files are there but the executable will not run), ``ready``. The dry check that
tells broken from ready runs the executable with ``--help`` once per file version: its result is
cached by path, size and modification time, because a settings page that polls must not spawn a
process per poll.
"""

from __future__ import annotations

import os
import subprocess
import sys
import threading
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

__all__ = [
    "DRY_CHECK_TIMEOUT_S",
    "EXE_SUFFIX",
    "PERSONAS_HOME_ENV",
    "EngineHomes",
    "EngineProbe",
    "ProbeState",
    "creation_flags",
    "dry_check",
    "dry_run",
    "resolve_homes",
]

PERSONAS_HOME_ENV = "PERSONAS_HOME"
KOKORO_BIN_ENV = "PERSONAS_KOKORO_BIN"
WHISPER_BIN_ENV = "PERSONAS_WHISPER_BIN"

#: Executables carry ``.exe`` on Windows and nothing elsewhere.
EXE_SUFFIX = ".exe" if os.name == "nt" else ""

#: How long ``--help`` may take before the executable is called broken. Both engines answer in
#: well under a second; a binary that hangs on ``--help`` would hang on a sentence too.
DRY_CHECK_TIMEOUT_S = 10.0

ProbeState = Literal["ready", "absent", "broken"]


@dataclass(frozen=True)
class EngineProbe:
    """What a probe found. ``reason`` is one sentence for a person, ``None`` when ready."""

    state: ProbeState
    reason: str | None = None

    @property
    def ready(self) -> bool:
        return self.state == "ready"


@dataclass(frozen=True)
class EngineHomes:
    """The two engine trees, and the overrides that point past them."""

    root: Path
    kokoro_bin_override: Path | None = None
    whisper_bin_override: Path | None = None

    @property
    def tts(self) -> Path:
        return self.root / "companion-tts"

    @property
    def tts_bin(self) -> Path:
        return self.tts / "bin"

    @property
    def kokoro_dir(self) -> Path:
        return self.tts / "kokoro"

    @property
    def stt(self) -> Path:
        return self.root / "companion-stt"

    @property
    def stt_bin(self) -> Path:
        return self.stt / "bin"

    @property
    def stt_models(self) -> Path:
        return self.stt / "models"


def resolve_homes(
    environ: Mapping[str, str] | None = None, home: Path | None = None
) -> EngineHomes:
    """``$PERSONAS_HOME`` else ``<home>/.personas``, plus the per-engine binary overrides."""
    env = os.environ if environ is None else environ
    base = env.get(PERSONAS_HOME_ENV, "")
    root = Path(base) if base else (home if home is not None else Path.home()) / ".personas"
    kokoro = env.get(KOKORO_BIN_ENV, "")
    whisper = env.get(WHISPER_BIN_ENV, "")
    return EngineHomes(
        root=root,
        kokoro_bin_override=Path(kokoro) if kokoro else None,
        whisper_bin_override=Path(whisper) if whisper else None,
    )


def creation_flags() -> int:
    """``CREATE_NO_WINDOW`` on Windows, so an engine run from a windowless daemon flashes no
    console; ``0`` elsewhere."""
    return getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0


_dry_lock = threading.Lock()
_dry_cache: dict[tuple[str, int, int], str | None] = {}


def dry_check(exe: Path, args: Sequence[str] = ("--help",)) -> str | None:
    """Run ``exe --help`` once per file version. ``None`` when it ran, else why it did not.

    A missing DLL on Windows is not an ``OSError`` at spawn but an exit code from the loader,
    which is why a non-zero exit counts as broken too.
    """
    try:
        stat = exe.stat()
    except OSError:
        return f"{exe.name} could not be read"
    key = (str(exe), stat.st_size, stat.st_mtime_ns)
    with _dry_lock:
        if key in _dry_cache:
            return _dry_cache[key]
    try:
        done = subprocess.run(
            [str(exe), *args],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=DRY_CHECK_TIMEOUT_S,
            creationflags=creation_flags(),
            check=False,
        )
        verdict = None if done.returncode == 0 else f"{exe.name} exited with {done.returncode}"
    except subprocess.TimeoutExpired:
        verdict = f"{exe.name} did not answer within {DRY_CHECK_TIMEOUT_S:.0f} s"
    except OSError as exc:
        verdict = f"{exe.name} would not start ({type(exc).__name__})"
    with _dry_lock:
        _dry_cache[key] = verdict
    return verdict


def dry_run(command: Sequence[str]) -> str | None:
    """The dry check for an injected command — a test's fake engine — uncached."""
    try:
        done = subprocess.run(
            [*command, "--help"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=DRY_CHECK_TIMEOUT_S,
            creationflags=creation_flags(),
            check=False,
        )
    except subprocess.TimeoutExpired:
        return f"the engine did not answer within {DRY_CHECK_TIMEOUT_S:.0f} s"
    except OSError as exc:
        return f"the engine would not start ({type(exc).__name__})"
    return None if done.returncode == 0 else f"the engine exited with {done.returncode}"

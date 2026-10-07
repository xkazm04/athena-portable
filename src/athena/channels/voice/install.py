"""voice-io / ADR 0028 (Athena's voice is set up in a studio), README section 3.1.

The one-click installers: Kokoro (engine and model) and a whisper model (and ``whisper-cli`` when
it is not there yet), into the home Personas shares. Standard library only — ``urllib`` to fetch,
``tarfile`` (bz2) and ``zipfile`` to unpack.

**The sources are constants.** Personas' pins: sherpa-onnx v1.13.4 ``win-x64-shared-MT-Release``,
the ``kokoro-multi-lang-v1_0`` model package, whisper.cpp v1.9.2 ``whisper-bin-x64``, and the ggml
models from the upstream Hugging Face repository. A request names a *component* — ``kokoro`` or
``whisper:<model id from the allowlist>`` — and never a URL, so nothing a caller sends reaches an
authority. (:class:`Sources` exists so a test can point the installer at a local server.)

**One install at a time, across both products.** A second request while one runs is refused
(409 at the route). A lock file in the engine home — ``.install.lock``, created exclusively — is
held for the whole run, so Athena never extracts over a tree another installer is writing; a lock
older than :data:`STALE_LOCK_S` is a crashed run and is taken over.

**Progress is one state machine.** ``idle`` → ``downloading_engine`` → ``downloading_model`` →
``extracting`` → ``completed``, or ``failed`` with the error from any of them; ``not_needed``
when the component already probes ready, and ``manual`` off Windows, where the prebuilt engines
do not exist and the person installs by hand. Success is only ever claimed after a verify: the
files are looked for again *after* extraction, so a renamed upstream asset fails loudly instead
of reporting a tree that will not run.
"""

from __future__ import annotations

import http.client
import json
import os
import shutil
import sys
import tarfile
import tempfile
import threading
import time
import urllib.request
import zipfile
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass, field, replace
from pathlib import Path, PurePosixPath
from typing import Any, Literal

from athena.channels.voice import kokoro, whisper
from athena.channels.voice.home import EngineHomes

__all__ = [
    "INSTALL_STATES",
    "LOCK_FILENAME",
    "SOURCES",
    "STALE_LOCK_S",
    "InstallBusy",
    "InstallError",
    "InstallState",
    "Installer",
    "Sources",
    "parse_component",
]

InstallPhase = Literal[
    "idle",
    "not_needed",
    "downloading_engine",
    "downloading_model",
    "extracting",
    "completed",
    "failed",
    "manual",
]
INSTALL_STATES: tuple[str, ...] = (
    "idle",
    "not_needed",
    "downloading_engine",
    "downloading_model",
    "extracting",
    "completed",
    "failed",
    "manual",
)
RUNNING: frozenset[str] = frozenset({"downloading_engine", "downloading_model", "extracting"})

LOCK_FILENAME = ".install.lock"
#: A lock this old belongs to a run that died; the slowest honest download is well under it.
STALE_LOCK_S = 60 * 60.0
#: Per-read socket timeout. A whole archive may take many minutes; a stalled read may not.
READ_TIMEOUT_S = 60.0
DOWNLOAD_CHUNK = 256 * 1024
#: The top-level directory inside the Kokoro model archive.
KOKORO_PREFIX = "kokoro-multi-lang-v1_0"
#: What of the model package is kept: the English voice needs nothing Chinese.
KOKORO_KEEP: frozenset[str] = frozenset(
    {"model.onnx", "voices.bin", "tokens.txt", "lexicon-us-en.txt", "LICENSE", "README.md"}
)
KOKORO_KEEP_DIRS: frozenset[str] = frozenset({"espeak-ng-data"})


@dataclass(frozen=True)
class Sources:
    """Where each archive comes from. Production uses :data:`SOURCES` and nothing else."""

    kokoro_engine: str
    kokoro_model: str
    whisper_engine: str
    whisper_models: str

    def whisper_model(self, model: whisper.WhisperModel) -> str:
        return f"{self.whisper_models}/{model.filename}"


SOURCES = Sources(
    kokoro_engine="https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.4/"
    "sherpa-onnx-v1.13.4-win-x64-shared-MT-Release.tar.bz2",
    kokoro_model="https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/"
    "kokoro-multi-lang-v1_0.tar.bz2",
    whisper_engine="https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/"
    "whisper-bin-x64.zip",
    whisper_models="https://huggingface.co/ggerganov/whisper.cpp/resolve/main",
)


class InstallError(Exception):
    """An install step failed. The message is the ``error`` a surface shows."""


class InstallBusy(InstallError):
    """An install is already running."""


@dataclass(frozen=True)
class InstallState:
    component: str | None = None
    state: InstallPhase = "idle"
    received_bytes: int = 0
    total_bytes: int | None = None
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "component": self.component,
            "state": self.state,
            "received_bytes": self.received_bytes,
            "total_bytes": self.total_bytes,
            "error": self.error,
        }


def parse_component(component: str) -> tuple[str, whisper.WhisperModel | None]:
    """``kokoro`` or ``whisper:<model>``, else ``ValueError`` naming what exists."""
    if component == "kokoro":
        return "kokoro", None
    engine, _, model_id = component.partition(":")
    if engine == "whisper":
        model = whisper.find_model(model_id)
        if model is not None:
            return "whisper", model
    names = ", ".join(["kokoro", *(f"whisper:{m.id}" for m in whisper.MODELS)])
    raise ValueError(f"unknown component {component!r}; one of {names}")


@dataclass
class Installer:
    """One installer per daemon. :meth:`start` returns at once; the work is on a thread."""

    homes: EngineHomes
    sources: Sources = SOURCES
    platform: str = sys.platform
    #: Called with the component after a run ends, either way — the studio re-composes.
    on_done: Callable[[str], None] | None = None
    #: Probes, injectable so a test with a fake engine decides what "ready" means.
    kokoro_ready: Callable[[], bool] | None = None
    whisper_ready: Callable[[str], bool] | None = None
    _state: InstallState = field(default_factory=InstallState)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    _thread: threading.Thread | None = field(default=None, repr=False)

    # -- reading -----------------------------------------------------------------------------------

    def state(self) -> InstallState:
        with self._lock:
            return self._state

    @property
    def running(self) -> bool:
        return self.state().state in RUNNING

    def join(self, timeout: float | None = None) -> None:
        thread = self._thread
        if thread is not None:
            thread.join(timeout)

    # -- starting ----------------------------------------------------------------------------------

    def start(self, component: str) -> InstallState:
        """Begin ``component``. ``ValueError`` for an unknown one, :class:`InstallBusy` if one
        runs. ``manual`` and ``not_needed`` are answered at once and start nothing."""
        engine, model = parse_component(component)
        with self._lock:
            if self._state.state in RUNNING:
                raise InstallBusy(f"{self._state.component} is still installing")
            if self.platform != "win32":
                self._state = InstallState(
                    component,
                    "manual",
                    error="The prebuilt engines are Windows-only; install them by hand into "
                    f"{self.homes.root}.",
                )
                return self._state
            if self._installed(engine, model):
                self._state = InstallState(component, "not_needed")
                return self._state
            first: InstallPhase = (
                "downloading_engine"
                if engine == "kokoro" or whisper.engine_path(self.homes) is None
                else "downloading_model"
            )
            self._state = InstallState(component, first)
            self._thread = threading.Thread(
                target=self._run, args=(component, engine, model), name="voice-install", daemon=True
            )
            self._thread.start()
            return self._state

    def _installed(self, engine: str, model: whisper.WhisperModel | None) -> bool:
        if engine == "kokoro":
            if self.kokoro_ready is not None:
                return self.kokoro_ready()
            return not kokoro.paths_for(self.homes).missing()
        assert model is not None
        if self.whisper_ready is not None:
            return self.whisper_ready(model.id)
        return whisper.engine_path(self.homes) is not None and whisper.model_installed(
            self.homes, model.id
        )

    def _set(self, **changes: Any) -> None:
        with self._lock:
            self._state = replace(self._state, **changes)

    # -- the run -----------------------------------------------------------------------------------

    def _run(self, component: str, engine: str, model: whisper.WhisperModel | None) -> None:
        home = self.homes.tts if engine == "kokoro" else self.homes.stt
        try:
            with _HomeLock(home):
                if engine == "kokoro":
                    self._kokoro()
                else:
                    assert model is not None
                    self._whisper(model)
                if not self._installed(engine, model):
                    raise InstallError(
                        "the install finished but the files are still not where they belong"
                    )
            self._set(state="completed", error=None)
        except InstallError as exc:
            self._set(state="failed", error=str(exc))
        except Exception as exc:  # a bug ends the run honestly, never as a stuck "downloading"
            self._set(state="failed", error=f"install failed ({type(exc).__name__})")
        finally:
            # The studio's refresh must not leave the run unfinished.
            if self.on_done is not None:
                with suppress(Exception):
                    self.on_done(component)

    def _kokoro(self) -> None:
        bin_dir, model_dir = self.homes.tts_bin, self.homes.kokoro_dir
        with tempfile.TemporaryDirectory(prefix="athena-voice-install-") as tmp:
            engine_tar = Path(tmp) / "engine.tar.bz2"
            model_tar = Path(tmp) / "model.tar.bz2"
            self._download(self.sources.kokoro_engine, engine_tar, "downloading_engine")
            self._download(self.sources.kokoro_model, model_tar, "downloading_model")
            self._set(state="extracting", received_bytes=0, total_bytes=None)
            bin_dir.mkdir(parents=True, exist_ok=True)
            model_dir.mkdir(parents=True, exist_ok=True)
            extract_sherpa_engine(engine_tar, bin_dir)
            extract_kokoro_model(model_tar, model_dir)

    def _whisper(self, model: whisper.WhisperModel) -> None:
        bin_dir, models_dir = self.homes.stt_bin, self.homes.stt_models
        with tempfile.TemporaryDirectory(prefix="athena-voice-install-") as tmp:
            engine_zip: Path | None = None
            if whisper.engine_path(self.homes) is None:
                engine_zip = Path(tmp) / "whisper-bin.zip"
                self._download(self.sources.whisper_engine, engine_zip, "downloading_engine")
            models_dir.mkdir(parents=True, exist_ok=True)
            partial = models_dir / f"{model.filename}.partial"
            try:
                self._download(self.sources.whisper_model(model), partial, "downloading_model")
                self._set(state="extracting", received_bytes=0, total_bytes=None)
                if engine_zip is not None:
                    bin_dir.mkdir(parents=True, exist_ok=True)
                    extract_whisper_engine(engine_zip, bin_dir)
                if partial.stat().st_size == 0:
                    raise InstallError(f"{model.filename} downloaded empty")
                os.replace(partial, models_dir / model.filename)
            finally:
                if partial.exists():
                    partial.unlink()

    def _download(self, url: str, dest: Path, phase: InstallPhase) -> None:
        self._set(state=phase, received_bytes=0, total_bytes=None)
        request = urllib.request.Request(url, headers={"User-Agent": "athena-voice-installer"})
        try:
            with urllib.request.urlopen(request, timeout=READ_TIMEOUT_S) as reply:
                length = reply.headers.get("Content-Length")
                total = int(length) if length and length.isdigit() else None
                self._set(total_bytes=total)
                received = 0
                with dest.open("wb") as out:
                    while True:
                        # ``read1``: what has arrived, up to a chunk — so progress moves with
                        # the bytes rather than once per quarter megabyte.
                        chunk = reply.read1(DOWNLOAD_CHUNK)
                        if not chunk:
                            break
                        out.write(chunk)
                        received += len(chunk)
                        self._set(received_bytes=received)
        except (OSError, http.client.HTTPException) as exc:  # URLError, HTTPError: OSErrors
            code = getattr(exc, "code", None)
            what = f"HTTP {code}" if code else type(exc).__name__
            raise InstallError(f"download of {PurePosixPath(url).name} failed ({what})") from None
        if total is not None and received != total:
            raise InstallError(
                f"download of {PurePosixPath(url).name} stopped at {received} of {total} bytes"
            )


# --- the lock -------------------------------------------------------------------------------------


class _HomeLock:
    """``<home>/.install.lock``, created exclusively and removed on the way out."""

    def __init__(self, home: Path) -> None:
        self.path = home / LOCK_FILENAME

    def __enter__(self) -> _HomeLock:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        for _ in range(2):
            try:
                fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            except FileExistsError:
                try:
                    age = time.time() - self.path.stat().st_mtime
                except OSError:
                    continue  # it went away between the two calls; try again
                if age < STALE_LOCK_S:
                    raise InstallError(
                        f"another install is writing {self.path.parent.name} "
                        "(Personas or another Athena); try again when it finishes"
                    ) from None
                self.path.unlink(missing_ok=True)
                continue
            with os.fdopen(fd, "w", encoding="utf-8") as out:
                json.dump({"owner": "athena", "pid": os.getpid(), "at": time.time()}, out)
            return self
        raise InstallError(f"could not take {self.path.name}")

    def __exit__(self, *exc: object) -> None:
        self.path.unlink(missing_ok=True)


# --- unpacking ------------------------------------------------------------------------------------


def _safe_parts(name: str) -> tuple[str, ...] | None:
    """An archive member's path as parts, or ``None`` if it is absolute or climbs out."""
    path = PurePosixPath(name.replace("\\", "/"))
    if path.is_absolute() or any(part in ("..", "") for part in path.parts):
        return None
    if path.parts and ":" in path.parts[0]:
        return None
    return tuple(part for part in path.parts if part != ".")


def _open_bz2(archive: Path) -> tarfile.TarFile:
    try:
        return tarfile.open(archive, "r:bz2")
    except (tarfile.TarError, OSError, EOFError) as exc:
        raise InstallError(f"{archive.name} is not a tar.bz2 ({type(exc).__name__})") from None


def extract_sherpa_engine(archive: Path, bin_dir: Path) -> None:
    """``sherpa-onnx-offline-tts.exe`` and its sibling DLLs from the bundle's ``bin/``, flat."""
    found = False
    with _open_bz2(archive) as tar:
        for member in tar:
            parts = _safe_parts(member.name)
            if parts is None or not member.isfile() or "bin" not in parts[:-1]:
                continue
            name = parts[-1]
            if name.lower() != kokoro.ENGINE_FILENAME.lower() and not name.lower().endswith(".dll"):
                continue
            _write_member(tar, member, bin_dir / name)
            found = found or name.lower() == kokoro.ENGINE_FILENAME.lower()
    if not found:
        raise InstallError(f"the engine archive had no {kokoro.ENGINE_FILENAME}")


def extract_kokoro_model(archive: Path, model_dir: Path) -> None:
    """The English half of the model package under its top-level prefix, prefix stripped."""
    found = False
    with _open_bz2(archive) as tar:
        for member in tar:
            parts = _safe_parts(member.name)
            if parts is None:
                if member.name.replace("\\", "/").startswith(f"{KOKORO_PREFIX}/"):
                    raise InstallError(f"{member.name} escapes the model directory; refusing")
                continue
            if len(parts) < 2 or parts[0] != KOKORO_PREFIX:
                continue
            rel = parts[1:]
            if rel[0] not in KOKORO_KEEP and rel[0] not in KOKORO_KEEP_DIRS:
                continue
            dest = model_dir.joinpath(*rel)
            if member.isdir():
                dest.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                _write_member(tar, member, dest)
                found = found or rel[0] == "model.onnx"
    if not found:
        raise InstallError("the model archive had no model.onnx")


def _write_member(tar: tarfile.TarFile, member: tarfile.TarInfo, dest: Path) -> None:
    source = tar.extractfile(member)
    if source is None:
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    with source, dest.open("wb") as out:
        shutil.copyfileobj(source, out)


def extract_whisper_engine(archive: Path, bin_dir: Path) -> None:
    """Every ``.exe`` and ``.dll`` in the release zip, flat into ``bin_dir``."""
    found = False
    try:
        with zipfile.ZipFile(archive) as bundle:
            for info in bundle.infolist():
                parts = _safe_parts(info.filename)
                if parts is None or info.is_dir() or not parts:
                    continue
                name = parts[-1]
                if not name.lower().endswith((".exe", ".dll")):
                    continue
                with bundle.open(info) as source, (bin_dir / name).open("wb") as out:
                    shutil.copyfileobj(source, out)
                found = found or name.lower() in {c.lower() for c in whisper.ENGINE_CANDIDATES}
    except (zipfile.BadZipFile, OSError) as exc:
        raise InstallError(f"{archive.name} could not be unpacked ({type(exc).__name__})") from None
    if not found:
        raise InstallError(f"the engine archive had no {whisper.ENGINE_CANDIDATES[0]}")

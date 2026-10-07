"""voice-io / ADR 0028 (Athena's voice is set up in a studio), README section 3.1.

Speech in through whisper.cpp, run as Personas runs it: one ``whisper-cli`` per utterance.

The utterance is buffered while the key is held (push-to-talk makes its end a key release, so
nothing is lost by not streaming), written as a 16 kHz mono WAV to a temp file, and handed to
``whisper-cli -m <model> -f <wav> -nt -np``; the transcript is its stdout. No credential and no
network at transcription time — the audio never leaves the machine.

**Silence is the empty string.** On a near-silent capture whisper prints a bracketed marker such
as ``[BLANK_AUDIO]`` with exit 0. Personas measured it and drops those tokens; so does this, so a
key held over nothing reaches the gateway's ``silence`` path instead of becoming a message.

**The models are an allowlist.** Six ggml files, English-only and multilingual, ``tiny`` to
``small``; an id not in :data:`MODELS` is refused before a path is built from it.
"""

from __future__ import annotations

import io
import subprocess
import tempfile
import wave
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from athena.channels.voice.backends import (
    INPUT_SAMPLE_RATE,
    BufferedTranscriber,
    Transcriber,
    VoiceBackendError,
)
from athena.channels.voice.home import (
    EXE_SUFFIX,
    EngineHomes,
    EngineProbe,
    creation_flags,
    dry_check,
    dry_run,
)

__all__ = [
    "DEFAULT_MODEL",
    "ENGINE_CANDIDATES",
    "MODELS",
    "TIMEOUT_S",
    "WhisperModel",
    "WhisperSTT",
    "build_args",
    "clean_transcript",
    "engine_path",
    "find_model",
    "model_installed",
    "model_path",
    "pcm_to_wav",
    "probe",
]

#: Newest name first: whisper.cpp renamed ``main`` to ``whisper-cli``.
ENGINE_CANDIDATES: tuple[str, ...] = tuple(
    f"{name}{EXE_SUFFIX}" for name in ("whisper-cli", "main", "whisper")
)
#: A short clip on the ``small`` models takes seconds on a CPU; this is headroom, not a target.
TIMEOUT_S = 120.0
STDERR_SNIPPET = 400


@dataclass(frozen=True)
class WhisperModel:
    id: str
    size_mb: int
    label: str
    multilingual: bool

    @property
    def filename(self) -> str:
        return f"ggml-{self.id}.bin"


MODELS: tuple[WhisperModel, ...] = (
    WhisperModel("tiny.en", 75, "Tiny (English)", False),
    WhisperModel("base.en", 142, "Base (English)", False),
    WhisperModel("small.en", 466, "Small (English)", False),
    WhisperModel("tiny", 75, "Tiny (multilingual)", True),
    WhisperModel("base", 142, "Base (multilingual)", True),
    WhisperModel("small", 466, "Small (multilingual)", True),
)
DEFAULT_MODEL = "base.en"


def find_model(model_id: str) -> WhisperModel | None:
    return next((model for model in MODELS if model.id == model_id), None)


def model_path(homes: EngineHomes, model_id: str) -> Path:
    model = find_model(model_id)
    if model is None:
        raise ValueError(f"unknown whisper model {model_id!r}")
    return homes.stt_models / model.filename


def model_installed(homes: EngineHomes, model_id: str) -> bool:
    try:
        path = model_path(homes, model_id)
    except ValueError:
        return False
    return path.is_file() and path.stat().st_size > 0


def engine_path(homes: EngineHomes) -> Path | None:
    override = homes.whisper_bin_override
    if override is not None and override.is_file():
        return override
    for name in ENGINE_CANDIDATES:
        candidate = homes.stt_bin / name
        if candidate.is_file():
            return candidate
    return None


def probe(
    homes: EngineHomes, *, command: Sequence[str] | None = None, check: bool = True
) -> EngineProbe:
    """The engine alone: absent, broken or ready. Whether a *model* is there is per model."""
    if command is not None:
        verdict = dry_run(command) if check else None
    else:
        exe = engine_path(homes)
        if exe is None:
            return EngineProbe(
                "absent",
                f"Whisper is not installed: {ENGINE_CANDIDATES[0]} is missing from "
                f"{homes.stt_bin}.",
            )
        verdict = dry_check(exe) if check else None
    if verdict is not None:
        return EngineProbe("broken", f"Whisper will not run: {verdict}.")
    return EngineProbe("ready")


def pcm_to_wav(pcm: bytes, rate: int = INPUT_SAMPLE_RATE) -> bytes:
    out = io.BytesIO()
    with wave.open(out, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(pcm)
    return out.getvalue()


def build_args(model: Path, wav: Path, language: str | None = None) -> list[str]:
    """Personas' flags: no timestamps, no prints, an optional language hint. No executable."""
    args = ["-m", str(model), "-f", str(wav), "-nt", "-np"]
    if language:
        args += ["-l", language]
    return args


_LOWER_EVENTS = frozenset({"silence", "blank_audio", "music", "noise", "inaudible", "applause"})


def _is_marker(token: str) -> bool:
    word = token.rstrip(".,")
    if len(word) <= 2 or (word[0], word[-1]) not in {("[", "]"), ("(", ")")}:
        return False
    inner = word[1:-1]
    caps = len(inner) >= 3 and all(ch.isupper() or ch in "_ " for ch in inner)
    return caps or inner.lower() in _LOWER_EVENTS


def clean_transcript(stdout: str) -> str:
    """Lines joined, whitespace collapsed, non-speech markers dropped."""
    words = " ".join(line.strip() for line in stdout.splitlines() if line.strip()).split()
    return " ".join(word for word in words if not _is_marker(word))


@dataclass
class WhisperSTT:
    """Speech in through whisper.cpp. A :class:`~athena.channels.voice.backends.Listener`."""

    homes: EngineHomes
    model: str = DEFAULT_MODEL
    #: Replaces the engine executable: a test's ``[sys.executable, fake.py]``.
    command: Sequence[str] | None = None
    language: str | None = None
    timeout_s: float = TIMEOUT_S

    @property
    def name(self) -> str:
        return "whisper"

    def transcriber(self) -> Transcriber:
        return BufferedTranscriber(self.transcribe)

    def _argv0(self) -> list[str]:
        if self.command is not None:
            return list(self.command)
        exe = engine_path(self.homes)
        if exe is None:
            raise VoiceBackendError("whisper is not installed")
        return [str(exe)]

    def transcribe(self, pcm: bytes) -> str:
        model = model_path(self.homes, self.model)
        if not model.is_file():
            raise VoiceBackendError(f"whisper model {self.model} is not installed")
        argv0 = self._argv0()
        with tempfile.TemporaryDirectory(prefix="athena-whisper-") as tmp:
            wav = Path(tmp) / "in.wav"
            wav.write_bytes(pcm_to_wav(pcm))
            try:
                done: Any = subprocess.run(
                    [*argv0, *build_args(model, wav, self.language)],
                    stdin=subprocess.DEVNULL,
                    capture_output=True,
                    timeout=self.timeout_s,
                    creationflags=creation_flags(),
                    check=False,
                )
            except subprocess.TimeoutExpired:
                raise VoiceBackendError(f"whisper timed out after {self.timeout_s:.0f} s") from None
            except OSError as exc:
                raise VoiceBackendError(f"whisper would not start ({type(exc).__name__})") from None
        if done.returncode != 0:
            snippet = bytes(done.stderr).decode("utf-8", "replace").strip()[:STDERR_SNIPPET]
            raise VoiceBackendError(f"whisper exited with {done.returncode}: {snippet}")
        return clean_transcript(bytes(done.stdout).decode("utf-8", "replace"))

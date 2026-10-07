"""voice-io / ADR 0028 (Athena's voice is set up in a studio), README section 3.1.

Kokoro, run as Personas runs it: ``sherpa-onnx-offline-tts`` once per sentence, a WAV out, PCM in.

**Why a process per sentence.** The sidecar takes its text as one positional argument and writes
one WAV; there is no streaming mode to hold open. Splitting the reply into sentences is what makes
the first audio arrive after one sentence's work instead of the whole reply's, and the next
sentence is rendered on a helper thread while the current one is being yielded — so between two
sentences the speaker waits for nothing when the engine keeps ahead of playback, which on a CPU it
does. Each run reloads the model (a second or so cold); 90 s is the ceiling for one sentence.

**The arguments are Personas'.** ``--kokoro-model``, ``--kokoro-voices``, ``--kokoro-tokens``,
``--kokoro-data-dir`` (espeak-ng), ``--kokoro-lexicon`` when the US-English lexicon is present,
``--num-threads=2``, ``--sid``, ``--output-filename``, then the text. No shell, ever: the text is
an argument in a list, so nothing a model wrote can become a command. On Windows the run carries
``CREATE_NO_WINDOW``.

**The catalog is one voice.** ``af_heart`` is speaker 3 of ``kokoro-multi-lang-v1_0`` — verified
against the upstream speaker table by Personas, and a wrong sid silently speaks as somebody else,
so a voice is added here only with a verified sid.
"""

from __future__ import annotations

import re
import subprocess
import tempfile
import threading
import wave
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from athena.channels.voice.backends import VoiceBackendError
from athena.channels.voice.home import (
    EXE_SUFFIX,
    EngineHomes,
    EngineProbe,
    creation_flags,
    dry_check,
    dry_run,
)

__all__ = [
    "ENGINE_FILENAME",
    "KOKORO_SIZE_MB",
    "MAX_CHARS",
    "SAMPLE_RATE",
    "TEXT_CAP",
    "TIMEOUT_S",
    "VOICES",
    "KokoroPaths",
    "KokoroTTS",
    "KokoroVoice",
    "build_args",
    "find_voice",
    "paths_for",
    "probe",
    "split_sentences",
]

ENGINE_FILENAME = f"sherpa-onnx-offline-tts{EXE_SUFFIX}"
#: What Kokoro speaks: 24 kHz, 16-bit, mono.
SAMPLE_RATE = 24_000
#: One sentence's ceiling. Generous: a cold run on a slow disk is a few seconds.
TIMEOUT_S = 90.0
#: The longest text a caller may ask for — the preview route's bound, and the turn's ``TTS:`` cap.
TEXT_CAP = 1200
#: What :meth:`KokoroTTS.synthesize` accepts: the cap plus room for the ``(showing N of M)`` a
#: cut reply ends with (``athena.channels.voice.tts``), which is part of what is spoken.
MAX_CHARS = TEXT_CAP + 64
#: Engine (~19 MB with its runtime) plus the model package (~340 MB), for the picker.
KOKORO_SIZE_MB = 360
#: How much PCM one yielded chunk carries: a tenth of a second, so a barge-in lands promptly.
CHUNK_BYTES = SAMPLE_RATE * 2 // 10
#: How much of an engine's stderr an error quotes.
STDERR_SNIPPET = 400


@dataclass(frozen=True)
class KokoroVoice:
    id: str
    sid: int
    name: str
    language: str
    gender: str
    grade: str
    blurb: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "language": self.language,
            "gender": self.gender,
            "grade": self.grade,
            "blurb": self.blurb,
        }


VOICES: tuple[KokoroVoice, ...] = (
    KokoroVoice(
        id="af_heart",
        sid=3,
        name="Heart",
        language="en-US",
        gender="female",
        grade="A",
        blurb="Warm, expressive US female — Kokoro's flagship voice.",
    ),
)


def find_voice(voice_id: str) -> KokoroVoice | None:
    return next((voice for voice in VOICES if voice.id == voice_id), None)


# --- the files ------------------------------------------------------------------------------------


@dataclass(frozen=True)
class KokoroPaths:
    exe: Path
    model: Path
    voices: Path
    tokens: Path
    espeak: Path
    lexicon: Path

    def missing(self) -> list[str]:
        """What is not there, engine first, in the order a person would install it."""
        gone: list[str] = []
        if not self.exe.is_file():
            gone.append(self.exe.name)
        for path in (self.model, self.voices, self.tokens):
            if not path.is_file():
                gone.append(path.name)
        if not self.espeak.is_dir():
            gone.append(f"{self.espeak.name}/")
        return gone


def paths_for(homes: EngineHomes) -> KokoroPaths:
    model = homes.kokoro_dir
    exe = homes.kokoro_bin_override
    if exe is None or not exe.is_file():
        exe = homes.tts_bin / ENGINE_FILENAME
    return KokoroPaths(
        exe=exe,
        model=model / "model.onnx",
        voices=model / "voices.bin",
        tokens=model / "tokens.txt",
        espeak=model / "espeak-ng-data",
        lexicon=model / "lexicon-us-en.txt",
    )


def probe(
    homes: EngineHomes, *, command: Sequence[str] | None = None, check: bool = True
) -> EngineProbe:
    """Absent (naming the first missing file), broken (the engine will not run), or ready.

    ``command`` replaces the engine executable — a test's fake — and then only the model files
    are looked for on disk.
    """
    paths = paths_for(homes)
    missing = paths.missing()
    if command is not None:
        missing = [name for name in missing if name != paths.exe.name]
    if missing:
        where = homes.tts_bin if missing[0] == paths.exe.name else homes.kokoro_dir
        more = f" (and {len(missing) - 1} more)" if len(missing) > 1 else ""
        return EngineProbe(
            "absent", f"Kokoro is not installed: {missing[0]} is missing from {where}{more}."
        )
    if check:
        verdict = dry_check(paths.exe) if command is None else dry_run(command)
        if verdict is not None:
            return EngineProbe("broken", f"Kokoro's engine will not run: {verdict}.")
    return EngineProbe("ready")


# --- one sentence -------------------------------------------------------------------------------

_SENTENCE_END = re.compile(r"(?<=[.!?…])[\"')\]]*\s+")


def split_sentences(text: str) -> list[str]:
    """The reply cut where a sentence ends, blanks dropped. A run with no stop is one sentence.

    A fragment shorter than a few words is folded into the sentence before it — "Hi." as its own
    process run costs a model load for half a second of audio.
    """
    parts = [part.strip() for part in _SENTENCE_END.split(text.strip())]
    out: list[str] = []
    for part in parts:
        if not part:
            continue
        if out and len(part) < 12:
            out[-1] = f"{out[-1]} {part}"
        else:
            out.append(part)
    return out


def build_args(paths: KokoroPaths, sid: int, output: Path, text: str) -> list[str]:
    """The engine's flags, exactly Personas', text last and positional. No executable."""
    args = [
        f"--kokoro-model={paths.model}",
        f"--kokoro-voices={paths.voices}",
        f"--kokoro-tokens={paths.tokens}",
        f"--kokoro-data-dir={paths.espeak}",
    ]
    if paths.lexicon.is_file():
        args.append(f"--kokoro-lexicon={paths.lexicon}")
    args += ["--num-threads=2", f"--sid={sid}", f"--output-filename={output}", text]
    return args


def read_pcm(wav_path: Path) -> bytes:
    """The frames of a 16-bit mono WAV at :data:`SAMPLE_RATE`; anything else is an engine fault."""
    try:
        with wave.open(str(wav_path), "rb") as wav:
            if wav.getnchannels() != 1 or wav.getsampwidth() != 2:
                raise VoiceBackendError(
                    f"kokoro wrote {wav.getnchannels()} channel(s) of {wav.getsampwidth() * 8} "
                    "bit audio; expected mono 16-bit"
                )
            if wav.getframerate() != SAMPLE_RATE:
                raise VoiceBackendError(
                    f"kokoro wrote {wav.getframerate()} Hz; expected {SAMPLE_RATE}"
                )
            return wav.readframes(wav.getnframes())
    except (OSError, EOFError, wave.Error) as exc:
        raise VoiceBackendError(f"kokoro's output was not a WAV ({type(exc).__name__})") from None


@dataclass
class _Render:
    """One sentence on its own thread: the process, its WAV, and a way to stop it early."""

    run: Any
    sentence: str
    pcm: bytes = b""
    error: VoiceBackendError | None = None
    proc: subprocess.Popen[bytes] | None = None
    cancelled: bool = False
    done: threading.Event = field(default_factory=threading.Event)

    def start(self) -> _Render:
        threading.Thread(target=self._go, name="kokoro-render", daemon=True).start()
        return self

    def _go(self) -> None:
        try:
            self.pcm = self.run(self)
        except VoiceBackendError as exc:
            self.error = exc
        except Exception as exc:  # a bug in a helper thread must still end the wait
            self.error = VoiceBackendError(f"kokoro failed ({type(exc).__name__})")
        finally:
            self.done.set()

    def result(self) -> bytes:
        self.done.wait()
        if self.error is not None:
            raise self.error
        return self.pcm

    def cancel(self) -> None:
        self.cancelled = True
        proc = self.proc
        if proc is not None and proc.poll() is None:
            proc.kill()


@dataclass
class KokoroTTS:
    """Speech out through Kokoro. A :class:`~athena.channels.voice.backends.Speaker`."""

    homes: EngineHomes
    voice: KokoroVoice = VOICES[0]
    #: Replaces the engine executable: a test's ``[sys.executable, fake.py]``.
    command: Sequence[str] | None = None
    timeout_s: float = TIMEOUT_S
    sample_rate: int = SAMPLE_RATE
    #: Every sentence handed to the engine, in the order it was started — a test's evidence that
    #: sentence n+1 began before sentence n was finished being played.
    started: list[str] = field(default_factory=list)

    @property
    def name(self) -> str:
        return "kokoro"

    def _command(self, paths: KokoroPaths) -> list[str]:
        return list(self.command) if self.command is not None else [str(paths.exe)]

    def _render(self, job: _Render) -> bytes:
        paths = paths_for(self.homes)
        with tempfile.TemporaryDirectory(prefix="athena-kokoro-") as tmp:
            output = Path(tmp) / "out.wav"
            argv = [
                *self._command(paths),
                *build_args(paths, self.voice.sid, output, job.sentence),
            ]
            if job.cancelled:
                return b""
            try:
                job.proc = subprocess.Popen(
                    argv,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                    creationflags=creation_flags(),
                )
            except OSError as exc:
                raise VoiceBackendError(f"kokoro would not start ({type(exc).__name__})") from None
            try:
                _, stderr = job.proc.communicate(timeout=self.timeout_s)
            except subprocess.TimeoutExpired:
                job.proc.kill()
                job.proc.communicate()
                raise VoiceBackendError(f"kokoro timed out after {self.timeout_s:.0f} s") from None
            if job.cancelled:
                return b""
            if job.proc.returncode != 0:
                snippet = stderr.decode("utf-8", "replace").strip()[:STDERR_SNIPPET]
                raise VoiceBackendError(f"kokoro exited with {job.proc.returncode}: {snippet}")
            return read_pcm(output)

    def synthesize(self, text: str) -> Iterator[bytes]:
        """PCM16 at 24 kHz, sentence by sentence, the next one rendering while this one plays.

        Closing the generator early — a barge-in — kills the sentence still rendering.
        """
        if len(text) > MAX_CHARS:
            raise VoiceBackendError(f"kokoro speaks at most {MAX_CHARS} characters at once")
        sentences = split_sentences(text)
        if not sentences:
            return
        pending: _Render | None = self._start(sentences[0])
        try:
            for index in range(len(sentences)):
                assert pending is not None
                pcm = pending.result()
                pending = self._start(sentences[index + 1]) if index + 1 < len(sentences) else None
                for at in range(0, len(pcm), CHUNK_BYTES):
                    yield pcm[at : at + CHUNK_BYTES]
        finally:
            if pending is not None:
                pending.cancel()

    def _start(self, sentence: str) -> _Render:
        self.started.append(sentence)
        return _Render(self._render, sentence).start()

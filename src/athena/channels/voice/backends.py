"""The voice backend port, a scripted one for tests, and one that reaches a provider (ADR 0019).

A backend is two things and nothing else: a way to turn microphone audio into text, one
utterance at a time, and a way to turn a reply into audio. It never sees the lane, the gate or
the ledger, and it never decides what an utterance *means* — whether "approve" answers a card is
:mod:`athena.channels.voice.commands`' question, and a backend that answered it would be a second
gate in a vendor's SDK.

**The port is utterance-shaped, with room for streaming.** A :class:`Transcriber` is fed chunks
as they arrive and may return partial transcripts along the way; :meth:`Transcriber.finish` is
the end of the turn and returns the final text. A backend that transcribes in one request at the
end returns no partials and is still a correct backend. Push-to-talk makes the end of an
utterance a key release, so this build never has to guess where a sentence ended.

**Audio is PCM16, mono, little-endian.** The client sends :data:`INPUT_SAMPLE_RATE`; a backend
says what rate it speaks at through :attr:`VoiceBackend.sample_rate`, because the two need not
agree and the surface plays whatever it is told.

**No provider is mandatory (README §2, invariant 5).** The provider backend imports nothing but
the standard library and reads its key from the environment; without a key the daemon starts
with no voice channel rather than with a broken one, and ``/health`` says so.
"""

from __future__ import annotations

import io
import json
import os
import time
import urllib.error
import urllib.request
import uuid
import wave
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

__all__ = [
    "BACKENDS",
    "INPUT_SAMPLE_RATE",
    "OPENAI_KEY_ENV",
    "OpenAIBackend",
    "ScriptedBackend",
    "ScriptedTranscriber",
    "Transcriber",
    "VoiceBackend",
    "VoiceBackendError",
    "backend_from_name",
]

#: What the microphone sends: 16 kHz, 16-bit, one channel. The rate a speech model was trained on
#: and a quarter of what a sound card gives for free; the surface resamples down, never up.
INPUT_SAMPLE_RATE = 16_000

OPENAI_KEY_ENV = "OPENAI_API_KEY"

#: The names ``--voice-backend`` accepts. ``auto`` picks the first provider whose key is set and
#: ``none`` starts the daemon with no voice channel at all.
BACKENDS: tuple[str, ...] = ("auto", "openai", "none")


class VoiceBackendError(Exception):
    """The backend could not hear or could not speak. Never carries a key."""


@runtime_checkable
class Transcriber(Protocol):
    """One utterance, fed as it arrives."""

    def feed(self, pcm: bytes) -> Sequence[str]:
        """Take a chunk; return any partial transcripts it produced, most recent last."""

    def finish(self) -> str:
        """End the utterance and return its final text. Empty when nothing was said."""


@runtime_checkable
class VoiceBackend(Protocol):
    """Speech in, speech out. Everything in between is the lane's."""

    @property
    def name(self) -> str: ...

    @property
    def sample_rate(self) -> int:
        """The rate of the PCM16 :meth:`synthesize` yields."""

    def transcriber(self) -> Transcriber:
        """A fresh session for one utterance."""

    def synthesize(self, text: str) -> Iterator[bytes]:
        """PCM16 mono at :attr:`sample_rate`, in chunks a player can start on."""


# --- scripted, for tests ------------------------------------------------------------------------


@dataclass
class ScriptedTranscriber:
    """Replays one scripted utterance: its partials on the first chunks, its final on finish."""

    final: str
    partials: list[str] = field(default_factory=list)
    fed: int = 0

    def feed(self, pcm: bytes) -> Sequence[str]:
        self.fed += len(pcm)
        if self.partials:
            return [self.partials.pop(0)]
        return []

    def finish(self) -> str:
        return self.final


@dataclass
class ScriptedBackend:
    """What a test hears and says. One entry of ``utterances`` per transcriber, in order.

    An entry is the final text, or ``(final, [partial, ...])`` when the test wants speech to be
    noticed before the key is released — which is how a barge-in by new speech is exercised.
    ``chunk_delay_s`` paces playback so a barge-in can land in the middle of it; ``spoken`` is
    what was synthesised, whole, whether or not it was played to the end.
    """

    utterances: list[str | tuple[str, list[str]]] = field(default_factory=list)
    chunk_delay_s: float = 0.0
    chunk_bytes: int = 640
    chunks_per_text: int = 4
    sample_rate: int = INPUT_SAMPLE_RATE
    spoken: list[str] = field(default_factory=list)
    fail_synthesis: bool = False

    @property
    def name(self) -> str:
        return "scripted"

    def transcriber(self) -> Transcriber:
        if not self.utterances:
            return ScriptedTranscriber(final="")
        entry = self.utterances.pop(0)
        if isinstance(entry, tuple):
            return ScriptedTranscriber(final=entry[0], partials=list(entry[1]))
        return ScriptedTranscriber(final=entry)

    def synthesize(self, text: str) -> Iterator[bytes]:
        if self.fail_synthesis:
            raise VoiceBackendError("scripted: synthesis refused")
        self.spoken.append(text)
        for _ in range(self.chunks_per_text):
            if self.chunk_delay_s:
                time.sleep(self.chunk_delay_s)
            yield bytes(self.chunk_bytes)


# --- one provider ---------------------------------------------------------------------------------


class _BufferedTranscriber:
    """Collects the utterance and transcribes it whole on ``finish`` — no partials."""

    def __init__(self, backend: OpenAIBackend) -> None:
        self._backend = backend
        self._chunks: list[bytes] = []

    def feed(self, pcm: bytes) -> Sequence[str]:
        self._chunks.append(pcm)
        return []

    def finish(self) -> str:
        audio = b"".join(self._chunks)
        self._chunks = []
        # Under a tenth of a second is a key tapped by mistake, not a sentence.
        if len(audio) < INPUT_SAMPLE_RATE * 2 // 10:
            return ""
        return self._backend.transcribe(audio)


@dataclass
class OpenAIBackend:
    """Speech to text and text to speech over the provider's HTTP API, standard library only.

    Transcription is one request per utterance — the port allows partials and this backend sends
    none, which push-to-talk makes harmless. Synthesis asks for raw PCM at 24 kHz and yields it as
    it streams, so playback starts on the first chunk rather than after the last.

    The key is read once and held; it is never logged, never in an exception, and never on the
    wire anywhere but the ``Authorization`` header of these two requests.
    """

    api_key: str
    stt_model: str = "gpt-4o-mini-transcribe"
    tts_model: str = "gpt-4o-mini-tts"
    voice: str = "alloy"
    base_url: str = "https://api.openai.com/v1"
    timeout_s: float = 30.0
    chunk_bytes: int = 4096

    #: The provider's ``pcm`` response format is 24 kHz, 16-bit, mono.
    sample_rate: int = 24_000

    @property
    def name(self) -> str:
        return "openai"

    def transcriber(self) -> Transcriber:
        return _BufferedTranscriber(self)

    def transcribe(self, pcm: bytes) -> str:
        wav = io.BytesIO()
        with wave.open(wav, "wb") as out:
            out.setnchannels(1)
            out.setsampwidth(2)
            out.setframerate(INPUT_SAMPLE_RATE)
            out.writeframes(pcm)
        boundary = f"----athena-{uuid.uuid4().hex}"
        body = b"".join(
            [
                f"--{boundary}\r\n".encode(),
                b'Content-Disposition: form-data; name="model"\r\n\r\n',
                self.stt_model.encode("utf-8"),
                f"\r\n--{boundary}\r\n".encode(),
                b'Content-Disposition: form-data; name="response_format"\r\n\r\njson',
                f"\r\n--{boundary}\r\n".encode(),
                b'Content-Disposition: form-data; name="file"; filename="utterance.wav"\r\n',
                b"Content-Type: audio/wav\r\n\r\n",
                wav.getvalue(),
                f"\r\n--{boundary}--\r\n".encode(),
            ]
        )
        request = urllib.request.Request(
            f"{self.base_url}/audio/transcriptions",
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": f"multipart/form-data; boundary={boundary}",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_s) as reply:
                payload = json.loads(reply.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raise VoiceBackendError(f"transcription refused with {exc.code}") from None
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
            raise VoiceBackendError(f"transcription failed: {type(exc).__name__}") from None
        text = payload.get("text") if isinstance(payload, dict) else None
        return str(text or "").strip()

    def synthesize(self, text: str) -> Iterator[bytes]:
        request = urllib.request.Request(
            f"{self.base_url}/audio/speech",
            data=json.dumps(
                {
                    "model": self.tts_model,
                    "voice": self.voice,
                    "input": text,
                    "response_format": "pcm",
                }
            ).encode("utf-8"),
            method="POST",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_s) as reply:
                while True:
                    chunk = reply.read(self.chunk_bytes)
                    if not chunk:
                        return
                    yield chunk
        except urllib.error.HTTPError as exc:
            raise VoiceBackendError(f"synthesis refused with {exc.code}") from None
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise VoiceBackendError(f"synthesis failed: {type(exc).__name__}") from None


def backend_from_name(name: str, environ: dict[str, str] | None = None) -> VoiceBackend | None:
    """The backend ``--voice-backend`` asked for, or ``None`` for no voice channel.

    ``auto`` is the default and means "whichever provider has a key in the environment, else
    none" — so a machine with no key starts a daemon with no ``/voice`` rather than a daemon whose
    ``/voice`` fails on the first utterance. Asking for a provider by name without its key raises,
    naming the variable and nothing else.
    """
    env = os.environ if environ is None else environ
    if name not in BACKENDS:
        raise ValueError(f"unknown voice backend {name!r}; expected one of {', '.join(BACKENDS)}")
    if name == "none":
        return None
    key = env.get(OPENAI_KEY_ENV, "")
    if key:
        return OpenAIBackend(api_key=key)
    if name == "openai":
        raise ValueError(f"the openai voice backend needs {OPENAI_KEY_ENV} in the environment")
    return None

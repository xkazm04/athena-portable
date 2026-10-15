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
the standard library. Which backend ``/voice`` uses is the voice studio's to compose (ADR 0028,
:mod:`athena.channels.voice.config`): one :class:`Speaker` and one :class:`Listener`, chosen
separately, behind :class:`ComposedBackend` — local Kokoro and whisper.cpp by default, the provider
for hearing when a person picks it and its key is sealed or in the environment.

**A metered half says so, and that is all it says (ADR 0083).** A provider half names the engine
and the model a request of it bills under — :func:`hearing_meter`, :func:`speaking_meter` — and
:class:`BufferedTranscriber` says whether ``finish`` sent anything. The gateway writes the ledger
row from those; a local engine and the scripted backend name no meter and get none.
"""

from __future__ import annotations

import http.client
import io
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
import wave
from array import array
from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

__all__ = [
    "BACKENDS",
    "INPUT_SAMPLE_RATE",
    "MAX_SPEECH_REPLY_SECONDS",
    "MAX_TRANSCRIPTION_REPLY_BYTES",
    "MAX_UTTERANCE_BYTES",
    "OPENAI_KEY_ENV",
    "SILENCE_FLOOR_DBFS",
    "BufferedTranscriber",
    "ComposedBackend",
    "Listener",
    "Meter",
    "OpenAIBackend",
    "ScriptedBackend",
    "ScriptedTranscriber",
    "Speaker",
    "Transcriber",
    "VoiceBackend",
    "VoiceBackendError",
    "backend_from_name",
    "hearing_meter",
    "speaking_meter",
]

#: What the microphone sends: 16 kHz, 16-bit, one channel. The rate a speech model was trained on
#: and a quarter of what a sound card gives for free; the surface resamples down, never up.
INPUT_SAMPLE_RATE = 16_000

OPENAI_KEY_ENV = "OPENAI_API_KEY"

#: The names ``--voice-backend`` accepts. ``config`` — the default — is the studio's choice in
#: ``ATHENA_HOME/voice/config.json`` (ADR 0028), switchable live; ``auto`` is its old name and means
#: the same. ``openai`` pins the provider for both directions over whatever the studio chose, and
#: ``none`` starts the daemon with no voice channel at all, which is what a scripted test wants.
BACKENDS: tuple[str, ...] = ("config", "auto", "openai", "none")


class VoiceBackendError(Exception):
    """The backend could not hear or could not speak. Never carries a key."""


@dataclass(frozen=True)
class Meter:
    """What one request of a metered half bills under: the provider's name and its model."""

    engine: str
    model: str


def hearing_meter(backend: object) -> Meter | None:
    """The meter of ``backend``'s hearing half, or ``None`` when hearing costs no request."""
    meter = getattr(backend, "hearing_meter", None)
    return meter if isinstance(meter, Meter) else None


def speaking_meter(backend: object) -> Meter | None:
    """The meter of ``backend``'s speaking half, or ``None`` when speaking costs no request."""
    meter = getattr(backend, "speaking_meter", None)
    return meter if isinstance(meter, Meter) else None


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


@runtime_checkable
class Speaker(Protocol):
    """The speaking half alone: what the studio picks as a TTS engine."""

    @property
    def name(self) -> str: ...

    @property
    def sample_rate(self) -> int: ...

    def synthesize(self, text: str) -> Iterator[bytes]: ...


@runtime_checkable
class Listener(Protocol):
    """The hearing half alone: what the studio picks as an STT engine."""

    @property
    def name(self) -> str: ...

    def transcriber(self) -> Transcriber: ...


@dataclass
class ComposedBackend:
    """One speaker and one listener, chosen separately, behind the one :class:`VoiceBackend` port.

    The gateway never learns there are two — it asks one backend to hear and to speak — and the
    studio can pick Kokoro to speak and the provider to hear without either knowing of the other.
    """

    speaker: Speaker
    listener: Listener

    @property
    def name(self) -> str:
        return f"{self.speaker.name}+{self.listener.name}"

    @property
    def sample_rate(self) -> int:
        return self.speaker.sample_rate

    def transcriber(self) -> Transcriber:
        return self.listener.transcriber()

    def synthesize(self, text: str) -> Iterator[bytes]:
        return self.speaker.synthesize(text)

    @property
    def hearing_meter(self) -> Meter | None:
        return hearing_meter(self.listener)

    @property
    def speaking_meter(self) -> Meter | None:
        return speaking_meter(self.speaker)


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


#: One utterance is at most this many bytes of PCM16: two minutes at 16 kHz mono. It is the number
#: the HTTP twin ``/voice/transcribe`` already enforces as ``MAX_RAW_BODY_BYTES`` (a test pins the
#: two equal; the daemon is not imported here) (ADR 0072).
MAX_UTTERANCE_BYTES = 4_194_304
#: A transcription reply is a short JSON object; past this it is not one (ADR 0019, amended).
MAX_TRANSCRIPTION_REPLY_BYTES = 1_048_576
#: A spoken line is a sentence or two; a synthesis reply longer than this many seconds of PCM16 at
#: the backend's sample rate is cut off and refused (ADR 0019, amended).
MAX_SPEECH_REPLY_SECONDS = 180


#: Below this peak an utterance is silence — a muted or misrouted microphone, not a quiet voice —
#: and no engine is asked to hear it (ADR 0110). Conservative on purpose: speech a person meant
#: peaks well above -40 dBFS, and room tone through an open microphone sits above this too.
SILENCE_FLOOR_DBFS = -55.0

#: PCM16 full scale: a peak of this many steps is 0 dBFS.
_PCM16_FULL_SCALE = 32_768


def _peak(pcm: bytes) -> int:
    """The largest sample magnitude in a chunk of PCM16 little-endian. A trailing odd byte is
    ignored (the client sends whole samples)."""
    samples = array("h")
    samples.frombytes(pcm[: len(pcm) - len(pcm) % 2])
    if not samples:
        return 0
    if sys.byteorder == "big":
        samples.byteswap()
    return max(max(samples), -min(samples))


def _dbfs(peak: int) -> float:
    """A PCM16 peak in dB below full scale, to a tenth. Zero reads as one step (about -90.3)."""
    return round(20 * math.log10(max(peak, 1) / _PCM16_FULL_SCALE), 1)


class BufferedTranscriber:
    """Collects the utterance and transcribes it whole on ``finish`` — no partials.

    Any one-request speech-to-text fits behind it: the provider here, and a local engine that
    takes a file (:mod:`athena.channels.voice.whisper`).

    **It says how the utterance ended** (ADR 0110). ``finish`` sets :attr:`outcome` to
    ``too_short`` (a tapped key), ``silent`` (the peak never reached :data:`SILENCE_FLOOR_DBFS`),
    ``no_words`` (the engine heard it and made no words) or ``words``. The first two return before
    ``transcribe`` is called: no process starts, no request is sent, no row is owed.
    """

    def __init__(self, transcribe: Callable[[bytes], str]) -> None:
        self._transcribe = transcribe
        self._chunks: list[bytes] = []
        self._held = 0
        self._peak = 0
        self._measured = False
        #: Whether ``finish`` handed the utterance to ``transcribe`` — set before the call, so a
        #: request that failed still counts as sent (ADR 0083).
        self.requested = False
        #: How ``finish`` found the utterance; ``""`` until it has, or when ``transcribe`` raised.
        self.outcome = ""

    @property
    def peak_dbfs(self) -> float | None:
        """The loudest sample held so far, in dBFS; ``None`` before anything was held."""
        return _dbfs(self._peak) if self._measured else None

    def feed(self, pcm: bytes) -> Sequence[str]:
        # Past the ceiling the frame is dropped, so the buffer never holds more than it (ADR 0072).
        if self._held + len(pcm) <= MAX_UTTERANCE_BYTES:
            self._chunks.append(pcm)
            self._held += len(pcm)
            self._peak = max(self._peak, _peak(pcm))
            self._measured = True
        return []

    def finish(self) -> str:
        audio = b"".join(self._chunks)
        self._chunks = []
        self._held = 0
        # Under a tenth of a second is a key tapped by mistake, not a sentence.
        if len(audio) < INPUT_SAMPLE_RATE * 2 // 10:
            self.outcome = "too_short"
            return ""
        if _dbfs(self._peak) < SILENCE_FLOOR_DBFS:
            self.outcome = "silent"
            return ""
        self.requested = True
        text = self._transcribe(audio)
        self.outcome = "words" if text.strip() else "no_words"
        return text


@dataclass
class OpenAIBackend:
    """Speech to text and text to speech over the provider's HTTP API, standard library only.

    Transcription is one request per utterance — the port allows partials and this backend sends
    none, which push-to-talk makes harmless. Synthesis asks for raw PCM at 24 kHz and yields it as
    it streams, so playback starts on the first chunk rather than after the last.

    The key is read once and held; it is never logged, never in an exception, and never on the
    wire anywhere but the ``Authorization`` header of these two requests.
    """

    #: Never in a repr: a dataclass prints its fields, and a traceback prints a repr.
    api_key: str = field(repr=False)
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

    @property
    def hearing_meter(self) -> Meter:
        return Meter(self.name, self.stt_model)

    @property
    def speaking_meter(self) -> Meter:
        return Meter(self.name, self.tts_model)

    def transcriber(self) -> Transcriber:
        return BufferedTranscriber(self.transcribe)

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
                raw = reply.read(MAX_TRANSCRIPTION_REPLY_BYTES + 1)
                if len(raw) > MAX_TRANSCRIPTION_REPLY_BYTES:
                    raise VoiceBackendError("transcription failed: reply too large") from None
                payload = json.loads(raw.decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raise VoiceBackendError(f"transcription refused with {exc.code}") from None
        except (
            urllib.error.URLError,
            http.client.HTTPException,
            TimeoutError,
            OSError,
            ValueError,
        ) as exc:
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
            ceiling = MAX_SPEECH_REPLY_SECONDS * self.sample_rate * 2
            sent = 0
            with urllib.request.urlopen(request, timeout=self.timeout_s) as reply:
                while True:
                    chunk = reply.read(self.chunk_bytes)
                    if not chunk:
                        return
                    sent += len(chunk)
                    if sent > ceiling:
                        raise VoiceBackendError("synthesis failed: reply too long") from None
                    yield chunk
        except urllib.error.HTTPError as exc:
            raise VoiceBackendError(f"synthesis refused with {exc.code}") from None
        except (
            urllib.error.URLError,
            http.client.HTTPException,
            TimeoutError,
            OSError,
        ) as exc:
            raise VoiceBackendError(f"synthesis failed: {type(exc).__name__}") from None


def backend_from_name(name: str, environ: dict[str, str] | None = None) -> VoiceBackend | None:
    """The backend ``--voice-backend`` asked for, or ``None`` for no voice channel.

    ``config`` and ``none`` are ``None`` here: the first is the studio's to compose
    (``athena serve`` never asks this function for it), the second is no channel. ``auto`` keeps
    its old meaning for a caller that still asks — the provider when its key is in the
    environment, else ``None``.
    Asking for a provider by name without its key raises, naming the variable and nothing else.
    """
    env = os.environ if environ is None else environ
    if name not in BACKENDS:
        raise ValueError(f"unknown voice backend {name!r}; expected one of {', '.join(BACKENDS)}")
    if name in ("none", "config"):
        return None
    key = env.get(OPENAI_KEY_ENV, "")
    if key:
        return OpenAIBackend(api_key=key)
    if name == "openai":
        raise ValueError(f"the openai voice backend needs {OPENAI_KEY_ENV} in the environment")
    return None

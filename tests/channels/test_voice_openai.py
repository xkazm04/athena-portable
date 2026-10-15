"""The OpenAI backend: transport failures and the meter (voice/backends.py; ADR 0019, ADR 0083).

``urlopen`` is replaced by a fake reply; nothing here touches the network.
"""

from __future__ import annotations

import http.client
import math
import struct
from typing import Any

import pytest

from athena.channels.voice import backends as backends_module
from athena.channels.voice.backends import (
    INPUT_SAMPLE_RATE,
    BufferedTranscriber,
    ComposedBackend,
    Meter,
    OpenAIBackend,
    ScriptedBackend,
    VoiceBackendError,
    hearing_meter,
    speaking_meter,
)

KEY = "sk-test-secret-key-0123"
TEXT = "the private sentence to speak"


class _Reply:
    """A reply context manager whose reads come from a script; an exception in it is raised."""

    def __init__(self, reads: list[bytes | BaseException]) -> None:
        self._reads = list(reads)
        self.sizes: list[int] = []

    def __enter__(self) -> _Reply:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def read(self, size: int = -1) -> bytes:
        self.sizes.append(size)
        step = self._reads.pop(0)
        if isinstance(step, BaseException):
            raise step
        return step


def _reply(monkeypatch: pytest.MonkeyPatch, reads: list[bytes | BaseException]) -> _Reply:
    reply = _Reply(reads)

    def urlopen(request: Any, timeout: float | None = None) -> _Reply:
        return reply

    monkeypatch.setattr(backends_module.urllib.request, "urlopen", urlopen)
    return reply


def _clean(exc: BaseException) -> None:
    for shown in (str(exc), repr(exc)):
        assert KEY not in shown
        assert TEXT not in shown
    assert exc.__cause__ is None


def test_a_synthesis_reply_cut_short_is_a_backend_error_after_its_chunk(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _reply(monkeypatch, [b"\x01" * 8, http.client.IncompleteRead(b"", 10)])
    stream = OpenAIBackend(api_key=KEY).synthesize(TEXT)
    assert next(stream) == b"\x01" * 8
    with pytest.raises(VoiceBackendError) as failed:
        next(stream)
    assert str(failed.value) == "synthesis failed: IncompleteRead"
    _clean(failed.value)


def test_a_transcription_reply_cut_short_is_a_backend_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _reply(monkeypatch, [http.client.IncompleteRead(b"", 10)])
    pcm = bytes(INPUT_SAMPLE_RATE // 5)  # 0.1 s of 16-bit mono
    with pytest.raises(VoiceBackendError) as failed:
        OpenAIBackend(api_key=KEY).transcribe(pcm)
    assert str(failed.value) == "transcription failed: IncompleteRead"
    _clean(failed.value)


def test_a_transcription_reply_over_the_ceiling_is_refused_before_it_is_parsed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(backends_module, "MAX_TRANSCRIPTION_REPLY_BYTES", 16)
    reply = _reply(monkeypatch, [b'{"text": "' + b"x" * 100 + b'"}'])
    pcm = bytes(INPUT_SAMPLE_RATE // 5)
    with pytest.raises(VoiceBackendError) as failed:
        OpenAIBackend(api_key=KEY).transcribe(pcm)
    assert str(failed.value) == "transcription failed: reply too large"
    assert reply.sizes == [17]
    _clean(failed.value)


def test_a_synthesis_reply_over_the_ceiling_yields_whole_chunks_then_is_refused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(backends_module, "MAX_SPEECH_REPLY_SECONDS", 1)
    backend = OpenAIBackend(api_key=KEY, sample_rate=4, chunk_bytes=3)  # ceiling: 8 bytes
    _reply(monkeypatch, [b"" * 3, b"" * 3, b"" * 3, b"" * 3])
    got: list[bytes] = []
    with pytest.raises(VoiceBackendError) as failed:
        for chunk in backend.synthesize(TEXT):
            got.append(chunk)
    assert got == [b"" * 3, b"" * 3]
    assert sum(map(len, got)) <= 8
    assert str(failed.value) == "synthesis failed: reply too long"
    _clean(failed.value)


# -- the meter: which half bills, under which model (ADR 0083) ---------------------------------


def test_the_provider_names_the_model_each_half_bills_under() -> None:
    backend = OpenAIBackend(api_key=KEY, stt_model="stt-x", tts_model="tts-y")
    assert hearing_meter(backend) == Meter(engine="openai", model="stt-x")
    assert speaking_meter(backend) == Meter(engine="openai", model="tts-y")
    assert KEY not in repr(hearing_meter(backend)) + repr(speaking_meter(backend))


def test_a_scripted_backend_bills_nothing() -> None:
    assert hearing_meter(ScriptedBackend()) is None
    assert speaking_meter(ScriptedBackend()) is None


def test_a_composed_backend_is_metered_per_half() -> None:
    provider = OpenAIBackend(api_key=KEY)
    hears = ComposedBackend(speaker=ScriptedBackend(), listener=provider)
    assert hearing_meter(hears) == Meter("openai", provider.stt_model)
    assert speaking_meter(hears) is None
    speaks = ComposedBackend(speaker=provider, listener=ScriptedBackend())
    assert hearing_meter(speaks) is None
    assert speaking_meter(speaks) == Meter("openai", provider.tts_model)


def test_a_buffered_transcriber_says_whether_it_sent_the_utterance() -> None:
    sent: list[int] = []

    def transcribe(pcm: bytes) -> str:
        sent.append(len(pcm))
        raise VoiceBackendError("transcription refused with 500")

    tapped = BufferedTranscriber(transcribe)
    tapped.feed(bytes(INPUT_SAMPLE_RATE // 10))
    assert tapped.finish() == ""
    assert (tapped.requested, sent) == (False, [])

    spoken = BufferedTranscriber(transcribe)
    spoken.feed(_tone(0.5))
    with pytest.raises(VoiceBackendError):
        spoken.finish()
    assert (spoken.requested, sent) == (True, [INPUT_SAMPLE_RATE])


# -- how an utterance ended, said by the stage that saw it (ADR 0110) ---------------------------


def _tone(seconds: float, dbfs: float = -20.0, hz: float = 440.0) -> bytes:
    """PCM16 little-endian of a sine whose peak is ``dbfs``."""
    amplitude = 32768 * 10 ** (dbfs / 20)
    count = int(INPUT_SAMPLE_RATE * seconds)
    samples = (
        round(amplitude * math.sin(2 * math.pi * hz * n / INPUT_SAMPLE_RATE)) for n in range(count)
    )
    return struct.pack(f"<{count}h", *samples)


def test_a_tapped_key_is_too_short_and_sends_nothing() -> None:
    sent: list[int] = []
    tapped = BufferedTranscriber(lambda pcm: str(sent.append(len(pcm))))
    tapped.feed(_tone(0.05))
    assert len(_tone(0.05)) == 1_600
    assert tapped.finish() == ""
    assert (tapped.outcome, tapped.requested, sent) == ("too_short", False, [])


def test_a_second_of_zeros_is_silent_and_never_reaches_the_engine() -> None:
    sent: list[int] = []
    muted = BufferedTranscriber(lambda pcm: str(sent.append(len(pcm))))
    muted.feed(bytes(32_000))
    assert muted.finish() == ""
    assert (muted.outcome, muted.requested, sent) == ("silent", False, [])


def test_a_tone_the_engine_hears_no_words_in_is_no_words_and_its_peak_is_measured() -> None:
    sent: list[int] = []

    def transcribe(pcm: bytes) -> str:
        sent.append(len(pcm))
        return ""

    heard = BufferedTranscriber(transcribe)
    heard.feed(_tone(1.0, dbfs=-20.0))
    assert heard.finish() == ""
    assert (heard.outcome, heard.requested, sent) == ("no_words", True, [32_000])
    assert heard.peak_dbfs is not None and -21.0 <= heard.peak_dbfs <= -19.0


def test_a_tone_the_engine_hears_words_in_is_words() -> None:
    heard = BufferedTranscriber(lambda pcm: "what is overdue")
    heard.feed(_tone(0.5))
    assert heard.finish() == "what is overdue"
    assert (heard.outcome, heard.requested) == ("words", True)

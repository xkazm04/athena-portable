"""The OpenAI backend's transport failures (channels/voice/backends.py; README §3.2; ADR 0019).

``urlopen`` is replaced by a fake reply; nothing here touches the network.
"""

from __future__ import annotations

import http.client
from typing import Any

import pytest

from athena.channels.voice import backends as backends_module
from athena.channels.voice.backends import INPUT_SAMPLE_RATE, OpenAIBackend, VoiceBackendError

KEY = "sk-test-secret-key-0123"
TEXT = "the private sentence to speak"


class _Reply:
    """A reply context manager whose reads come from a script; an exception in it is raised."""

    def __init__(self, reads: list[bytes | BaseException]) -> None:
        self._reads = list(reads)

    def __enter__(self) -> _Reply:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def read(self, size: int = -1) -> bytes:
        step = self._reads.pop(0)
        if isinstance(step, BaseException):
            raise step
        return step


def _reply(monkeypatch: pytest.MonkeyPatch, reads: list[bytes | BaseException]) -> None:
    def urlopen(request: Any, timeout: float | None = None) -> _Reply:
        return _Reply(reads)

    monkeypatch.setattr(backends_module.urllib.request, "urlopen", urlopen)


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

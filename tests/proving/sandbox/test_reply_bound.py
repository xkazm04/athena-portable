"""A reply past the ceiling is refused as an OSError in both HTTP clients, never read whole."""

from __future__ import annotations

import io
import urllib.error
import urllib.request
from typing import Any

import pytest

from athena.harness import tokenfactory
from athena.proving.sandbox import client


class _Response(io.BytesIO):
    status = 200
    headers: dict[str, str] = {}

    def __enter__(self) -> _Response:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


class _Opener:
    def __init__(self, response: _Response) -> None:
        self.response = response

    def open(self, request: Any, timeout: float) -> _Response:
        return self.response


def _tf(monkeypatch: pytest.MonkeyPatch, size: int) -> _Response:
    response = _Response(b"x" * size)
    monkeypatch.setattr(urllib.request, "urlopen", lambda request, timeout: response)
    return response


def _sandbox(monkeypatch: pytest.MonkeyPatch, size: int) -> None:
    opener = _Opener(_Response(b"x" * size))
    monkeypatch.setattr(urllib.request, "build_opener", lambda *handlers: opener)


def test_tokenfactory_refuses_a_body_past_the_ceiling(monkeypatch: pytest.MonkeyPatch) -> None:
    response = _tf(monkeypatch, tokenfactory.MAX_REPLY_BYTES + 1000)
    asked: list[int] = []
    real_read = response.read
    response.read = lambda n=-1: (asked.append(n), real_read(n))[1]  # type: ignore[method-assign]
    with pytest.raises(OSError, match="more than"):
        tokenfactory.urllib_post("https://x.test/", {}, b"{}", 1.0)
    assert asked == [tokenfactory.MAX_REPLY_BYTES + 1]  # a bounded read, never read()


def test_tokenfactory_accepts_a_body_at_the_ceiling(monkeypatch: pytest.MonkeyPatch) -> None:
    _tf(monkeypatch, tokenfactory.MAX_REPLY_BYTES)
    reply = tokenfactory.urllib_post("https://x.test/", {}, b"{}", 1.0)
    assert len(reply.body) == tokenfactory.MAX_REPLY_BYTES


def test_sandbox_refuses_a_body_past_the_ceiling(monkeypatch: pytest.MonkeyPatch) -> None:
    _sandbox(monkeypatch, client.MAX_REPLY_BYTES + 1)
    with pytest.raises(OSError, match="more than"):
        client.urllib_http("GET", "https://x.test/", {}, None, 1.0)


def test_sandbox_accepts_a_body_at_the_ceiling(monkeypatch: pytest.MonkeyPatch) -> None:
    _sandbox(monkeypatch, client.MAX_REPLY_BYTES)
    reply = client.urllib_http("GET", "https://x.test/", {}, None, 1.0)
    assert len(reply.body) == client.MAX_REPLY_BYTES


def test_sandbox_refuses_an_oversize_error_body(monkeypatch: pytest.MonkeyPatch) -> None:
    error = urllib.error.HTTPError(
        "https://x.test/",
        500,
        "boom",
        {},
        io.BytesIO(b"x" * (client.MAX_REPLY_BYTES + 1)),  # type: ignore[arg-type]
    )

    class _Failing:
        def open(self, request: Any, timeout: float) -> None:
            raise error

    monkeypatch.setattr(urllib.request, "build_opener", lambda *handlers: _Failing())
    with pytest.raises(OSError, match="more than"):
        client.urllib_http("GET", "https://x.test/", {}, None, 1.0)

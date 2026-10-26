"""A fake ``HttpPost`` and ``HttpGet`` for the Meta clients: records each request, no socket."""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any

from athena.harness.tokenfactory import HttpReply

KEY = "meta-secret-key-0123456789"
ENV = {"META_API_KEY": KEY, "META_BASE_URL": "https://meta.test/v1/"}


@dataclass
class Sent:
    url: str
    headers: dict[str, str]
    body: dict[str, Any]
    timeout: float


def ok(body: Mapping[str, Any]) -> HttpReply:
    return HttpReply(200, json.dumps(body).encode("utf-8"))


def responses_reply(answer: Any, *, tokens: tuple[int, int, int] = (100, 20, 0)) -> HttpReply:
    """A Responses reply whose output text is ``answer`` (JSON-encoded unless a string)."""
    text = answer if isinstance(answer, str) else json.dumps(answer)
    return ok(
        {
            "id": "resp_1",
            "output": [
                {
                    "type": "message",
                    "role": "assistant",
                    "content": [{"type": "output_text", "text": text}],
                }
            ],
            "usage": {
                "input_tokens": tokens[0],
                "output_tokens": tokens[1],
                "input_tokens_details": {"cached_tokens": tokens[2]},
            },
        }
    )


@dataclass
class FakePost:
    """Answers each POST with ``route(url, body)``; records what was sent."""

    route: Callable[[str, dict[str, Any]], HttpReply | BaseException]
    sent: list[Sent] = field(default_factory=list)

    def __call__(
        self, url: str, headers: Mapping[str, str], body: bytes, timeout: float
    ) -> HttpReply:
        parsed = json.loads(body)
        self.sent.append(Sent(url, dict(headers), parsed, timeout))
        reply = self.route(url, parsed)
        if isinstance(reply, BaseException):
            raise reply
        return reply


def always(reply: HttpReply | BaseException) -> FakePost:
    return FakePost(lambda url, body: reply)


@dataclass
class FakeGet:
    reply: HttpReply
    sent: list[str] = field(default_factory=list)

    def __call__(self, url: str, headers: Mapping[str, str], timeout: float) -> HttpReply:
        self.sent.append(url)
        return self.reply

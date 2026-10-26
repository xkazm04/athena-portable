"""``MetaModel``: Muse Spark as a ModelFn over Chat Completions, through a fake ``post``."""

from __future__ import annotations

import asyncio
import json

import pytest

from athena.harness.meta import MetaModel
from athena.harness.ports import ModelChunk, ModelMessage, ModelRequest
from athena.harness.tokenfactory import HttpReply

from .fakes import ENV, KEY, always, ok

REQUEST = ModelRequest(system="You act for the user.", messages=[ModelMessage("user", "Hi")])


def _run(model: MetaModel, request: ModelRequest = REQUEST) -> list[ModelChunk]:
    async def collect() -> list[ModelChunk]:
        return [chunk async for chunk in model(request)]

    return asyncio.run(collect())


def test_a_turn_becomes_thinking_text_tool_call_usage_and_done() -> None:
    call = {"id": "c1", "function": {"name": "read", "arguments": '{"a": 1}'}}
    post = always(
        ok(
            {
                "model": "muse-spark-1.3",
                "choices": [
                    {
                        "message": {"content": "<think>plan</think>Hello.", "tool_calls": [call]},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {
                    "prompt_tokens": 1_000,
                    "completion_tokens": 500,
                    "prompt_tokens_details": {"cached_tokens": 200},
                },
            }
        )
    )
    chunks = _run(MetaModel(api_key=KEY, base_url="https://meta.test/v1/", post=post))
    sent = post.sent[0]
    assert sent.url == "https://meta.test/v1/chat/completions"
    assert sent.headers["Authorization"] == f"Bearer {KEY}"
    assert sent.body["model"] == "muse-spark-1.3"
    assert sent.body["stream"] is False
    assert sent.body["messages"][0] == {"role": "system", "content": "You act for the user."}
    assert "chat_template_kwargs" not in sent.body
    assert [c.kind for c in chunks] == ["thinking", "text", "tool_call", "usage", "done"]
    usage = chunks[3]
    assert (usage.input_tokens, usage.output_tokens) == (1_000, 500)
    assert usage.cost_usd == pytest.approx(0.003155)
    assert usage.cost_estimated is True
    assert chunks[2].params == {"a": 1}
    assert KEY not in repr(MetaModel(api_key=KEY))


def test_key_url_and_model_come_from_env_and_the_request(monkeypatch: pytest.MonkeyPatch) -> None:
    for name, value in ENV.items():
        monkeypatch.setenv(name, value)
    post = always(ok({"choices": [{"message": {"content": "ok"}}]}))
    request = ModelRequest(system="", messages=[ModelMessage("user", "x")], model="muse-wonder-1.0")
    chunks = _run(MetaModel(post=post), request)
    assert post.sent[0].url == "https://meta.test/v1/chat/completions"
    assert post.sent[0].body["model"] == "muse-wonder-1.0"
    assert chunks[-1].kind == "done"


@pytest.mark.parametrize(
    ("reply", "reason", "needle"),
    [
        (HttpReply(401), "engine_error", "META_API_KEY"),
        (HttpReply(429), "engine_error", "rate limiting"),
        (HttpReply(504), "timeout", "timed out"),
        (TimeoutError(), "timeout", "did not answer"),
        (OSError(f"boom {KEY}"), "engine_error", "OSError"),
        (HttpReply(200, b"not json"), "parse_error", "not JSON"),
        (HttpReply(200, json.dumps({"choices": []}).encode()), "parse_error", "no choice"),
    ],
)
def test_failures_are_one_error_chunk_without_the_key(
    reply: HttpReply | BaseException, reason: str, needle: str
) -> None:
    chunks = _run(MetaModel(api_key=KEY, post=always(reply)))
    assert len(chunks) == 1
    assert chunks[0].kind == "error"
    assert chunks[0].reason == reason
    assert needle in chunks[0].text
    assert KEY not in chunks[0].text


def test_no_key_is_an_engine_error_and_no_request(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("META_API_KEY", raising=False)
    post = always(ok({}))
    chunks = _run(MetaModel(post=post))
    assert chunks[0].reason == "engine_error"
    assert "META_API_KEY" in chunks[0].text
    assert post.sent == []

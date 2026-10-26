"""Muse Spark as a ModelFn: the future ``meta`` engine over Chat Completions (spike 00 piece 1).

:class:`MetaModel` mirrors :class:`~athena.harness.tokenfactory.TokenFactoryModel`: one
:class:`~athena.harness.ports.ModelRequest` becomes one ``POST {base}/chat/completions`` and the
reply becomes ``text``, ``thinking``, ``tool_call``, ``usage`` and ``done`` chunks - or one
``error`` chunk whose reason is in ``ERROR_REASONS``. The round loop, the gate and the ledger row
stay :class:`~athena.harness.api_harness.ApiHarness`'s. It is **not registered** anywhere yet: the
engine lists (``harness/engines.py``, ``daemon.rs``, ``lib/engines.ts``) are the Director's.

**Press, not measured; the P1 probe replaces.** Meta's examples use the OpenAI SDK, so the request
is :mod:`~athena.harness.tokenfactory`'s own body (no Nemotron thinking switch is sent) and the
reply is read the same way; usage adds ``prompt_tokens_details.cached_tokens`` so a cache hit is
priced at the cached rate. **Not streamed**, for tokenfactory's reason: an ``OP:`` line is only an
op once its JSON closes. Costs come from :mod:`~athena.harness.meta.prices`, flagged
``cost_estimated``.

**The key is presence, never content**: ``META_API_KEY`` is read at call time, sent in one header,
and is in no ``repr`` and no error sentence; an HTTP failure is reported by its status alone.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass, field
from typing import Any

from athena.harness.meta.config import (
    API_KEY_ENV,
    REQUEST_TIMEOUT_S,
    SPARK_MODEL,
    api_key,
    base_url,
    headers,
)
from athena.harness.meta.prices import token_cost
from athena.harness.ports import ModelChunk, ModelRequest
from athena.harness.tokenfactory import (
    HttpPost,
    _int,
    _payload,
    _scrub,
    _split_think,
    _tool_calls,
    urllib_post,
)

__all__ = ["ENGINE", "MetaModel", "chat_chunks"]

#: The engine id this model will be registered under (not yet: the Director owns the lists).
ENGINE = "meta"


@dataclass
class MetaModel:
    """A :data:`~athena.harness.ports.ModelFn` over Meta's Chat Completions API."""

    model: str = SPARK_MODEL
    #: ``""`` reads ``META_BASE_URL`` (else the published base) at call time.
    base_url: str = ""
    timeout_s: float = REQUEST_TIMEOUT_S
    #: ``None`` reads ``META_API_KEY`` at call time. Never in ``repr``.
    api_key: str | None = field(default=None, repr=False)
    post: HttpPost = field(default=urllib_post, repr=False)

    def __call__(self, request: ModelRequest) -> AsyncIterator[ModelChunk]:
        return self._stream(request)

    async def _stream(self, request: ModelRequest) -> AsyncIterator[ModelChunk]:
        key = (self.api_key if self.api_key is not None else api_key()).strip()
        if not key:
            yield ModelChunk("error", reason="engine_error", text=f"{API_KEY_ENV} is not set")
            return
        model = request.model or self.model
        url = (self.base_url.rstrip("/") or base_url()) + "/chat/completions"
        body = json.dumps(_payload(request, model)).encode("utf-8")
        try:
            reply = await asyncio.to_thread(self.post, url, headers(key), body, self.timeout_s)
        except TimeoutError:
            yield ModelChunk(
                "error", reason="timeout", text=f"Meta did not answer in {self.timeout_s:g}s"
            )
            return
        except OSError as exc:
            reached = f"could not reach Meta: {type(exc).__name__}"
            yield ModelChunk("error", reason="engine_error", text=_scrub(reached, key))
            return
        if reply.status != 200:
            reason, detail = _http_failure(reply.status)
            yield ModelChunk("error", reason=reason, text=detail)
            return
        for chunk in chat_chunks(reply.body, model):
            yield chunk


def _http_failure(status: int) -> tuple[str, str]:
    """A status as a reason and a sentence. The body is never quoted; the key never is."""
    if status in (401, 403):
        return "engine_error", f"Meta refused the key (HTTP {status}); check {API_KEY_ENV}"
    if status == 404:
        return "engine_error", "Meta does not know that model (HTTP 404); list GET /v1/models"
    if status in (408, 504):
        return "timeout", f"Meta timed out (HTTP {status})"
    if status == 429:
        return "engine_error", "Meta is rate limiting this team (HTTP 429)"
    return "engine_error", f"Meta answered HTTP {status}"


def chat_chunks(raw: bytes, model: str) -> list[ModelChunk]:
    """One Chat Completions reply as chunks. Anything unreadable is one ``parse_error``."""
    try:
        reply = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return [ModelChunk("error", reason="parse_error", text="Meta's reply is not JSON")]
    choices = reply.get("choices") if isinstance(reply, Mapping) else None
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], Mapping):
        return [ModelChunk("error", reason="parse_error", text="Meta's reply has no choice")]
    message = choices[0].get("message")
    message = message if isinstance(message, Mapping) else {}

    chunks: list[ModelChunk] = []
    reasoning = message.get("reasoning_content")
    if isinstance(reasoning, str) and reasoning:
        chunks.append(ModelChunk("thinking", text=reasoning))
    content = message.get("content")
    thought, said = _split_think(content if isinstance(content, str) else "")
    if thought:
        chunks.append(ModelChunk("thinking", text=thought))
    if said:
        chunks.append(ModelChunk("text", text=said))
    chunks.extend(_tool_calls(message.get("tool_calls")))

    usage: Mapping[str, Any] = reply.get("usage") if isinstance(reply.get("usage"), Mapping) else {}
    details = usage.get("prompt_tokens_details")
    cached = _int(details.get("cached_tokens")) if isinstance(details, Mapping) else 0
    input_tokens = _int(usage.get("prompt_tokens"))
    output_tokens = _int(usage.get("completion_tokens"))
    cost = token_cost(model, input_tokens, output_tokens, cached)
    chunks.append(
        ModelChunk(
            "usage",
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=cost,
            cost_estimated=True,
            model=str(reply.get("model") or model),
        )
    )
    chunks.append(ModelChunk("done", reason=str(choices[0].get("finish_reason") or "")))
    return chunks

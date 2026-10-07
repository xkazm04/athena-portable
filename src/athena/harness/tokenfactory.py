"""Nebius Token Factory as a ModelFn: the ``nebius`` engine (README §3.1; ADR 0031).

Token Factory serves open models — NVIDIA Nemotron among them — behind an OpenAI-compatible Chat
Completions API. :class:`TokenFactoryModel` is the one function an API engine supplies
(:data:`~athena.harness.ports.ModelFn`): it turns a :class:`~athena.harness.ports.ModelRequest`
into one ``POST /chat/completions`` and the reply into ``text``, ``thinking``, ``usage`` and
``done`` chunks — or one ``error`` chunk whose reason is a member of ``ERROR_REASONS``. The round
loop, the gate and the ledger row are :class:`~athena.harness.api_harness.ApiHarness`'s.

**Stdlib only.** ``urllib.request`` speaks HTTPS and JSON well enough for one POST per round, so
there is no SDK and no extra (ADR 0002). The blocking call runs on a worker thread so the
daemon's event loop keeps serving while a model thinks.

**Not streamed.** The harness parses a round's text whole — an ``OP:`` line is only an op once
its JSON closes — so a token stream would buy nothing the user sees, and the non-streamed reply
is where usage reliably arrives. One request yields several chunks, which is what the port's
iterator shape allows; it does not ask for more.

**The key is presence, never content.** ``NEBIUS_API_KEY`` is read from the environment, sent
in one header, and appears in no ``repr``, no error sentence and no ledger column. An HTTP
failure is reported by its status alone: a provider's error body is a third party's text and
may echo what it was sent.
"""

from __future__ import annotations

import asyncio
import json
import os
import urllib.error
import urllib.request
from collections.abc import AsyncIterator, Callable, Mapping
from dataclasses import dataclass, field
from typing import Any

from athena.harness.ports import ModelChunk, ModelMessage, ModelRequest

__all__ = [
    "API_KEY_ENV",
    "DEFAULT_BASE_URL",
    "DEFAULT_MODEL",
    "ENGINE",
    "LIGHTNING_MODEL",
    "PRICES",
    "REQUEST_TIMEOUT_S",
    "HttpPost",
    "HttpReply",
    "TokenFactoryModel",
    "estimate_cost",
    "key_present",
    "urllib_post",
]

#: The engine id the ledger, ``--engine`` and ``GET /engines`` use.
ENGINE = "nebius"

#: Where the key is read from. Its presence is all ``GET /engines`` reports.
API_KEY_ENV = "NEBIUS_API_KEY"

#: Verified 2026-10-07 against docs.tokenfactory.nebius.com/api-reference/introduction, whose
#: example is ``POST https://api.tokenfactory.nebius.com/v1/chat/completions`` with a bearer key.
DEFAULT_BASE_URL = "https://api.tokenfactory.nebius.com/v1/"

#: Nemotron 3 Super. Read back from the live catalog (``GET {DEFAULT_BASE_URL}models``) on
#: 2026-10-07; this is the only place the default is spelled.
DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b"

#: The cheapest NVIDIA model Token Factory serves: the first rung a Proving Ground role is tried
#: on before it is escalated to :data:`DEFAULT_MODEL` (ADR 0030, "assume mediocre until measured").
LIGHTNING_MODEL = "nvidia/Nemotron-3_5-Lightning"

#: USD per one million (input, output) tokens, read from ``GET /v1/models?verbose=true`` on
#: 2026-10-07 (``pricing.prompt`` / ``pricing.completion`` are per token). Still an *estimate* for
#: the ledger — ``cost_estimated`` says so, because list prices move — and a model missing from
#: the table has its cost omitted, never written as 0.
PRICES: dict[str, tuple[float, float]] = {
    LIGHTNING_MODEL: (0.06, 0.24),
    "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B": (0.06, 0.24),
    DEFAULT_MODEL: (0.30, 0.90),
    "nvidia/Nemotron-3-Ultra-550b-a55b": (1.00, 3.00),
}

#: One HTTP round may take this long. A wall for a hung connection, not a thinking budget.
REQUEST_TIMEOUT_S = 180.0


@dataclass(frozen=True)
class HttpReply:
    """What came back: a status and a body. ``body`` is empty for an HTTP error, deliberately."""

    status: int
    body: bytes = b""


HttpPost = Callable[[str, Mapping[str, str], bytes, float], HttpReply]
"""``(url, headers, body, timeout) -> reply``. Raises ``TimeoutError`` or ``OSError``.

The seam the tests replace: nothing under ``tests/`` opens a socket to Token Factory.
"""


def urllib_post(url: str, headers: Mapping[str, str], body: bytes, timeout: float) -> HttpReply:
    """One POST with the standard library. An HTTP error is a reply; a dead network raises."""
    request = urllib.request.Request(url, data=body, headers=dict(headers), method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return HttpReply(status=int(response.status), body=response.read())
    except urllib.error.HTTPError as exc:
        exc.close()
        return HttpReply(status=int(exc.code))
    except urllib.error.URLError as exc:
        if isinstance(exc.reason, TimeoutError):
            raise TimeoutError("timed out") from None
        raise OSError(f"could not reach Token Factory: {type(exc.reason).__name__}") from None


def key_present(env: Mapping[str, str] | None = None) -> bool:
    """Is a key set? The only question about the key anything outside this class may ask."""
    return bool((env if env is not None else os.environ).get(API_KEY_ENV, "").strip())


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float | None:
    """What a call cost by the price table, or ``None`` when the model is not in it."""
    price = PRICES.get(model)
    if price is None:
        return None
    return (input_tokens * price[0] + output_tokens * price[1]) / 1_000_000


@dataclass
class TokenFactoryModel:
    """A :data:`~athena.harness.ports.ModelFn` over Token Factory's Chat Completions API."""

    model: str = DEFAULT_MODEL
    base_url: str = DEFAULT_BASE_URL
    timeout_s: float = REQUEST_TIMEOUT_S
    #: ``None`` reads ``NEBIUS_API_KEY`` at call time, so a key set after the daemon started is
    #: picked up on the next turn. Never in ``repr``.
    api_key: str | None = field(default=None, repr=False)
    post: HttpPost = field(default=urllib_post, repr=False)

    def __call__(self, request: ModelRequest) -> AsyncIterator[ModelChunk]:
        return self._stream(request)

    async def _stream(self, request: ModelRequest) -> AsyncIterator[ModelChunk]:
        key = self.api_key if self.api_key is not None else os.environ.get(API_KEY_ENV, "")
        key = key.strip()
        if not key:
            yield ModelChunk("error", reason="engine_error", text=f"{API_KEY_ENV} is not set")
            return
        model = request.model or self.model
        url = self.base_url.rstrip("/") + "/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": f"Bearer {key}",
        }
        body = json.dumps(_payload(request, model)).encode("utf-8")
        try:
            reply = await asyncio.to_thread(self.post, url, headers, body, self.timeout_s)
        except TimeoutError:
            yield ModelChunk(
                "error",
                reason="timeout",
                text=f"Token Factory did not answer in {self.timeout_s:g}s",
            )
            return
        except OSError as exc:
            yield ModelChunk("error", reason="engine_error", text=_scrub(str(exc), key))
            return
        if reply.status != 200:
            reason, detail = _http_failure(reply.status)
            yield ModelChunk("error", reason=reason, text=detail)
            return
        for chunk in _chunks(reply.body, model):
            yield chunk


def _payload(request: ModelRequest, model: str) -> dict[str, Any]:
    messages: list[dict[str, Any]] = []
    if request.system:
        messages.append({"role": "system", "content": request.system})
    messages.extend(_message(item) for item in request.messages)
    payload: dict[str, Any] = {"model": model, "messages": messages, "stream": False}
    if request.max_tokens is not None:
        payload["max_tokens"] = request.max_tokens
    if request.tools:
        payload["tools"] = [dict(tool) for tool in request.tools]
    return payload


def _message(message: ModelMessage) -> dict[str, Any]:
    if message.role == "tool":
        return {"role": "tool", "tool_call_id": message.call_id, "content": message.content}
    return {"role": message.role, "content": message.content}


def _http_failure(status: int) -> tuple[str, str]:
    """A status as a reason and a sentence. The body is never quoted; the key never is."""
    if status in (401, 403):
        return "engine_error", (
            f"Token Factory refused the key (HTTP {status}); check {API_KEY_ENV}"
        )
    if status == 404:
        return "engine_error", (
            "Token Factory does not know that model (HTTP 404); list GET /v1/models"
        )
    if status in (408, 504):
        return "timeout", f"Token Factory timed out (HTTP {status})"
    if status == 429:
        return "engine_error", "Token Factory is rate limiting this key (HTTP 429)"
    return "engine_error", f"Token Factory answered HTTP {status}"


def _chunks(raw: bytes, model: str) -> list[ModelChunk]:
    """One Chat Completions reply as chunks. Anything unreadable is one ``parse_error``."""
    try:
        reply = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return [ModelChunk("error", reason="parse_error", text="Token Factory's reply is not JSON")]
    choices = reply.get("choices") if isinstance(reply, Mapping) else None
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], Mapping):
        return [
            ModelChunk("error", reason="parse_error", text="Token Factory's reply has no choice")
        ]
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

    usage = reply.get("usage")
    usage = usage if isinstance(usage, Mapping) else {}
    served = str(reply.get("model") or model)
    input_tokens = _int(usage.get("prompt_tokens"))
    output_tokens = _int(usage.get("completion_tokens"))
    cost = estimate_cost(model, input_tokens, output_tokens)
    chunks.append(
        ModelChunk(
            "usage",
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=cost,
            cost_estimated=cost is not None,
            model=served,
        )
    )
    chunks.append(ModelChunk("done", reason=str(choices[0].get("finish_reason") or "")))
    return chunks


def _split_think(content: str) -> tuple[str, str]:
    """A reasoning model may open with ``<think>…</think>``; that part is not said."""
    stripped = content.lstrip()
    if stripped.startswith("<think>") and "</think>" in stripped:
        thought, _, rest = stripped[len("<think>") :].partition("</think>")
        return thought.strip(), rest.lstrip()
    return "", content


def _tool_calls(raw: Any) -> list[ModelChunk]:
    if not isinstance(raw, list):
        return []
    chunks: list[ModelChunk] = []
    for call in raw:
        function = call.get("function") if isinstance(call, Mapping) else None
        if not isinstance(function, Mapping):
            continue
        try:
            params = json.loads(str(function.get("arguments") or "{}"))
        except json.JSONDecodeError:
            params = {}
        chunks.append(
            ModelChunk(
                "tool_call",
                call_id=str(call.get("id") or ""),
                name=str(function.get("name") or ""),
                params=params if isinstance(params, Mapping) else {},
            )
        )
    return chunks


def _scrub(text: str, key: str) -> str:
    return text.replace(key, "***") if key else text


def _int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0

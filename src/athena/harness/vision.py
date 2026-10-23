"""One picture to a Token Factory vision model: Nemotron 3.5 Super-VL as a plain call.

The ``nebius`` engine's :class:`~athena.harness.tokenfactory.TokenFactoryModel` is a text-only
``ModelFn``; a vision read is one Chat Completions request whose user turn carries the prompt and
the picture as a base64 ``image_url`` part. :class:`VisionCall` is that request and its reply,
used by the documents lane's opt-in reader (ADR 0097) and by the Proving Ground's document-reading
bench (WP-V), so there is one implementation of both.

**The key is presence, never content** — the same rules as :mod:`~athena.harness.tokenfactory`:
``NEBIUS_API_KEY`` goes in one header and in no reply, ``repr`` or error sentence; an HTTP failure
is its status alone; a dead network is named by its exception type, never its message.

**Sizes without Pillow.** :func:`sniff_image` reads a PNG, JPEG or WebP header for its mime type
and pixel size (stdlib ``struct`` only), so a caller can refuse a picture too large to send before
it builds a request.
"""

from __future__ import annotations

import base64
import json
import os
import struct
import time
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from athena.harness.tokenfactory import (
    API_KEY_ENV,
    DEFAULT_BASE_URL,
    REQUEST_TIMEOUT_S,
    SUPER_VL_MODEL,
    THINKING_OFF,
    HttpPost,
    _http_failure,
    _split_think,
    estimate_cost,
    urllib_post,
)

__all__ = [
    "IMAGE_MIMES",
    "MAX_TOKENS",
    "MAX_TOKENS_THINKING",
    "VisionCall",
    "VisionReply",
    "png_size",
    "sniff_image",
    "vision_reply",
]

#: The picture suffixes a vision call is offered, lower-case, with the mime type each implies.
IMAGE_MIMES: Mapping[str, str] = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}

#: The answer ceiling with reasoning off, and with it on (reasoning spends from the same budget).
MAX_TOKENS = 4096
MAX_TOKENS_THINKING = 12288


@dataclass(frozen=True)
class VisionReply:
    """What one vision call produced. ``error_reason`` is in ``ERROR_REASONS``, or ``None``.

    ``stopped`` is ``"length"`` when the reply hit the call's own ``max_tokens`` ceiling: the text
    is kept (it is cut off) and the reply is an error.
    """

    text: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float | None = None
    ms: int = 0
    error_reason: str | None = None
    detail: str = ""
    stopped: str = ""

    @property
    def ok(self) -> bool:
        return self.error_reason is None


@dataclass
class VisionCall:
    """One call about one picture: a system prompt, a user prompt and the picture, one answer."""

    image: bytes = field(repr=False)
    mime: str = "image/png"
    model: str = SUPER_VL_MODEL
    #: Off by default: the answer is a strict JSON object, and reasoning only spends tokens on it.
    thinking: bool = False
    max_tokens: int | None = None
    timeout_s: float = REQUEST_TIMEOUT_S
    base_url: str = DEFAULT_BASE_URL
    #: ``None`` reads ``NEBIUS_API_KEY`` at call time. Never in ``repr``.
    api_key: str | None = field(default=None, repr=False)
    post: HttpPost = field(default=urllib_post, repr=False)

    def payload(self, system: str, prompt: str) -> dict[str, Any]:
        data_url = f"data:{self.mime};base64," + base64.b64encode(self.image).decode("ascii")
        ceiling = self.max_tokens or (MAX_TOKENS_THINKING if self.thinking else MAX_TOKENS)
        body: dict[str, Any] = {
            "model": self.model,
            "stream": False,
            "max_tokens": ceiling,
            "messages": [
                {"role": "system", "content": system},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                },
            ],
        }
        if not self.thinking:
            body.update({key: dict(value) for key, value in THINKING_OFF.items()})
        return body

    def complete(self, system: str, prompt: str) -> VisionReply:
        started = time.monotonic()
        key = (
            self.api_key if self.api_key is not None else os.environ.get(API_KEY_ENV, "")
        ).strip()

        def fail(reason: str, detail: str, *, ms: int | None = None) -> VisionReply:
            spent = _ms(started) if ms is None else ms
            return VisionReply("", self.model, ms=spent, error_reason=reason, detail=detail)

        if not key:
            return fail("engine_error", f"{API_KEY_ENV} is not set", ms=0)
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": f"Bearer {key}",
        }
        url = self.base_url.rstrip("/") + "/chat/completions"
        body = json.dumps(self.payload(system, prompt)).encode("utf-8")
        try:
            reply = self.post(url, headers, body, self.timeout_s)
        except TimeoutError:
            return fail("timeout", f"Token Factory did not answer in {self.timeout_s:g}s")
        except OSError as exc:
            return fail("engine_error", type(exc).__name__)
        if reply.status != 200:
            return fail(*_http_failure(reply.status))
        return vision_reply(reply.body, self.model, _ms(started))


def vision_reply(raw: bytes, model: str, ms: int) -> VisionReply:
    """A Chat Completions body as a :class:`VisionReply`. The provider's text is never quoted in
    ``detail``."""

    def fail(reason: str, detail: str) -> VisionReply:
        return VisionReply("", model, ms=ms, error_reason=reason, detail=detail)

    try:
        reply = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return fail("parse_error", "Token Factory's reply is not JSON")
    choices = reply.get("choices") if isinstance(reply, Mapping) else None
    first = choices[0] if isinstance(choices, list) and choices else None
    if not isinstance(first, Mapping):
        return fail("parse_error", "Token Factory's reply has no choice")
    message = first.get("message")
    content = message.get("content") if isinstance(message, Mapping) else None
    _, said = _split_think(content if isinstance(content, str) else "")
    usage = reply.get("usage")
    usage = usage if isinstance(usage, Mapping) else {}
    tokens_in = _int(usage.get("prompt_tokens"))
    tokens_out = _int(usage.get("completion_tokens"))
    common: dict[str, Any] = {
        "model": str(reply.get("model") or model),
        "input_tokens": tokens_in,
        "output_tokens": tokens_out,
        "cost_usd": estimate_cost(model, tokens_in, tokens_out),
        "ms": ms,
    }
    if first.get("finish_reason") == "length":
        return VisionReply(
            said.strip(),
            error_reason="engine_error",
            detail="stopped at the max_tokens ceiling",
            stopped="length",
            **common,
        )
    if not said.strip():
        return VisionReply(
            "", error_reason="engine_error", detail="no text in the answer", **common
        )
    return VisionReply(said.strip(), **common)


# --- picture headers ------------------------------------------------------------------------------


def png_size(data: bytes) -> tuple[int, int]:
    """``(width, height)`` from a PNG header, or raise ``ValueError``."""
    if data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        raise ValueError("not a PNG")
    width, height = struct.unpack(">II", data[16:24])
    return int(width), int(height)


def sniff_image(data: bytes) -> tuple[str, int, int] | None:
    """``(mime, width, height)`` read from a PNG, JPEG or WebP header; ``None`` for anything else
    or a header too damaged to read."""
    try:
        if data[:8] == b"\x89PNG\r\n\x1a\n":
            width, height = png_size(data)
            return "image/png", width, height
        if data[:2] == b"\xff\xd8":
            size = _jpeg_size(data)
            return ("image/jpeg", *size) if size else None
        if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
            size = _webp_size(data)
            return ("image/webp", *size) if size else None
    except (ValueError, struct.error, IndexError):
        return None
    return None


#: JPEG start-of-frame markers (every SOFn but DHT ``C4``, JPG ``C8`` and DAC ``CC``).
_SOF = frozenset(range(0xC0, 0xD0)) - {0xC4, 0xC8, 0xCC}


def _jpeg_size(data: bytes) -> tuple[int, int] | None:
    at = 2
    while at + 4 <= len(data):
        if data[at] != 0xFF:
            return None
        marker = data[at + 1]
        if marker == 0xFF:  # fill byte
            at += 1
            continue
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:  # standalone markers
            at += 2
            continue
        if marker in (0xD9, 0xDA):  # end of image, or start of scan before any frame header
            return None
        (length,) = struct.unpack(">H", data[at + 2 : at + 4])
        if length < 2:
            return None
        if marker in _SOF:
            height, width = struct.unpack(">HH", data[at + 5 : at + 9])
            return (int(width), int(height)) if width and height else None
        at += 2 + length
    return None


def _webp_size(data: bytes) -> tuple[int, int] | None:
    chunk = data[12:16]
    if chunk == b"VP8 ":
        if data[23:26] != b"\x9d\x01\x2a":
            return None
        width, height = struct.unpack("<HH", data[26:30])
        return int(width & 0x3FFF), int(height & 0x3FFF)
    if chunk == b"VP8L":
        if data[20] != 0x2F:
            return None
        (bits,) = struct.unpack("<I", data[21:25])
        return int((bits & 0x3FFF) + 1), int(((bits >> 14) & 0x3FFF) + 1)
    if chunk == b"VP8X":
        width = int.from_bytes(data[24:27], "little") + 1
        height = int.from_bytes(data[27:30], "little") + 1
        return width, height
    return None


def _ms(started: float) -> int:
    return int((time.monotonic() - started) * 1000)


def _int(value: Any) -> int:
    return int(value) if isinstance(value, int | float) and not isinstance(value, bool) else 0

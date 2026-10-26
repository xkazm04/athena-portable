"""The wire every Meta role shares: one JSON POST, the typed errors, the Responses helpers.

**Press, not measured; the P1 probe replaces.** Meta's examples point the OpenAI SDK at its base
URL, so the Responses shapes here (``input`` parts, ``text.format`` structured output, ``output[]``
messages, ``usage.input_tokens``) are the OpenAI convention guessed onto Meta. Request building and
reply parsing are small pure functions so the day-1 probe can run the clients' own parsers on a
real reply and name every shape that differs.

**Parsed defensively.** An unexpected reply raises :class:`MetaShapeError` naming the key path it
looked for - never a bare ``KeyError``. An HTTP failure is :class:`MetaHttpError` with its status
alone (a provider's error body is a third party's text and may echo what it was sent), and a dead
network is named by its exception type, never its message. The key is in no error sentence.
"""

from __future__ import annotations

import base64
import json
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

from athena.harness.meta.config import API_KEY_ENV, api_key, headers
from athena.harness.tokenfactory import MAX_REPLY_BYTES, HttpPost, HttpReply

__all__ = [
    "HttpGet",
    "MetaError",
    "MetaHttpError",
    "MetaKeyMissing",
    "MetaMediaMissing",
    "MetaShapeError",
    "MetaUnreachable",
    "data_url",
    "json_schema_format",
    "mime_of",
    "post_json",
    "require_file",
    "require_key",
    "responses_json",
    "responses_text",
    "responses_usage",
    "urllib_get",
]

HttpGet = Callable[[str, Mapping[str, str], float], HttpReply]
"""``(url, headers, timeout) -> reply``: the probe's ``GET /models``. :data:`HttpPost` has no verb,
so the one GET the spike needs gets its own seam of the same shape (tests replace it)."""


class MetaError(RuntimeError):
    """A Meta call could not produce an answer. The message never holds the key or a reply body."""


class MetaKeyMissing(MetaError):
    """``META_API_KEY`` is not set."""


class MetaMediaMissing(MetaError):
    """The media file is not on this machine: legal for the fixture backend, a refusal here."""


class MetaUnreachable(MetaError):
    """The network failed or timed out before Meta answered."""


class MetaHttpError(MetaError):
    """Meta answered with a non-200 status."""

    def __init__(self, status: int, what: str) -> None:
        super().__init__(f"Meta {what} answered HTTP {status}{_hint(status)}")
        self.status = status


class MetaShapeError(MetaError):
    """A reply lacked a key the client assumes; ``key`` is the path it looked for."""

    def __init__(self, key: str, what: str) -> None:
        super().__init__(f"Meta {what} reply has no {key} (press shape; see the P1 probe)")
        self.key = key


def _hint(status: int) -> str:
    if status in (401, 403):
        return f"; check {API_KEY_ENV}"
    if status == 404:
        return "; list GET /models"
    if status == 429:
        return "; rate limited"
    return ""


def require_key(env: Mapping[str, str] | None) -> str:
    key = api_key(env)
    if not key:
        raise MetaKeyMissing(f"{API_KEY_ENV} is not set")
    return key


def require_file(file: Path | None, media_id: str) -> bytes:
    if file is None or not file.is_file():
        raise MetaMediaMissing(f"media {media_id!r} has no local file; a Meta sense must see it")
    return file.read_bytes()


#: Suffix -> the mime type a part is labelled with.
_MIMES: Mapping[str, str] = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
}


def mime_of(path: Path | str) -> str:
    return _MIMES.get(Path(path).suffix.lower(), "application/octet-stream")


def data_url(data: bytes, mime: str) -> str:
    return f"data:{mime};base64," + base64.b64encode(data).decode("ascii")


def json_schema_format(name: str, schema: Mapping[str, Any]) -> dict[str, Any]:
    """The Responses ``text`` field asking for strict JSON-schema output."""
    return {"format": {"type": "json_schema", "name": name, "schema": dict(schema), "strict": True}}


def post_json(
    post: HttpPost,
    url: str,
    key: str,
    payload: Mapping[str, Any],
    timeout: float,
    what: str,
) -> tuple[Mapping[str, Any], int]:
    """One POST of ``payload``; the parsed object reply and the latency in milliseconds."""
    body = json.dumps(payload).encode("utf-8")
    started = time.monotonic()
    try:
        reply = post(url, headers(key), body, timeout)
    except TimeoutError:
        raise MetaUnreachable(f"Meta {what} did not answer in {timeout:g}s") from None
    except OSError as exc:
        raise MetaUnreachable(f"could not reach Meta {what}: {type(exc).__name__}") from None
    latency_ms = int((time.monotonic() - started) * 1000)
    if reply.status != 200:
        raise MetaHttpError(reply.status, what)
    return parse_object(reply.body, what), latency_ms


def parse_object(raw: bytes, what: str) -> Mapping[str, Any]:
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise MetaShapeError("JSON body", what) from None
    if not isinstance(value, Mapping):
        raise MetaShapeError("JSON object", what)
    return value


def responses_text(reply: Mapping[str, Any], what: str) -> str:
    """The answer text of a Responses reply: ``output_text``, else the ``output_text`` parts of the
    ``output[]`` messages, joined."""
    direct = reply.get("output_text")
    if isinstance(direct, str) and direct:
        return direct
    output = reply.get("output")
    if not isinstance(output, list):
        raise MetaShapeError("output", what)
    parts: list[str] = []
    for item in output:
        content = item.get("content") if isinstance(item, Mapping) else None
        for part in content if isinstance(content, list) else []:
            if isinstance(part, Mapping) and part.get("type") == "output_text":
                text = part.get("text")
                if isinstance(text, str):
                    parts.append(text)
    if not parts:
        raise MetaShapeError("output[].content[].output_text", what)
    return "".join(parts)


def responses_json(reply: Mapping[str, Any], what: str) -> Mapping[str, Any]:
    """The structured-output object of a Responses reply."""
    text = responses_text(reply, what).strip()
    if text.startswith("```"):
        text = text.strip("`").removeprefix("json").strip()
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        raise MetaShapeError("JSON in output_text", what) from None
    if not isinstance(value, Mapping):
        raise MetaShapeError("JSON object in output_text", what)
    return value


def responses_usage(reply: Mapping[str, Any]) -> tuple[int, int, int]:
    """``(input, output, cached)`` tokens; zeros where the reply is silent."""
    usage = reply.get("usage")
    usage = usage if isinstance(usage, Mapping) else {}
    details = usage.get("input_tokens_details")
    details = details if isinstance(details, Mapping) else {}
    return (
        _int(usage.get("input_tokens")),
        _int(usage.get("output_tokens")),
        _int(details.get("cached_tokens")),
    )


def _int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def urllib_get(url: str, headers: Mapping[str, str], timeout: float) -> HttpReply:
    """One GET with the standard library: an HTTP error is a reply, a dead network raises."""
    request = urllib.request.Request(url, headers=dict(headers), method="GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read(MAX_REPLY_BYTES + 1)
            if len(body) > MAX_REPLY_BYTES:
                raise OSError(f"Meta answered more than {MAX_REPLY_BYTES} bytes")
            return HttpReply(status=int(response.status), body=body)
    except urllib.error.HTTPError as exc:
        exc.close()
        return HttpReply(status=int(exc.code))
    except urllib.error.URLError as exc:
        if isinstance(exc.reason, TimeoutError):
            raise TimeoutError("timed out") from None
        raise OSError(f"could not reach Meta: {type(exc.reason).__name__}") from None

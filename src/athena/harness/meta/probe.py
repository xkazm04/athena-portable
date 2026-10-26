"""The day-1 probe: the first hour with a Meta key, measured (spike 00 piece 6, proof P1).

``uv run python -m athena.harness.meta probe [--out <dir>]`` lists ``GET /models``, then makes one
tiny call per text model id per endpoint (Responses; Chat Completions with streaming off and on),
one SAM call on a generated 16x16 PNG, one Voice Transcribe call and one Spark-audio call on a
generated one-second WAV, and one structured-output read on the PNG. Each call records its status,
latency, the reply's top-level keys and its ``usage``; the clients' **own parsers** run on every
reply, so a shape that differs from what the clients assume is named by the key they missed.

It writes ``probe-<UTC stamp>.json`` to ``--out`` (default: the main checkout's
``.spark/Spark/meta/probes/``, git-excluded) and prints a checklist of every difference. Without
``META_API_KEY`` it exits 2 with one line and opens no socket. **The key is presence, never
content**: it is in no record, no line printed and no file written. Cost of a full run, by the price
table: well under one cent (16-token answers, one SAM image, two seconds of audio).
"""

from __future__ import annotations

import io
import json
import math
import struct
import subprocess
import sys
import time
import wave
import zlib
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from athena.harness.meta.config import (
    API_KEY_ENV,
    KNOWN_MODELS,
    REQUEST_TIMEOUT_S,
    SAM_MODEL,
    SPARK_AUDIO_MODEL,
    SPARK_MODEL,
    TEXT_MODELS,
    VOICE_MODEL,
    api_key,
    base_url,
    headers,
)
from athena.harness.meta.engine import chat_chunks
from athena.harness.meta.reader import parse_reading, read_payload
from athena.harness.meta.sam import parse_segments, segment_payload
from athena.harness.meta.voice import (
    asr_payload,
    parse_asr,
    parse_spark_turns,
    spark_audio_payload,
)
from athena.harness.meta.wire import (
    HttpGet,
    MetaError,
    parse_object,
    responses_text,
    urllib_get,
)
from athena.harness.tokenfactory import HttpPost, HttpReply, urllib_post

__all__ = ["ProbeCall", "main", "run_probe", "tiny_png", "tiny_wav"]

#: The answer ceiling of every text call: enough for "OK", cheap enough to call twenty times.
TINY_TOKENS = 16
_SAY = "Reply with the single word OK."


@dataclass(frozen=True)
class ProbeCall:
    """One measured call. ``differs`` names what the clients assumed and did not get."""

    name: str
    endpoint: str
    model: str
    status: int | None
    latency_ms: int
    keys: tuple[str, ...] = ()
    usage: Mapping[str, Any] | None = None
    differs: str = ""
    note: str = ""

    def row(self) -> dict[str, Any]:
        row: dict[str, Any] = {
            "name": self.name,
            "endpoint": self.endpoint,
            "model": self.model,
            "status": self.status,
            "latency_ms": self.latency_ms,
            "keys": list(self.keys),
            "ok": not self.differs,
        }
        if self.usage is not None:
            row["usage"] = dict(self.usage)
        if self.differs:
            row["differs"] = self.differs
        if self.note:
            row["note"] = self.note
        return row


# --- generated media -----------------------------------------------------------------------------


def tiny_png(size: int = 16) -> bytes:
    """A valid ``size`` x ``size`` RGB PNG: white with a black square in the middle (zlib only)."""
    lo, hi = size // 4, size - size // 4
    rows = b"".join(
        b"\x00"
        + b"".join(
            b"\x00\x00\x00" if lo <= x < hi and lo <= y < hi else b"\xff\xff\xff"
            for x in range(size)
        )
        for y in range(size)
    )

    def chunk(kind: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(kind + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", crc)

    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(rows))
        + chunk(b"IEND", b"")
    )


def tiny_wav(seconds: float = 1.0, rate: int = 16_000) -> bytes:
    """A mono 16-bit WAV: a quiet 440 Hz tone (``wave`` only)."""
    frames = b"".join(
        struct.pack("<h", int(3000 * math.sin(2 * math.pi * 440 * n / rate)))
        for n in range(int(seconds * rate))
    )
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(frames)
    return buffer.getvalue()


# --- one call ------------------------------------------------------------------------------------


@dataclass(frozen=True)
class _Raw:
    status: int | None
    latency_ms: int
    body: bytes = b""
    failed: str = ""


def _timed(fn: Callable[[], HttpReply]) -> _Raw:
    started = time.monotonic()
    try:
        reply = fn()
    except TimeoutError:
        return _Raw(None, _ms(started), failed="timed out")
    except OSError as exc:
        return _Raw(None, _ms(started), failed=f"unreachable ({type(exc).__name__})")
    return _Raw(reply.status, _ms(started), reply.body)


def _ms(started: float) -> int:
    return int((time.monotonic() - started) * 1000)


def _measure(
    raw: _Raw, name: str, endpoint: str, model: str, check: Callable[[Mapping[str, Any]], str]
) -> ProbeCall:
    """A raw reply as a record; ``check`` runs the client's parser and returns a note."""
    common: dict[str, Any] = {
        "name": name,
        "endpoint": endpoint,
        "model": model,
        "status": raw.status,
        "latency_ms": raw.latency_ms,
    }
    if raw.failed:
        return ProbeCall(**common, differs=raw.failed)
    if raw.status != 200:
        return ProbeCall(**common, differs=f"HTTP {raw.status}")
    try:
        reply = parse_object(raw.body, name)
    except MetaError as exc:
        return ProbeCall(**common, differs=str(exc))
    usage = reply.get("usage")
    common["keys"] = tuple(sorted(str(k) for k in reply))
    common["usage"] = usage if isinstance(usage, Mapping) else None
    try:
        note = check(reply)
    except MetaError as exc:
        return ProbeCall(**common, differs=str(exc))
    return ProbeCall(**common, note=note)


def _check_responses(reply: Mapping[str, Any]) -> str:
    responses_text(reply, "Responses")
    if not isinstance(reply.get("usage"), Mapping) or "input_tokens" not in reply["usage"]:
        raise MetaError("Meta Responses reply has no usage.input_tokens")
    return ""


def _check_chat(model: str) -> Callable[[Mapping[str, Any]], str]:
    def check(reply: Mapping[str, Any]) -> str:
        chunks = chat_chunks(json.dumps(reply).encode("utf-8"), model)
        errors = [c.text for c in chunks if c.kind == "error"]
        if errors:
            raise MetaError(errors[0])
        if not isinstance(reply.get("usage"), Mapping) or "prompt_tokens" not in reply["usage"]:
            raise MetaError("Meta chat reply has no usage.prompt_tokens")
        return ""

    return check


def _stream_call(raw: _Raw, model: str) -> ProbeCall:
    """A streamed chat reply: Server-Sent Events expected (``data: {...}`` lines, ``[DONE]``)."""
    common: dict[str, Any] = {
        "name": "chat.stream",
        "endpoint": "/chat/completions",
        "model": model,
        "status": raw.status,
        "latency_ms": raw.latency_ms,
    }
    if raw.failed:
        return ProbeCall(**common, differs=raw.failed)
    if raw.status != 200:
        return ProbeCall(**common, differs=f"HTTP {raw.status}")
    text = raw.body.decode("utf-8", errors="replace")
    events = [line[5:].strip() for line in text.splitlines() if line.startswith("data:")]
    if not events:
        return ProbeCall(**common, differs="stream=true did not answer Server-Sent Events")
    usage: Mapping[str, Any] | None = None
    keys: set[str] = set()
    for event in events:
        try:
            value = json.loads(event)
        except json.JSONDecodeError:
            continue
        if isinstance(value, Mapping):
            keys.update(str(k) for k in value)
            if isinstance(value.get("usage"), Mapping):
                usage = value["usage"]
    note = f"{len(events)} events; [DONE] {'sent' if events[-1] == '[DONE]' else 'absent'}"
    note += "; usage in stream" if usage else "; no usage in stream"
    return ProbeCall(**common, keys=tuple(sorted(keys)), usage=usage, note=note)


def _models_call(raw: _Raw) -> tuple[ProbeCall, list[str]]:
    common: dict[str, Any] = {
        "name": "models",
        "endpoint": "/models",
        "model": "",
        "status": raw.status,
        "latency_ms": raw.latency_ms,
    }
    if raw.failed:
        return ProbeCall(**common, differs=raw.failed), []
    if raw.status != 200:
        return ProbeCall(**common, differs=f"HTTP {raw.status}"), []
    try:
        reply = parse_object(raw.body, "models")
    except MetaError as exc:
        return ProbeCall(**common, differs=str(exc)), []
    data = reply.get("data")
    if not isinstance(data, list):
        return ProbeCall(**common, keys=tuple(sorted(reply)), differs="no data[] list"), []
    ids = sorted(str(m.get("id")) for m in data if isinstance(m, Mapping) and m.get("id"))
    return ProbeCall(**common, keys=tuple(sorted(reply)), note=f"{len(ids)} ids"), ids


# --- the run -------------------------------------------------------------------------------------


def run_probe(
    *,
    env: Mapping[str, str],
    post: HttpPost = urllib_post,
    get: HttpGet = urllib_get,
    timeout_s: float = REQUEST_TIMEOUT_S,
) -> dict[str, Any]:
    """Every probe call, as the report written to disk (no key in it). Needs a key in ``env``."""
    key = api_key(env)
    if not key:
        raise MetaError(f"{API_KEY_ENV} is not set")
    root = base_url(env)
    head = headers(key)

    def send(path: str, payload: Mapping[str, Any]) -> _Raw:
        body = json.dumps(payload).encode("utf-8")
        return _timed(lambda: post(root + path, head, body, timeout_s))

    models, listed = _models_call(_timed(lambda: get(root + "/models", head, timeout_s)))
    calls: list[ProbeCall] = [models]
    for model in TEXT_MODELS:
        calls.append(
            _measure(
                send(
                    "/responses", {"model": model, "input": _SAY, "max_output_tokens": TINY_TOKENS}
                ),
                "responses",
                "/responses",
                model,
                _check_responses,
            )
        )
        chat: dict[str, Any] = {
            "model": model,
            "messages": [{"role": "user", "content": _SAY}],
            "max_tokens": TINY_TOKENS,
            "stream": False,
        }
        calls.append(
            _measure(
                send("/chat/completions", chat),
                "chat",
                "/chat/completions",
                model,
                _check_chat(model),
            )
        )
        streamed = {**chat, "stream": True, "stream_options": {"include_usage": True}}
        calls.append(_stream_call(send("/chat/completions", streamed), model))

    png, wav = tiny_png(), tiny_wav()

    def segments(reply: Mapping[str, Any]) -> str:
        return f"{len(parse_segments(reply, 'black square', (16, 16)))} segments"

    calls.append(
        _measure(
            send("/responses", segment_payload(SAM_MODEL, png, "image/png", "black square")),
            "sam.image",
            "/responses",
            SAM_MODEL,
            segments,
        )
    )
    calls.append(
        _measure(
            send("/asr/transcribe", asr_payload(VOICE_MODEL, wav, "wav", {})),
            "voice.file",
            "/asr/transcribe",
            VOICE_MODEL,
            lambda r: f"{len(parse_asr(r, 'probe').turns)} turns",
        )
    )
    calls.append(
        _measure(
            send("/responses", spark_audio_payload(SPARK_AUDIO_MODEL, wav, "wav")),
            "spark.audio",
            "/responses",
            SPARK_AUDIO_MODEL,
            lambda r: f"{len(parse_spark_turns(r, 'probe').turns)} turns",
        )
    )
    fields = ["shape"]
    calls.append(
        _measure(
            send("/responses", read_payload(SPARK_MODEL, png, "image/png", "probe.png", fields)),
            "spark.read",
            "/responses",
            SPARK_MODEL,
            lambda r: f"unreadable={list(parse_reading(r, 'probe', fields).unreadable)}",
        )
    )
    return {
        "base_url": root,
        "listed": listed,
        "missing": [m for m in KNOWN_MODELS if listed and m not in listed],
        "unexpected": [m for m in listed if m not in KNOWN_MODELS],
        "calls": [c.row() for c in calls],
    }


def checklist(report: Mapping[str, Any]) -> list[str]:
    """One line per call, ``[x]`` where the clients' shape held and ``[ ]`` where it differed."""
    lines = []
    for row in report["calls"]:
        mark = "[x]" if row["ok"] else "[ ]"
        what = row.get("differs") or row.get("note") or "as assumed"
        model = f" {row['model']}" if row["model"] else ""
        lines.append(f"{mark} {row['name']}{model} ({row['latency_ms']} ms): {what}")
    for model in report["missing"]:
        lines.append(f"[ ] models: {model} is in the facts table but not listed")
    for model in report["unexpected"]:
        lines.append(f"[ ] models: {model} is listed but not in the facts table")
    return lines


def main_checkout() -> Path:
    """The main checkout's root (a worktree's probe lands beside the one vault, not in a copy)."""
    here = Path(__file__).resolve().parent
    try:
        done = subprocess.run(
            ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
            cwd=here,
            capture_output=True,
            text=True,
            timeout=10,
            check=True,
        )
        return Path(done.stdout.strip()).parent
    except (OSError, subprocess.SubprocessError):
        return here.parents[3]


def default_out() -> Path:
    return main_checkout() / ".spark" / "Spark" / "meta" / "probes"


def write_report(report: Mapping[str, Any], out: Path, now: datetime | None = None) -> Path:
    stamp = (now or datetime.now(UTC)).strftime("%Y%m%dT%H%M%SZ")
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"probe-{stamp}.json"
    path.write_text(json.dumps({"stamp": stamp, **report}, indent=2) + "\n", encoding="utf-8")
    return path


def main(
    argv: Sequence[str] | None = None,
    *,
    env: Mapping[str, str] | None = None,
    post: HttpPost = urllib_post,
    get: HttpGet = urllib_get,
) -> int:
    """``probe [--out <dir>]``: 0 when every shape held, 1 when one differed, 2 with no key."""
    import argparse
    import os

    parser = argparse.ArgumentParser(prog="python -m athena.harness.meta")
    sub = parser.add_subparsers(dest="command", required=True)
    probe = sub.add_parser("probe", help="measure Meta's API against what the clients assume")
    probe.add_argument("--out", type=Path, default=None, help="where probe-<stamp>.json goes")
    args = parser.parse_args(argv)
    env = env if env is not None else os.environ
    if not api_key(env):
        print(f"{API_KEY_ENV} is not set; the probe needs a key and opened no connection.")
        return 2
    report = run_probe(env=env, post=post, get=get)
    path = write_report(report, args.out or default_out())
    lines = checklist(report)
    print("\n".join(lines))
    differs = sum(1 for line in lines if line.startswith("[ ]"))
    print(f"{differs} difference(s); wrote {path}")
    return 1 if differs else 0


if __name__ == "__main__":
    sys.exit(main())

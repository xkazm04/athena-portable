"""voice-io / ADR 0028 (Athena's voice is set up in a studio), README section 3.1.

The voice studio's routes: the choice, a preview by ear, a transcription to compare, the install,
and the provider key. Every one is behind the token like every other route; a refusal is the one
error shape, and an absent value on the wire is ``null``, never a missing key.

``GET /voice/config``, ``PUT /voice/config``
    The choice with every engine's probe, ``ready`` and the first ``reason`` it is not. A PUT
    validates against the catalogs (``validator_failed`` for an unknown id), persists, and swaps
    the socket's backend at once.

``POST /voice/preview``
    ``{"text", "voice"}`` → raw PCM16LE mono, ``Content-Type: audio/L16;rate=<n>``, with
    ``X-Tts-Provider``, ``X-Tts-Voice`` and ``X-Tts-Elapsed-Ms``. 503 while Kokoro is not ready.
    It speaks through the engine directly, so a voice can be picked before a listener exists.

``POST /voice/transcribe?engine=whisper|openai``
    Raw PCM16LE mono 16 kHz → ``{"engine", "text", "elapsed_ms"}``. The engine defaults to the
    chosen one; 503 while it is not ready. This is how the studio compares listeners by ear.

``POST /voice/install``, ``GET /voice/install``
    ``{"component": "kokoro" | "whisper:<model>"}`` → 202 and the install state; 409 while one is
    already running. The sources are constants (:mod:`athena.channels.voice.install`).

``PUT /voice/key``, ``DELETE /voice/key?provider=openai``
    Seal or destroy the provider key. 204 either way, and the key is never echoed — not in the
    answer, not in an error, not in the ledger, which a key never goes near.
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING

from athena.channels.voice import kokoro
from athena.channels.voice.backends import VoiceBackendError
from athena.channels.voice.config import STT_ENGINES, ConfigError, VoiceStudio
from athena.channels.voice.install import InstallBusy
from athena.connectors.seal import SealUnavailable
from athena.daemon.routes import BinaryReply, RawRequest, Reply, Request, Route, error

if TYPE_CHECKING:
    from athena.daemon.server import AthenaDaemon

__all__ = [
    "CONFIG_PATH",
    "INSTALL_PATH",
    "KEY_PATH",
    "PREVIEW_PATH",
    "RAW_PATHS",
    "TRANSCRIBE_PATH",
    "voice_routes",
]

CONFIG_PATH = "/voice/config"
PREVIEW_PATH = "/voice/preview"
TRANSCRIBE_PATH = "/voice/transcribe"
INSTALL_PATH = "/voice/install"
KEY_PATH = "/voice/key"
#: The paths whose body is bytes (:class:`~athena.daemon.routes.RawRequest`).
RAW_PATHS: frozenset[str] = frozenset({TRANSCRIBE_PATH})


def get_config(studio: VoiceStudio) -> Reply:
    return 200, {"ok": True, **studio.view()}


def put_config(studio: VoiceStudio, request: Request) -> Reply:
    try:
        view = studio.update(request.body)
    except ConfigError as exc:
        return error(400, "validator_failed", str(exc))
    return 200, {"ok": True, **view}


def preview(studio: VoiceStudio, request: Request) -> Reply | BinaryReply:
    text = request.body.get("text")
    voice = str(request.body.get("voice") or studio.choice.tts_voice)
    if not isinstance(text, str) or not text.strip() or len(text) > kokoro.TEXT_CAP:
        return error(400, "validator_failed", f"text is 1 to {kokoro.TEXT_CAP} characters")
    if kokoro.find_voice(voice) is None:
        return error(400, "validator_failed", f"unknown voice {voice!r}")
    speaker, reason = studio.speaker(voice)
    if speaker is None:
        return error(503, "engine_error", reason or "Kokoro is not ready.")
    started = time.monotonic()
    try:
        pcm = b"".join(speaker.synthesize(text))
    except VoiceBackendError as exc:
        return error(503, "engine_error", str(exc))
    elapsed = int((time.monotonic() - started) * 1000)
    return BinaryReply(
        200,
        pcm,
        content_type=f"audio/L16;rate={speaker.sample_rate}",
        headers={
            "X-Tts-Provider": speaker.name,
            "X-Tts-Voice": voice,
            "X-Tts-Elapsed-Ms": str(elapsed),
        },
    )


def transcribe(studio: VoiceStudio, request: Request) -> Reply:
    engine = request.query.get("engine") or studio.choice.stt_engine
    if engine not in STT_ENGINES:
        return error(400, "validator_failed", f"unknown engine {engine!r}")
    pcm = request.raw if isinstance(request, RawRequest) else b""
    if not pcm or len(pcm) % 2:
        return error(400, "validator_failed", "the body is PCM16 mono at 16 kHz, and not empty")
    model = studio.choice.stt_model if studio.choice.stt_engine == "whisper" else None
    listener, reason = studio.listener(engine, model)
    if listener is None:
        return error(503, "engine_error", reason or f"{engine} is not ready.")
    started = time.monotonic()
    try:
        heard = listener.transcriber()
        heard.feed(pcm)
        text = heard.finish()
    except VoiceBackendError as exc:
        return error(503, "engine_error", str(exc))
    elapsed = int((time.monotonic() - started) * 1000)
    return 200, {"ok": True, "engine": engine, "text": text, "elapsed_ms": elapsed}


def start_install(studio: VoiceStudio, request: Request) -> Reply:
    component = str(request.body.get("component", ""))
    try:
        state = studio.installer.start(component)
    except InstallBusy as exc:
        return error(409, "validator_failed", str(exc))
    except ValueError as exc:
        return error(400, "validator_failed", str(exc))
    return 202, {"ok": True, **state.to_dict()}


def install_state(studio: VoiceStudio) -> Reply:
    return 200, {"ok": True, **studio.installer.state().to_dict()}


def put_key(studio: VoiceStudio, request: Request) -> Reply | BinaryReply:
    provider = str(request.body.get("provider", ""))
    key = request.body.get("key")
    try:
        studio.set_key(provider, key if isinstance(key, str) else "")
    except ConfigError as exc:
        return error(400, "validator_failed", str(exc))
    except SealUnavailable as exc:
        return error(503, "engine_error", str(exc))
    return BinaryReply(204)


def delete_key(studio: VoiceStudio, request: Request) -> Reply | BinaryReply:
    try:
        studio.delete_key(request.query.get("provider", ""))
    except ConfigError as exc:
        return error(400, "validator_failed", str(exc))
    except SealUnavailable as exc:
        return error(503, "engine_error", str(exc))
    return BinaryReply(204)


def voice_routes(daemon: AthenaDaemon, studio: VoiceStudio) -> list[Route]:
    """The studio's routes, for :meth:`RouteTable.add`."""
    return [
        Route("GET", CONFIG_PATH, lambda request: get_config(studio)),
        Route("PUT", CONFIG_PATH, lambda request: put_config(studio, request)),
        Route("POST", PREVIEW_PATH, lambda request: preview(studio, request)),
        Route("POST", TRANSCRIBE_PATH, lambda request: transcribe(studio, request)),
        Route("POST", INSTALL_PATH, lambda request: start_install(studio, request)),
        Route("GET", INSTALL_PATH, lambda request: install_state(studio)),
        Route("PUT", KEY_PATH, lambda request: put_key(studio, request)),
        Route("DELETE", KEY_PATH, lambda request: delete_key(studio, request)),
    ]

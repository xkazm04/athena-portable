"""The voice studio's routes over a real socket, with fake engines behind them.

voice-io / ADR 0028 (Athena's voice is set up in a studio), README section 3.1.

The daemon is the one ``conftest.py`` builds; the only change is the studio it is given — an
engine home under ``tmp_path`` and ``fake_engine.py`` in place of the two executables — so what
these prove is the wire: status codes, headers, the null convention, the 503s, the live swap, and
that a provider key never comes back out.
"""

from __future__ import annotations

import json
import struct
from http.client import HTTPConnection
from pathlib import Path

import pytest

from athena.channels.voice.config import VoiceStudio
from athena.channels.voice.gateway import VOICE_PATH, VoiceGateway
from athena.channels.voice.home import EngineHomes
from athena.channels.voice.ws import connect
from athena.connectors.seal import FileSeal
from athena.daemon.server import ALLOWED_METHODS, TOKEN_HEADER
from channels.conftest import VoiceClient
from channels.fake_engine import command, lay_out_kokoro, lay_out_whisper_model

from .conftest import PAGE_ORIGIN, SHELL_ORIGIN, TOKEN, Live, Response, claude_round

KEY = "sk-route-test-not-a-real-key-42"
HEART = {"tts": {"engine": "kokoro", "voice": "af_heart"}}


@pytest.fixture
def studio(tmp_path: Path) -> VoiceStudio:
    log = tmp_path / "runs.jsonl"
    return VoiceStudio(
        tmp_path / "voice",
        homes=EngineHomes(tmp_path / "personas"),
        seal=FileSeal(tmp_path / "voice" / "sealed"),
        environ={},
        kokoro_command=command("kokoro", log),
        whisper_command=command("whisper", log),
    )


@pytest.fixture
def installed(tmp_path: Path) -> Path:
    """Kokoro's model files and the base.en whisper model, as an install would leave them."""
    root = tmp_path / "personas"
    lay_out_kokoro(root)
    lay_out_whisper_model(root, "base.en")
    return root


def _raw(
    live: Live,
    path: str,
    body: bytes,
    *,
    method: str = "POST",
    origin: str = "",
    content_type: str = "audio/L16;rate=16000",
) -> Response:
    headers = {TOKEN_HEADER: TOKEN, "Content-Type": content_type}
    if origin:
        headers["Origin"] = origin
    connection = HTTPConnection(live.host, live.port, timeout=30)
    try:
        connection.request(method, path, body=body, headers=headers)
        reply = connection.getresponse()
        raw = reply.read()
        payload = json.loads(raw) if "json" in (reply.getheader("Content-Type") or "") else {}
        return Response(reply.status, dict(reply.getheaders()), payload, raw)
    finally:
        connection.close()


# -- the config ------------------------------------------------------------------------------------


def test_the_config_is_the_whole_shape_with_nulls_not_omissions(live: Live) -> None:
    reply = live.request("/voice/config")

    assert reply.status == 200
    body = reply.body
    assert {"tts", "stt", "engines", "ready", "reason", "home"} <= set(body)
    assert body["tts"] == {"engine": "kokoro", "voice": "af_heart"}
    assert body["stt"] == {"engine": "whisper", "model": "base.en"}
    assert body["ready"] is False
    assert isinstance(body["reason"], str)
    assert [(e["id"], e["direction"], e["kind"]) for e in body["engines"]] == [
        ("kokoro", "tts", "local"),
        ("whisper", "stt", "local"),
        ("openai", "stt", "cloud"),
    ]
    openai = body["engines"][2]
    assert openai["size_mb"] is None and openai["voices"] == [] and openai["models"] == []
    assert "size_mb" in body["engines"][1] and body["engines"][1]["size_mb"] is None


def test_a_put_validates_persists_and_swaps_the_socket_live(
    live: Live, installed: Path, tmp_path: Path
) -> None:
    assert live.request("/voice/config").body["ready"] is True
    gateway = live.daemon.sockets.get(VOICE_PATH)
    assert isinstance(gateway, VoiceGateway)
    assert gateway.backend is not None and gateway.backend.name == "kokoro+whisper"

    bad = live.request("/voice/config", method="PUT", json_body={**HEART, "stt": {"engine": "x"}})
    assert bad.status == 400 and bad.body["reason"] == "validator_failed"

    chosen = live.request(
        "/voice/config", method="PUT", json_body={**HEART, "stt": {"engine": "openai"}}
    )
    assert chosen.status == 200
    assert chosen.body["stt"] == {"engine": "openai", "model": None}
    assert chosen.body["ready"] is False
    assert gateway.backend is None, "the swap did not wait for a restart"
    saved = json.loads((tmp_path / "voice" / "config.json").read_text(encoding="utf-8"))
    assert saved["stt"] == {"engine": "openai", "model": None}

    # The socket now refuses a start with the studio's own sentence.
    ws = connect(live.host, live.port, VOICE_PATH, token=TOKEN, origin=SHELL_ORIGIN)
    client = VoiceClient(ws)
    try:
        client.start()
        refused = client.until("turn.error")
        assert refused["reason"] == "engine_error"
        assert refused["detail"] == chosen.body["reason"]
    finally:
        client.close()


def test_a_ready_socket_hears_and_speaks_through_the_fakes(live: Live, installed: Path) -> None:
    """The whole loop on the studio's composed backend: whisper's transcript becomes the turn,
    and the spoken line comes back as Kokoro's PCM, tagged with its generation.

    The engines were laid out *after* the daemon composed its first (empty) backend, and nobody
    opened the studio since: the press itself looks again, as it would after Personas installed.
    """
    live.register()
    live.script(claude_round("TTS: Two are late.\nTwo invoices are over thirty days."))
    ws = connect(live.host, live.port, VOICE_PATH, token=TOKEN, origin=SHELL_ORIGIN)
    client = VoiceClient(ws)
    try:
        client.start(PAGE_ORIGIN)
        client.chunks(count=4, size=3200)
        client.stop()
        heard = client.until("voice.transcript", final=True, timeout=30)
        assert heard["text"] == "Heard 6400 frames."
        speaking = client.until("voice.speaking", timeout=30)
        assert speaking["sample_rate"] == 24_000
        client.until("voice.stopped", reason="done", timeout=30)
        audio = b"".join(chunk for generation, chunk in client.audio)
        assert audio == b"Two are late. "  # the fake's WAV frames are the sentence, padded
        assert {generation for generation, _ in client.audio} == {speaking["generation"]}
    finally:
        client.close()


# -- preview -------------------------------------------------------------------------------------


def test_a_preview_is_raw_pcm_with_its_provenance_in_headers(live: Live, installed: Path) -> None:
    reply = live.request(
        "/voice/preview",
        method="POST",
        origin=SHELL_ORIGIN,
        json_body={"text": "Hello, I am Athena.", "voice": "af_heart"},
    )

    assert reply.status == 200
    assert reply.header("Content-Type") == "audio/L16;rate=24000"
    assert reply.header("X-Tts-Provider") == "kokoro"
    assert reply.header("X-Tts-Voice") == "af_heart"
    assert int(reply.header("X-Tts-Elapsed-Ms")) >= 0
    assert reply.raw == b"Hello, I am Athena. "
    exposed = reply.header("Access-Control-Expose-Headers")
    assert {"X-Tts-Provider", "X-Tts-Voice", "X-Tts-Elapsed-Ms"} <= set(exposed.split(", "))


@pytest.mark.parametrize(
    "body",
    [
        {"text": "", "voice": "af_heart"},
        {"text": "x" * 1201, "voice": "af_heart"},
        {"text": "Hi.", "voice": "af_nobody"},
        {"voice": "af_heart"},
    ],
)
def test_a_preview_outside_the_bounds_is_a_400(live: Live, installed: Path, body: dict) -> None:  # type: ignore[type-arg]
    reply = live.request("/voice/preview", method="POST", json_body=body)
    assert reply.status == 400
    assert reply.body["reason"] == "validator_failed"


def test_a_preview_with_no_engine_is_a_503_naming_what_is_missing(live: Live) -> None:
    reply = live.request(
        "/voice/preview", method="POST", json_body={"text": "Hello.", "voice": "af_heart"}
    )
    assert reply.status == 503
    assert reply.body["reason"] == "engine_error"
    assert "model.onnx is missing" in reply.body["detail"]


# -- transcribe ----------------------------------------------------------------------------------


def test_transcribe_takes_raw_pcm_and_answers_text_and_latency(live: Live, installed: Path) -> None:
    pcm = struct.pack("<4800h", *([0] * 4800))
    reply = _raw(live, "/voice/transcribe?engine=whisper", pcm)

    assert reply.status == 200
    assert reply.body["engine"] == "whisper"
    assert reply.body["text"] == "Heard 4800 frames."
    assert isinstance(reply.body["elapsed_ms"], int)


def test_transcribe_refuses_an_unknown_engine_an_empty_body_and_an_unready_engine(
    live: Live, installed: Path
) -> None:
    assert _raw(live, "/voice/transcribe?engine=deepgram", b"\x00\x00").status == 400
    assert _raw(live, "/voice/transcribe?engine=whisper", b"").status == 400
    cloud = _raw(live, "/voice/transcribe?engine=openai", bytes(6400))
    assert cloud.status == 503
    assert cloud.body["reason"] == "engine_error"
    assert "OpenAI key" in cloud.body["detail"]


# -- install -------------------------------------------------------------------------------------


def test_install_answers_202_and_its_state_and_refuses_an_unknown_component(
    live: Live, studio: VoiceStudio
) -> None:
    unknown = live.request("/voice/install", method="POST", json_body={"component": "piper"})
    assert unknown.status == 400

    studio.installer.platform = "linux"
    started = live.request("/voice/install", method="POST", json_body={"component": "kokoro"})
    assert started.status == 202
    assert started.body["state"] == "manual"
    state = live.request("/voice/install").body
    assert {k: state[k] for k in ("component", "state", "received_bytes", "total_bytes")} == {
        "component": "kokoro",
        "state": "manual",
        "received_bytes": 0,
        "total_bytes": None,
    }


def test_a_second_install_while_one_runs_is_a_409(live: Live, studio: VoiceStudio) -> None:
    from athena.channels.voice.install import InstallState

    with studio.installer._lock:  # a run in flight, without a network
        studio.installer._state = InstallState("kokoro", "downloading_model", 10, 100)
    reply = live.request("/voice/install", method="POST", json_body={"component": "kokoro"})
    assert reply.status == 409
    assert reply.body["reason"] == "validator_failed"
    assert live.request("/voice/install").body["received_bytes"] == 10


# -- the key -------------------------------------------------------------------------------------


def test_the_key_is_sealed_with_a_204_and_never_comes_back_out(
    live: Live, installed: Path, tmp_path: Path
) -> None:
    put = live.request("/voice/key", method="PUT", json_body={"provider": "openai", "key": KEY})
    assert put.status == 204 and put.raw == b""

    switched = live.request(
        "/voice/config", method="PUT", json_body={**HEART, "stt": {"engine": "openai"}}
    )
    assert switched.body["ready"] is True
    for path in ("/voice/config", "/health", "/ledger", "/voice/install"):
        assert KEY not in live.request(path).text, f"{path} leaked the key"
    assert KEY not in switched.text

    bad = live.request("/voice/key", method="PUT", json_body={"provider": "nobody", "key": KEY})
    assert bad.status == 400 and KEY not in bad.text

    gone = live.request("/voice/key?provider=openai", method="DELETE")
    assert gone.status == 204
    assert live.request("/voice/config").body["ready"] is False


def test_the_preflight_allows_the_new_verbs(live: Live) -> None:
    reply = live.request("/voice/key", method="OPTIONS", token=None, origin=SHELL_ORIGIN)
    assert reply.status == 204
    assert reply.header("Access-Control-Allow-Methods") == ALLOWED_METHODS
    assert "PUT" in ALLOWED_METHODS and "DELETE" in ALLOWED_METHODS


def test_every_voice_route_wants_the_token(live: Live) -> None:
    for method, path in (
        ("GET", "/voice/config"),
        ("PUT", "/voice/config"),
        ("POST", "/voice/preview"),
        ("POST", "/voice/transcribe"),
        ("POST", "/voice/install"),
        ("GET", "/voice/install"),
        ("PUT", "/voice/key"),
        ("DELETE", "/voice/key"),
    ):
        assert live.request(path, method=method, token=None).status == 401, f"{method} {path}"

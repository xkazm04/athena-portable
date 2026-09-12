"""Voice: a WebSocket on the daemon's port, around the one lane (ADR 0019; README §3.2).

Voice is a transport and not a feature, and that is the claim: one held key becomes one utterance,
the utterance runs the *same* browser-lane turn ``POST /run`` streams — same gate, same writer
lock, same events — and the reply's spoken line follows the ``TTS:`` rule. Then the other half:
a spoken "approve" is not a message to the model at all. It takes the button's path through
``POST /decisions/<id>``, so what is asserted afterwards is the approval table and the ledger and
not anything about the socket.

The client is the client half of the daemon's own framing (``channels/voice/ws.connect``): no
dependency, and the same handshake a browser performs, with the token on the subprotocol the way
a page that cannot set a header sends it.
"""

from __future__ import annotations

import json
import time
from typing import Any

from athena.channels.voice.gateway import VOICE_PATH
from athena.channels.voice.ws import WebSocket, connect

from .conftest import APP_ID, PAGE_ORIGIN, Daemon, Spawn, claude_round, op

#: 20 ms of silence at 16 kHz PCM16 — the shape push-to-talk sends, and enough for the scripted
#: transcriber to be fed at all.
CHUNK = b"\x00" * 640
SPOKEN = "Three invoices are past thirty days."
VISIBLE = "I will need your approval for that."


def _connect(daemon: Daemon) -> WebSocket:
    """The voice socket, with the token on the subprotocol the way a browser page sends it."""
    return connect(daemon.host, daemon.port, VOICE_PATH, token=daemon.token, timeout=60.0)


def _speak(ws: WebSocket, utterance_chunks: int = 2) -> None:
    """One held key: down, audio, up."""
    ws.send_text(json.dumps({"type": "start", "origin": PAGE_ORIGIN, "host_state": {}}))
    for _ in range(utterance_chunks):
        ws.send_binary(CHUNK)
    ws.send_text(json.dumps({"type": "stop"}))


def _until(ws: WebSocket, kind: str, *, seen: list[dict[str, Any]], limit_s: float = 60.0) -> dict:
    """Read frames until one of ``kind`` arrives. Audio frames are counted, not decoded."""
    deadline = time.monotonic() + limit_s
    while time.monotonic() < deadline:
        message = ws.recv()
        if message is None:
            raise AssertionError(f"the socket closed before {kind}; saw {_kinds(seen)}")
        if message.kind == "binary":
            seen.append({"kind": "audio", "bytes": len(message.data)})
            continue
        payload = json.loads(message.text)
        seen.append(payload)
        if payload.get("kind") == kind:
            return payload
    raise AssertionError(f"no {kind} frame within {limit_s}s; saw {_kinds(seen)}")


def _kinds(seen: list[dict[str, Any]]) -> list[str]:
    return [str(frame.get("kind")) for frame in seen]


def test_one_spoken_utterance_runs_a_turn_and_the_answer_is_spoken_by_the_tts_rule(
    spawn: Spawn,
) -> None:
    daemon = spawn.scripted(
        [claude_round(f'{VISIBLE}\nTTS: "{SPOKEN}"')],
        voice="scripted",
        utterances=["what is overdue?"],
    )
    assert daemon.ready["voice"] == "scripted"
    assert daemon.request("/health").body["sockets"] == ["/voice"]
    daemon.register()

    ws = _connect(daemon)
    try:
        _speak(ws)
        seen: list[dict[str, Any]] = []
        transcript = _until(ws, "voice.transcript", seen=seen)
        assert transcript["text"] == "what is overdue?"
        assert transcript["final"] is True

        finished = _until(ws, "turn.finished", seen=seen)
        assert finished["text"] == VISIBLE
        assert finished["tts"] == SPOKEN

        speaking = _until(ws, "voice.speaking", seen=seen)
        # The ``TTS:`` line is what is spoken, and it is not the visible text.
        assert speaking["text"] == SPOKEN
        assert speaking["truncated"] is False
        assert speaking["sample_rate"] > 0

        stopped = _until(ws, "voice.stopped", seen=seen)
        assert stopped["reason"] == "done"
        assert stopped["generation"] == speaking["generation"]
        assert any(frame["kind"] == "audio" for frame in seen), "no audio was played"
        assert "turn.summary" in _kinds(seen)
    finally:
        ws.close()

    # The same lane, the same ledger, and the two words that say where it came from.
    row = daemon.request("/ledger").body["rows"][0]
    assert (row["surface"], row["trigger"]) == ("voice", "voice")
    assert row["origin"] == f"host:{APP_ID}"
    assert row["is_error"] is False


def test_a_spoken_answer_resolves_a_pending_card_through_the_route_a_button_uses(
    spawn: Spawn,
) -> None:
    daemon = spawn.scripted(
        [
            claude_round(
                f'{VISIBLE}\nTTS: "{SPOKEN}"\n'
                + op("host.invoices.pay", "the invoice the user named", invoice="7")
            ),
            claude_round("It is paid."),
        ],
        voice="scripted",
        utterances=["pay invoice seven", "approve"],
    )
    daemon.register()

    ws = _connect(daemon)
    try:
        _speak(ws)
        seen: list[dict[str, Any]] = []
        card = _until(ws, "decision.requested", seen=seen)
        approval_id = str(card["id"])
        _until(ws, "turn.finished", seen=seen)
        assert daemon.request("/decisions").body["total"] == 1

        # The second utterance is one word, and it is not a message for the model.
        _speak(ws)
        answered: list[dict[str, Any]] = []
        resolved = _until(ws, "decision.resolved", seen=answered)
        assert resolved["id"] == approval_id
        assert resolved["choice"] == "approve"
        assert resolved["by"] == "user"

        # The execute leaves as a ``tool.call`` for the page, carrying the row's parameters.
        call = _until(ws, "tool.call", seen=answered)
        assert call["name"] == f"host.{APP_ID}.pay"
        assert call["params"] == {"invoice": "7"}
        ws.send_text(
            json.dumps(
                {
                    "type": "tool_result",
                    "call_id": call["call_id"],
                    "name": call["name"],
                    "ok": True,
                    "output": "paid",
                    "tier": 1,
                }
            )
        )
        assert _until(ws, "turn.finished", seen=answered)["text"] == "It is paid."
    finally:
        ws.close()

    # What is asserted is the approval table and the ledger, not the transport: the card is
    # answered, a second answer is refused exactly as it is over HTTP, and the continuation was
    # ledgered as another voice turn.
    assert daemon.request("/decisions").body["total"] == 0
    second = daemon.decide(approval_id, "decline")
    assert second.status == 409
    assert second.body["reason"] == "pending_approval"
    surfaces = daemon.request("/ledger/rollup?by=surface").body["rollup"]
    assert [row["key"] for row in surfaces] == ["voice"]
    assert surfaces[0]["turns"] == 2, "the utterance and the continuation, one row each"

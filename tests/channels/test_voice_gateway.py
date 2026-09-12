"""``/voice``: one utterance is one turn, over a real socket, on a scripted engine and a scripted
backend (channels/voice/gateway.py; README §3.2; ADR 0019).

Everything but the CLI process and the microphone is real — the WebSocket, the token, the brain,
the gate, the approval table, the ledger and the lane — so what these prove is what the shell's
push-to-talk gets: a transcript, the turn's own events, a spoken line, a barge-in that stops it,
and a card answered by voice through the same route as a button.
"""

from __future__ import annotations

import json
import time

import pytest

from athena.channels.voice.backends import ScriptedBackend
from athena.channels.voice.gateway import VOICE_PATH
from athena.channels.voice.tts import TTS_CAP
from athena.channels.voice.ws import HandshakeError, connect
from daemon.conftest import PAGE_ORIGIN, SHELL_ORIGIN, TOKEN, Live, claude_round, op

from .conftest import VoiceClient


def _settle(seconds: float = 0.3) -> None:
    """Give a worker thread the time it would need to do the thing the test says it must not."""
    time.sleep(seconds)


# -- the door ----------------------------------------------------------------------------------


def test_the_socket_is_refused_without_the_token(voiced: Live) -> None:
    with pytest.raises(HandshakeError) as refused:
        connect(voiced.host, voiced.port, VOICE_PATH, token="", origin=SHELL_ORIGIN)
    assert refused.value.status == 401
    assert json.loads(refused.value.body)["reason"] == "foreign_token"


def test_the_token_may_ride_the_header_instead_of_the_subprotocol(voiced: Live) -> None:
    ws = connect(voiced.host, voiced.port, VOICE_PATH, token=TOKEN, header_token=True)
    ws.close()


def test_an_origin_cors_would_not_allow_may_not_open_a_socket(voiced: Live) -> None:
    with pytest.raises(HandshakeError) as refused:
        connect(voiced.host, voiced.port, VOICE_PATH, token=TOKEN, origin="https://evil.example")
    assert refused.value.status == 403
    assert json.loads(refused.value.body)["reason"] == "foreign_origin"


def test_a_daemon_with_no_backend_has_no_socket(live: Live) -> None:
    with pytest.raises(HandshakeError) as refused:
        connect(live.host, live.port, VOICE_PATH, token=TOKEN)
    assert refused.value.status == 404
    assert live.request("/health").body["sockets"] == []


def test_health_names_the_socket(voiced: Live) -> None:
    assert voiced.request("/health").body["sockets"] == [VOICE_PATH]


# -- one utterance ---------------------------------------------------------------------------


def test_one_utterance_is_one_turn_one_ledger_row_and_one_spoken_line(
    voiced: Live, backend: ScriptedBackend, client: VoiceClient
) -> None:
    voiced.register()
    voiced.script(claude_round("TTS: Two are late.\nTwo invoices are over thirty days."))
    backend.utterances = ["what is overdue"]

    client.utter()
    stopped = client.until("voice.stopped")

    assert client.kinds() == [
        "voice.transcript",
        "text.delta",
        "turn.summary",
        "turn.finished",
        "voice.speaking",
        "voice.stopped",
    ]
    assert client.of("voice.transcript")[0] == {
        "kind": "voice.transcript",
        "text": "what is overdue",
        "final": True,
    }
    assert client.of("turn.finished")[0]["tts"] == "Two are late."
    speaking = client.of("voice.speaking")[0]
    assert (speaking["text"], speaking["truncated"], speaking["generation"]) == (
        "Two are late.",
        False,
        1,
    )
    assert speaking["sample_rate"] == backend.sample_rate
    assert stopped == {"kind": "voice.stopped", "generation": 1, "reason": "done"}
    assert [generation for generation, _ in client.audio] == [1] * backend.chunks_per_text
    assert backend.spoken == ["Two are late."]

    rows = voiced.daemon.ledger.recent(10).rows
    assert len(rows) == 1
    assert (rows[0].surface, rows[0].trigger, rows[0].origin) == (
        "voice",
        "voice",
        "host:invoices",
    )
    assert len(voiced.transport.requests) == 1


def test_a_typed_utterance_takes_the_same_path(voiced: Live, client: VoiceClient) -> None:
    voiced.register()
    voiced.script(claude_round("Nothing is overdue."))

    client.say("what is overdue")
    finished = client.until("turn.finished")

    assert finished["text"] == "Nothing is overdue."
    assert client.of("voice.transcript")[0]["text"] == "what is overdue"
    # No TTS line and short text: the text itself is spoken, whole.
    assert client.until("voice.speaking")["text"] == "Nothing is overdue."


def test_silence_starts_no_turn(
    voiced: Live, backend: ScriptedBackend, client: VoiceClient
) -> None:
    voiced.register()
    backend.utterances = ["   "]

    client.utter()
    client.until("voice.transcript", final=True)
    _settle()

    assert client.kinds() == ["voice.transcript"]
    assert voiced.transport.requests == []


def test_an_origin_with_no_session_is_refused_in_the_gates_word(client: VoiceClient) -> None:
    client.say("hello", origin="https://nowhere.example")
    refused = client.until("turn.error")
    assert refused["reason"] == "foreign_origin"


# -- barge-in ----------------------------------------------------------------------------------


def test_a_barge_in_cancels_playback_and_does_not_start_a_second_turn(
    voiced: Live, backend: ScriptedBackend, client: VoiceClient
) -> None:
    voiced.register()
    voiced.script(claude_round("TTS: Here is a very long answer about every invoice.\nLong."))
    backend.utterances = ["what is overdue", "stop"]
    backend.chunk_delay_s = 0.05
    backend.chunks_per_text = 40

    client.utter()
    client.until("voice.speaking", generation=1)
    # The user presses the key over the reply and says "stop".
    client.utter()

    stopped = client.until("voice.stopped", generation=1)
    assert stopped["reason"] == "barge_in"
    assert client.until("voice.transcript", final=True, text="stop")
    _settle()

    assert len([g for g, _ in client.audio if g == 1]) < backend.chunks_per_text
    assert len(voiced.transport.requests) == 1, "the stop word was not sent to the model"
    assert len(voiced.daemon.ledger.recent(10).rows) == 1
    assert client.of("voice.speaking") == client.of("voice.speaking")[:1]


def test_new_speech_during_playback_is_a_barge_in_and_the_next_utterance_is_a_turn(
    voiced: Live, backend: ScriptedBackend, client: VoiceClient
) -> None:
    """An open microphone: the key is already down when the reply starts, and the first partial
    the backend hears is what stops it."""
    voiced.register()
    voiced.script(
        claude_round("TTS: Two are late.\nTwo invoices are over thirty days."),
        claude_round("TTS: One contact.\nThe CRM has one conflicting contact."),
    )
    backend.utterances = ["what is overdue", ("and the crm", ["and"])]
    backend.chunk_delay_s = 0.05
    backend.chunks_per_text = 40

    client.utter()
    client.start()  # the key goes down again before the reply has begun
    client.until("voice.speaking", generation=1)
    client.chunks(1)  # ...and the backend hears "and" over it
    assert client.until("voice.stopped", generation=1)["reason"] == "barge_in"
    assert client.until("voice.transcript", final=False)["text"] == "and"

    client.stop()
    finished = client.until("turn.finished", text="The CRM has one conflicting contact.")
    assert finished["tts"] == "One contact."
    assert client.until("voice.speaking", generation=2)["text"] == "One contact."
    assert len(voiced.daemon.ledger.recent(10).rows) == 2


def test_a_stop_word_into_silence_is_a_message(voiced: Live, client: VoiceClient) -> None:
    voiced.register()
    voiced.script(claude_round("Stopped what?"))
    client.say("stop")
    assert client.until("turn.finished")["text"] == "Stopped what?"


# -- the spoken line ---------------------------------------------------------------------------


def test_a_reply_longer_than_the_cap_is_spoken_truncated_and_announced(
    voiced: Live, backend: ScriptedBackend, client: VoiceClient
) -> None:
    voiced.register()
    long = "word " * 400  # 2000 characters, no TTS line
    voiced.script(claude_round(long))

    client.say("tell me everything")
    speaking = client.until("voice.speaking")

    assert speaking["truncated"] is True
    total = len(long.strip())
    assert speaking["text"].endswith(f"(showing {TTS_CAP} of {total})")
    assert backend.spoken == [speaking["text"]]


def test_a_backend_that_cannot_speak_says_so_and_the_turn_still_stands(
    voiced: Live, backend: ScriptedBackend, client: VoiceClient
) -> None:
    voiced.register()
    voiced.script(claude_round("TTS: Hello.\nHello."))
    backend.fail_synthesis = True

    client.say("hi")
    assert client.until("voice.stopped")["reason"] == "error"
    assert len(voiced.daemon.ledger.recent(10).rows) == 1


# -- a card, by voice ------------------------------------------------------------------------


def _file_a_card(voiced: Live, client: VoiceClient) -> dict[str, object]:
    voiced.register()
    voiced.script(
        claude_round(
            "I will need your approval for that.\n"
            + op("host.invoices.pay", "the invoice the user named", invoice="7")
        )
    )
    client.say("pay invoice 7")
    # The gate lets the proposal through as a call, refuses it pending approval in the same
    # turn, and files the card. Nothing ran, and the refused call is not the page's to run.
    proposed = client.until("tool.call", name="host.invoices.pay")
    refused = client.until("tool.result", call_id=proposed["call_id"])
    assert (refused["ok"], refused["error"]) == (False, "pending_approval")
    card = client.until("decision.requested")
    client.until("turn.finished")
    assert card["tool"] == "athena_decision"
    assert card["surface"] == "voice"
    return card


def test_a_spoken_approve_answers_the_card_and_the_page_runs_the_execute(
    voiced: Live, backend: ScriptedBackend, client: VoiceClient
) -> None:
    card = _file_a_card(voiced, client)
    voiced.script(claude_round("TTS: Paid.\nInvoice 7 is paid."))
    backend.utterances = ["approve"]

    client.utter()
    resolved = client.until("decision.resolved")
    assert (resolved["id"], resolved["choice"], resolved["by"]) == (card["id"], "approve", "user")
    assert client.until("voice.speaking", text="Approved.")

    # The approval replays the gate and the page is told to run it, with the row's parameters.
    call = client.until("tool.call", name="host.invoices.pay")
    assert call["params"] == {"invoice": "7"}
    assert call["origin"] == "host:invoices"
    client.tool_result(call, output="paid")
    finished = client.until("turn.finished", text="Invoice 7 is paid.")
    assert finished["tts"] == "Paid."
    assert client.until("voice.speaking", text="Paid.")

    assert not any(row.id == card["id"] for row in voiced.daemon.approvals.pending(10).rows)
    rows = voiced.daemon.ledger.recent(10).rows
    assert [row.trigger for row in rows] == ["voice", "voice"], "an approval is not a model call"
    assert len(voiced.transport.requests) == 2, "the card's turn and the continuation"
    # The continuation carried the page's answer, not the user's words repeated.
    assert "paid" in voiced.transport.requests[1].stdin


def test_a_spoken_no_declines_it_and_nothing_runs(
    voiced: Live, backend: ScriptedBackend, client: VoiceClient
) -> None:
    card = _file_a_card(voiced, client)
    backend.utterances = ["no"]

    client.utter()
    resolved = client.until("decision.resolved")
    assert (resolved["id"], resolved["choice"]) == (card["id"], "decline")
    assert client.until("voice.speaking", text="Declined.")
    _settle()

    assert "tool.call" not in client.kinds()[client.kinds().index("decision.resolved") :]
    assert not any(row.id == card["id"] for row in voiced.daemon.approvals.pending(10).rows)
    assert len(voiced.transport.requests) == 1
    denied = [row for row in voiced.daemon.ledger.recent(10).rows if row.trigger == "decision"]
    assert denied and denied[0].error_reason == "user_denied"


def test_a_card_from_the_inbox_is_answerable_by_a_fresh_socket(
    voiced: Live, backend: ScriptedBackend, client: VoiceClient
) -> None:
    """The card was filed by the panel; the voice socket that answers it was never shown it."""
    card = _file_a_card(voiced, client)
    fresh = VoiceClient(
        connect(voiced.host, voiced.port, VOICE_PATH, token=TOKEN, origin=SHELL_ORIGIN)
    )
    try:
        backend.utterances = ["decline"]
        fresh.utter()
        assert fresh.until("decision.resolved")["id"] == card["id"]
    finally:
        fresh.close()


# -- the page's answers ------------------------------------------------------------------------


def test_a_host_tool_call_waits_for_the_page_and_the_turn_continues(
    voiced: Live, client: VoiceClient
) -> None:
    voiced.register()
    voiced.script(
        claude_round("Reading.\n" + op("host.invoices.chase", "draft it", invoice="3")),
        claude_round("TTS: Drafted.\nThe chase for invoice 3 is drafted."),
    )

    client.say("chase invoice 3")
    call = client.until("tool.call", name="host.invoices.chase")
    assert call["origin"] == "host:invoices"
    client.until("turn.finished", text="Reading.")
    client.tool_result(call, output="draft d_1 saved")

    finished = client.until("turn.finished", text="The chase for invoice 3 is drafted.")
    assert finished["tts"] == "Drafted."
    assert len(voiced.transport.requests) == 2
    assert "draft d_1 saved" in voiced.transport.requests[1].stdin


def test_a_page_that_never_answers_carries_the_timeout_into_the_next_utterance(
    voiced: Live, client: VoiceClient
) -> None:
    voiced.register()
    voiced.script(
        claude_round("Reading.\n" + op("host.invoices.chase", "draft it", invoice="3")),
        claude_round("Then nothing was drafted."),
    )

    client.say("chase invoice 3")
    client.until("tool.call", name="host.invoices.chase")
    client.until("turn.finished", text="Reading.")
    _settle(0.8)  # past the test's result timeout
    assert len(voiced.transport.requests) == 1, "no continuation on an unanswered call"

    client.say("and then?")
    client.until("turn.finished", text="Then nothing was drafted.")
    assert len(voiced.transport.requests) == 2
    assert "timeout" in voiced.transport.requests[1].stdin


def test_a_malformed_control_frame_is_refused_not_fatal(voiced: Live, client: VoiceClient) -> None:
    voiced.register()
    client.ws.send_text("not json")
    assert client.until("turn.error")["reason"] == "parse_error"
    client.send(type="dance")
    assert client.until("turn.error")["reason"] == "validator_failed"
    voiced.script(claude_round("Still here."))
    client.say("hello")
    assert client.until("turn.finished")["text"] == "Still here."


def test_hanging_up_mid_turn_still_writes_the_row(
    voiced: Live, backend: ScriptedBackend, client: VoiceClient
) -> None:
    voiced.register()
    voiced.script(claude_round("TTS: Gone.\nThe caller left."))
    backend.chunk_delay_s = 0.05
    backend.chunks_per_text = 40

    client.say("hello")
    client.until("voice.speaking")
    client.close()
    _settle(0.5)

    rows = voiced.daemon.ledger.recent(10).rows
    assert len(rows) == 1 and rows[0].surface == "voice"
    assert PAGE_ORIGIN in voiced.daemon.sessions

"""``/voice``: one utterance is one turn, over a real socket, on a scripted engine and a scripted
backend (channels/voice/gateway.py; README §3.2; ADR 0019).

Everything but the CLI process and the microphone is real — the WebSocket, the token, the brain,
the gate, the approval table, the ledger and the lane — so what these prove is what the shell's
push-to-talk gets: a transcript, the turn's own events, a spoken line, a barge-in that stops it,
and a card answered by voice through the same route as a button.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from collections.abc import Callable, Iterator, Sequence

import pytest

from athena.channels.voice import gateway as gateway_module
from athena.channels.voice.backends import ScriptedBackend
from athena.channels.voice.gateway import (
    MAX_PENDING_TURNS,
    MAX_SESSIONS,
    VOICE_PATH,
    VoiceGateway,
    VoiceSession,
)
from athena.channels.voice.tts import TTS_CAP
from athena.channels.voice.ws import HandshakeError, connect
from athena.contracts import ToolCall
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


def test_a_daemon_whose_voice_is_not_set_up_still_has_the_socket_and_says_why(live: Live) -> None:
    """ADR 0028: the socket is always there; a ``start`` with nothing to hear on is refused with
    ``engine_error`` and the studio's own first sentence, and no turn runs."""
    assert live.request("/health").body["sockets"] == [VOICE_PATH]
    reason = live.request("/voice/config").body["reason"]
    assert reason and reason.startswith("Kokoro is not installed")
    ws = connect(live.host, live.port, VOICE_PATH, token=TOKEN, origin=SHELL_ORIGIN)
    client = VoiceClient(ws)
    try:
        client.start()
        refused = client.until("turn.error")
        assert refused["reason"] == "engine_error"
        assert refused["detail"] == reason
        client.chunks()
        client.stop()
        _settle()
        assert client.kinds() == ["turn.error"]
    finally:
        client.close()


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
    # ``voice.speaking`` goes out before the backend is first pulled; the line is the backend's
    # record only once playback has run, so read it after the stop, not racing the speaker.
    client.until("voice.stopped", generation=speaking["generation"])
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


def _speaker_records(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    return [r for r in caplog.records if r.name == "athena.channels.voice.gateway"]


def test_a_synthesis_that_raises_ends_that_line_and_the_next_is_spoken(
    voiced: Live,
    backend: ScriptedBackend,
    client: VoiceClient,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    voiced.register()
    voiced.script(claude_round("TTS: First.\nFirst."), claude_round("TTS: Second.\nSecond."))
    real = backend.synthesize
    calls: list[str] = []

    def flaky(text: str) -> Iterator[bytes]:
        calls.append(text)
        if len(calls) == 1:
            raise RuntimeError("engine fell over")
        return real(text)

    monkeypatch.setattr(backend, "synthesize", flaky)
    with caplog.at_level("ERROR", logger="athena.channels.voice.gateway"):
        client.say("one")
        assert client.until("voice.stopped", generation=1)["reason"] == "error"
        client.say("two")
        assert client.until("voice.stopped", generation=2)["reason"] == "done"

    assert calls == ["First.", "Second."]
    assert backend.spoken == ["Second."]
    records = _speaker_records(caplog)
    assert len(records) == 1
    assert records[0].exc_info is not None
    assert "1" in records[0].getMessage()
    assert "First" not in caplog.text
    assert "First." not in records[0].getMessage()


def test_a_synthesis_that_raises_after_a_chunk_ends_that_line_and_the_next_is_spoken(
    voiced: Live,
    backend: ScriptedBackend,
    client: VoiceClient,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    voiced.register()
    voiced.script(claude_round("TTS: First.\nFirst."), claude_round("TTS: Second.\nSecond."))
    real = backend.synthesize
    calls: list[str] = []

    def breaks_midway(text: str) -> Iterator[bytes]:
        calls.append(text)
        if len(calls) > 1:
            yield from real(text)
            return
        yield bytes(backend.chunk_bytes)
        raise RuntimeError("connection dropped mid-line")

    monkeypatch.setattr(backend, "synthesize", breaks_midway)
    with caplog.at_level("ERROR", logger="athena.channels.voice.gateway"):
        client.say("one")
        assert client.until("voice.stopped", generation=1)["reason"] == "error"
        client.say("two")
        assert client.until("voice.stopped", generation=2)["reason"] == "done"

    assert backend.spoken == ["Second."]
    assert len(_speaker_records(caplog)) == 1


def test_an_engine_refusal_is_not_logged_as_an_error(
    voiced: Live,
    backend: ScriptedBackend,
    client: VoiceClient,
    caplog: pytest.LogCaptureFixture,
) -> None:
    voiced.register()
    voiced.script(claude_round("TTS: Hello.\nHello."))
    backend.fail_synthesis = True
    with caplog.at_level("ERROR", logger="athena.channels.voice.gateway"):
        client.say("hi")
        assert client.until("voice.stopped")["reason"] == "error"
    assert _speaker_records(caplog) == []


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


def test_a_spoken_approve_is_replayed_against_the_list_current_when_the_user_spoke(
    voiced: Live, backend: ScriptedBackend, client: VoiceClient
) -> None:
    """The shell says the switched-off list on every request. A card filed while the app was on,
    approved by a voice utterance that lists the app, is refused ``foreign_origin`` and the page
    is never told to run it."""
    _file_a_card(voiced, client)
    backend.utterances = ["approve"]

    client.utter(disabled_origins=["host:invoices"])
    refused = client.until("turn.error")
    _settle()

    assert refused["reason"] == "foreign_origin"
    assert "decision.resolved" not in client.kinds()
    assert "tool.call" not in client.kinds()[client.kinds().index("turn.error") :]


def test_a_voice_turn_whose_utterance_lists_the_app_is_refused_that_apps_tools(
    voiced: Live, client: VoiceClient
) -> None:
    voiced.register()
    voiced.script(
        claude_round(op("host.invoices.chase", invoice="7")),
        claude_round("That app is switched off."),
    )

    client.say("chase invoice 7", disabled_origins=["host:invoices"])
    refused = client.until("tool.result")
    client.until("turn.finished")

    assert refused["error"] == "foreign_origin"
    assert "decision.requested" not in client.kinds()


def test_a_spoken_turn_carries_first_sight_from_the_key_down_to_the_gate(
    voiced: Live, backend: ScriptedBackend, client: VoiceClient
) -> None:
    """ADR 0063: the start frame's ``gated_origins`` rides the utterance to its turn, so the
    page's ``AUTO`` tool on an app the user never registered files a card instead of running."""
    voiced.register()
    voiced.script(claude_round(op("host.invoices.chase", invoice="7")))
    backend.utterances = ["chase invoice 7"]

    client.utter(gated_origins=["host:invoices"])
    card = client.until("decision.requested")
    refused = client.until("tool.result")
    client.until("turn.finished")

    assert card["action"] == "host.invoices.chase"
    assert refused["error"] == "pending_approval"
    assert voiced.daemon.approvals.pending(10).total == 1


def test_a_typed_voice_turn_carries_the_users_pins_to_the_gate(
    voiced: Live, client: VoiceClient
) -> None:
    voiced.register()
    voiced.script(
        claude_round(op("host.invoices.chase", invoice="7")),
        claude_round(op("host.invoices.chase", invoice="8")),
        claude_round("The chase for invoice 8 is drafted."),
    )

    client.say("chase invoice 7", gated_tools=["host.invoices.chase"])
    refused = client.until("tool.result")
    client.until("turn.finished")
    assert refused["error"] == "pending_approval"
    assert "decision.requested" in client.kinds()

    # The next utterance names no pin, and its call is the page's to run: nothing was kept.
    client.say("chase invoice 8")
    call = client.until("tool.call", params={"invoice": "8"})
    assert voiced.daemon.approvals.pending(10).total == 1
    client.tool_result(call, output="drafted")
    client.until("turn.finished", text="The chase for invoice 8 is drafted.")


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


def test_a_spoken_and_a_typed_turn_file_a_card_that_carries_the_shells_capture(
    voiced: Live, backend: ScriptedBackend, client: VoiceClient
) -> None:
    """ADR 0066: the capture id on the start frame and on a text frame reaches the gate."""
    capture = "cap_0123456789ab"
    voiced.register()
    voiced.script(
        claude_round(op("host.invoices.pay", invoice="7")),
        claude_round(op("host.invoices.pay", invoice="8")),
    )
    backend.utterances = ["pay invoice 7"]

    client.utter(capture_id=capture)
    spoken = client.until("decision.requested")
    client.until("turn.finished")
    client.say("pay invoice 8", capture_id=capture)
    typed = client.until("decision.requested", params={"invoice": "8"})
    client.until("turn.finished")

    assert spoken["capture_id"] == typed["capture_id"] == capture


def test_a_voice_frame_with_a_list_past_its_cap_is_refused_not_cut(
    voiced: Live, client: VoiceClient
) -> None:
    voiced.register()

    client.say("pay", gated_tools=[f"host.invoices.t{i}" for i in range(5000)])
    error = client.until("turn.error")

    assert error["reason"] == "validator_failed"
    assert "gated_tools" in error["detail"]


# -- the utterance ceiling -----------------------------------------------------------------------


def test_the_utterance_ceiling_is_the_http_twins_body_cap() -> None:
    from athena.channels.voice.backends import MAX_UTTERANCE_BYTES
    from athena.daemon.server import MAX_RAW_BODY_BYTES

    assert MAX_UTTERANCE_BYTES == MAX_RAW_BODY_BYTES == 4_194_304


def test_frames_past_the_ceiling_drop_the_utterance_once_and_the_next_one_works(
    voiced: Live, backend: ScriptedBackend, client: VoiceClient
) -> None:
    from athena.channels.voice.backends import MAX_UTTERANCE_BYTES, ScriptedTranscriber

    voiced.register()
    made: list[ScriptedTranscriber] = []
    real = backend.transcriber

    def recording() -> ScriptedTranscriber:
        transcriber = real()
        assert isinstance(transcriber, ScriptedTranscriber)
        made.append(transcriber)
        return transcriber

    backend.transcriber = recording  # type: ignore[method-assign]
    backend.utterances = ["never heard", "hello there"]

    client.start()
    frame = bytes(MAX_UTTERANCE_BYTES // 4)
    for _ in range(7):  # four fill the ceiling, three more are past it
        client.ws.send_binary(frame)
    refused = client.until("turn.error")
    assert refused["reason"] == "validator_failed"
    assert "seconds" in refused["detail"]
    client.stop()
    _settle()
    assert made[0].fed <= MAX_UTTERANCE_BYTES
    assert made[0].fed == MAX_UTTERANCE_BYTES, "frames up to the ceiling were fed, no more"
    assert len(client.of("turn.error")) == 1
    assert client.of("voice.transcript") == [], "nothing was transcribed"

    voiced.script(claude_round("Still here."))
    client.utter()
    assert client.until("voice.transcript", final=True)["text"] == "hello there"
    assert client.until("turn.finished")["text"] == "Still here."
    assert len(client.of("turn.error")) == 1


def test_a_buffered_transcriber_never_holds_more_than_the_ceiling() -> None:
    from athena.channels.voice.backends import MAX_UTTERANCE_BYTES, BufferedTranscriber

    heard: list[int] = []
    transcriber = BufferedTranscriber(lambda audio: str(heard.append(len(audio))))
    for _ in range(MAX_UTTERANCE_BYTES // 65_536 + 10):
        transcriber.feed(bytes(65_536))
    transcriber.finish()
    assert heard == [MAX_UTTERANCE_BYTES]


# -- the reader's errors -------------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad",
    [{"tier": "high"}, {"tier": [1]}, {"ms": "fast"}, {"tier": 1.9}, {"ms": True}, {"tier": -1}],
)
def test_a_tool_result_with_a_tier_or_ms_that_is_not_a_count_is_refused_and_the_socket_stays(
    voiced: Live, client: VoiceClient, bad: dict[str, object]
) -> None:
    voiced.register()
    client.send(type="tool_result", call_id="c1", name="x", ok=True, output="", **bad)
    assert client.until("turn.error")["reason"] == "validator_failed"
    voiced.script(claude_round("Still here."))
    client.say("hello")
    assert client.until("turn.finished")["text"] == "Still here."


def test_a_transcriber_that_raises_closes_1011_and_the_log_says_so(
    voiced: Live,
    backend: ScriptedBackend,
    client: VoiceClient,
    caplog: pytest.LogCaptureFixture,
) -> None:
    class Broken:
        def feed(self, pcm: bytes) -> list[str]:
            raise RuntimeError("SECRET-AUDIO-DETAIL")

        def finish(self) -> str:
            return ""

    backend.transcriber = Broken  # type: ignore[method-assign,assignment]
    voiced.register()
    with caplog.at_level("ERROR", logger="athena.channels.voice.gateway"):
        client.start()
        client.chunks(1)
        assert client.next() is None
    assert client.ws.close_code == 1011
    assert any("handling a binary frame failed" in r.getMessage() for r in caplog.records)


def test_an_unmasked_client_frame_closes_1002(voiced: Live, client: VoiceClient) -> None:
    client.ws._wfile.write(bytes([0x81, 2]) + b"hi")
    client.ws._wfile.flush()
    assert client.next() is None
    assert client.ws.close_code == 1002


# -- a bare yes answers only a card this socket presented ---------------------------------------


def _fresh(voiced: Live) -> VoiceClient:
    return VoiceClient(
        connect(voiced.host, voiced.port, VOICE_PATH, token=TOKEN, origin=SHELL_ORIGIN)
    )


def _pending_ids(voiced: Live) -> set[str]:
    return {row.id for row in voiced.daemon.approvals.pending(10).rows}


def test_a_fresh_socket_with_two_inbox_cards_hears_no_bare_word_as_an_answer(
    voiced: Live, backend: ScriptedBackend, client: VoiceClient
) -> None:
    first = _file_a_card(voiced, client)
    second = _file_a_card(voiced, client)
    fresh = _fresh(voiced)
    try:
        words = ["yes", "ok", "do it", "Yes.", "no"]
        backend.utterances = list(words)
        for word in words:
            voiced.script(claude_round("Noted."))
            fresh.utter()
            assert fresh.until("voice.transcript", final=True)["text"] == word
            fresh.until("turn.finished")
        assert "decision.resolved" not in fresh.kinds()
        assert _pending_ids(voiced) == {str(first["id"]), str(second["id"])}
    finally:
        fresh.close()


def test_a_card_this_socket_presented_takes_a_bare_yes_while_older_inbox_cards_wait(
    voiced: Live, backend: ScriptedBackend, client: VoiceClient
) -> None:
    older = _file_a_card(voiced, client)
    fresh = _fresh(voiced)
    try:
        mine = _file_a_card(voiced, fresh)
        voiced.script(claude_round("TTS: Paid.\nPaid."))
        backend.utterances = ["yes"]
        fresh.utter()
        assert fresh.until("decision.resolved")["id"] == mine["id"]
        assert _pending_ids(voiced) == {str(older["id"])}
    finally:
        fresh.close()


def test_a_word_that_fits_two_unpresented_cards_resolves_neither(
    voiced: Live, backend: ScriptedBackend, client: VoiceClient
) -> None:
    first = _file_a_card(voiced, client)
    second = _file_a_card(voiced, client)
    fresh = _fresh(voiced)
    try:
        voiced.script(claude_round("Noted."))
        backend.utterances = ["decline"]
        fresh.utter()
        fresh.until("turn.finished")
        assert "decision.resolved" not in fresh.kinds()
        assert _pending_ids(voiced) == {str(first["id"]), str(second["id"])}
    finally:
        fresh.close()


# -- a socket queues at most four turns (ADR 0074) ---------------------------------------------


def _hold_the_worker(voiced: Live, client: VoiceClient) -> dict[str, object]:
    """Run one turn that waits on the page's answer, and give the page all the time it needs."""
    gateway = voiced.daemon.sockets.get(VOICE_PATH)
    assert isinstance(gateway, VoiceGateway)
    gateway.result_timeout_s = 30.0
    voiced.register()
    voiced.script(
        claude_round(op("host.invoices.chase", invoice="7")),
        claude_round("held done"),
        *[claude_round(f"queued {n}") for n in range(MAX_PENDING_TURNS)],
    )
    client.say("hold")
    return client.until("tool.call", params={"invoice": "7"})


def test_a_fifth_waiting_text_turn_is_refused_once_and_the_four_queued_still_run(
    voiced: Live, client: VoiceClient
) -> None:
    held = _hold_the_worker(voiced, client)
    for n in range(MAX_PENDING_TURNS):
        client.say(f"q{n}")
    client.say("one too many")

    refused = client.until("turn.error")
    assert refused["reason"] == "validator_failed"
    assert refused["detail"] == "4 turns are already waiting; this one was not queued"

    client.tool_result(held, output="drafted")
    client.until("turn.finished", text="held done")
    for n in range(MAX_PENDING_TURNS):
        client.until("turn.finished", text=f"queued {n}")
    _settle()
    assert len(client.of("turn.error")) == 1
    assert [e["text"] for e in client.of("voice.transcript")] == [
        "hold",
        "q0",
        "q1",
        "q2",
        "q3",
    ]


def test_a_stop_with_four_waiting_gets_one_error_and_is_never_transcribed(
    voiced: Live, backend: ScriptedBackend, client: VoiceClient
) -> None:
    finished: list[str] = []

    class Spy:
        def feed(self, pcm: bytes) -> list[str]:
            return []

        def finish(self) -> str:
            finished.append("finish")
            return "never heard"

    backend.transcriber = Spy  # type: ignore[method-assign,assignment]
    held = _hold_the_worker(voiced, client)
    for n in range(MAX_PENDING_TURNS):
        client.say(f"q{n}")

    client.utter()
    refused = client.until("turn.error")
    assert refused["reason"] == "validator_failed"
    _settle()
    assert finished == []
    assert len(client.of("turn.error")) == 1

    client.tool_result(held, output="drafted")
    client.until("turn.finished", text="held done")
    for n in range(MAX_PENDING_TURNS):
        client.until("turn.finished", text=f"queued {n}")


# -- a frame json cannot decode is refused, and the error door cannot raise --------------------


@pytest.mark.parametrize(
    "frame",
    ["[" * 100_000, '{"type": ' + "[" * 100_000 + "]" * 100_000 + "}"],
    ids=["bare-brackets", "nested-type"],
)
def test_a_frame_too_deep_to_decode_is_refused_once_and_the_socket_stays(
    voiced: Live, client: VoiceClient, frame: str
) -> None:
    voiced.register()
    client.ws.send_text(frame)
    refused = client.until("turn.error")
    assert refused["reason"] == "parse_error"
    voiced.script(claude_round("Still here."))
    client.say("hello")
    assert client.until("turn.finished")["text"] == "Still here."
    assert len(client.of("turn.error")) == 1
    assert client.ws.close_code is None


def test_a_handler_that_raises_on_an_undecodable_frame_closes_1011_with_one_log_record(
    voiced: Live,
    client: VoiceClient,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    def broken(self: object, raw: str) -> None:
        raise RuntimeError("SECRET-FRAME-DETAIL")

    monkeypatch.setattr(VoiceSession, "_control", broken)
    voiced.register()
    with caplog.at_level("ERROR", logger="athena.channels.voice.gateway"):
        client.ws.send_text("[" * 100_000)
        assert client.next() is None
    assert client.ws.close_code == 1011
    records = [r for r in caplog.records if r.name == "athena.channels.voice.gateway"]
    assert len(records) == 1
    assert "handling a text frame failed" in records[0].getMessage()


# -- a turn that has not started when the socket closes never starts ---------------------------


def test_turns_waiting_behind_a_held_one_never_start_once_the_socket_closes(
    voiced: Live, client: VoiceClient
) -> None:
    _hold_the_worker(voiced, client)
    for n in range(MAX_PENDING_TURNS):
        client.say(f"q{n}")
    client.close()
    _settle(1.0)  # the held turn gives up on the closed socket and finds the queue empty
    assert len(voiced.transport.requests) == 1


def test_a_page_that_answers_after_the_socket_closed_starts_no_continuation_step(
    voiced: Live, client: VoiceClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    original = VoiceSession._await_results

    def answered_then_closed(self: VoiceSession, calls: Sequence[ToolCall]) -> bool:
        answered = original(self, calls)
        self._closed = True  # the socket went away while the answer was on its way
        return answered

    monkeypatch.setattr(VoiceSession, "_await_results", answered_then_closed)
    held = _hold_the_worker(voiced, client)
    client.tool_result(held, output="drafted")
    _settle(0.5)
    assert len(voiced.transport.requests) == 1


# -- _results holds only answers to calls this socket asked the page to run --------------------


def _session_of(voiced: Live) -> VoiceSession:
    gateway = voiced.daemon.sockets.get(VOICE_PATH)
    assert isinstance(gateway, VoiceGateway)
    return VoiceSession(gateway=gateway, ws=None)  # type: ignore[arg-type]


def test_two_thousand_results_for_calls_nobody_asked_for_are_held_nowhere(voiced: Live) -> None:
    session = _session_of(voiced)
    for n in range(2_000):
        session._tool_result({"call_id": f"x{n}", "name": "n", "ok": True, "output": "o" * 100})
    assert session._results == {}
    assert session._expected == set()


def test_a_result_answered_before_the_wait_begins_is_still_collected(
    voiced: Live, client: VoiceClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    original = VoiceSession._await_results
    collected: list[bool] = []

    def late_to_the_wait(self: VoiceSession, calls: Sequence[ToolCall]) -> bool:
        deadline = time.monotonic() + 10
        while not self._results and time.monotonic() < deadline:
            time.sleep(0.01)  # the page has already answered when the wait starts
        collected.append(original(self, calls))
        return collected[-1]

    monkeypatch.setattr(VoiceSession, "_await_results", late_to_the_wait)
    held = _hold_the_worker(voiced, client)
    client.tool_result(held, output="drafted")
    client.until("turn.finished", text="held done")
    assert collected == [True]


def test_a_result_after_the_timeout_is_dropped_and_nothing_is_kept(
    voiced: Live, client: VoiceClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    sessions: list[VoiceSession] = []
    original = VoiceSession._await_results

    def remember(self: VoiceSession, calls: Sequence[ToolCall]) -> bool:
        sessions.append(self)
        return original(self, calls)

    monkeypatch.setattr(VoiceSession, "_await_results", remember)
    voiced.register()
    voiced.script(claude_round(op("host.invoices.chase", invoice="3")))
    client.say("chase invoice 3")
    call = client.until("tool.call", name="host.invoices.chase")
    _settle(0.8)  # past the test's result timeout
    client.tool_result(call, output="too late")
    _settle(0.3)
    assert len(sessions) == 1
    assert sessions[0]._results == {}
    assert sessions[0]._expected == set()


# -- one daemon admits at most MAX_SESSIONS voice sockets (ADR 0074, amended) ------------------


def _gateway(voiced: Live) -> VoiceGateway:
    gateway = voiced.daemon.sockets.get(VOICE_PATH)
    assert isinstance(gateway, VoiceGateway)
    return gateway


def _until(what: str, predicate: Callable[[], bool], timeout: float = 10.0) -> None:
    """Wait for a thread on the daemon side to get somewhere; a wait, never a timing claim."""
    deadline = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() > deadline:
            raise AssertionError(f"never: {what}")
        time.sleep(0.01)


def _admitted(voiced: Live, count: int) -> None:
    gateway = _gateway(voiced)
    _until(f"{count} admitted (now {gateway.admitted})", lambda: gateway.admitted == count)


def _served(monkeypatch: pytest.MonkeyPatch) -> list[VoiceSession]:
    """Every session the gateway let in, in order: a refused socket never gets one."""
    sessions: list[VoiceSession] = []
    original = VoiceSession.serve

    def serve(self: VoiceSession) -> None:
        sessions.append(self)
        original(self)

    monkeypatch.setattr(VoiceSession, "serve", serve)
    return sessions


def _assert_refused(refused: VoiceClient) -> None:
    error = refused.until("turn.error")
    assert error["reason"] == "validator_failed"
    assert error["detail"] == (
        f"at most {MAX_SESSIONS} voice sockets may be open at once; try again when one has closed"
    )
    assert refused.next() is None
    assert refused.ws.close_code == 1013
    assert refused.kinds() == ["turn.error"]


def test_one_socket_past_the_cap_gets_one_error_and_1013_and_starts_no_thread(
    voiced: Live, monkeypatch: pytest.MonkeyPatch
) -> None:
    sessions = _served(monkeypatch)
    clients: list[VoiceClient] = []
    try:
        for n in range(MAX_SESSIONS):
            clients.append(_fresh(voiced))
            _admitted(voiced, n + 1)
        refused = _fresh(voiced)
        clients.append(refused)
        _assert_refused(refused)
        assert len(sessions) == MAX_SESSIONS
        assert _gateway(voiced).admitted == MAX_SESSIONS
        assert voiced.transport.requests == []
    finally:
        for client in clients:
            client.close()
    _admitted(voiced, 0)


def test_a_closed_socket_holds_its_admission_until_its_running_turn_ends(
    voiced: Live, monkeypatch: pytest.MonkeyPatch
) -> None:
    entered, release = threading.Event(), threading.Event()

    def held_turn(*args: object, **kwargs: object) -> Iterator[object]:
        entered.set()
        release.wait(timeout=30)
        yield from ()

    monkeypatch.setattr(gateway_module, "turn_events", held_turn)
    sessions = _served(monkeypatch)
    voiced.register()
    client = _fresh(voiced)
    _admitted(voiced, 1)
    client.say("hold")
    assert entered.wait(timeout=10)
    others = [_fresh(voiced) for _ in range(MAX_SESSIONS - 1)]
    try:
        _admitted(voiced, MAX_SESSIONS)
        client.close()
        held = sessions[0]
        _until("the held socket's reader returned", lambda: held._holders == 1)
        refused = _fresh(voiced)
        try:
            _assert_refused(refused)
        finally:
            refused.close()
        assert _gateway(voiced).admitted == MAX_SESSIONS

        release.set()
        _admitted(voiced, MAX_SESSIONS - 1)
        admitted = _fresh(voiced)
        try:
            _admitted(voiced, MAX_SESSIONS)
            admitted.say("let in")
            assert admitted.until("voice.transcript", final=True)["text"] == "let in"
            assert "turn.error" not in admitted.kinds()
        finally:
            admitted.close()
    finally:
        release.set()
        for other in others:
            other.close()
    _admitted(voiced, 0)


def test_a_reader_that_ends_1011_gives_its_admission_back(
    voiced: Live, client: VoiceClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken(self: object, raw: str) -> None:
        raise RuntimeError("a bug in one frame's handling")

    monkeypatch.setattr(VoiceSession, "_control", broken)
    _admitted(voiced, 1)
    client.say("anything")
    assert client.next() is None
    assert client.ws.close_code == 1011
    _admitted(voiced, 0)


class _DyingSocket:
    """A socket whose read raises what no handler expects: the reader thread dies by it."""

    closed_with: tuple[int, str] | None = None

    def recv(self) -> None:
        raise RuntimeError("the reader dies")

    def send_text(self, text: str) -> None:
        pass

    def close(self, code: int = 1000, reason: str = "") -> None:
        self.closed_with = (code, reason)


def test_a_reader_that_dies_by_exception_gives_the_admission_back_exactly_once(
    voiced: Live,
) -> None:
    ended: list[int] = []
    session = VoiceSession(
        gateway=_gateway(voiced),
        ws=_DyingSocket(),  # type: ignore[arg-type]
        on_end=lambda: ended.append(1),
    )
    with pytest.raises(RuntimeError):
        session.serve()
    _until("the worker gave its hold back", lambda: session._holders == 0)
    assert ended == [1]


def test_fifty_sockets_opened_and_closed_in_a_row_leave_the_count_at_zero(
    voiced: Live, monkeypatch: pytest.MonkeyPatch
) -> None:
    sessions = _served(monkeypatch)
    gateway = _gateway(voiced)
    for n in range(50):
        client = _fresh(voiced)
        _until(f"socket {n} admitted", lambda count=n + 1: len(sessions) == count)
        client.close()
        _until(f"socket {n} let go", lambda: gateway.admitted <= 0)
        assert gateway.admitted == 0
    assert all(session._holders == 0 for session in sessions)


# -- a turn that raises is logged and the socket goes on ---------------------------------------


def test_a_turn_that_raises_is_logged_and_the_next_utterance_still_runs(
    voiced: Live,
    client: VoiceClient,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    voiced.register()
    voiced.script(claude_round("Nothing is overdue."))
    original = VoiceSession._turn
    calls: list[str] = []

    def flaky(self: VoiceSession, *args: object, **kwargs: object) -> None:
        calls.append("turn")
        if len(calls) == 1:
            raise KeyError("SECRET-PAGE-TEXT")
        original(self, *args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(VoiceSession, "_turn", flaky)
    with caplog.at_level("ERROR", logger="athena.channels.voice.gateway"):
        client.say("first")
        failed = client.until("turn.error")
        client.say("second")
        assert client.until("turn.finished")["text"] == "Nothing is overdue."

    assert (failed["reason"], failed["detail"]) == ("unknown", "KeyError")
    records = _speaker_records(caplog)
    assert len(records) == 1
    assert records[0].exc_info is not None
    assert records[0].getMessage() == "voice: a turn failed"

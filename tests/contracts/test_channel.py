"""Every channel event survives the wire unchanged (contracts/channel.py, README §3.2)."""

from __future__ import annotations

import dataclasses
import json

import pytest

from athena.contracts import (
    EVENT_KINDS,
    ChannelEvent,
    DecisionOption,
    DecisionRequested,
    DecisionResolved,
    TextDelta,
    ToolCall,
    ToolResult,
    TurnError,
    TurnFinished,
    TurnSummary,
    VoiceSpeaking,
    VoiceStopped,
    VoiceTranscript,
    event_from_dict,
    event_from_json,
    family_of,
)

EVENTS: list[ChannelEvent] = [
    TextDelta(text="a chase for the late invoice"),
    ToolCall(
        call_id="call-1",
        name="host.inbox.compose",
        params={"to": "client@example.com", "body": "hello"},
        origin="host:inbox",
        tier=1,
    ),
    ToolResult(
        call_id="call-1",
        name="host.inbox.compose",
        ok=False,
        output="",
        truncated=False,
        error="user_denied",
        tier=1,
        ms=12,
    ),
    TurnFinished(text="Drafted three chases.", tts="Drafted three chases."),
    TurnError(reason="timeout", detail="the engine did not answer in 120s"),
    TurnSummary(
        model="claude-sonnet",
        engine="claude",
        input_tokens=1200,
        output_tokens=340,
        cost_usd=0.004,
        cost_estimated=True,
        duration_ms=8100,
        rounds=3,
    ),
    DecisionRequested(
        id="apr_0123456789ab",
        decision_kind="choose",
        action="host.inbox.send",
        params={"to": "client@example.com"},
        rationale="this leaves the app",
        options=(DecisionOption("approve", "Send it"), DecisionOption("decline", "No")),
        expires_at="2026-09-12T10:00:00+00:00",
        origin="host:inbox",
        surface="voice",
        capture_id="cap_0123456789ab",
    ),
    DecisionResolved(id="apr_0123456789ab", choice="decline", by="user", at="2026-09-12T09:00:00Z"),
    VoiceTranscript(text="approve", final=True),
    VoiceSpeaking(generation=3, text="Drafted three chases.", truncated=False, sample_rate=24000),
    VoiceStopped(generation=3, reason="barge_in"),
]


@pytest.mark.parametrize("event", EVENTS, ids=lambda e: str(e.kind))
def test_every_event_round_trips_through_json(event: ChannelEvent) -> None:
    back = event_from_json(event.to_json())
    assert back == event
    assert type(back) is type(event)


@pytest.mark.parametrize("event", EVENTS, ids=lambda e: str(e.kind))
def test_the_wire_form_carries_the_kind_tag(event: ChannelEvent) -> None:
    wire = json.loads(event.to_json())
    assert wire["kind"] == event.kind
    assert family_of(event.kind)


def test_every_declared_kind_is_covered_by_this_test() -> None:
    assert {e.kind for e in EVENTS} == set(EVENT_KINDS)


def test_a_decision_cards_options_come_back_as_options_not_dicts() -> None:
    card = DecisionRequested(id="apr_1", options=(DecisionOption("approve", "Yes"),))
    back = event_from_json(card.to_json())
    assert isinstance(back, DecisionRequested)
    assert back.options == (DecisionOption("approve", "Yes"),)


def test_an_unknown_kind_raises_rather_than_being_skipped() -> None:
    # A surface that silently drops decision.requested is a gate that never asked.
    with pytest.raises(ValueError, match="unknown channel event kind"):
        event_from_dict({"kind": "decision.invented", "id": "apr_1"})


def test_unknown_fields_are_dropped_rather_than_crashing_an_older_reader() -> None:
    back = event_from_dict({"kind": "text.delta", "text": "hi", "invented_later": 7})
    assert back == TextDelta(text="hi")


def test_events_are_frozen() -> None:
    with pytest.raises(dataclasses.FrozenInstanceError):
        TextDelta(text="hi").text = "ho"  # type: ignore[misc]


def test_the_voice_family_is_its_own_family() -> None:
    # The gateway renders these and the panel may; neither is a stream event, because a turn
    # does not emit them — the transport around a turn does.
    assert family_of("voice.transcript") == "voice"
    assert family_of("voice.speaking") == "voice"
    assert family_of("voice.stopped") == "voice"

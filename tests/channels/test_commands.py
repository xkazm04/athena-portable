"""What an utterance is before it is a turn, and what is spoken after one (voice/commands.py,
voice/tts.py)."""

from __future__ import annotations

import pytest

from athena.channels.voice.commands import Card, normalise, recognise
from athena.channels.voice.tts import TTS_CAP, spoken_line
from athena.contracts.channel import TurnFinished

YES_NO = Card("apr_1", (("approve", "approve"), ("decline", "decline")))
CHOOSE = Card("apr_2", (("send_now", "Send it now"), ("hold", "Hold until Monday")))


def test_normalise_strips_punctuation_case_and_spacing() -> None:
    assert normalise("  Approve!  ") == "approve"
    assert normalise("Don't.") == "dont"
    assert normalise("Be   QUIET,") == "be quiet"


@pytest.mark.parametrize("said", ["approve", "Approve.", "yes", "go ahead", "OK"])
def test_a_yes_word_answers_the_newest_yes_no_card(said: str) -> None:
    spoken = recognise(said, [YES_NO], speaking=False)
    assert (spoken.kind, spoken.approval_id, spoken.choice) == ("answer", "apr_1", "approve")


@pytest.mark.parametrize("said", ["decline", "no", "No thanks", "cancel"])
def test_a_no_word_declines_it(said: str) -> None:
    spoken = recognise(said, [YES_NO], speaking=False)
    assert (spoken.kind, spoken.choice) == ("answer", "decline")


def test_a_choose_card_is_answered_by_its_labels_not_by_yes() -> None:
    assert recognise("Send it now", [CHOOSE], speaking=False).choice == "send_now"
    assert recognise("hold until monday", [CHOOSE], speaking=False).choice == "hold"
    # "yes" means nothing to a card with no approve option: it is a message.
    assert recognise("yes", [CHOOSE], speaking=False).kind == "message"


def test_a_bare_yes_answers_the_card_on_top_and_an_older_one_only_by_label() -> None:
    older = Card("apr_0", (("approve", "approve"), ("decline", "decline")))
    spoken = recognise("yes", [CHOOSE, older], speaking=False)
    assert spoken.kind == "message", "yes was meant for the top card, which has no approve"
    spoken = recognise("approve", [CHOOSE, older], speaking=False)
    assert (spoken.kind, spoken.approval_id) == ("answer", "apr_0")


def test_a_sentence_that_mentions_approving_is_a_message() -> None:
    # A card is consent to one action; a sentence is not that consent.
    assert recognise("approve the first two", [YES_NO], speaking=False).kind == "message"


def test_a_stop_word_is_a_barge_in_only_while_something_is_playing() -> None:
    assert recognise("stop", [], speaking=True).kind == "stop"
    assert recognise("Never mind.", [YES_NO], speaking=True).kind == "stop"
    assert recognise("stop", [], speaking=False).kind == "message"


def test_silence_is_nothing() -> None:
    assert recognise("   ", [YES_NO], speaking=True).kind == "silence"
    assert recognise("...", [], speaking=False).kind == "silence"


# -- the spoken line ---------------------------------------------------------------------------


def test_the_tts_line_wins_over_the_visible_text() -> None:
    line = spoken_line(TurnFinished(text="A long visible answer.", tts="Two are late."))
    assert line is not None and (line.text, line.truncated) == ("Two are late.", False)


def test_without_a_tts_line_the_text_is_spoken_whole_when_it_fits() -> None:
    line = spoken_line(TurnFinished(text="Two invoices are late.", tts=None))
    assert line is not None and line.text == "Two invoices are late."


def test_a_long_reply_is_spoken_cut_to_the_cap_and_announced() -> None:
    text = "x" * (TTS_CAP + 300)
    line = spoken_line(TurnFinished(text=text, tts=None))
    assert line is not None and line.truncated
    assert line.text.endswith(f"(showing {TTS_CAP} of {TTS_CAP + 300})")
    assert line.text.startswith("x" * TTS_CAP)


def test_an_empty_turn_says_nothing() -> None:
    assert spoken_line(TurnFinished(text="   ", tts=None)) is None


# -- speech-ready text and speech without words ------------------------------------------------


def test_markdown_is_not_spoken() -> None:
    text = "## Overdue\n\n- **Two** invoices are `late`.\n- See [the ledger](https://example.com/a/b?x=1)."
    line = spoken_line(TurnFinished(text=text, tts=None))
    assert line is not None
    for mark in ("#", "*", "`", "[", "](", "https://"):
        assert mark not in line.text
    assert "Two invoices are late" in line.text
    assert "the ledger" in line.text


def test_a_bare_link_is_said_as_a_link_to_its_host() -> None:
    line = spoken_line(
        TurnFinished(text="Details at https://docs.example.com/x/y?z=1 today.", tts=None)
    )
    assert line is not None
    assert line.text == "Details at a link to docs.example.com today."


def test_a_code_fence_is_not_read_out() -> None:
    line = spoken_line(TurnFinished(text="Run this:\n```\nrm -rf /\n```\nThen wait.", tts=None))
    assert line is not None and "rm" not in line.text and "```" not in line.text
    assert "Then wait." in line.text


def test_the_tts_line_is_authored_for_the_ear_and_left_alone() -> None:
    line = spoken_line(TurnFinished(text="x", tts="Two are *late*."))
    assert line is not None and line.text == "Two are *late*."


def test_audio_with_no_words_is_not_silence() -> None:
    assert recognise("  ", [], speaking=False, audible=True).kind == "unheard"
    assert recognise("  ", [], speaking=False, audible=False).kind == "silence"
    assert recognise("hello", [], speaking=False, audible=True).kind == "message"


def test_peak_level_tells_a_quiet_capture_from_a_voiced_one() -> None:
    import struct

    from athena.channels.voice.commands import SPEECH_PEAK, peak_level

    assert peak_level(bytes(640)) == 0
    loud = struct.pack("<320h", *([12000, -12000] * 160))
    assert peak_level(loud) >= SPEECH_PEAK

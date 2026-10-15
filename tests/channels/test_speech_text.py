"""What she says is written for the ear: the speech door (voice/speech.py) and the spoken line
(voice/tts.py) that runs every reply through it (ADR 0114)."""

from __future__ import annotations

from athena.channels.voice import kokoro
from athena.channels.voice.speech import SPOKEN_BUDGET, sentences, speakable
from athena.channels.voice.tts import SpokenLine, spoken_line
from athena.contracts.channel import TurnFinished
from athena.harness.op_grammar import TTS_CAP


def _sentence(n: int, length: int) -> str:
    """One sentence of exactly ``length`` characters: ``Item <n> <one long word> is late.``"""
    head, tail = f"Item {n} ", " is late."
    return f"{head}{'a' * (length - len(head) - len(tail))}{tail}"


# -- 1. markup and a bare URL ------------------------------------------------------------------


def test_case1_emphasis_bullets_and_a_bare_url_are_spoken_as_words_and_a_host() -> None:
    reply = "**Two** invoices are _late_:\n- INV-7 (see https://ledger.example.com/inv/7)\n- INV-9"
    line = spoken_line(TurnFinished(text=reply))
    assert line is not None
    for gone in ("*", "_", "https://", "/inv/7"):
        assert gone not in line.text
    for kept in ("Two invoices are late", "INV-7", "INV-9", "ledger.example.com"):
        assert kept in line.text
    assert not line.truncated


# -- 2. code -----------------------------------------------------------------------------------


def test_case2_a_fence_is_one_code_on_screen_phrase_and_inline_code_is_its_content() -> None:
    reply = "Run this:\n```python\nimport os\nprint(os.getcwd())\n```\nThen set `x` to one."
    line = spoken_line(TurnFinished(text=reply))
    assert line is not None
    assert line.text.count("code on screen") == 1
    for gone in ("`", "import os", "getcwd", "python"):
        assert gone not in line.text
    assert "Then set x to one." in line.text


# -- 3. a markdown link ------------------------------------------------------------------------


def test_case3_a_link_is_spoken_as_its_label_only() -> None:
    line = spoken_line(TurnFinished(text="Open [the overdue list](https://a.example/x) now."))
    assert line is not None
    assert line.text == "Open the overdue list now."


# -- 4. the spoken budget ----------------------------------------------------------------------


def test_case4_a_long_reply_is_spoken_as_whole_sentences_up_to_the_budget_and_announced() -> None:
    assert SPOKEN_BUDGET == 360
    # Nine sentences: 110, 110, 110, 110, 110, 110, 110, 110, 112 characters, one space between,
    # so 992 + 8 = 1,000 characters. Three sentences are 3 * 110 + 2 = 332 <= 360; a fourth makes
    # 443 > 360. So three are spoken and the footer counts sentences: (showing 3 of 9).
    lengths = [110] * 8 + [112]
    parts = [_sentence(n, length) for n, length in enumerate(lengths, start=1)]
    assert [len(part) for part in parts] == lengths
    reply = " ".join(parts)
    assert len(reply) == 1000 < TTS_CAP

    line = spoken_line(TurnFinished(text=reply))

    assert line is not None and line.truncated
    assert line.text.endswith("(showing 3 of 9)")
    body = line.text.removesuffix(" (showing 3 of 9)")
    assert body == " ".join(parts[:3])
    assert len(body) <= SPOKEN_BUDGET
    assert body.endswith("is late.")  # a whole sentence, never cut mid-word


def test_case4b_a_run_on_longer_than_the_budget_is_cut_between_words_and_announced() -> None:
    long = "word " * 400  # 1,999 characters and no sentence end: six pieces of at most 72 words
    line = spoken_line(TurnFinished(text=long))
    assert line is not None and line.truncated
    assert line.text == " ".join(["word"] * 72) + " (showing 1 of 6)"


# -- 5. the TTS line goes through the door too -------------------------------------------------


def test_case5_the_tts_line_passes_the_door() -> None:
    line = spoken_line(TurnFinished(text="A long visible answer.", tts="**Done.** See `INV-7`."))
    assert line == SpokenLine("Done. See INV-7.", truncated=False)


# -- 6. sentence boundaries --------------------------------------------------------------------


def test_case6_decimals_and_abbreviations_do_not_end_a_sentence() -> None:
    text = "Paid 3.5 thousand to Dr. Smith, e.g. today. Next one is due."
    assert sentences(text) == ["Paid 3.5 thousand to Dr. Smith, e.g. today.", "Next one is due."]
    # The chunker uses the same rules: no fragment is cut at "Dr." for the folding to hide.
    assert kokoro.split_sentences(
        "The invoice went to Dr. Smithson at the clinic today. Next one is due."
    ) == ["The invoice went to Dr. Smithson at the clinic today.", "Next one is due."]


# -- 7. a plain short reply is unchanged (guard) -----------------------------------------------


def test_case7_a_plain_reply_is_spoken_byte_for_byte() -> None:
    assert spoken_line(TurnFinished(text="Nothing is overdue.")) == SpokenLine(
        "Nothing is overdue.", truncated=False
    )


# -- 8. nothing to say (guard) -----------------------------------------------------------------


def test_case8_an_empty_turn_says_nothing() -> None:
    assert spoken_line(TurnFinished(text="   ", tts=None)) is None
    assert spoken_line(TurnFinished(text="", tts="  ")) is None


# -- the door on its own -----------------------------------------------------------------------


def test_headings_quotes_tables_and_rules_are_spoken_for_the_ear() -> None:
    text = (
        "## Overdue\n"
        "> Two are late\n\n"
        "| id | due |\n|----|-----|\n| INV-7 | May |\n\n"
        "---\n"
        "1. Pay INV-7\n"
        "2. Chase INV-9!"
    )
    assert speakable(text) == (
        "Overdue. Two are late. There is a table on screen. Pay INV-7. Chase INV-9!"
    )


def test_a_snake_case_name_and_a_lone_star_are_left_alone() -> None:
    assert speakable("Set max_retries to 5 * 3.") == "Set max_retries to 5 * 3."


def test_markup_that_leaves_no_words_says_nothing() -> None:
    assert speakable("---\n\n***") == ""
    assert spoken_line(TurnFinished(text="---")) is None

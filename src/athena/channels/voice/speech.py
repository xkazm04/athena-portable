"""The speech door: display text made speakable, and where its sentences end (ADR 0114).

A reply is written for the eye. Read aloud as it is, an engine says "asterisk asterisk", spells a
URL out letter by letter and reads code line by line. Everything Athena says passes this one pure
door first, the ``TTS:`` line and the visible-text fallback alike
(:mod:`athena.channels.voice.tts`):

- :func:`speakable` turns markup into speech. Emphasis, strike, heading and quote marks go; a list
  item or a heading is its own sentence; ``[label](url)`` is its label; a bare URL is "a link to"
  its host; a fenced block is one "code on screen" sentence and inline code its content; a table
  is one "table on screen" sentence.
- :func:`sentences` owns the sentence-boundary rules: a decimal, an abbreviation ("Dr.", "e.g.")
  or a stop before a lowercase word does not end a sentence, and closing quotes and brackets stay
  with the sentence they close. :func:`athena.channels.voice.kokoro.split_sentences` calls it, so
  the chunker and the spoken budget cut in the same places.
- :func:`pieces` is :func:`sentences` held to a limit: a run-on longer than the limit is cut
  between words, so a cut is never mid-word unless one word alone is longer than the limit.
"""

from __future__ import annotations

import re
from urllib.parse import urlsplit

__all__ = ["CODE_PHRASE", "SPOKEN_BUDGET", "TABLE_PHRASE", "pieces", "sentences", "speakable"]

#: How many characters of a reply are spoken before the cut, the footer aside: about 20 to 25
#: seconds of speech, well under :data:`athena.harness.op_grammar.TTS_CAP` (about 80 seconds).
SPOKEN_BUDGET = 360

#: What a fenced code block is spoken as.
CODE_PHRASE = "There is code on screen."
#: What a table is spoken as.
TABLE_PHRASE = "There is a table on screen."

# --- blocks -------------------------------------------------------------------------------------

_FENCE = re.compile(r"^\s{0,3}(`{3,}|~{3,})")
_RULE = re.compile(r"^\s{0,3}([-*_])(?:\s*\1){2,}\s*$")
_HEADING = re.compile(r"^\s{0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$")
_ITEM = re.compile(r"^\s*(?:[-*+]|\d{1,9}[.)])\s+(.*)$")
_QUOTE = re.compile(r"^\s{0,3}>\s?")
_TABLE_ROW = re.compile(r"^\s*\|")

# --- inline -------------------------------------------------------------------------------------

_CODE = re.compile(r"(`+)(.+?)\1")
_IMAGE = re.compile(r"!\[([^\]]*)\]\([^)]*\)")
_LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")
_AUTOLINK = re.compile(r"<(https?://[^>\s]+)>")
_URL = re.compile(r"\bhttps?://[^\s<>()\[\]]+")
_URL_TAIL = ".,;:!?'\""
_STRONG = re.compile(r"\*\*(?!\s)(.+?)(?<!\s)\*\*")
_UNDER_STRONG = re.compile(r"(?<!\w)__(?!\s)(.+?)(?<!\s)__(?!\w)")
_EM = re.compile(r"\*(?!\s)(.+?)(?<!\s)\*")
_UNDER_EM = re.compile(r"(?<!\w)_(?!\s)(.+?)(?<!\s)_(?!\w)")
_STRIKE = re.compile(r"~~(?!\s)(.+?)(?<!\s)~~")
_SPACE = re.compile(r"\s+")

_TERMINAL = ".!?:;…"
_CLOSERS = "\"')]\u2019\u201d"


def _host(match: re.Match[str]) -> str:
    url = match.group(0)
    tail = ""
    while url and url[-1] in _URL_TAIL:
        tail = url[-1] + tail
        url = url[:-1]
    host = urlsplit(url).hostname or ""
    host = host.removeprefix("www.")
    return (f"a link to {host}" if host else "a link") + tail


def _inline(text: str) -> str:
    text = _CODE.sub(lambda m: m.group(2).strip(), text)
    text = _IMAGE.sub(r"\1", text)
    text = _LINK.sub(r"\1", text)
    text = _AUTOLINK.sub(r"\1", text)
    text = _URL.sub(_host, text)
    for pattern in (_STRONG, _UNDER_STRONG, _EM, _UNDER_EM, _STRIKE):
        text = pattern.sub(r"\1", text)
    return _SPACE.sub(" ", text).strip()


def _ends(unit: str) -> bool:
    bare = unit.rstrip(_CLOSERS)
    return not bare or bare[-1] in _TERMINAL


def speakable(text: str) -> str:
    """``text`` as it should be heard: no markup, no URL paths, one line, ``""`` if no words."""
    units: list[str] = []
    paragraph: list[str] = []
    fence: str | None = None
    in_table = False

    def close() -> None:
        if paragraph:
            units.append(_inline(" ".join(paragraph)))
            paragraph.clear()

    for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if fence is not None:
            if line.strip().startswith(fence):
                fence = None
            continue
        opened = _FENCE.match(line)
        if opened:
            close()
            units.append(CODE_PHRASE)
            fence = opened.group(1)[0] * 3
            in_table = False
            continue
        if _TABLE_ROW.match(line):
            close()
            if not in_table:
                units.append(TABLE_PHRASE)
            in_table = True
            continue
        in_table = False
        if not line.strip() or _RULE.match(line):
            close()
            continue
        own = _HEADING.match(line) or _ITEM.match(line)
        if own:
            close()
            units.append(_inline(own.group(1)))
            continue
        quoted = _QUOTE.sub("", line, count=1)
        if not quoted.strip():
            close()
            continue
        paragraph.append(quoted.strip())
    close()

    spoken = [unit for unit in units if unit]
    # Every unit but the last ends as a sentence, so a heading or a list item is not run into
    # the next; the last is left as it was written.
    return " ".join(
        unit if index == len(spoken) - 1 or _ends(unit) else f"{unit}."
        for index, unit in enumerate(spoken)
    )


# --- sentences ----------------------------------------------------------------------------------

_BOUNDARY = re.compile(r"[.!?…]+[\"')\]\u2019\u201d]*\s+")
_LAST_WORD = re.compile(r"(\S+)$")
_ABBREVIATIONS = frozenset(
    {"dr", "mr", "mrs", "ms", "prof", "st", "jr", "sr", "vs", "e.g", "i.e", "cf", "approx"}
)


def _ends_sentence(text: str, match: re.Match[str]) -> bool:
    stop = match.group(0).rstrip()
    if not stop.rstrip(_CLOSERS).endswith("."):
        return True
    following = text[match.end() : match.end() + 1]
    if following.islower():
        return False
    word = _LAST_WORD.search(text[: match.start()])
    return not (word and word.group(1).lstrip("(\"'\u2018\u201c").lower() in _ABBREVIATIONS)


def sentences(text: str) -> list[str]:
    """``text`` cut where a sentence ends, blanks dropped. A run with no stop is one sentence."""
    text = text.strip()
    out: list[str] = []
    start = 0
    for match in _BOUNDARY.finditer(text):
        if _ends_sentence(text, match):
            out.append(text[start : match.end()].strip())
            start = match.end()
    out.append(text[start:].strip())
    return [sentence for sentence in out if sentence]


def pieces(text: str, limit: int) -> list[str]:
    """:func:`sentences`, with any sentence longer than ``limit`` cut between words to fit it."""
    out: list[str] = []
    for sentence in sentences(text):
        while len(sentence) > limit:
            cut = sentence.rfind(" ", 0, limit + 1)
            if cut <= 0:  # one word longer than the limit: the only cut inside a word
                cut = limit
            out.append(sentence[:cut].rstrip())
            sentence = sentence[cut:].lstrip()
        if sentence:
            out.append(sentence)
    return out

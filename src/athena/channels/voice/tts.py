"""The ``TTS:`` first-line rule, and the cap on what is spoken (README §3.2; ADR 0019).

A reply is written for the eye and spoken for the ear, and the two are not the same text. The
constitution lets the model put a ``TTS:`` line first — one sentence for the speaker — and
:mod:`athena.harness.op_grammar` lifts it off the visible text into ``turn.finished.tts``. This
module decides what the gateway actually says:

- the ``TTS:`` line, when there is one. The parser already holds it to :data:`TTS_CAP`;
- otherwise the visible text, made speech-ready (:func:`speech_ready`), cut to the same cap and
  *announced* — the spoken text ends with ``(showing N of M)`` like every other bounded thing in
  this repository (README §2, invariant 4), so a person who hears a reply stop short hears that it
  stopped short;
- nothing at all for an empty turn, so silence is never synthesised.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlsplit

from athena.contracts.channel import TurnFinished
from athena.contracts.harness import PromptBlock
from athena.harness.op_grammar import TTS_CAP

__all__ = ["TTS_CAP", "SpokenLine", "speech_ready", "spoken_line"]

_FENCE = re.compile(r"```.*?(?:```|\Z)", re.DOTALL)
_IMAGE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")
_URL = re.compile(r"https?://[^\s)>\]]+")
_LINE_MARK = re.compile(
    r"^[ 	]*(?:#{1,6}[ 	]+|>[ 	]?|[-*+][ 	]+|\d+[.)][ 	]+)", re.MULTILINE
)
_RULE = re.compile(r"^[ 	]*(?:[-*_][ 	]*){3,}$", re.MULTILINE)
_EMPHASIS = re.compile(r"\*{1,3}|(?<!\w)_{1,3}|_{1,3}(?!\w)|~~|`")
_SPACES = re.compile(r"[ 	]+")


def _host(match: re.Match[str]) -> str:
    host = urlsplit(match.group(0)).hostname
    return f"a link to {host}" if host else "a link"


def speech_ready(text: str) -> str:
    """The visible text as a voice should say it: no markup, links said by their host.

    One door before synthesis (voice-io/speech-ready-text). Fenced code and images are dropped,
    a link keeps its anchor text and loses its address, a bare address becomes "a link to
    <host>", and the bullets, heading marks and emphasis markers a screen draws are removed.
    """
    text = _FENCE.sub(" ", text)
    text = _IMAGE.sub(" ", text)
    text = _LINK.sub(lambda m: m.group(1), text)
    text = _URL.sub(_host, text)
    text = _RULE.sub("", text)
    text = _LINE_MARK.sub("", text)
    text = _EMPHASIS.sub("", text)
    lines = [_SPACES.sub(" ", line).strip() for line in text.splitlines()]
    return " ".join(line for line in lines if line)


@dataclass(frozen=True)
class SpokenLine:
    text: str
    truncated: bool = False


def spoken_line(finished: TurnFinished) -> SpokenLine | None:
    """What to say for one finished turn, or ``None`` when there is nothing to say."""
    if finished.tts and finished.tts.strip():
        return SpokenLine(finished.tts.strip())
    text = speech_ready(finished.text)
    if not text:
        return None
    total = len(text)
    if total <= TTS_CAP:
        return SpokenLine(text)
    footer = PromptBlock("tts", text[:TTS_CAP], shown=TTS_CAP, total=total).footer()
    return SpokenLine(f"{text[:TTS_CAP]} {footer}", truncated=True)

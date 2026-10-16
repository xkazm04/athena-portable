"""The ``TTS:`` line, the speech door and the spoken budget (README §3.2; ADR 0019, 0114).

A reply is written for the eye and spoken for the ear, and the two are not the same text. The
constitution lets the model put a ``TTS:`` line first — one sentence for the speaker — and
:mod:`athena.harness.op_grammar` lifts it off the visible text into ``turn.finished.tts``. This
module decides what the gateway actually says, and everything it says passes
:func:`athena.channels.voice.speech.speakable` first (no markup, no URL paths, code mentioned):

- the ``TTS:`` line, through the door, when it has words. The parser already holds it to
  :data:`TTS_CAP`, and what the door makes of it is held to the same cap, cut and announced;
- otherwise the visible text, through the door, as whole sentences up to
  :data:`~athena.channels.voice.speech.SPOKEN_BUDGET` and *announced* — the spoken text ends with
  ``(showing N of M)`` counted in sentences, like every other bounded thing in this repository
  (README §2, invariant 4), so a person who hears a reply stop short hears how much is on screen;
- nothing at all for an empty turn, so silence is never synthesised.
"""

from __future__ import annotations

from dataclasses import dataclass

from athena.channels.voice.speech import SPOKEN_BUDGET, pieces, speakable
from athena.contracts.channel import TurnFinished
from athena.contracts.harness import PromptBlock
from athena.harness.op_grammar import TTS_CAP

__all__ = ["SPOKEN_BUDGET", "TTS_CAP", "SpokenLine", "spoken_line"]


@dataclass(frozen=True)
class SpokenLine:
    text: str
    truncated: bool = False


def spoken_line(finished: TurnFinished) -> SpokenLine | None:
    """What to say for one finished turn, or ``None`` when there is nothing to say.

    The ``TTS:`` line is held to :data:`TTS_CAP` again *after* the door: the parser cut it before,
    and a bare URL spoken as "a link to" its host is longer than the URL, so the door can carry a
    line past what a speaker takes (``kokoro.MAX_CHARS``) and the whole line would be refused.
    """
    if finished.tts:
        line = speakable(finished.tts)
        if line:
            return _within(line, TTS_CAP)
    text = speakable(finished.text)
    if not text:
        return None
    return _within(text, SPOKEN_BUDGET)


def _within(text: str, limit: int) -> SpokenLine:
    """``text`` whole when it fits ``limit``, else whole sentences up to it and announced."""
    if len(text) <= limit:
        return SpokenLine(text)
    parts = pieces(text, limit)
    shown: list[str] = []
    size = -1
    for part in parts:
        if size + 1 + len(part) > limit:
            break
        shown.append(part)
        size += 1 + len(part)
    body = " ".join(shown)
    footer = PromptBlock("tts", body, shown=len(shown), total=len(parts)).footer()
    return SpokenLine(f"{body} {footer}", truncated=True) if footer else SpokenLine(body)

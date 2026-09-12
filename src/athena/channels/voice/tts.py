"""The ``TTS:`` first-line rule, and the cap on what is spoken (README §3.2; ADR 0019).

A reply is written for the eye and spoken for the ear, and the two are not the same text. The
constitution lets the model put a ``TTS:`` line first — one sentence for the speaker — and
:mod:`athena.harness.op_grammar` lifts it off the visible text into ``turn.finished.tts``. This
module decides what the gateway actually says:

- the ``TTS:`` line, when there is one. The parser already holds it to :data:`TTS_CAP`;
- otherwise the visible text, cut to the same cap and *announced* — the spoken text ends with
  ``(showing N of M)`` like every other bounded thing in this repository (README §2, invariant 4),
  so a person who hears a reply stop short hears that it stopped short;
- nothing at all for an empty turn, so silence is never synthesised.
"""

from __future__ import annotations

from dataclasses import dataclass

from athena.contracts.channel import TurnFinished
from athena.harness.op_grammar import TTS_CAP

__all__ = ["TTS_CAP", "SpokenLine", "spoken_line"]


@dataclass(frozen=True)
class SpokenLine:
    text: str
    truncated: bool = False


def spoken_line(finished: TurnFinished) -> SpokenLine | None:
    """What to say for one finished turn, or ``None`` when there is nothing to say."""
    if finished.tts and finished.tts.strip():
        return SpokenLine(finished.tts.strip())
    text = finished.text.strip()
    if not text:
        return None
    total = len(text)
    if total <= TTS_CAP:
        return SpokenLine(text)
    return SpokenLine(f"{text[:TTS_CAP]} (showing {TTS_CAP} of {total})", truncated=True)

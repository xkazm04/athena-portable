"""What an utterance is, before it is a turn (README §3.2 step 6; ADR 0019).

Three things a person says into a push-to-talk key are not messages for the model:

- **a stop word** — "stop", "quiet", "never mind" — spoken over a reply is a barge-in and nothing
  else. It cancels playback and starts no turn, because "stop" sent to the model as a message is
  a turn that spends a round working out that it was told to be quiet;
- **an answer token** — "approve", "decline", "yes", "no", or an option's own label — while a
  card is waiting is the user's answer to that card. It goes through the same
  ``POST /decisions/<id>`` path as a button, and the model never sees it;
- everything else is a message, exactly as if it had been typed.

The recognition is exact on a normalised utterance, never fuzzy. "approve the first two" is a
message and not two approvals: a card is consent to one action with the parameters on it, and a
sentence that mentions approving is not that consent. The synonyms are the few words a person
actually says to a yes/no card, and an option whose label is spoken is matched by its label.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Literal

__all__ = [
    "APPROVE_WORDS",
    "DECLINE_WORDS",
    "STOP_WORDS",
    "Card",
    "Spoken",
    "normalise",
    "recognise",
]

#: Barge-in words. Only meaningful while something is being spoken; otherwise they are a message.
STOP_WORDS: frozenset[str] = frozenset(
    {"stop", "quiet", "be quiet", "never mind", "nevermind", "enough", "shut up", "hush"}
)

#: What a person says to a yes/no card. Each maps onto the option *id* ``approve`` / ``decline``,
#: and only when the card actually offers that id — a ``choose`` card is answered by its labels.
APPROVE_WORDS: frozenset[str] = frozenset(
    {"approve", "approved", "yes", "yes please", "go ahead", "do it", "confirm", "okay", "ok"}
)
DECLINE_WORDS: frozenset[str] = frozenset(
    {"decline", "declined", "no", "no thanks", "do not", "dont", "cancel", "reject", "refuse"}
)

_PUNCT = re.compile(r"[^\w\s]+", re.UNICODE)
_SPACES = re.compile(r"\s+")


@dataclass(frozen=True)
class Card:
    """The little a recogniser needs to know about a waiting card: its id and its options."""

    id: str
    #: ``(option id, label)`` pairs, as the card was filed with.
    options: tuple[tuple[str, str], ...]


@dataclass(frozen=True)
class Spoken:
    """What one utterance turned out to be."""

    kind: Literal["stop", "answer", "message", "silence"]
    text: str = ""
    approval_id: str = ""
    choice: str = ""


def normalise(text: str) -> str:
    """Lowercase, no punctuation, single spaces — the form every word list is written in."""
    return _SPACES.sub(" ", _PUNCT.sub(" ", text.lower().replace("'", ""))).strip()


def recognise(text: str, cards: Sequence[Card], *, speaking: bool) -> Spoken:
    """Say what ``text`` is: a barge-in, an answer to the newest card, a message, or nothing.

    ``cards`` is newest first — the card the user was just asked about is the one a bare "yes"
    answers. ``speaking`` is whether a reply is playing right now, because a stop word only means
    stop while there is something to stop; said into silence it is a message like any other.
    """
    spoken = normalise(text)
    if not spoken:
        return Spoken("silence")
    if speaking and spoken in STOP_WORDS:
        return Spoken("stop", text=text)
    for card in cards:
        choice = _choice_for(spoken, card.options)
        if choice is not None:
            return Spoken("answer", text=text, approval_id=card.id, choice=choice)
        # Only the newest card takes a bare yes/no; an older one is answered by its own label
        # or from the inbox, never by a word that was meant for the card on top.
        break
    for card in cards[1:]:
        choice = _label_only(spoken, card.options)
        if choice is not None:
            return Spoken("answer", text=text, approval_id=card.id, choice=choice)
    return Spoken("message", text=text)


def _choice_for(spoken: str, options: Iterable[tuple[str, str]]) -> str | None:
    ids = {option_id for option_id, _ in options}
    labelled = _label_only(spoken, options)
    if labelled is not None:
        return labelled
    if "approve" in ids and spoken in APPROVE_WORDS:
        return "approve"
    if "decline" in ids and spoken in DECLINE_WORDS:
        return "decline"
    return None


def _label_only(spoken: str, options: Iterable[tuple[str, str]]) -> str | None:
    for option_id, label in options:
        if spoken == normalise(option_id) or (label and spoken == normalise(label)):
            return option_id
    return None

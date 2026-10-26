"""Spike 05 F4 (voices make records): which sentences of a family call claim a task.

"I'll call the pharmacy" and "I can take her Tuesday" are claims, owned by whoever said them.
Plain rules, no model: a sentence claims a task when it holds a first-person commitment (``I'll``,
``I will``, ``I can``, ``I'm going to``) that is not negated (``I can't``), not hedged (``if I
can``, ``maybe I will``) and not a question. A rule this plain is wrong sometimes ("I can hear you
now" reads as a claim); the proof counts every row a person would have to correct, which is the
honest price of keeping a model out of attribution.
"""

from __future__ import annotations

import re

_SENTENCE = re.compile(r"[^.!?]+[.!?]*")
_CLAIM = re.compile(r"\b(i'll|i will|i can|i'm going to|i am going to)\b", re.IGNORECASE)
_NEGATED = ("i can't", "i cannot", "i can not", "i will not", "i'll not")
_HEDGES = ("if ", "maybe ", "unless ", "whether ")


def _plain(text: str) -> str:
    return text.replace(chr(0x2019), "'").replace(chr(0x2018), "'")


def claims(text: str) -> list[str]:
    """The sentences of one turn that claim a task, stripped, in the order said."""
    out: list[str] = []
    for match in _SENTENCE.finditer(_plain(text)):
        sentence = match.group(0).strip()
        if not sentence or sentence.endswith("?"):
            continue
        lower = sentence.lower()
        for found in _CLAIM.finditer(lower):
            if lower.startswith(_NEGATED, found.start()):
                continue
            before = lower[: found.start()]
            if before.endswith(_HEDGES):
                continue
            out.append(sentence)
            break
    return out

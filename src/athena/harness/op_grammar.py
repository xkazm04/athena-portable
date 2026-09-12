"""The ``OP:`` line grammar a CLI engine calls tools through (README §3.2 steps 3 and 4).

A CLI engine has no tool-call API Athena can bind to: it prints text. So the capability block
teaches one line format and this module reads it back::

    OP: {"op":"propose_action","action":"host.invoices.mark_paid","params":{"id":7},
         "rationale":"the invoice the user named"}
    TTS: "Two invoices are over thirty days."

Everything else on the line is what the user sees. The two grammars are the two the channel
contract can express — an op becomes ``tool.call`` / ``tool.result`` or a decision card, and the
``TTS:`` first line becomes ``turn.finished.tts``. A third line format with no event behind it
would be a grammar the model is taught and nothing reads.

**Repairs, and why there are only three.** A model that writes JSON by hand gets the same three
things wrong, and each has exactly one correct reading:

- a **trailing comma** before ``}`` or ``]``;
- an **unquoted key** (``{op: "propose_action"}``);
- **missing closing braces** at the end, when the line was cut short.

Anything else is a parse error carrying the offending line, and the caller tells the model next
turn that its op was dropped and why (README §3.2 step 5's path, in reverse). Repairing further
would mean guessing at intent, and an op is a request to *act*: a guess that parses is worse than
a refusal that explains, because only one of the two can be reviewed.

Both text repairs skip string literals, so a rationale that contains ``a: b,`` is left alone. They
run only over text that has already failed to parse, and every candidate must parse before it is
accepted, so a repair that mangles the line falls through to the next candidate or to a reject.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field
from typing import Any

__all__ = [
    "MAX_BRACE_REPAIR",
    "REPAIRS",
    "TTS_CAP",
    "Op",
    "OpError",
    "ParsedTurn",
    "parse_op",
    "parse_turn",
]

#: One to three missing closing braces are repaired. Three is the deepest an envelope nests
#: (``{ … "params": { … } }`` plus one for a nested value), so a fourth is not a truncated line,
#: it is a line that was never an envelope.
MAX_BRACE_REPAIR = 3

#: The spoken line is capped, and the first ``TTS:`` line of a turn wins. A model that writes two
#: is not asking for two sentences to be spoken, it is changing its mind after the fact.
TTS_CAP = 1200

#: The repair names an :class:`Op` reports in ``repairs``. Closed, like ``ERROR_REASONS``: a
#: repair you cannot count is a repair nobody notices the model needing.
REPAIRS: tuple[str, ...] = ("unquoted_key", "trailing_comma", "closing_brace")

_OP_MARKER = re.compile(r"\bOP:\s*")
_TTS = re.compile(r"^\s*TTS:\s*(?P<text>.+?)\s*$")
_BARE_KEY = re.compile(r"([A-Za-z_][A-Za-z0-9_]*)(?=\s*:)")


@dataclass(frozen=True)
class Op:
    """A well-formed envelope. ``repairs`` names what had to be fixed to read it."""

    op: str
    action: str
    params: dict[str, Any] = field(default_factory=dict)
    rationale: str = ""
    raw: str = ""
    repairs: tuple[str, ...] = ()

    @property
    def repaired(self) -> bool:
        return bool(self.repairs)


@dataclass(frozen=True)
class OpError:
    """A dropped envelope, the line it was on, and why.

    ``line`` is the offending text verbatim. The model is told this next turn; a reject that says
    "malformed" without showing what was read teaches nothing.
    """

    line: str
    detail: str
    reason: str = "parse_error"


@dataclass(frozen=True)
class ParsedTurn:
    """One round of assistant text, split into what acts and what the user reads."""

    text: str = ""
    ops: tuple[Op, ...] = ()
    errors: tuple[OpError, ...] = ()
    tts: str | None = None


def parse_turn(assistant_text: str) -> ParsedTurn:
    """Read the grammars out of one round's text and leave the prose behind."""
    visible: list[str] = []
    ops: list[Op] = []
    errors: list[OpError] = []
    tts: str | None = None

    for line in assistant_text.splitlines():
        spoken = _TTS.match(line)
        if spoken is not None:
            if tts is None:  # the first line wins
                tts = _unquote(spoken.group("text"))[:TTS_CAP]
            continue

        envelope = _envelope(line)
        if envelope is None:
            visible.append(line)
            continue

        prefix, payload = envelope
        parsed = parse_op(payload)
        if isinstance(parsed, Op):
            ops.append(parsed)
        else:
            errors.append(parsed)
        if prefix.strip():
            visible.append(prefix.rstrip())

    return ParsedTurn(
        text="\n".join(visible).strip(),
        ops=tuple(ops),
        errors=tuple(errors),
        tts=tts,
    )


def parse_op(payload: str) -> Op | OpError:
    """Parse one envelope body into an :class:`Op`, or say why it was dropped."""
    raw = payload.strip()
    if not raw:
        return OpError(raw, "the envelope is empty")

    data, repairs = _loads(raw)
    if data is None:
        return OpError(raw, "the envelope is not JSON, and no repair rule reads it")
    if not isinstance(data, Mapping):
        return OpError(raw, f"an envelope is a JSON object, not {type(data).__name__}")

    op = data.get("op")
    if not isinstance(op, str) or not op:
        return OpError(raw, "the envelope has no 'op'")
    action = data.get("action", "")
    if not isinstance(action, str):
        return OpError(raw, "'action' must be a string")
    if op == "propose_action" and not action:
        return OpError(raw, "propose_action needs an 'action' name")
    params = data.get("params", {})
    if not isinstance(params, Mapping):
        return OpError(raw, "'params' must be an object")
    rationale = data.get("rationale", "")
    if not isinstance(rationale, str):
        return OpError(raw, "'rationale' must be a string")

    return Op(
        op=op,
        action=action,
        params=dict(params),
        rationale=rationale,
        raw=raw,
        repairs=repairs,
    )


# --- the repair ladder --------------------------------------------------------------------------


def _loads(raw: str) -> tuple[Any, tuple[str, ...]]:
    """The first candidate that parses, with the repairs it needed. ``(None, ())`` if none do."""
    for candidate, repairs in _candidates(raw):
        try:
            return json.loads(candidate), repairs
        except json.JSONDecodeError:
            continue
    return None, ()


def _candidates(raw: str) -> Iterator[tuple[str, tuple[str, ...]]]:
    """Every text worth trying, fewest repairs first.

    The two text repairs accumulate — a line can have both — and each stage is then tried with
    zero to three appended braces, so the cheapest reading of the line is always found first.
    """
    stages: list[tuple[str, tuple[str, ...]]] = [(raw, ())]
    text = raw
    applied: tuple[str, ...] = ()
    for name, repair in (("unquoted_key", _quote_keys), ("trailing_comma", _strip_commas)):
        fixed = repair(text)
        if fixed != text:
            text, applied = fixed, (*applied, name)
            stages.append((text, applied))

    seen: set[str] = set()
    for stage, repairs in stages:
        for missing in range(MAX_BRACE_REPAIR + 1):
            candidate = stage + "}" * missing
            if candidate in seen:
                continue
            seen.add(candidate)
            yield candidate, repairs if missing == 0 else (*repairs, "closing_brace")


def _quote_keys(text: str) -> str:
    """Quote bare object keys. Only outside string literals, only after ``{`` or ``,``."""
    out: list[str] = []
    index = 0
    while index < len(text):
        char = text[index]
        if char == '"':
            end = _end_of_string(text, index)
            out.append(text[index:end])
            index = end
            continue
        key = _BARE_KEY.match(text, index)
        if key is not None and _last_significant(out) in "{,":
            out.append(f'"{key.group(1)}"')
            index = key.end(1)
            continue
        out.append(char)
        index += 1
    return "".join(out)


def _strip_commas(text: str) -> str:
    """Drop a comma whose next significant character closes an object or an array."""
    out: list[str] = []
    index = 0
    while index < len(text):
        char = text[index]
        if char == '"':
            end = _end_of_string(text, index)
            out.append(text[index:end])
            index = end
            continue
        if char == "," and _next_significant(text, index + 1) in "}]":
            index += 1
            continue
        out.append(char)
        index += 1
    return "".join(out)


def _end_of_string(text: str, start: int) -> int:
    """The index just past the string literal that opens at ``start``."""
    index = start + 1
    while index < len(text):
        char = text[index]
        if char == "\\":
            index += 2
            continue
        if char == '"':
            return index + 1
        index += 1
    return len(text)


def _last_significant(out: list[str]) -> str:
    for piece in reversed(out):
        stripped = piece.rstrip()
        if stripped:
            return stripped[-1]
    return ""


def _next_significant(text: str, index: int) -> str:
    while index < len(text) and text[index].isspace():
        index += 1
    return text[index] if index < len(text) else ""


# --- line shapes ---------------------------------------------------------------------------------


def _envelope(line: str) -> tuple[str, str] | None:
    """``(what the user still sees, the envelope body)``, or ``None`` for an ordinary line."""
    marker = _OP_MARKER.search(line)
    if marker is not None:
        return line[: marker.start()], line[marker.end() :]
    stripped = line.strip()
    if stripped.startswith("{") and '"op"' in stripped[:40]:
        return "", stripped
    return None


def _unquote(text: str) -> str:
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'":
        return text[1:-1]
    return text

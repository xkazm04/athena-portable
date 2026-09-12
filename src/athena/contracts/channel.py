"""The channel events — what a turn emits and every surface renders (README §3.2).

Eight events, one stream. The lane produces them; the daemon writes them to an AG-UI SSE stream;
the panel, the voice gateway and the MCP server each render the families they can. They are frozen
dataclasses with a ``kind`` tag, and :meth:`ChannelEvent.to_json` / :func:`event_from_json` are the
only serialization any transport uses — a second encoder is how two surfaces end up disagreeing
about what a decision card said.

An unknown ``kind`` raises rather than being skipped: a surface that silently drops
``decision.requested`` is a gate that never asked.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field, fields
from datetime import UTC, datetime
from typing import Any, ClassVar, Literal, cast


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


@dataclass(frozen=True)
class ChannelEvent:
    """The base. ``kind`` is a ClassVar, so it is on the wire but never a constructor argument."""

    kind: ClassVar[str] = "event"

    def to_dict(self) -> dict[str, Any]:
        return {"kind": self.kind, **asdict(self)}

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), sort_keys=True)

    @staticmethod
    def from_dict(data: dict[str, Any]) -> ChannelEvent:
        return event_from_dict(data)

    @staticmethod
    def from_json(raw: str) -> ChannelEvent:
        return event_from_json(raw)


# ------------------------------------------------------------------------------------------
# the stream family
# ------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class TextDelta(ChannelEvent):
    kind: ClassVar[str] = "text.delta"
    text: str = ""


@dataclass(frozen=True)
class ToolCall(ChannelEvent):
    """A call the gate allowed. A host tool's call is an instruction to the surface, not a record:
    the lane holds no executor for it and waits for the result in the next turn's frame."""

    kind: ClassVar[str] = "tool.call"
    call_id: str = ""
    name: str = ""
    params: dict[str, Any] = field(default_factory=dict)
    origin: str = "core"
    tier: int = 0


@dataclass(frozen=True)
class ToolResult(ChannelEvent):
    """What came back. ``truncated`` is derived from ``shown``/``total`` by the producer, and the
    ``(showing N of M)`` footer is inside ``output`` — never only in this flag."""

    kind: ClassVar[str] = "tool.result"
    call_id: str = ""
    name: str = ""
    ok: bool = True
    output: str = ""
    truncated: bool = False
    error: str | None = None
    tier: int = 0
    ms: int = 0


@dataclass(frozen=True)
class TurnFinished(ChannelEvent):
    """The last event of a good turn. ``tts`` is the capped ``TTS:`` first line, if any."""

    kind: ClassVar[str] = "turn.finished"
    text: str = ""
    tts: str | None = None


@dataclass(frozen=True)
class TurnError(ChannelEvent):
    """The last event of a bad turn. ``reason`` is a member of ``ERROR_REASONS``, always."""

    kind: ClassVar[str] = "turn.error"
    reason: str = "unknown"
    detail: str = ""


@dataclass(frozen=True)
class TurnSummary(ChannelEvent):
    """One per turn, mirroring the ledger row the turn wrote (README §2 invariant 6)."""

    kind: ClassVar[str] = "turn.summary"
    model: str = ""
    engine: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float | None = None
    cost_estimated: bool = False
    duration_ms: int = 0
    #: Model → tool → model rounds inside this one turn. One turn is one ledger row whatever
    #: this says; a lane metering model invocations charges this number and not 1.
    rounds: int = 1


# ------------------------------------------------------------------------------------------
# the decisions family
# ------------------------------------------------------------------------------------------

DecisionKind = Literal["approve", "choose", "guidance"]


@dataclass(frozen=True)
class DecisionOption:
    """One answer token. ``resolve`` accepts these ids and nothing else."""

    id: str
    label: str = ""


@dataclass(frozen=True)
class DecisionRequested(ChannelEvent):
    """A card. ``capture_id`` is the screenshot the daemon minted the approval with, so the user
    sees the page the proposal is about and not a description of it (README §3.5)."""

    kind: ClassVar[str] = "decision.requested"
    id: str = ""
    decision_kind: str = "approve"
    action: str = ""
    params: dict[str, Any] = field(default_factory=dict)
    rationale: str = ""
    options: tuple[DecisionOption, ...] = ()
    expires_at: str = ""
    origin: str = "core"
    surface: str = "panel"
    capture_id: str | None = None


@dataclass(frozen=True)
class DecisionResolved(ChannelEvent):
    kind: ClassVar[str] = "decision.resolved"
    id: str = ""
    choice: str = ""
    by: str = "user"  # "user" | "athena"
    at: str = ""


EVENT_KINDS: dict[str, type[ChannelEvent]] = {
    cls.kind: cls
    for cls in (
        TextDelta,
        ToolCall,
        ToolResult,
        TurnFinished,
        TurnError,
        TurnSummary,
        DecisionRequested,
        DecisionResolved,
    )
}

FAMILIES: dict[str, tuple[str, ...]] = {
    "stream": ("text.delta", "tool.call", "tool.result", "turn.finished", "turn.error"),
    "record": ("turn.summary",),
    "decisions": ("decision.requested", "decision.resolved"),
}


def family_of(kind: str) -> str:
    for family, kinds in FAMILIES.items():
        if kind in kinds:
            return family
    raise KeyError(kind)


def event_from_dict(data: dict[str, Any]) -> ChannelEvent:
    """Rebuild an event from its wire form. Unknown keys are dropped, an unknown kind raises."""
    payload = dict(data)
    kind = payload.pop("kind", None)
    if not isinstance(kind, str) or kind not in EVENT_KINDS:
        raise ValueError(f"unknown channel event kind: {kind!r}")
    event_cls = EVENT_KINDS[kind]
    names = {f.name for f in fields(event_cls)}
    kwargs = {k: v for k, v in payload.items() if k in names}
    if event_cls is DecisionRequested and "options" in kwargs:
        kwargs["options"] = tuple(
            o if isinstance(o, DecisionOption) else DecisionOption(**o) for o in kwargs["options"]
        )
    ctor = cast(Any, event_cls)
    return cast(ChannelEvent, ctor(**kwargs))


def event_from_json(raw: str) -> ChannelEvent:
    loaded = json.loads(raw)
    if not isinstance(loaded, dict):
        raise ValueError(f"a channel event must be a JSON object, got {type(loaded).__name__}")
    return event_from_dict(cast(dict[str, Any], loaded))

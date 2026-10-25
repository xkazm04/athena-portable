"""The channel events — what a turn emits and every surface renders (README §3.2).

Eleven events, one stream. The lane produces them; the daemon writes them to an AG-UI SSE stream;
the panel and the voice gateway each render the families they can (the MCP server README §3 plans
would be a third; it is not built). They are frozen dataclasses with a ``kind`` tag, and
:meth:`ChannelEvent.to_dict` is the one shape every transport sends (``daemon.routes``'
``event_payload``, SSE and the voice socket alike), with :func:`event_from_json` as its reader — a
second encoder is how two surfaces end up disagreeing about what a decision card said.

An unknown ``kind`` raises rather than being skipped: a surface that silently drops
``decision.requested`` is a gate that never asked.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field, fields
from datetime import UTC, datetime
from typing import Any, ClassVar, Literal, cast

from athena.contracts.reasons import normalize_reason, reason_of_error


def iso(moment: datetime) -> str:
    """UTC with an explicit offset, so the strings sort the way the instants do and parse back."""
    aware = moment if moment.tzinfo else moment.replace(tzinfo=UTC)
    return aware.astimezone(UTC).isoformat()


def now_iso() -> str:
    return iso(datetime.now(UTC))


def cut_text(text: str, limit: int) -> str:
    """``text`` cut to ``limit`` characters with ``(showing N of M)`` on a new line, or whole.

    The one announced cut (README §2 invariant 4): text within the limit comes back unchanged.
    """
    total = len(text)
    if total <= limit:
        return text
    return f"{text[:limit]}\n(showing {limit} of {total})"


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
    ``(showing N of M)`` footer is inside ``output`` — never only in this flag. A failure says why
    in ``reason`` (the closed vocabulary) and which instance in ``error`` (free text)."""

    kind: ClassVar[str] = "tool.result"
    call_id: str = ""
    name: str = ""
    ok: bool = True
    output: str = ""
    truncated: bool = False
    error: str | None = None
    tier: int = 0
    ms: int = 0
    #: Where the text came from when it was not the focused page: the catalog origin
    #: (``host:<app_id>``) of the other tab a ``tabs_read`` read. Set by the surface from the tab
    #: it read, never by a model; the record groups the episode under it (ADR 0105).
    source: str | None = None
    #: Why a failure failed: a member of ``ERROR_REASONS``, decided at construction and ``None``
    #: on success. ``error`` is the bounded free-text detail beside it, never parsed for meaning.
    #: A writer that sends no reason (one from before this field) has it derived from a legacy
    #: ``<reason>`` or ``<reason>: detail`` error, and any other text reads as ``unknown``.
    reason: str | None = None

    def __post_init__(self) -> None:
        if self.ok:
            reason = None
        elif isinstance(self.reason, str) and self.reason.strip():
            reason = normalize_reason(self.reason)
        else:
            reason = reason_of_error(self.error)
        object.__setattr__(self, "reason", reason)


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
# the voice family
# ------------------------------------------------------------------------------------------


TranscriptOutcome = Literal["message", "answer", "stop", "too_short", "silent", "no_words"]

#: How one utterance ended, each named by the stage that knew it (ADR 0110). ``message`` runs a
#: turn and ``answer`` answers a card, so the surface waits for what follows; the other four end
#: the utterance on the transcript itself. ``stop`` is a stop word over a reply; ``too_short`` a
#: key tapped and let go; ``silent`` a capture the level gate stopped before any engine heard it;
#: ``no_words`` sound an engine heard and made no words of. The desktop's ``events.ts`` declares
#: the same tuple, and a test reads it.
TRANSCRIPT_OUTCOMES: tuple[TranscriptOutcome, ...] = (
    "message",
    "answer",
    "stop",
    "too_short",
    "silent",
    "no_words",
)


@dataclass(frozen=True)
class VoiceTranscript(ChannelEvent):
    """What the microphone said, as the backend heard it. ``final`` marks the end of an
    utterance; a partial is a hint the surface may show and the gateway may treat as speech.

    A final transcript says how the utterance ended: ``outcome`` is a member of
    :data:`TRANSCRIPT_OUTCOMES`, and ``peak_dbfs`` is the loudest sample the microphone sent, when
    the transcriber measured it. A partial, and a producer from before ADR 0110, leave them ``""``
    and ``None``; a reader takes that to mean "not said", never "silent"."""

    kind: ClassVar[str] = "voice.transcript"
    text: str = ""
    final: bool = False
    outcome: str = ""
    peak_dbfs: float | None = None


@dataclass(frozen=True)
class VoiceSpeaking(ChannelEvent):
    """Playback of one spoken reply begins. ``generation`` tags the audio frames that follow, so
    a surface that heard ``voice.stopped`` for the same generation drops what is still in flight.
    ``truncated`` says the spoken text was cut to the cap and the text itself says how much."""

    kind: ClassVar[str] = "voice.speaking"
    generation: int = 0
    text: str = ""
    truncated: bool = False
    sample_rate: int = 16000


@dataclass(frozen=True)
class VoiceStopped(ChannelEvent):
    """Playback of ``generation`` ended: ``done`` when it played out, ``barge_in`` when the user
    spoke over it, ``error`` when the backend could not synthesise it."""

    kind: ClassVar[str] = "voice.stopped"
    generation: int = 0
    reason: str = "done"


@dataclass(frozen=True)
class VoiceVisemes(ChannelEvent):
    """The mouth shapes of one sentence of ``generation``, sent before that sentence's audio.

    ``offset`` is where the sentence starts, in samples from the line's first audio sample, and
    each viseme is ``(v, start, end)`` in samples from ``offset``: ``v`` is one of the Oculus 15
    (``sil PP FF TH DD kk CH SS nn RR aa E ih oh ou``), and the segments are ordered, do not
    overlap and cover the sentence. Times are taken from the speech model's own durations, so they
    match the audio that follows (ADR on Athena's face). Only sent when the face helper is ready;
    a surface without them drives the mouth from playback level."""

    kind: ClassVar[str] = "voice.visemes"
    generation: int = 0
    sentence: int = 0
    offset: int = 0
    sample_rate: int = 24000
    visemes: tuple[tuple[str, int, int], ...] = ()


@dataclass(frozen=True)
class VoiceMotion(ChannelEvent):
    """Head and eye motion for one sentence of ``generation``, predicted from its audio, sent
    whenever it is ready (it may arrive after the sentence started; a surface crossfades it in).

    ``frames`` are RigParams v1 frames at ``fps``, timed from ``offset`` (samples from the line's
    first audio sample): ``{"t", "head": {"yaw","pitch","roll"}, "eyes": {"blinkL","blinkR",
    "gazeX","gazeY"}, "brow": {"raise"}}`` - head in degrees, blink 0..1, gaze -1..1. A channel the
    model does not predict is omitted, never zero. Only sent when the face helper has a motion
    model."""

    kind: ClassVar[str] = "voice.motion"
    generation: int = 0
    sentence: int = 0
    offset: int = 0
    fps: int = 60
    frames: tuple[dict[str, Any], ...] = ()


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
    sees the page the proposal is about and not a description of it (README §3.5).

    ``tab_id`` and ``tab_nav`` bind the card to the tab it was proposed on and to that tab's
    document generation (ADR 0103): an approval runs there or not at all. ``None`` on a card with
    no binding - a connector's, core's, or one filed before the binding existed."""

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
    tab_id: int | None = None
    tab_nav: int | None = None


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
        VoiceTranscript,
        VoiceSpeaking,
        VoiceStopped,
        VoiceVisemes,
        VoiceMotion,
    )
}

FAMILIES: dict[str, tuple[str, ...]] = {
    "stream": ("text.delta", "tool.call", "tool.result", "turn.finished", "turn.error"),
    "record": ("turn.summary",),
    "decisions": ("decision.requested", "decision.resolved"),
    "voice": (
        "voice.transcript",
        "voice.speaking",
        "voice.stopped",
        "voice.visemes",
        "voice.motion",
    ),
}


def family_of(kind: str) -> str:
    for family, kinds in FAMILIES.items():
        if kind in kinds:
            return family
    raise KeyError(kind)


def event_from_dict(data: dict[str, Any]) -> ChannelEvent:
    """Rebuild an event from its wire form. Unknown keys are dropped, a card's options' too; an
    unknown kind or a malformed option raises ``ValueError``."""
    payload = dict(data)
    kind = payload.pop("kind", None)
    if not isinstance(kind, str) or kind not in EVENT_KINDS:
        raise ValueError(f"unknown channel event kind: {kind!r}")
    event_cls = EVENT_KINDS[kind]
    names = {f.name for f in fields(event_cls)}
    kwargs = {k: v for k, v in payload.items() if k in names}
    if event_cls is DecisionRequested and "options" in kwargs:
        kwargs["options"] = tuple(_option_from(o) for o in kwargs["options"])
    if event_cls is VoiceVisemes and "visemes" in kwargs:
        kwargs["visemes"] = tuple((str(v), int(s), int(e)) for v, s, e in kwargs["visemes"])
    if event_cls is VoiceMotion and "frames" in kwargs:
        kwargs["frames"] = tuple(dict(f) for f in kwargs["frames"])
    ctor = cast(Any, event_cls)
    return cast(ChannelEvent, ctor(**kwargs))


def _option_from(raw: object) -> DecisionOption:
    """One card option off the wire, by the event's own rule: unknown keys are dropped, and
    anything that is not an option is a ``ValueError`` naming it."""
    if isinstance(raw, DecisionOption):
        return raw
    if not isinstance(raw, dict) or not isinstance(raw.get("id"), str):
        raise ValueError(f"a decision option must be an object with a string id: {raw!r}")
    label = raw.get("label", "")
    return DecisionOption(id=raw["id"], label=label if isinstance(label, str) else str(label))


def event_from_json(raw: str) -> ChannelEvent:
    loaded = json.loads(raw)
    if not isinstance(loaded, dict):
        raise ValueError(f"a channel event must be a JSON object, got {type(loaded).__name__}")
    return event_from_dict(cast(dict[str, Any], loaded))

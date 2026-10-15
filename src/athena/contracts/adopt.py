"""The Adopt studio's wire contract — the session events and the shapes they carry (ADR 0097).

Adopting a playbook is a conversation, not a form: Athena asks batched question cards whose
questions a model writes to fill *slots* derived from the playbook, research lanes fill slots on
their own, and an auditor decides when nothing is open. Everything the desktop sees of that
arrives as one ordered stream of ``adopt.*`` events, each with a ``seq`` so a reconnect resumes
with ``after=<seq>``.

Absent values: an optional string is ``""``, an optional number or object is ``None`` (JSON
``null``), a list is ``[]``; a key is never omitted, so the desktop never has to tell "absent"
from "empty" twice.

This module is pure data: no I/O, no model calls. The session produces every event but
``adopt.lane`` and ``adopt.showcase``, which the research lanes and the showcase produce.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from typing import Any, ClassVar, Literal

SlotKind = Literal["portal", "gate", "fact", "trap"]
SlotStatus = Literal["open", "guessed", "confirmed"]
SlotSource = Literal["user", "research", "memory", "document", "account", "default"]
LaneKind = Literal["rules", "accounts", "memory", "document"]
LaneStatus = Literal["queued", "running", "done", "failed", "skipped"]
ShowcaseStatus = Literal["queued", "running", "done", "failed"]
AnswerVia = Literal["text", "voice"]

#: Every model call names its kind; the tier bench picks the model and effort per kind (tiers.json).
LegKind = Literal["interview", "audit", "research", "shape", "persona", "judge", "intake"]
LEG_KINDS: tuple[LegKind, ...] = (
    "interview",
    "audit",
    "research",
    "shape",
    "persona",
    "judge",
    "intake",
)
VerdictFit = Literal["template", "custom"]
Effort = Literal["low", "medium"]


@dataclass(frozen=True)
class Slot:
    id: str
    kind: SlotKind
    label: str
    status: SlotStatus = "open"
    value: str = ""
    source: SlotSource = "default"


@dataclass(frozen=True)
class Option:
    id: str
    label: str


@dataclass(frozen=True)
class Question:
    id: str
    slot_ids: tuple[str, ...]
    text: str
    options: tuple[Option, ...] = ()
    multi: bool = False
    allow_text: bool = True


@dataclass(frozen=True)
class Finding:
    text: str
    source_url: str = ""
    slot_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class Lane:
    id: str
    kind: LaneKind
    title: str
    status: LaneStatus = "queued"
    summary: str = ""
    findings: tuple[Finding, ...] = ()


@dataclass(frozen=True)
class Answer:
    question_id: str
    choice_ids: tuple[str, ...] = ()
    text: str = ""


@dataclass(frozen=True)
class Tier:
    model: str
    effort: Effort


# ------------------------------------------------------------------------------------------
# events
# ------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class AdoptEvent:
    """The base. ``kind`` is a ClassVar: on the wire, never a constructor argument. ``seq`` is
    set by the session's stream when the event is appended (0 before that)."""

    kind: ClassVar[str] = "adopt.event"
    seq: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {"kind": self.kind, **asdict(self)}

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), sort_keys=True)


@dataclass(frozen=True)
class Progress(AdoptEvent):
    kind: ClassVar[str] = "adopt.progress"
    text: str = ""


@dataclass(frozen=True)
class Say(AdoptEvent):
    """Athena's line, in simple markdown (blank-line blocks, ``- `` bullets, ``**bold**``)."""

    kind: ClassVar[str] = "adopt.say"
    text: str = ""


@dataclass(frozen=True)
class Questions(AdoptEvent):
    """One card: at most four questions."""

    kind: ClassVar[str] = "adopt.questions"
    round: int = 0
    questions: tuple[Question, ...] = ()


@dataclass(frozen=True)
class Slots(AdoptEvent):
    kind: ClassVar[str] = "adopt.slots"
    slots: tuple[Slot, ...] = ()


@dataclass(frozen=True)
class LaneEvent(AdoptEvent):
    kind: ClassVar[str] = "adopt.lane"
    lane: Lane | None = None


@dataclass(frozen=True)
class Brief(AdoptEvent):
    """The situation brief: ``md`` to read, ``command`` to hand over, ``portals`` playbook name
    -> theirs ("" = the same), ``open_slot_ids`` the slots still guessed or open when drafted."""

    kind: ClassVar[str] = "adopt.brief"
    rev: int = 0
    md: str = ""
    command: str = ""
    portals: dict[str, str] = field(default_factory=dict)
    open_slot_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class Clear(AdoptEvent):
    """The auditor found no open slot: brief ``rev`` is ready for approval."""

    kind: ClassVar[str] = "adopt.clear"
    rev: int = 0


@dataclass(frozen=True)
class Showcase(AdoptEvent):
    """The tailored rehearsal. ``trace`` uses bench.json's trace-turn shape."""

    kind: ClassVar[str] = "adopt.showcase"
    status: ShowcaseStatus = "queued"
    turn: int | None = None
    total: int | None = None
    trace: tuple[dict[str, Any], ...] = ()
    found_usd: float | None = None
    detail: str = ""


@dataclass(frozen=True)
class Usage(AdoptEvent):
    kind: ClassVar[str] = "adopt.usage"
    leg: str = ""
    model: str = ""
    effort: str = ""
    ms: int = 0
    first_text_ms: int | None = None


@dataclass(frozen=True)
class Alternate:
    """A chore that nearly fits: ``why`` is one sentence on what it would do for this need."""

    playbook_id: str
    title: str = ""
    why: str = ""


@dataclass(frozen=True)
class Verdict(AdoptEvent):
    """The intake conversation's end (the front door of the Chores page, ADR 0098).

    ``fit`` ``"template"``: ``playbook_id`` is the chore that fits, ``why`` says why and
    ``differs`` what would differ for this person; ``command`` is ``""``. ``fit`` ``"custom"``:
    ``playbook_id`` is ``""`` and ``command`` is a draft to hand to Athena. ``need`` is the need in
    the person's words, kept short; it becomes the opening message of an adopt session.
    """

    kind: ClassVar[str] = "adopt.verdict"
    fit: VerdictFit = "custom"
    playbook_id: str = ""
    why: str = ""
    differs: str = ""
    alternates: tuple[Alternate, ...] = ()
    need: str = ""
    command: str = ""


@dataclass(frozen=True)
class Error(AdoptEvent):
    kind: ClassVar[str] = "adopt.error"
    reason: str = ""
    detail: str = ""


_EVENTS: tuple[type[AdoptEvent], ...] = (
    Progress,
    Say,
    Questions,
    Slots,
    LaneEvent,
    Brief,
    Clear,
    Showcase,
    Usage,
    Verdict,
    Error,
)
EVENT_KINDS: tuple[str, ...] = tuple(c.kind for c in _EVENTS)

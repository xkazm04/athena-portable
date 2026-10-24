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
#: Why a done showcase claims no dollar figure (ADR 0125): ``""`` none withheld, ``"shaped"`` the
#: shape leg edited rows or moved ``today``, so the answer key no longer matches the world.
FoundReason = Literal["", "shaped"]
AnswerVia = Literal["text", "voice"]

#: Every model call names its kind; the tier bench picks the model and effort per kind (tiers.json).
#: The two ``sleep.*`` kinds are the sleep cycle's legs (ADR 0143), which go through the same door.
LegKind = Literal[
    "interview",
    "audit",
    "research",
    "shape",
    "persona",
    "judge",
    "intake",
    "sleep.compress",
    "sleep.merge",
]
LEG_KINDS: tuple[LegKind, ...] = (
    "interview",
    "audit",
    "research",
    "shape",
    "persona",
    "judge",
    "intake",
    "sleep.compress",
    "sleep.merge",
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
    """The tailored rehearsal. ``trace`` uses bench.json's trace-turn shape.

    ``found_usd`` is the bench's ``value_found_usd`` only while the answer key still holds (ADR
    0125): a world shaped by renames alone. Otherwise it is ``None`` and ``found_reason`` says why.
    """

    kind: ClassVar[str] = "adopt.showcase"
    status: ShowcaseStatus = "queued"
    turn: int | None = None
    total: int | None = None
    trace: tuple[dict[str, Any], ...] = ()
    found_usd: float | None = None
    found_reason: FoundReason = ""
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


# ------------------------------------------------------------------------------------------
# the case file (ADR 0123)
# ------------------------------------------------------------------------------------------

#: The shape version of a case file's data block. A reader refuses a version it does not know.
CASE_SCHEMA = 1


@dataclass(frozen=True)
class CaseSlot:
    """One slot as the case keeps it: the :class:`Slot`, plus when it was last confirmed
    (``confirmed_at``, ISO 8601 UTC, ``""`` when never), the person's own words for it
    (``quote``, ``""`` when none) and the fact written from it (``fact_id``, ``""`` when none)."""

    id: str
    kind: SlotKind
    label: str
    status: SlotStatus = "open"
    value: str = ""
    source: SlotSource = "default"
    confirmed_at: str = ""
    quote: str = ""
    fact_id: str = ""


@dataclass(frozen=True)
class CaseApproval:
    """One approval of the case: the brief ``rev``, when, and the episode that records it."""

    rev: int
    at: str
    episode_id: str


@dataclass(frozen=True)
class Case:
    """A standing case: one person's setup of one playbook, kept in ``goals/<id>.md``.

    ``id`` is a minted ``proj_`` id, one per case and kept across re-approvals.
    ``approved_rev`` / ``approved_at`` / ``episode_id`` are the latest approval's; ``approvals``
    is every one, oldest first. ``brief_md``, ``command``, ``portals`` and ``open_slot_ids`` are
    the approved :class:`Brief`'s. ``created`` is the first approval's time.
    """

    id: str
    playbook_id: str
    title: str
    approved_rev: int
    approved_at: str
    episode_id: str
    created: str
    brief_md: str = ""
    command: str = ""
    portals: dict[str, str] = field(default_factory=dict)
    open_slot_ids: tuple[str, ...] = ()
    slots: tuple[CaseSlot, ...] = ()
    approvals: tuple[CaseApproval, ...] = ()
    schema: int = CASE_SCHEMA


@dataclass(frozen=True)
class CaseSummary:
    """One row of ``GET /adopt/cases``: enough to name a case and open it."""

    case_id: str
    playbook_id: str
    title: str
    approved_rev: int
    approved_at: str
    created: str
    confirmed: int = 0
    slots: int = 0


# ------------------------------------------------------------------------------------------
# the receipts of a case's runs (ADR 0124)
# ------------------------------------------------------------------------------------------

#: The shape version of one receipt, as the case file's ``receipts`` list keeps it.
RECEIPT_SCHEMA = 1


@dataclass(frozen=True)
class ReceiptCard:
    """One card filed in the run, as the approval table holds it.

    ``status`` is the row's (``approved``, ``declined``, ``expired``, ``pending``); ``consumed``
    says the gate let an approved one through. ``params`` are the card's key parameters as text,
    each cut, at most :data:`athena.adopt.receipts.PARAMS_CAP` of them (``more_params`` counts the
    rest): what the page proposed, untrusted, for a surface to show as text and never as markup.
    ``amount_usd`` is the card's own amount parameter, ``None`` without one.
    """

    id: str
    action: str
    status: str
    consumed: bool = False
    created_at: str = ""
    resolved_at: str = ""
    params: dict[str, str] = field(default_factory=dict)
    more_params: int = 0
    amount_usd: float | None = None


@dataclass(frozen=True)
class ReceiptNote:
    """A call of the run that may have completed (``outcome_unknown``, ADR 0101): the episode
    that records it, when, and its text cut (untrusted: it carries the page's output)."""

    episode_id: str
    at: str
    text: str


@dataclass(frozen=True)
class Receipt:
    """What one run of a case came to, joined by the turns stamped under the case (ADR 0127).

    The run is the case's ``turns`` that began in ``since`` .. ``until`` (``""`` for the start,
    and for a run still open), each in its own tab's conversation. Every count is the approval
    table's for the cards those turns filed; ``consumed`` is of ``approved``. ``asked_usd`` sums
    the amount parameter of the approved cards (``asked_cards`` of them), what the cards asked
    for and never what came back; ``None`` when no approved card named an amount. ``calls`` ..
    ``ms`` sum the ledger's rows of those turns. ``conversation_id`` is ``""``: a run spans each
    tab's own; a receipt kept before ADR 0127 names the ``conv_proj_…`` it was folded from.
    ``cards`` and ``notes`` are bounded: ``cards_total`` and ``notes_total`` are the populations,
    and each ``*_footer`` is ``(showing N of M)`` or ``""``.
    ``closed_by`` is ``"done"`` once the person pressed done, else ``""``.
    """

    case_id: str
    conversation_id: str
    since: str = ""
    until: str = ""
    first_at: str = ""
    last_at: str = ""
    turns: int = 0
    approved: int = 0
    consumed: int = 0
    declined: int = 0
    expired: int = 0
    pending: int = 0
    asked_usd: float | None = None
    asked_cards: int = 0
    calls: int = 0
    errors: int = 0
    cost_usd: float = 0.0
    unpriced: int = 0
    ms: int = 0
    cards: tuple[ReceiptCard, ...] = ()
    cards_total: int = 0
    cards_footer: str = ""
    notes: tuple[ReceiptNote, ...] = ()
    notes_total: int = 0
    notes_footer: str = ""
    closed_by: str = ""
    closed_at: str = ""
    schema: int = RECEIPT_SCHEMA


# ------------------------------------------------------------------------------------------
# when a chore comes due (ADR 0131)
# ------------------------------------------------------------------------------------------

#: The shape version of a cadence file's data block. A reader refuses a version it does not know.
CADENCE_SCHEMA = 1

#: The three rules a chore's cadence is written in: a weekday, a day of the month, or every N days.
CadenceKind = Literal["weekly", "monthly", "every_days"]
CADENCE_KINDS: tuple[CadenceKind, ...] = ("weekly", "monthly", "every_days")
#: How a review was closed: ``""`` still open, ``prepare`` she pressed "Open and prepare",
#: ``skip`` she skipped this one, ``paused`` she paused the chore with it open.
ReviewAnswer = Literal["", "prepare", "skip", "paused"]
#: One line of a due review, in the order the review lists them.
ReviewLineKind = Literal["expired", "may_have_completed", "pending", "approved", "declined"]
REVIEW_LINE_KINDS: tuple[ReviewLineKind, ...] = (
    "expired",
    "may_have_completed",
    "pending",
    "approved",
    "declined",
)
#: Where an "Open and prepare" address came from: the playbook's app, the case's own slot, none.
PortalSource = Literal["playbook", "case", ""]


@dataclass(frozen=True)
class CadenceRule:
    """When a chore comes due, in the person's own wall-clock time (``Cadence.timezone``).

    ``weekly`` uses ``weekday`` (0 Monday .. 6 Sunday); ``monthly`` uses ``day`` (1 .. 31, a
    month shorter than it falls on its last day); ``every_days`` uses ``every_days`` (1 .. 366)
    counted from ``start`` (a local ``YYYY-MM-DD``, the first occurrence). ``at`` is ``HH:MM``.
    """

    kind: CadenceKind
    weekday: int = 0
    day: int = 1
    every_days: int = 0
    start: str = ""
    at: str = "09:00"


@dataclass(frozen=True)
class ChoreReview:
    """The review a due occurrence opened: at most one per case is open (``answer`` ``""``).

    ``due_at`` is the occurrence it stands for (ISO UTC), the identity its one notification is
    keyed on with the case. ``missed`` counts the later occurrences folded into it, the first ten
    in ``missed_at``. ``delivered_at`` is when the desktop showed its notice (``""`` not yet);
    ``held_at`` when quiet hours first held it. ``first_turn_id`` is the turn the ledger records
    as ``trigger_kind='schedule'`` after "Open and prepare" (``""`` until her first send).
    """

    due_at: str
    opened_at: str
    missed: int = 0
    missed_at: tuple[str, ...] = ()
    delivered_at: str = ""
    held_at: str = ""
    answer: ReviewAnswer = ""
    answered_at: str = ""
    first_turn_id: str = ""


@dataclass(frozen=True)
class CadenceLine:
    """One explainable line of a cadence's log: what the loop or the person decided, and why."""

    at: str
    event: str
    due_at: str = ""
    text: str = ""


@dataclass(frozen=True)
class Cadence:
    """A chore's cadence, kept in ``rituals/cadence/<proj>.md`` (ADR 0131).

    ``id`` is a minted ``rit_`` id; ``case_id`` the case it is the cadence of. ``next_run_at`` and
    ``last_run_at`` are ISO UTC (``""`` none); ``next_run_at`` is a cache of the rule, recomputed on
    every change of the rule, the zone or ``enabled``. ``unanswered`` counts the occurrences that
    came due while a review she had been shown sat unanswered; at :data:`ASK_SLOW_AFTER` the
    review asks whether to pause or slow the chore. ``log`` keeps the latest lines, ``log_total``
    counts every line ever written.
    """

    id: str
    case_id: str
    enabled: bool
    rule: CadenceRule
    timezone: str
    next_run_at: str
    last_run_at: str
    created: str
    updated_at: str = ""
    review: ChoreReview | None = None
    unanswered: int = 0
    log: tuple[CadenceLine, ...] = ()
    log_total: int = 0
    schema: int = CADENCE_SCHEMA


#: Unanswered occurrences in a row before a review asks "pause or slow this chore?".
ASK_SLOW_AFTER = 3


@dataclass(frozen=True)
class ReviewLine:
    """One line of a due review, from the case's last receipt: a card (``action``, its kept
    ``params``, when it was filed or answered) or a call that may have completed (``text``)."""

    kind: ReviewLineKind
    action: str = ""
    params: dict[str, str] = field(default_factory=dict)
    at: str = ""
    text: str = ""


@dataclass(frozen=True)
class ReviewPortal:
    """One app "Open and prepare" opens: the playbook's address, else the case's own, else none
    (``url`` ``""``, said, never guessed)."""

    name: str
    url: str = ""
    source: PortalSource = ""


@dataclass(frozen=True)
class DueReview:
    """``GET /adopt/cases/<proj>/review``: a chore's review, assembled with no model call from the
    case file, its cadence and its last receipt (ADR 0131)."""

    case_id: str
    playbook_id: str
    title: str
    command: str
    enabled: bool
    rule_text: str
    timezone: str
    next_run_at: str
    review: ChoreReview | None = None
    unanswered: int = 0
    ask_slow: bool = False
    last_run_at: str = ""
    lines: tuple[ReviewLine, ...] = ()
    lines_total: int = 0
    lines_footer: str = ""
    portals: tuple[ReviewPortal, ...] = ()


@dataclass(frozen=True)
class DueNotice:
    """One notice ``GET /adopt/chores/due`` asks the desktop to show, once per (case, due)."""

    case_id: str
    playbook_id: str
    title: str
    due_at: str
    missed: int = 0
    ask_slow: bool = False


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


def cap_text(text: str, limit: int) -> str:
    """Cut ``text`` to ``limit`` characters, ending in an ellipsis when it was cut."""
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"

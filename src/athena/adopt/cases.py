"""ADR 0123 (a case file that survives restarts): the approved brief, kept as a goal in the brain.

An adopt session lives in daemon memory and dies with the daemon or after two hours idle. What
the person approved must not: on a successful approve the studio writes a **case** to
``goals/<proj>.md`` through :meth:`Brain.write_goal`, where ``proj`` is a ``proj_`` id minted
once per case (``contracts/ids.py``) and kept by every later approval of the same case. Opening
the case again (``POST /adopt {playbook_id, case_id}``) starts a session that already holds it.

**The file.** The brain's goal header is five keys (``id, type, title, session, created``) and
nothing of the chore goes there. The body is markdown a person can read (the brief, the
command, the apps, each slot with its status, source, date and her words, every approval), and
ends in one data block the code reads, after a marker line::

    <!-- athena:case -->
    ```json
    {"schema": 1, "id": "proj_…", ...}
    ```

The block is the :class:`~athena.contracts.adopt.Case` as JSON plus any key this module does
not own (a later writer's ``receipts``, say), which a rewrite carries forward untouched. The
reader takes the **last** marker, so a brief that quotes one cannot stand in for the real block.
Everything in the block is the person's case and the model's brief: untrusted text, to be fenced
by whoever puts it in a prompt.

**Provenance.** Each approval is an episode (role ``user``, in the case's conversation
``conv_proj_…``, marked ``[adopt] [project:proj_…]``), and every slot the person confirmed in
this session becomes a fact (scope ``project``) citing that episode, through
:meth:`Brain.write_fact` and its gate. A slot carried from the case and not touched again keeps
the fact it already has. Order: episode, facts, then the goal file, so a crash part way leaves
evidence and never a case citing what was not written.

**Reopening.** Slots the playbook still has, under the same id, kind and label, carry over with
source ``memory`` and their date; a confirmed one stays confirmed, except a ``fact`` that names
a date or an amount (:func:`perishable`), which reopens as ``guessed`` so the auditor asks again
from her words. The brief at the approved rev is the session's current draft, so it is shown at
once with no interview.
"""

from __future__ import annotations

import json
import re
import threading
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, fields
from typing import TYPE_CHECKING, Any

from athena.adopt import receipts as runs
from athena.contracts import ids
from athena.contracts.adopt import (
    CASE_SCHEMA,
    Brief,
    Case,
    CaseApproval,
    CaseSlot,
    CaseSummary,
    Receipt,
    Slot,
    SlotSource,
    SlotStatus,
)
from athena.contracts.channel import now_iso
from athena.core.brain import frontmatter
from athena.core.brain.store import Brain
from athena.lane.browser_lane import marked

if TYPE_CHECKING:
    from athena.adopt.session import AdoptSession

__all__ = [
    "CASE_MARKER",
    "MAX_CASES",
    "CaseBook",
    "CaseUnreadable",
    "case_brief",
    "parse_case",
    "perishable",
    "render_case",
    "reopen_slots",
    "summary",
]

#: The line before the data block. The reader takes the last one in the body.
CASE_MARKER = "<!-- athena:case -->"
_OPEN = "```json"
_CLOSE = "```"
#: The most rows ``GET /adopt/cases`` answers; past it the reply says ``(showing N of M)``.
MAX_CASES = 20
QUOTE_CAP = 400

_SOURCES: tuple[SlotSource, ...] = ("user", "research", "memory", "document", "account", "default")
_STATUSES: tuple[SlotStatus, ...] = ("open", "guessed", "confirmed")
_OWNED = frozenset(f.name for f in fields(Case))


class CaseUnreadable(ValueError):
    """A goal file that is not a case this module can read (no block, bad JSON, wrong schema)."""


# --- what reopens as a guess ---------------------------------------------------------------------

_MONTHS = (
    r"jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t|tember)?|"
    r"oct(ober)?|nov(ember)?|dec(ember)?"
)
_DATE = re.compile(
    rf"\b({_MONTHS})\b|\b\d{{4}}-\d{{1,2}}-\d{{1,2}}\b|\b\d{{1,2}}[/.]\d{{1,2}}([/.]\d{{2,4}})?\b|"
    r"\b(date|dated|deadline|due|day|days|week|weeks|month|months|year|years|quarter|"
    r"annual|anniversary|renewal|expir\w*)\b",
    re.I,
)
_AMOUNT = re.compile(
    r"[$€£¥]\s*\d|\d\s*(usd|eur|gbp|dollars?|euros?|pounds?|%|percent)\b|"
    r"\b(amount|balance|total|fee|fees|cost|price|rate|owed|owe|paid|payment|salary|"
    r"wage|income|rent|premium|deductible|limit|threshold|charge|refund|interest)\b",
    re.I,
)


def perishable(slot: Slot | CaseSlot) -> bool:
    """A ``fact`` slot whose label or value names a date or an amount: it may have moved since
    the case was approved, so it reopens as ``guessed`` (ADR 0123). Portals, gates and traps,
    and facts like a head count or a state, carry over as they were."""
    if slot.kind != "fact":
        return False
    text = f"{slot.label} {slot.value}"
    return bool(_DATE.search(text) or _AMOUNT.search(text))


# --- the file ------------------------------------------------------------------------------------


def render_case(case: Case, extra: Mapping[str, Any] | None = None) -> str:
    """The goal file's body: the case for a person to read, then its data block."""
    date = case.approved_at[:10]
    parts = [
        f"# {case.title}",
        f"Your case for **{case.title}** (playbook `{case.playbook_id}`), approved as draft "
        f"{case.approved_rev} on {date}.",
        "## The brief",
        case.brief_md.strip() or "(no brief)",
        "## The command",
        "\n".join(f"    {line}" for line in (case.command or "(none)").splitlines()),
    ]
    if case.portals:
        rows = [
            f"- {name} -> {theirs}" if theirs else f"- {name} (the same)"
            for name, theirs in case.portals.items()
        ]
        parts += ["## Your apps", "\n".join(rows)]
    if case.slots:
        parts += ["## What she knows", "\n".join(_slot_line(s) for s in case.slots)]
    if case.approvals:
        rows = [f"- draft {a.rev} on {a.at[:10]} ({a.episode_id})" for a in case.approvals]
        parts += ["## Approvals", "\n".join(rows)]
    kept = runs.stored(extra or {})
    if kept:
        # The runs as a person reads them; the block below is what the code reads (ADR 0124).
        parts += ["## Your runs", "\n".join(runs.receipt_line(r) for r in kept)]
    data = {**{k: v for k, v in dict(extra or {}).items() if k not in _OWNED}, **asdict(case)}
    block = json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False)
    parts.append(f"{CASE_MARKER}\n{_OPEN}\n{block}\n{_CLOSE}")
    return "\n\n".join(parts) + "\n"


def _slot_line(slot: CaseSlot) -> str:
    value = slot.value.strip() or "not known yet"
    said = f' - you said "{slot.quote}"' if slot.quote else ""
    when = f" on {slot.confirmed_at[:10]}" if slot.confirmed_at else ""
    state = f"{slot.status}, {slot.source}{when}"
    return f"- {slot.id} ({slot.kind}) {slot.label}: {value} - {state}{said}"


def parse_case(body: str) -> tuple[Case, dict[str, Any]]:
    """The case in a goal body and the keys of its block this module does not own; or
    :class:`CaseUnreadable`."""
    at = body.rfind(f"{CASE_MARKER}\n{_OPEN}\n")
    if at == -1:
        raise CaseUnreadable("no case block")
    start = at + len(CASE_MARKER) + len(_OPEN) + 2
    end = body.find(f"\n{_CLOSE}", start)
    if end == -1:
        raise CaseUnreadable("the case block is not closed")
    try:
        raw = json.loads(body[start:end])
    except json.JSONDecodeError as exc:
        raise CaseUnreadable(f"the case block is not JSON: {exc.msg}") from exc
    if not isinstance(raw, dict):
        raise CaseUnreadable("the case block is not an object")
    if raw.get("schema") != CASE_SCHEMA:
        raise CaseUnreadable(f"case schema {raw.get('schema')!r} is not {CASE_SCHEMA}")
    case_id = _s(raw.get("id"))
    if not ids.is_id("project", case_id):
        raise CaseUnreadable(f"not a case id: {case_id!r}")
    case = Case(
        id=case_id,
        playbook_id=_s(raw.get("playbook_id")),
        title=_s(raw.get("title")),
        approved_rev=_i(raw.get("approved_rev")),
        approved_at=_s(raw.get("approved_at")),
        episode_id=_s(raw.get("episode_id")),
        created=_s(raw.get("created")),
        brief_md=_s(raw.get("brief_md")),
        command=_s(raw.get("command")),
        portals={str(k): _s(v) for k, v in _d(raw.get("portals")).items()},
        open_slot_ids=tuple(_s(x) for x in _l(raw.get("open_slot_ids")) if _s(x)),
        slots=tuple(_case_slot(x) for x in _l(raw.get("slots")) if isinstance(x, dict)),
        approvals=tuple(
            CaseApproval(
                rev=_i(x.get("rev")), at=_s(x.get("at")), episode_id=_s(x.get("episode_id"))
            )
            for x in _l(raw.get("approvals"))
            if isinstance(x, dict)
        ),
    )
    if not case.playbook_id or case.approved_rev < 1:
        raise CaseUnreadable("the case names no playbook or no approved rev")
    return case, {k: v for k, v in raw.items() if k not in _OWNED}


def _case_slot(raw: Mapping[str, Any]) -> CaseSlot:
    kind = raw.get("kind")
    status = raw.get("status")
    source = raw.get("source")
    return CaseSlot(
        id=_s(raw.get("id")),
        kind=kind if kind in ("portal", "gate", "fact", "trap") else "fact",
        label=_s(raw.get("label")),
        status=status if status in _STATUSES else "open",
        value=_s(raw.get("value")),
        source=source if source in _SOURCES else "default",
        confirmed_at=_s(raw.get("confirmed_at")),
        quote=_s(raw.get("quote")),
        fact_id=_s(raw.get("fact_id")),
    )


# --- reopening -----------------------------------------------------------------------------------


def reopen_slots(mechanical: Sequence[Slot], case: Case) -> tuple[list[Slot], list[str]]:
    """The session's slots for a reopened ``case``, and the ids reopened as guesses.

    ``mechanical`` is the playbook's slots as it is now. A portal the case holds under the same
    id, kind and label carries over; a gate is always the playbook's (policy, never memory); the
    case's ``fact`` and ``trap`` slots carry over whole, so their ids stay contiguous.
    """
    saved = {s.id: s for s in case.slots}
    out: list[Slot] = []
    reopened: list[str] = []

    def carry(slot: CaseSlot) -> Slot:
        status: SlotStatus = slot.status
        if status == "confirmed" and perishable(slot):
            status = "guessed"
            reopened.append(slot.id)
        # A rule the playbook states stays the playbook's: reopening never turns it into hers.
        keep = slot.source == "default" or not slot.value.strip()
        source: SlotSource = slot.source if keep else "memory"
        return Slot(slot.id, slot.kind, slot.label, status, slot.value, source)

    for slot in mechanical:
        held = saved.get(slot.id)
        same = held is not None and held.kind == slot.kind and held.label == slot.label
        out.append(carry(held) if held is not None and same and slot.kind != "gate" else slot)
    taken = {s.id for s in out}
    for held in case.slots:
        if held.kind in ("fact", "trap") and held.id not in taken:
            out.append(carry(held))
    return out, reopened


def case_brief(case: Case, slots: Sequence[Slot]) -> Brief:
    """The approved brief as the reopened session's current draft. ``open_slot_ids`` is what is
    not confirmed now (the reopened guesses included); the command is exactly what was approved."""
    return Brief(
        rev=case.approved_rev,
        md=case.brief_md,
        command=case.command,
        portals=dict(case.portals),
        open_slot_ids=tuple(s.id for s in slots if s.status != "confirmed"),
    )


# --- the book ------------------------------------------------------------------------------------


@dataclass
class CaseBook:
    """The cases in one brain: write on approve, read on reopen, list for the topic page."""

    brain: Brain

    def __post_init__(self) -> None:
        self._lock = threading.Lock()

    def load(self, case_id: str) -> Case | None:
        """The case ``case_id`` from disk (the truth, whatever the index holds), or ``None``."""
        if not ids.is_id("project", case_id):
            return None
        path = self.brain.root / "goals" / f"{case_id}.md"
        try:
            _, body = frontmatter.parse(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError):
            return None
        try:
            case, _ = parse_case(body)
        except CaseUnreadable:
            return None
        return case if case.id == case_id else None

    def cases(self, playbook_id: str = "") -> list[Case]:
        """Every readable case the index holds (for ``playbook_id`` when given), latest
        approval first. A goal that is not a case is passed over."""
        out: list[Case] = []
        for row in self.brain.goals():
            case = self.load(row.id)
            if case is not None and (not playbook_id or case.playbook_id == playbook_id):
                out.append(case)
        out.sort(key=lambda c: (c.approved_at, c.id), reverse=True)
        return out

    def save(self, session: AdoptSession, rev: int) -> Case:
        """Record the approval of brief ``rev``: episode, facts, then ``goals/<proj>.md``.

        Everything saved beside the approval is brief ``rev``'s draft as it was shown (ADR 0151):
        its slots and answers, never what a lane or a document set since. The session's case id
        is minted on its first save and kept; a reopened session already holds its case's. Raises
        ``ValueError`` for a rev never drafted, and what the brain raises (a refused fact, a disk
        error).
        """
        with self._lock, session.case_lock:
            draft = session.draft_of(rev)
            if draft is None:
                raise ValueError(f"brief {rev} was never drafted in this session")
            brief = draft.brief
            slots = list(draft.slots)
            answers = list(draft.answers)
            with session.lock:
                prior = session.case
                meta = dict(session.slot_meta)
                case_id = session.case_id
                playbook = session.playbook
                playbook_id = session.playbook_id
            case_id = case_id or ids.mint("project")
            now = now_iso()
            title = _s(playbook.get("short_title")) or _s(playbook.get("title")) or playbook_id
            quotes = _quotes(answers)
            fresh = [s for s in slots if s.status == "confirmed" and s.source == "user"]

            lines = [
                f'I approved draft {rev} of my brief for "{title}" ({playbook_id}).',
            ]
            if fresh:
                lines.append("What I confirmed:")
                for slot in fresh:
                    said = quotes.get(slot.id, "")
                    tail = f' (I said "{said}")' if said else ""
                    lines.append(f"- {_bare(slot.label)}: {slot.value.strip()}{tail}")
            episode = self.brain.append_episode(
                marked("\n".join(lines), origin="adopt", project_id=case_id),
                "user",
                session_id=ids.conversation_for_project(case_id),
            )

            kept: list[CaseSlot] = []
            for slot in slots:
                held = meta.get(slot.id)
                quote = quotes.get(slot.id, "") or (held.quote if held else "")
                if slot.status == "confirmed" and slot.source == "user":
                    fact = self.brain.write_fact(
                        f"case {case_id} {slot.id}",
                        f"{_bare(slot.label)}: {slot.value.strip()} "
                        f'(my case {case_id} of "{title}")',
                        scope="project",
                        sources=[episode.id],
                    )
                    confirmed_at, fact_id = now, fact.id
                elif slot.status == "confirmed" and held is not None and held.confirmed_at:
                    confirmed_at, fact_id = held.confirmed_at, held.fact_id
                elif slot.status == "confirmed" and slot.source != "default":
                    confirmed_at, fact_id = now, ""
                else:
                    confirmed_at = held.confirmed_at if held is not None else ""
                    fact_id = held.fact_id if held is not None else ""
                kept.append(
                    CaseSlot(
                        id=slot.id,
                        kind=slot.kind,
                        label=slot.label,
                        status=slot.status,
                        value=slot.value,
                        source=slot.source,
                        confirmed_at=confirmed_at,
                        quote=quote[:QUOTE_CAP],
                        fact_id=fact_id,
                    )
                )

            approval = CaseApproval(rev=rev, at=now, episode_id=episode.id)
            case = Case(
                id=case_id,
                playbook_id=playbook_id,
                title=title,
                approved_rev=rev,
                approved_at=now,
                episode_id=episode.id,
                created=prior.created if prior is not None else now,
                brief_md=brief.md,
                command=brief.command,
                portals=dict(brief.portals),
                open_slot_ids=brief.open_slot_ids,
                slots=tuple(kept),
                approvals=(*(prior.approvals if prior is not None else ()), approval),
            )
            extra = self._extra(case_id)
            self.brain.write_goal(
                case_id,
                title,
                render_case(case, extra),
                session_id=ids.conversation_for_project(case_id),
                created=case.created,
            )
            with session.lock:
                session.case_id = case_id
                session.case = case
                session.slot_meta = {s.id: s for s in kept}
            return case

    def receipts(self, case_id: str) -> list[Receipt]:
        """The receipts the case file keeps, oldest first (ADR 0124); ``[]`` for no case."""
        return runs.stored(self._extra(case_id))

    def last_run_started(self, case_id: str) -> str | None:
        """Where the case's last stored run began (ADR 0126, ADR 0130), which the gate's "you
        approved this exact call" looks back to; ``None`` for no case, a case with no receipt, or
        a receipt that records no start."""
        held = self.receipts(case_id)
        return (runs.run_started(held[-1]) or None) if held else None

    def append_receipt(self, case_id: str, receipt: Receipt) -> Case:
        """Append ``receipt`` to the case file's ``receipts`` and rewrite ``goals/<proj>.md``.

        The case itself is rewritten as it stands (the same header, the same approvals); only the
        block's ``receipts`` grows. Raises :class:`CaseUnreadable` for no case, and what the brain
        raises on a disk error.
        """
        with self._lock:
            path = self.brain.root / "goals" / f"{case_id}.md"
            if not ids.is_id("project", case_id) or not path.is_file():
                raise CaseUnreadable(f"no saved case {case_id!r}")
            _, body = frontmatter.parse(path.read_text(encoding="utf-8"))
            case, extra = parse_case(body)
            held = extra.get("receipts")
            extra["receipts"] = [*(held if isinstance(held, list) else []), runs.as_dict(receipt)]
            self.brain.write_goal(
                case_id,
                case.title or case.playbook_id,
                render_case(case, extra),
                session_id=ids.conversation_for_project(case_id),
                created=case.created,
            )
            return case

    def _extra(self, case_id: str) -> dict[str, Any]:
        """The keys a later writer added to this case's block, so a rewrite keeps them."""
        path = self.brain.root / "goals" / f"{case_id}.md"
        if not path.is_file():
            return {}
        try:
            _, body = frontmatter.parse(path.read_text(encoding="utf-8"))
            return parse_case(body)[1]
        except (OSError, UnicodeDecodeError, CaseUnreadable):
            return {}


def summary(case: Case) -> CaseSummary:
    return CaseSummary(
        case_id=case.id,
        playbook_id=case.playbook_id,
        title=case.title,
        approved_rev=case.approved_rev,
        approved_at=case.approved_at,
        created=case.created,
        confirmed=sum(1 for s in case.slots if s.status == "confirmed"),
        slots=len(case.slots),
    )


# --- helpers -------------------------------------------------------------------------------------


def _quotes(answers: Sequence[Any]) -> dict[str, str]:
    """Each slot's latest words from the person: the free text, else the chosen labels."""
    out: dict[str, str] = {}
    for answer in answers:
        words = " ".join(str(answer.text or "").split()) or ", ".join(answer.choices)
        if not words:
            continue
        for slot_id in answer.slot_ids:
            out[slot_id] = words
    return out


def _bare(label: str) -> str:
    return label.rstrip(" ?.:")


def _s(value: Any) -> str:
    return value if isinstance(value, str) else ""


def _i(value: Any) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def _d(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _l(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []

"""ADR 0097 (slots + auditor): the round loop — Personas' clarify round, made iterative.

**Start.** The mechanical slots and Athena's opening line go out at once (no model), the research
lanes are started (``on_start``), and two legs run side by side: the first ``audit`` derives the
``fact`` and ``trap`` slots while the first ``interview`` writes a card about the portals and the
gates — so the first card is one leg away, not two.

**Each answer.** The answers are recorded, the lanes told (``on_answer``), and again two legs run
side by side: the ``audit`` checks every value against the person's literal words and lists what is
still open, while the next ``interview`` writes a card from the pre-audit slots and the new
answers. When the audit's open list is empty the card is dropped and the brief is written; when
the audit settled what a question asked, that question is dropped.

**Never stalls.** A malformed interview (after the leg's one retry) becomes one plain free-text
question about the first open slot; a malformed audit keeps the slots and is counted; a failed
brief leg falls back to the playbook's gates and its "Left alone" rows. Eight cards at most —
then the brief is drafted as ``enough`` drafts it, with the open slots listed.

**Honest marks, her case only** (UAT 2026-10-23, themes 3 and 4). A brief line says where its
value came from: her words bare, a rule the playbook states "(from the playbook)", a lane's reading
"(from research)", and "(my guess)" only for Athena's own guess about her. The brief carries a
"Dates that matter" section (a date when her words or a document give one, else the rule and
what it runs from). A line that states the invented example's names or amounts as hers is
dropped and counted (``example_leak_dropped``), and the command "Start for real" hands Athena is
built from the approved brief, never from the playbook's example command.

**Draft, preview, apply.** Every brief has a ``rev``; an answer after a brief makes it stale and
the next brief is ``rev + 1``; approval names the rev it approves, and only the current one is
accepted. What is approved is exactly what was shown.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, replace
from typing import Any, TypeVar

from athena.adopt.legs import LegResult
from athena.adopt.prompts import (
    AUDIT_SCHEMA,
    AUDIT_SYSTEM,
    BRIEF_SCHEMA,
    BRIEF_SYSTEM,
    INTERVIEW_SCHEMA,
    INTERVIEW_SYSTEM,
    MAX_QUESTIONS,
    MAX_ROUNDS,
    audit_prompt,
    brief_prompt,
    interview_prompt,
    opening,
)
from athena.adopt.session import UNASKED, AdoptSession, AskedQuestion, GivenAnswer
from athena.adopt.slots import (
    add_slots,
    apply_updates,
    example_terms,
    from_playbook,
    mentions,
    portal_names,
    portal_roles,
    portal_swaps,
    portal_value,
    provenance,
)
from athena.contracts.adopt import (
    Answer,
    Brief,
    Clear,
    Error,
    Option,
    Progress,
    Question,
    Questions,
    Say,
    Slot,
    Slots,
    SlotSource,
)

__all__ = [
    "ANSWER_TEXT_CAP",
    "MAX_ANSWERS",
    "approve",
    "card_questions",
    "check_answers",
    "enough",
    "fitted_command",
    "receive_answers",
    "reopen_line",
    "start",
]

#: The most answers one POST may carry, and the most characters one free-text answer may hold.
MAX_ANSWERS = 2 * MAX_QUESTIONS
ANSWER_TEXT_CAP = 2000
OPTION_CAP = 80
QUESTION_CAP = 300
MAX_OPTIONS = 5

T = TypeVar("T")
U = TypeVar("U")


# --- the public verbs (each queued on the session's actor) ---------------------------------------


def start(session: AdoptSession) -> None:
    session.submit(lambda: _start(session))


def receive_answers(session: AdoptSession, answers: Sequence[Answer], via: str) -> None:
    """Record ``answers`` now (so a stale brief is stale at once) and queue the round."""
    with session.lock:
        for answer in answers:
            if not answer.question_id:
                # Said beside the card, to no question: kept as their words all the same.
                session.answers.append(
                    GivenAnswer(
                        round=session.round,
                        question_id="",
                        question=UNASKED,
                        slot_ids=(),
                        choices=(),
                        text=answer.text.strip(),
                        via=via,
                    )
                )
                continue
            asked = session.asked[answer.question_id]
            labels = {o.id: o.label for o in asked.question.options}
            session.answers.append(
                GivenAnswer(
                    round=asked.round,
                    question_id=answer.question_id,
                    question=asked.question.text,
                    slot_ids=asked.question.slot_ids,
                    choices=tuple(labels[c] for c in answer.choice_ids if c in labels),
                    text=answer.text.strip(),
                    via=via,
                )
            )
        if session.brief is not None:
            session.brief_stale = True
    session.submit(lambda: _after_answers(session))


def enough(session: AdoptSession) -> None:
    session.submit(lambda: _write_brief(session, cleared=False))


def approve(session: AdoptSession, rev: int) -> str:
    """``""`` when brief ``rev`` is approved (``on_approve`` queued), else why not."""
    with session.lock:
        current = session.rev if session.brief is not None else None
        if current is None:
            return "stale_rev: no brief has been drafted yet"
        if session.brief_stale:
            return f"stale_rev: brief {current} was answered past; a new one is being written"
        if rev != current:
            return f"stale_rev: brief {current} is the current one, not {rev}"
        session.approved_rev = rev
    session.submit(lambda: session.call_hook("on_approve", rev))
    return ""


def check_answers(session: AdoptSession, answers: Sequence[Answer]) -> str:
    """``""`` when every answer names a question that was asked and options it offered, or
    is free text to no question (``question_id`` ``""``)."""
    if not answers:
        return "answers: at least one answer"
    if len(answers) > MAX_ANSWERS:
        return f"answers: {len(answers)} is more than {MAX_ANSWERS}"
    with session.lock:
        for answer in answers:
            if not answer.question_id:
                if answer.choice_ids:
                    return "answers: an answer to no question cannot choose options"
                if not answer.text.strip():
                    return "answers: an answer to no question must say something"
                if len(answer.text) > ANSWER_TEXT_CAP:
                    return f"answers: {len(answer.text)} characters is more than {ANSWER_TEXT_CAP}"
                continue
            asked = session.asked.get(answer.question_id)
            if asked is None:
                return f"answers: no question {answer.question_id!r} was asked"
            offered = {o.id for o in asked.question.options}
            unknown = [c for c in answer.choice_ids if c not in offered]
            if unknown:
                return f"answers: {answer.question_id} has no option {unknown[0]!r}"
            if len(answer.text) > ANSWER_TEXT_CAP:
                return f"answers: {len(answer.text)} characters is more than {ANSWER_TEXT_CAP}"
            if not answer.choice_ids and not answer.text.strip():
                return f"answers: {answer.question_id} chose nothing and said nothing"
    return ""


# --- start --------------------------------------------------------------------------------------


def _start(session: AdoptSession) -> None:
    if session.case is not None:
        _reopen(session)
        return
    session.emit(Slots(slots=tuple(session.slots)))
    session.emit(Say(text=opening(session.playbook)))
    session.call_hook("on_start")
    session.warm = session.runner.warm_session("interview", INTERVIEW_SYSTEM, str(session.temp_dir))
    session.emit(Progress(text="Reading the playbook and working out what I need to know…"))
    slots = session.slots
    audit, card = _both(
        lambda: _audit_leg(session, slots, derive=True),
        lambda: _interview_leg(session, slots, round_no=1),
    )
    _apply_audit(session, audit)
    _offer_card(session, card, round_no=1, open_ids=None)


def _reopen(session: AdoptSession) -> None:
    """A reopened case (ADR 0123): the slots, a line on what carried over, the approved brief at
    once. Only the dates and amounts that reopened as guesses are asked again; with none, the
    brief is clear for approval and no model is called."""
    case = session.case
    assert case is not None
    slots = session.slots
    with session.lock:
        brief = session.brief
        reopened = list(session.reopened)
    session.emit(Slots(slots=tuple(slots)))
    session.emit(Say(text=reopen_line(case.approved_at, slots, reopened)))
    session.call_hook("on_start")
    if brief is not None:
        session.emit(brief)
    if not reopened:
        if brief is not None:
            session.emit(Clear(rev=brief.rev))
        return
    session.warm = session.runner.warm_session("interview", INTERVIEW_SYSTEM, str(session.temp_dir))
    session.emit(Progress(text="Checking the dates and amounts that may have moved…"))
    card = _interview_leg(session, slots, round_no=1)
    if card.ok and card.value is not None:
        # Asked again: only what reopened. A slot she left a guess when she approved stays one.
        wanted = set(reopened)
        kept = []
        for raw in _dicts(card.value.get("questions")):
            named = [i for i in raw.get("slot_ids", []) if isinstance(i, str) and i in wanted]
            if named:
                kept.append({**raw, "slot_ids": named})
        card = replace(card, value={**card.value, "questions": kept})
    _offer_card(session, card, round_no=1, open_ids=reopened)


def reopen_line(approved_at: str, slots: Sequence[Slot], reopened: Sequence[str]) -> str:
    """Athena's first line on a reopened case, written without a model."""
    carried = sum(1 for s in slots if s.source == "memory" and s.status == "confirmed")
    when = approved_at[:10] or "earlier"
    line = f"Your case is back as you approved it on {when}."
    if carried:
        line += f" {carried} {'thing' if carried == 1 else 'things'} you told me carry over."
    if not reopened:
        return line + " Nothing in it has a date or an amount that could have moved."
    return (
        line + f" {len(reopened)} {'date or amount' if len(reopened) == 1 else 'dates or amounts'}"
        " may have changed since, so I'll ask about "
        f"{'that one' if len(reopened) == 1 else 'those'} again."
    )


# --- one answered card --------------------------------------------------------------------------


def _after_answers(session: AdoptSession) -> None:
    session.call_hook("on_answer")
    with session.lock:
        session.rounds_done += 1
        next_round = session.cards + 1
    if next_round > MAX_ROUNDS:
        _write_brief(session, cleared=False)
        return
    session.emit(Progress(text="Checking what you said against the rule…"))
    slots = session.slots
    audit, card = _both(
        lambda: _audit_leg(session, slots, derive=False),
        lambda: _interview_leg(session, slots, round_no=next_round),
    )
    open_ids = _apply_audit(session, audit)
    if open_ids is not None and not open_ids:
        _write_brief(session, cleared=True)
        return
    _offer_card(session, card, round_no=next_round, open_ids=open_ids)


# --- the legs -----------------------------------------------------------------------------------


def _interview_leg(session: AdoptSession, slots: Sequence[Slot], *, round_no: int) -> LegResult:
    with session.lock:
        answers = [asdict(a) for a in session.answers]
        asked = [a.question.text for a in session.asked.values()]
    known = {s.id for s in slots}
    return session.run_leg(
        "interview",
        INTERVIEW_SYSTEM,
        interview_prompt(session.playbook, slots, answers, asked, round_no=round_no),
        json_schema=INTERVIEW_SCHEMA,
        check=lambda value: _interview_problem(value, known),
        warm=True,
    )


def _audit_leg(session: AdoptSession, slots: Sequence[Slot], *, derive: bool) -> LegResult:
    with session.lock:
        answers = [asdict(a) for a in session.answers]
    return session.run_leg(
        "audit",
        AUDIT_SYSTEM,
        audit_prompt(session.playbook, slots, answers, derive=derive),
        json_schema=AUDIT_SCHEMA,
    )


def _apply_audit(session: AdoptSession, result: LegResult) -> list[str] | None:
    """Apply an audit's slot changes; answers the open slot ids, or ``None`` when it failed."""
    if not result.ok or result.value is None:
        session.count("malformed_audit" if result.malformed else "failed_audit")
        if not result.malformed and result.error_reason not in (None, "parse_error"):
            session.emit(Error(reason=result.error_reason or "unknown", detail=result.detail))
        return None
    value = result.value
    updates = _dicts(value.get("updates"))
    with session.lock:
        grown = add_slots(session.slots, _dicts(value.get("new_slots")))
        # A rule the playbook states is the library's, not her word (source default, like a
        # gate), and as a non-user source it never overwrites what she confirmed herself.
        ruled, _ = apply_updates(grown, [u for u in updates if from_playbook(u)], source="default")
        source: SlotSource = "user" if session.answers else "default"
        updated, _ = apply_updates(
            ruled, [u for u in updates if not from_playbook(u)], source=source
        )
        session.set_slots(updated)
        by_id = {s.id: s for s in session.slots}
        named = [str(i) for i in value.get("open_slot_ids", []) if isinstance(i, str)]
        open_ids = [i for i in named if i in by_id and by_id[i].status != "confirmed"]
        open_ids += [s.id for s in session.slots if s.status == "open" and s.id not in open_ids]
    return open_ids


def _offer_card(
    session: AdoptSession, result: LegResult, *, round_no: int, open_ids: list[str] | None
) -> None:
    """Emit the card ``result`` wrote, trimmed to what is still unknown — or never stall."""
    slots = session.slots
    with session.lock:
        answers = [asdict(a) for a in session.answers]
    guard = _ExampleGuard(session.playbook, slots, answers)
    try:
        _offer(session, result, slots, guard, round_no=round_no, open_ids=open_ids)
    finally:
        for _ in range(guard.dropped):
            session.count("example_option_dropped")


def _offer(
    session: AdoptSession,
    result: LegResult,
    slots: Sequence[Slot],
    guard: _ExampleGuard,
    *,
    round_no: int,
    open_ids: list[str] | None,
) -> None:
    if result.ok and result.value is not None:
        say = str(result.value.get("say") or "").strip()
        questions = _questions(result.value, slots, round_no, guard=guard)
        if questions:
            if say:
                session.emit(Say(text=say))
            _emit_card(session, round_no, questions)
            return
        # Nothing asked although something is unknown: ask again on the settled slots, once.
        if open_ids is None or open_ids:
            retry = _interview_leg(session, slots, round_no=round_no)
            if retry.ok and retry.value is not None:
                questions = _questions(retry.value, session.slots, round_no, guard=guard)
                if questions:
                    _emit_card(session, round_no, questions)
                    return
                # Twice nothing she could answer: what is still open is read during the run
                # (her lease, a statement, a portal), not asked as a bare slot label.
                _defer_to_run(session, open_ids)
                return
        elif not open_ids:
            _write_brief(session, cleared=True)
            return
    elif result.malformed:
        session.count("malformed_interview")
    else:
        session.emit(Error(reason=result.error_reason or "unknown", detail=result.detail))
    _plain_question(session, round_no, open_ids)


#: What a slot holds when the interviewer found nothing the person could answer about it.
RUN_LOOKUP = "I'll read this during the run"


def _defer_to_run(session: AdoptSession, open_ids: list[str] | None) -> None:
    """Mark what is still open as looked up during the run (a guess, said so), then the brief."""
    with session.lock:
        wanted = set(open_ids) if open_ids else {s.id for s in session.slots if s.status == "open"}
        # A value already held (their own half-answer) stays, marked a guess; only an empty
        # slot gets the run-lookup line.
        # A portal stays empty: its value is read as an app name (portal_value), and the
        # run-lookup line would read as a rename. Its setup line says it is not known yet.
        updates = [
            {
                "slot_id": s.id,
                "value": s.value.strip() or ("" if s.kind == "portal" else RUN_LOOKUP),
                "status": "guessed",
            }
            for s in session.slots
            if s.id in wanted and s.status == "open"
        ]
        updated, changed = apply_updates(session.slots, updates, source="default")
        if changed:
            session.set_slots(updated)
    session.count("deferred_to_run")
    session.emit(Say(text="That's all I need from you. The rest I'll read during the run."))
    _write_brief(session, cleared=True)


def _plain_question(session: AdoptSession, round_no: int, open_ids: list[str] | None) -> None:
    """One free-text question about the first slot still open, so the talk goes on."""
    slots = session.slots
    wanted = set(open_ids) if open_ids else {s.id for s in slots if s.status != "confirmed"}
    target = next((s for s in slots if s.id in wanted), None)
    if target is None:
        _write_brief(session, cleared=open_ids is not None)
        return
    session.emit(Say(text="Let me ask this one plainly, in your own words."))
    _emit_card(
        session,
        round_no,
        [Question(id=f"r{round_no}q1", slot_ids=(target.id,), text=target.label, allow_text=True)],
    )


def _emit_card(session: AdoptSession, round_no: int, questions: Sequence[Question]) -> None:
    with session.lock:
        session.round = round_no
        session.cards = max(session.cards, round_no)
        for question in questions:
            session.asked[question.id] = AskedQuestion(round=round_no, question=question)
    session.emit(Questions(round=round_no, questions=tuple(questions)))


# --- the brief ----------------------------------------------------------------------------------


def _write_brief(session: AdoptSession, *, cleared: bool) -> None:
    session.emit(Progress(text="Writing your brief…"))
    slots = session.slots
    with session.lock:
        answers = [asdict(a) for a in session.answers]
    result = session.run_leg(
        "audit",
        BRIEF_SYSTEM,
        brief_prompt(session.playbook, slots, answers),
        json_schema=BRIEF_SCHEMA,
    )
    playbook = session.playbook
    claim_default, left_default = _default_sections(playbook)
    if result.ok and result.value is not None:
        lead = str(result.value.get("lead") or "").strip()
        setup = _strs(result.value.get("setup"))
        dates = _dates(result.value.get("dates"))
        claim = _strs(result.value.get("claim"))
        left = _strs(result.value.get("left_alone"))
    else:
        session.count("malformed_brief" if result.malformed else "failed_brief")
        lead, setup, dates, claim, left = "", [], [], [], []
    # The example's names and amounts never reach her brief as hers (UAT 2026-10-23, theme 4):
    # a line that carries one she did not say herself is dropped and counted.
    guard = _ExampleGuard(playbook, slots, answers)
    lead, setup, dates, claim, left = (
        guard.line(lead),
        guard.lines(setup),
        guard.lines(dates),
        guard.lines(claim),
        guard.lines(left),
    )
    claim = claim or guard.lines(claim_default)
    left = left or guard.lines(left_default)
    for _ in range(guard.dropped):
        session.count("example_leak_dropped")
    if not lead:
        lead = _default_lead(playbook)
    open_ids = tuple(s.id for s in slots if s.status != "confirmed")
    # The model's setup lines read as one voice; the mechanical ones are the floor.
    setup = setup or _setup_lines(playbook, slots)
    md = _brief_md(lead, setup, claim, left, dates)
    with session.lock:
        session.rev += 1
        rev = session.rev
        brief = Brief(
            rev=rev,
            md=md,
            command=fitted_command(
                playbook, slots, setup=setup, claim=claim, left=left, dates=dates
            ),
            portals=portal_swaps(session.playbook, slots),
            open_slot_ids=open_ids,
        )
        session.brief = brief
        session.brief_stale = False
        session.round = 0
    session.emit(brief)
    if cleared:
        session.emit(Clear(rev=rev))


def fitted_command(
    playbook: Mapping[str, Any],
    slots: Sequence[Slot],
    *,
    setup: Sequence[str] = (),
    claim: Sequence[str] = (),
    left: Sequence[str] = (),
    dates: Sequence[str] = (),
) -> str:
    """The command "Start for real" hands Athena: the approved brief, in the person's terms.

    Built from what she saw and approved (her setup, the dates, what to claim, what to leave
    alone) and never from the playbook's own ``command``, which tells the invented example's
    story in its invented names and stays as it is for the bench (UAT 2026-10-23,
    construction-12). Mechanical on purpose: no model rewrites what runs (draft-preview-apply).

    With no ``setup`` (a caller with slots and no drafted brief: the adopt-tiers bench, which
    rehearses on the example world itself) the slots' own lines stand in, after one "I use X
    instead of Y" line per swapped app, since there the example's app names are the world's.
    """
    title = str(playbook.get("short_title") or playbook.get("title") or "this chore").strip()
    swaps = (
        []
        if setup
        else [
            f"I use {theirs} instead of {name}."
            for name, theirs in portal_swaps(playbook, slots).items()
            if theirs
        ]
    )
    sections = [
        f"Run this chore for my own case, as I approved it: {title}.",
        _section("My apps", swaps),
        _section("My setup", setup or _setup_lines(playbook, slots)),
        _section("Dates that matter", dates),
        _section("What to claim", claim),
        _section("Leave alone", left),
    ]
    return "\n\n".join(s for s in sections if s)


def _section(heading: str, rows: Sequence[str]) -> str:
    return f"{heading}:\n" + "\n".join(f"- {r}" for r in rows) if rows else ""


def _setup_lines(playbook: Mapping[str, Any], slots: Sequence[Slot]) -> list[str]:
    """One line per app by its role, then one per fact, trap and gate, each marked by where its
    value came from (:func:`~athena.adopt.slots.provenance`): her words bare, a playbook rule
    "(from the playbook)", a lane's reading "(from research)", a guess "(my guess)"."""
    names = portal_names(playbook)
    roles = portal_roles(playbook)
    by_id = {s.id: s for s in slots}
    lines: list[str] = []
    for index, (name, role) in enumerate(zip(names, roles, strict=True), start=1):
        slot = by_id.get(f"p{index}")
        held = slot.value.strip() if slot is not None else ""
        if slot is None or not held:
            lines.append(f"{_upper_first(role)}: not known yet")
            continue
        theirs = portal_value(name, held) or name
        lines.append(f"{theirs} for {role}{provenance(slot)}")
    for slot in slots:
        if slot.kind == "portal":
            continue
        if slot.value.strip():
            lines.append(f"{_bare(slot.label)}: {slot.value.strip()}{provenance(slot)}")
        else:
            lines.append(f"{_bare(slot.label)}: not known yet")
    return lines


def _brief_md(
    lead: str,
    setup: Sequence[str],
    claim: Sequence[str],
    left: Sequence[str],
    dates: Sequence[str] = (),
) -> str:
    parts = [lead.strip()]
    for heading, rows in (
        ("Your setup", setup),
        ("Dates that matter", dates),
        ("What I'll claim", claim),
        ("Left alone", left),
    ):
        if rows:
            parts.append(f"**{heading}:**\n" + "\n".join(f"- {r}" for r in rows))
    return "\n\n".join(p for p in parts if p)


def _dates(value: Any) -> list[str]:
    """The brief leg's ``dates`` rows as one line each: "what: when (rule). If missed: ...".

    A row with no ``what`` or no ``when`` is dropped: a deadline with neither a date nor the
    rule that sets it is not one the person can act on.
    """
    out: list[str] = []
    for row in _dicts(value):
        what, when = _one_line(row.get("what")), _one_line(row.get("when"))
        if not what or not when:
            continue
        line = f"{what.rstrip('.:')}: {when.rstrip('.')}"
        rule = _one_line(row.get("rule"))
        if rule and rule.lower() not in line.lower():
            line += f" ({rule.rstrip('.')})"
        missed = _one_line(row.get("if_missed"))
        if missed:
            line += f". If missed: {missed.rstrip('.')}"
        out.append(line + ".")
    return out


_HEADING = re.compile(r"^\*\*(.+?)\*\*\s*$")


def _default_sections(playbook: Mapping[str, Any]) -> tuple[list[str], list[str]]:
    """The brief's floor when the brief leg fails or wrote nothing that survived the guard.

    What to claim: each gate, which is an act of the general job and never the example's
    specifics. Left alone: the playbook brief's "Left alone" rows (the guard then drops any
    that carry the example's names or amounts)."""
    claim = [
        f"{label}, where your case allows it"
        for label in (str(g.get("label") or "").strip() for g in _dicts(playbook.get("gates")))
        if label
    ]
    sections: list[tuple[str, list[str]]] = []
    for line in str(playbook.get("brief") or "").splitlines():
        stripped = line.strip()
        heading = _HEADING.match(stripped)
        if heading:
            sections.append((heading.group(1), []))
        elif stripped.startswith("- ") and sections:
            sections[-1][1].append(stripped[2:].strip())
    left = next((rows for title, rows in sections if "left alone" in title.lower()), [])
    return claim, left


def _default_lead(playbook: Mapping[str, Any]) -> str:
    title = str(playbook.get("short_title") or playbook.get("title") or "this chore").strip()
    return f"I'll do this chore for your case: {title}. I ask you before each act that matters."


class _ExampleGuard:
    """Drops a brief line that states the invented example's names or amounts as hers.

    The example's terms (:func:`~athena.adopt.slots.example_terms`) minus whatever she said
    herself or a lane read for her: a term in her answers or in a slot value she or a lane gave
    is hers to mention.
    """

    def __init__(
        self,
        playbook: Mapping[str, Any],
        slots: Sequence[Slot],
        answers: Sequence[Mapping[str, Any]],
    ) -> None:
        own = " ".join(
            [
                *(str(a.get("text") or "") for a in answers),
                *(" ".join(a.get("choices", ()) or ()) for a in answers),
                *(
                    s.value
                    for s in slots
                    if s.source in ("research", "document", "account")
                    or (s.status == "confirmed" and s.source in ("user", "memory"))
                ),
            ]
        )
        self.terms = [t for t in example_terms(playbook) if not mentions(own, t)]
        self.dropped = 0

    def leaks(self, text: str) -> bool:
        return any(mentions(text, t) for t in self.terms)

    def line(self, text: str) -> str:
        if text and self.leaks(text):
            self.dropped += 1
            return ""
        return text

    def lines(self, rows: Sequence[str]) -> list[str]:
        return [r for r in rows if self.line(r)]


# --- the card, sanitised ------------------------------------------------------------------------


def _interview_problem(value: dict[str, Any], known: set[str]) -> str:
    """A structural problem worth one retry; anything finer is trimmed, not retried."""
    questions = value.get("questions")
    if not isinstance(questions, list):
        return "questions must be a list"
    for index, raw in enumerate(questions):
        if not isinstance(raw, dict):
            return f"questions[{index}] must be an object"
        if not isinstance(raw.get("text"), str) or not raw["text"].strip():
            return f"questions[{index}].text must be a non-empty string"
        ids = raw.get("slot_ids")
        if not isinstance(ids, list) or not any(isinstance(i, str) and i in known for i in ids):
            named = ", ".join(sorted(known))
            return f"questions[{index}].slot_ids must name at least one of: {named}"
    return ""


def _questions(
    value: Mapping[str, Any],
    slots: Sequence[Slot],
    round_no: int,
    *,
    slotless: bool = False,
    guard: _ExampleGuard | None = None,
) -> list[Question]:
    """The card as the person will see it: at most four questions, each about a slot that is not
    confirmed, 2 to 5 options or none, free text always allowed, ids minted here.

    ``slotless`` (the intake conversation, ADR 0098, which has no slots) keeps every question
    that has text and gives it no slot ids. With a ``guard``, an option that offers the
    example's invented names or amounts as her answer is dropped (UAT 2026-10-23, benefits-05)."""
    unconfirmed = {s.id for s in slots if s.status != "confirmed"}
    out: list[Question] = []
    for raw in _dicts(value.get("questions")):
        if len(out) >= MAX_QUESTIONS:
            break
        named = raw.get("slot_ids", [])
        slot_ids = tuple(dict.fromkeys(i for i in named if isinstance(i, str) and i in unconfirmed))
        text = " ".join(str(raw.get("text") or "").split())
        if not text or not (slot_ids or slotless):
            continue
        options: list[Option] = []
        seen: set[str] = set()
        for option in _dicts(raw.get("options")):
            label = " ".join(str(option.get("label") or "").split())[:OPTION_CAP]
            if not label or label.lower() in seen:
                continue
            if guard is not None and guard.line(label) == "":
                continue
            seen.add(label.lower())
            options.append(Option(id="abcde"[len(options)], label=label))
            if len(options) >= MAX_OPTIONS:
                break
        if len(options) < 2:
            options = []
        out.append(
            Question(
                id=f"r{round_no}q{len(out) + 1}",
                slot_ids=slot_ids if not slotless else (),
                text=text[:QUESTION_CAP],
                options=tuple(options),
                multi=bool(raw.get("multi")) and len(options) >= 2,
                allow_text=True,
            )
        )
    return out


def card_questions(value: Mapping[str, Any], round_no: int) -> list[Question]:
    """:func:`_questions` for a conversation with no slots (the intake, ADR 0098)."""
    return _questions(value, (), round_no, slotless=True)


# --- helpers ------------------------------------------------------------------------------------


def _both(a: Callable[[], T], b: Callable[[], U]) -> tuple[T, U]:
    """Run ``a`` and ``b`` at the same time; answer both."""
    with ThreadPoolExecutor(max_workers=2, thread_name_prefix="adopt-leg") as pool:
        first = pool.submit(a)
        second = pool.submit(b)
        return first.result(), second.result()


def _dicts(value: Any) -> list[dict[str, Any]]:
    return [v for v in value if isinstance(v, dict)] if isinstance(value, list) else []


def _strs(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [" ".join(v.split()) for v in value if isinstance(v, str) and v.strip()]


def _bare(label: str) -> str:
    return label.rstrip(" ?.:")


def _one_line(value: Any) -> str:
    return " ".join(value.split()) if isinstance(value, str) else ""


def _upper_first(text: str) -> str:
    return text[:1].upper() + text[1:]

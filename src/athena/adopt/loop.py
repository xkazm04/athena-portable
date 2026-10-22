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
brief leg falls back to the playbook's own brief. Eight cards at most — then the brief is drafted
as ``enough`` drafts it, with the open slots listed and guesses marked "(my guess)".

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
from athena.adopt.slots import add_slots, apply_updates, portal_swaps
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
    with session.lock:
        grown = add_slots(session.slots, _dicts(value.get("new_slots")))
        source: SlotSource = "user" if session.answers else "default"
        updated, _ = apply_updates(grown, _dicts(value.get("updates")), source=source)
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
    if result.ok and result.value is not None:
        say = str(result.value.get("say") or "").strip()
        questions = _questions(result.value, slots, round_no)
        if questions:
            if say:
                session.emit(Say(text=say))
            _emit_card(session, round_no, questions)
            return
        # Nothing asked although something is unknown: ask again on the settled slots, once.
        if open_ids is None or open_ids:
            retry = _interview_leg(session, slots, round_no=round_no)
            if retry.ok and retry.value is not None:
                questions = _questions(retry.value, session.slots, round_no)
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
        updates = [
            {"slot_id": s.id, "value": s.value.strip() or RUN_LOOKUP, "status": "guessed"}
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
    claim_default, left_default = _brief_sections(str(session.playbook.get("brief") or ""))
    if result.ok and result.value is not None:
        lead = str(result.value.get("lead") or "").strip()
        setup = _strs(result.value.get("setup"))
        claim = _strs(result.value.get("claim")) or claim_default
        left = _strs(result.value.get("left_alone")) or left_default
    else:
        session.count("malformed_brief" if result.malformed else "failed_brief")
        lead, setup, claim, left = "", [], claim_default, left_default
    if not lead:
        lead = _first_sentence(str(session.playbook.get("promise") or ""))
    open_ids = tuple(s.id for s in slots if s.status != "confirmed")
    # The model's setup lines read as one voice; the mechanical ones are the floor.
    md = _brief_md(lead, setup or _setup_lines(session.playbook, slots), claim, left)
    with session.lock:
        session.rev += 1
        rev = session.rev
        brief = Brief(
            rev=rev,
            md=md,
            command=fitted_command(session.playbook, slots),
            portals=portal_swaps(session.playbook, slots),
            open_slot_ids=open_ids,
        )
        session.brief = brief
        session.brief_stale = False
        session.round = 0
    session.emit(brief)
    if cleared:
        session.emit(Clear(rev=rev))


def fitted_command(playbook: Mapping[str, Any], slots: Sequence[Slot]) -> str:
    """The playbook's command plus a "My case:" block of what the slots hold.

    Mechanical on purpose: the command is what runs, so it is built from the slots the person
    saw on the brief and not rewritten by a model (draft-preview-apply).
    """
    lines: list[str] = []
    for name, theirs in portal_swaps(playbook, slots).items():
        if theirs:
            lines.append(f"- I use {theirs} instead of {name}.")
    for slot in slots:
        if slot.kind == "portal" or not slot.value.strip():
            continue
        guess = " (my guess)" if slot.status != "confirmed" else ""
        lines.append(f"- {_bare(slot.label)}: {slot.value.strip()}{guess}")
    command = str(playbook.get("command") or "").strip()
    return command if not lines else f"{command}\n\nMy case:\n" + "\n".join(lines)


def _setup_lines(playbook: Mapping[str, Any], slots: Sequence[Slot]) -> list[str]:
    swaps = portal_swaps(playbook, slots)
    by_id = {s.id: s for s in slots}
    lines: list[str] = []
    for index, (name, theirs) in enumerate(swaps.items(), start=1):
        slot = by_id.get(f"p{index}")
        guess = "" if slot is not None and slot.status == "confirmed" else " (my guess)"
        lines.append(f"{theirs} in place of {name}{guess}" if theirs else f"{name}{guess}")
    for slot in slots:
        if slot.kind == "portal":
            continue
        if slot.value.strip():
            guess = "" if slot.status == "confirmed" else " (my guess)"
            lines.append(f"{_bare(slot.label)}: {slot.value.strip()}{guess}")
        else:
            lines.append(f"{_bare(slot.label)}: not known yet")
    return lines


def _brief_md(lead: str, setup: Sequence[str], claim: Sequence[str], left: Sequence[str]) -> str:
    parts = [lead.strip()]
    for heading, rows in (
        ("Your setup", setup),
        ("What I'll claim", claim),
        ("Left alone", left),
    ):
        if rows:
            parts.append(f"**{heading}:**\n" + "\n".join(f"- {r}" for r in rows))
    return "\n\n".join(p for p in parts if p)


_HEADING = re.compile(r"^\*\*(.+?)\*\*\s*$")


def _brief_sections(brief: str) -> tuple[list[str], list[str]]:
    """The playbook brief's first bulleted section and its "Left alone" section."""
    sections: list[tuple[str, list[str]]] = []
    for line in brief.splitlines():
        stripped = line.strip()
        heading = _HEADING.match(stripped)
        if heading:
            sections.append((heading.group(1), []))
        elif stripped.startswith("- ") and sections:
            sections[-1][1].append(stripped[2:].strip())
    claim = next((rows for title, rows in sections if "left alone" not in title.lower()), [])
    left = next((rows for title, rows in sections if "left alone" in title.lower()), [])
    return claim, left


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
    value: Mapping[str, Any], slots: Sequence[Slot], round_no: int, *, slotless: bool = False
) -> list[Question]:
    """The card as the person will see it: at most four questions, each about a slot that is not
    confirmed, 2 to 5 options or none, free text always allowed, ids minted here.

    ``slotless`` (the intake conversation, ADR 0098, which has no slots) keeps every question
    that has text and gives it no slot ids."""
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


def _first_sentence(text: str) -> str:
    match = re.match(r"(.+?[.!?])(\s|$)", " ".join(text.split()))
    return match.group(1) if match else " ".join(text.split())

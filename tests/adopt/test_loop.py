"""The round loop against a scripted model: start, answer, audit, brief, clear (ADR 0097)."""

from __future__ import annotations

import json
from typing import Any

from athena.adopt import loop
from athena.adopt.prompts import MAX_ROUNDS
from athena.adopt.session import UNASKED, AdoptSession
from athena.contracts.adopt import Answer

from .conftest import PLAYBOOK_ID, Rig, clear_script


def wire(event: Any) -> dict[str, Any]:
    """An event as the desktop reads it: through JSON."""
    return dict(json.loads(event.to_json()))


def kinds(session: AdoptSession) -> list[str]:
    return [e.kind for e in session.events_after(0)]


def last(session: AdoptSession, kind: str) -> dict[str, Any]:
    return next(wire(e) for e in reversed(session.events_after(0)) if e.kind == kind)


def started(rig: Rig) -> AdoptSession:
    session = rig.store.create(PLAYBOOK_ID)
    loop.start(session)
    session.drain()
    return session


def answer_all(session: AdoptSession, via: str = "text") -> None:
    card = last(session, "adopt.questions")
    answers = [
        Answer(
            question_id=q["id"],
            choice_ids=(q["options"][-1]["id"],) if q["options"] else (),
            text="" if q["options"] else "yes",
        )
        for q in card["questions"]
    ]
    assert loop.check_answers(session, answers) == ""
    loop.receive_answers(session, answers, via)
    session.drain()


def test_start_opens_with_slots_a_line_and_a_card(rig: Rig) -> None:
    rig.model.script = clear_script()
    session = started(rig)

    assert kinds(session)[:3] == ["adopt.slots", "adopt.say", "adopt.progress"]
    first_slots = session.events_after(0)[0].to_dict()["slots"]
    assert [s["id"] for s in first_slots] == ["p1", "p2", "g1"]
    assert first_slots[0]["label"] == "Which app or site do you use for the payroll firm?"
    assert wire(session.events_after(0)[1])["text"].startswith("**Late 401(k) deposits repaid.**")
    card = last(session, "adopt.questions")
    assert card["round"] == 1
    assert [q["id"] for q in card["questions"]] == ["r1q1", "r1q2"]
    assert card["questions"][0]["options"] == [
        {"id": "a", "label": "Yes"},
        {"id": "b", "label": "No, Gusto"},
    ]
    assert all(q["allow_text"] for q in card["questions"])
    # The derive audit ran beside the first interview and grew the fact and trap slots.
    assert [s.id for s in session.slots] == ["p1", "p2", "g1", "f1", "t1"]
    assert ("start", session.id) in rig.seen
    # The interviewer ran warm; the auditor cold.
    assert [c.warm for c in rig.model.calls if c.kind == "interview"] == [True]
    assert [c.warm for c in rig.model.calls if c.kind == "audit"] == [False]


def test_an_answered_card_that_the_audit_clears_ends_in_a_brief_and_clear(rig: Rig) -> None:
    rig.model.script = clear_script()
    session = started(rig)
    answer_all(session)

    brief = last(session, "adopt.brief")
    assert brief["rev"] == 1
    assert last(session, "adopt.clear") == {
        "kind": "adopt.clear",
        "seq": brief["seq"] + 1,
        "rev": 1,
    }
    assert brief["portals"] == {"Payroll Harbor": "Gusto", "Retireline": ""}
    assert brief["open_slot_ids"] == []
    assert brief["md"].startswith("I'll find the late deposits")
    assert "**Your setup:**\n- Gusto for the payroll firm" in brief["md"]
    assert "**What I'll claim:**\n- Lost earnings on each late deferral" in brief["md"]
    assert "**Left alone:**" in brief["md"]
    # "Start for real" runs the approved brief, never the playbook's example command.
    assert brief["command"].startswith("Run this chore for my own case, as I approved it")
    assert "Find the late deposits" not in brief["command"]
    assert "- Gusto for the payroll firm" in brief["command"]
    assert "- People in the plan: 38" in brief["command"]
    assert "What to claim:\n- Lost earnings on each late deferral" in brief["command"]
    # The card the interviewer wrote in parallel was dropped: the audit found nothing open.
    assert sum(1 for k in kinds(session) if k == "adopt.questions") == 1
    assert ("answer", session.id) in rig.seen
    # The answers reach every leg fenced, never bare.
    audit_prompt = [c.prompt for c in rig.model.calls if c.kind == "audit"][-1]
    assert "<<<answers:" in audit_prompt


def test_every_leg_is_one_usage_event_and_one_ledger_row(rig: Rig) -> None:
    rig.model.script = clear_script()
    session = started(rig)
    answer_all(session)

    usages = [wire(e) for e in session.events_after(0) if e.kind == "adopt.usage"]
    assert len(usages) == len(rig.model.calls) == len(rig.ledger.rows) == 5
    assert {u["leg"] for u in usages} == {"interview", "audit"}
    assert all(u["first_text_ms"] is not None and u["model"].endswith("-5-5") for u in usages)
    assert {r["conversation"] for r in rig.ledger.rows} == {f"conv_{session.id}"}
    assert {r["surface"] for r in rig.ledger.rows} == {"adopt"}
    assert not any(r["is_error"] for r in rig.ledger.rows)


def test_seq_is_monotonic_and_after_replays_the_rest(rig: Rig) -> None:
    rig.model.script = clear_script()
    session = started(rig)
    seqs = [e.seq for e in session.events_after(0)]
    assert seqs == list(range(1, len(seqs) + 1))
    assert [e.seq for e in session.events_after(3)] == seqs[3:]


def test_approve_takes_only_the_current_rev_and_calls_the_hook(rig: Rig) -> None:
    rig.model.script = clear_script()
    session = started(rig)
    assert loop.approve(session, 1).startswith("stale_rev:")
    answer_all(session)

    assert loop.approve(session, 2).startswith("stale_rev:")
    assert loop.approve(session, 1) == ""
    session.drain()
    assert ("approve", 1) in rig.seen


def test_an_answer_after_the_brief_makes_it_stale_and_the_next_brief_is_rev_two(rig: Rig) -> None:
    rig.model.script = clear_script()
    session = started(rig)
    answer_all(session)
    first_card = next(wire(e) for e in session.events_after(0) if e.kind == "adopt.questions")

    loop.receive_answers(
        session,
        [Answer(question_id=first_card["questions"][0]["id"], text="Actually ADP")],
        "voice",
    )
    assert loop.approve(session, 1).startswith("stale_rev:")
    session.drain()
    assert last(session, "adopt.brief")["rev"] == 2
    assert loop.approve(session, 2) == ""


def test_a_malformed_interview_is_retried_once_then_asked_plainly(rig: Rig) -> None:
    script = clear_script()
    script["interview"] = ["not json at all"]
    rig.model.script = script
    session = started(rig)

    interviews = [c for c in rig.model.calls if c.kind == "interview"]
    assert len(interviews) == 2
    assert "could not be used" in interviews[1].prompt
    card = last(session, "adopt.questions")
    assert len(card["questions"]) == 1 and card["questions"][0]["options"] == []
    assert card["questions"][0]["slot_ids"] == ["p1"]
    assert session.counters.get("malformed_interview") == 1
    rows = [r for r in rig.ledger.rows if r["trigger"] == "adopt.interview"]
    assert [r["error_reason"] for r in rows] == ["parse_error", "parse_error"]


def test_a_malformed_audit_keeps_the_slots_says_nothing_and_is_counted(rig: Rig) -> None:
    script = clear_script()
    script["audit"] = ["{broken"]
    rig.model.script = script
    session = started(rig)
    answer_all(session)

    assert [s.id for s in session.slots] == ["p1", "p2", "g1"]
    assert session.counters.get("malformed_audit") == 2
    assert "adopt.clear" not in kinds(session)
    assert "adopt.error" not in kinds(session)
    # The conversation goes on: a second card was offered.
    assert last(session, "adopt.questions")["round"] == 2


def test_enough_drafts_the_brief_with_open_slots_and_guesses_marked(rig: Rig) -> None:
    rig.model.script = clear_script()
    session = started(rig)
    loop.enough(session)
    session.drain()

    brief = last(session, "adopt.brief")
    assert brief["open_slot_ids"] == ["p1", "p2", "f1", "t1"]  # g1 is policy, settled
    assert "People in the plan: 38 (my guess)" in brief["md"]
    assert "Deposits on the seventh day: not known yet" in brief["md"]
    assert "- People in the plan: 38 (my guess)" in brief["command"]
    assert "adopt.clear" not in kinds(session)
    assert loop.approve(session, brief["rev"]) == ""


def test_never_more_than_eight_cards(rig: Rig) -> None:
    script = clear_script()
    script["audit"] = [{"updates": [], "open_slot_ids": ["p1"]}]
    script["interview"] = [{"questions": [{"slot_ids": ["p1"], "text": "Which payroll app?"}]}]
    rig.model.script = script
    session = started(rig)
    for _ in range(MAX_ROUNDS):
        answer_all(session)

    cards = [wire(e)["round"] for e in session.events_after(0) if e.kind == "adopt.questions"]
    assert cards == list(range(1, MAX_ROUNDS + 1))
    assert last(session, "adopt.brief")["open_slot_ids"]
    assert "adopt.clear" not in kinds(session)


def test_a_failed_brief_leg_falls_back_to_the_gates_never_the_example(rig: Rig) -> None:
    script = clear_script()
    script["brief"] = ["nope"]
    rig.model.script = script
    session = started(rig)
    answer_all(session)

    brief = last(session, "adopt.brief")
    assert brief["md"].startswith("I'll do this chore for your case: Late 401(k) deposits repaid.")
    # What to claim is the general act (the gate), not the example's own lines.
    assert "- Pay lost earnings into the plan, where your case allows it" in brief["md"]
    assert "Two late deferrals" not in brief["md"]
    assert "- A recovery firm's offer" in brief["md"]
    assert last(session, "adopt.clear")["rev"] == 1
    # Malformed twice is counted and says nothing, as a malformed audit is.
    assert session.counters.get("malformed_brief") == 1
    assert "adopt.error" not in kinds(session)


def test_a_brief_leg_the_engine_failed_says_so_beside_the_fallback_brief(rig: Rig) -> None:
    # The CLI answered nothing (an engine error, not a malformed answer): the brief still comes,
    # from the playbook's floor, and the failure is an adopt.error, as a failed audit's is.
    script = clear_script()
    script["brief"] = [""]
    rig.model.script = script
    session = started(rig)
    answer_all(session)

    assert session.counters.get("failed_brief") == 1
    error = last(session, "adopt.error")
    assert error["reason"] == "engine_error" and error["detail"]
    order = kinds(session)
    assert order.index("adopt.error") < order.index("adopt.brief")
    assert last(session, "adopt.brief")["md"].startswith("I'll do this chore for your case")


def test_check_answers_refuses_what_was_not_asked(rig: Rig) -> None:
    rig.model.script = clear_script()
    session = started(rig)
    assert "no question" in loop.check_answers(session, [Answer(question_id="r9q9", text="x")])
    assert "no option" in loop.check_answers(
        session, [Answer(question_id="r1q1", choice_ids=("zz",))]
    )
    assert "nothing" in loop.check_answers(session, [Answer(question_id="r1q1")])
    assert loop.check_answers(session, []) != ""


def test_what_she_cannot_answer_is_read_during_the_run_not_asked_as_a_label(rig: Rig) -> None:
    script = clear_script()
    script["audit"] = [{"updates": [], "open_slot_ids": ["p1"]}]
    script["interview"] = [
        {"questions": [{"slot_ids": ["p2"], "text": "Is the plan at Retireline?"}]},
        {"questions": []},
    ]
    rig.model.script = script
    session = started(rig)
    answer_all(session)

    cards = [wire(e) for e in session.events_after(0) if e.kind == "adopt.questions"]
    assert len(cards) == 1  # no bare-label card after the interviewer found nothing to ask
    p1 = next(s for s in session.slots if s.id == "p1")
    # A portal stays empty, as a guess: the run-lookup line would read as a rename to
    # "I'll read this during the run". The brief says it is not known yet.
    assert (p1.status, p1.value) == ("guessed", "")
    assert "- The payroll firm: not known yet" in last(session, "adopt.brief")["md"]
    assert "adopt.clear" in kinds(session)
    assert session.counters.get("deferred_to_run") == 1


def test_an_empty_slot_deferred_to_the_run_says_so(rig: Rig) -> None:
    script = clear_script()
    script["audit"] = [
        {
            "new_slots": [{"kind": "fact", "label": "When did the plan year end?"}],
            "open_slot_ids": ["f1"],
        },
    ]
    script["interview"] = [
        {"questions": [{"slot_ids": ["p2"], "text": "Is the plan at Retireline?"}]},
        {"questions": []},
    ]
    rig.model.script = script
    session = started(rig)
    answer_all(session)

    f1 = next(s for s in session.slots if s.id == "f1")
    assert (f1.status, f1.value) == ("guessed", loop.RUN_LOOKUP)


def test_words_said_to_no_question_are_kept_and_start_a_round(rig: Rig) -> None:
    rig.model.script = clear_script()
    session = started(rig)
    remark = Answer(question_id="", text="It's my dad's plan, not mine.")
    assert loop.check_answers(session, [remark]) == ""
    assert "cannot choose" in loop.check_answers(
        session, [Answer(question_id="", choice_ids=("a",), text="x")]
    )
    assert "must say" in loop.check_answers(session, [Answer(question_id="", text="  ")])
    loop.receive_answers(session, [remark], "text")
    session.drain(timeout=5)
    said = [a for a in session.answers if not a.question_id]
    assert [(a.question, a.text) for a in said] == [(UNASKED, "It's my dad's plan, not mine.")]


def test_what_she_says_up_front_reaches_the_first_audit_and_card(rig: Rig) -> None:
    rig.model.script = clear_script()
    session = rig.store.create(PLAYBOOK_ID, "  We moved payroll to Gusto last spring.  ")
    loop.start(session)
    session.drain()

    first = [c for c in rig.model.calls if c.kind in ("audit", "interview")][:2]
    assert {c.kind for c in first} == {"audit", "interview"}
    assert all("We moved payroll to Gusto last spring." in c.prompt for c in first)
    assert session.answers[0].round == 0 and session.answers[0].question_id == ""


def test_case_5_approving_a_brief_an_answer_made_stale_is_refused_with_no_hook(rig: Rig) -> None:
    rig.model.script = clear_script()
    session = started(rig)
    answer_all(session)
    assert last(session, "adopt.brief")["rev"] == 1
    # The answer is recorded at once, so brief 1 is stale before its round has run.
    loop.receive_answers(session, [Answer(question_id="", text="Actually ADP")], "voice")
    assert loop.approve(session, 1).startswith("stale_rev:")
    session.drain()
    assert not any(name == "approve" for name, _ in rig.seen)
    assert session.approved_rev is None

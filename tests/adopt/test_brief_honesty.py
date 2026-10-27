"""The brief carries rules, dates and her case only (UAT 2026-10-23 chores, themes 3, 4 and 7).

Rules the playbook states are marked "(from the playbook)", never "(my guess)"; a value she gave
is never a guess; the brief has a "Dates that matter" section; the example world's invented names
and amounts never reach her as hers (first card, opening line, brief, "Start for real"); and the
playbook's ``fit`` reaches every leg and her opening line. No real model is called.
"""

from __future__ import annotations

import json
import re
from typing import Any

import pytest

from athena.adopt import loop
from athena.adopt.prompts import (
    AUDIT_SYSTEM,
    BRIEF_SYSTEM,
    INTERVIEW_CAP,
    INTERVIEW_SYSTEM,
    opening,
    playbook_block,
    slots_block,
)
from athena.adopt.research import _confirmed_block
from athena.adopt.session import AdoptSession
from athena.adopt.slots import (
    add_slots,
    example_terms,
    invented_names,
    load_playbook_json,
    mechanical_slots,
    mentions,
    playbooks_root,
    provenance,
)
from athena.contracts.adopt import Answer, Slot

from .conftest import PLAYBOOK, PLAYBOOK_ID, Rig, clear_script

LIBRARY = playbooks_root(environ={})
ALL_IDS = sorted(p.parent.name for p in LIBRARY.glob("*/playbook.json")) if LIBRARY else []

FIT: dict[str, Any] = {
    "where": ["TX"],
    "where_note": "Texas law; elsewhere the deadlines differ",
    "who": "A homeowner in Texas who lives in the house",
    "not_for": "Renters, or a house that is not your home",
    "asks_for": ["your appraisal notice", "your deed"],
    "costs": "No fees; only your Claude usage",
}


def wire(event: Any) -> dict[str, Any]:
    return dict(json.loads(event.to_json()))


def last(session: AdoptSession, kind: str) -> dict[str, Any]:
    return next(wire(e) for e in reversed(session.events_after(0)) if e.kind == kind)


def answered(rig: Rig, script: dict[str, list[Any]], **playbook: Any) -> AdoptSession:
    rig.model.script = script
    session = rig.store.create(PLAYBOOK_ID)
    session.playbook.update(playbook)
    loop.start(session)
    session.drain()
    card = last(session, "adopt.questions")
    answers = [
        Answer(
            question_id=q["id"],
            choice_ids=(q["options"][-1]["id"],) if q["options"] else (),
            text="" if q["options"] else "yes",
        )
        for q in card["questions"]
    ]
    loop.receive_answers(session, answers, "text")
    session.drain()
    return session


# --- the prompts say the rules -------------------------------------------------------------------


def test_the_interviewer_is_told_the_example_is_not_hers_and_may_ask_her_dates() -> None:
    assert len(INTERVIEW_SYSTEM) < INTERVIEW_CAP
    text = " ".join(INTERVIEW_SYSTEM.split())
    assert "Never put an example name, number or term in a question or an option" in text
    assert "the insurer's own website or app" in text
    assert "Never ask what the law or a rule says" in text
    assert "the date on their notice" in text
    assert 'answer it in "say" in one line from FIT' in text
    assert "outside FIT's where, say so plainly" in text


def test_the_auditor_marks_playbook_rules_and_never_guesses_her_own_value() -> None:
    text = " ".join(AUDIT_SYSTEM.split())
    assert '"from": "playbook", status confirmed' in text
    assert "is confirmed even when they ask you to check it" in text
    assert "Never mark the EXAMPLE's own names, dates, amounts or contract terms" in text
    assert "the dates a deadline runs from" in text
    # B-C10 (recertify R-3): an anchor date stays open until she answered it once.
    assert "its fact slot stays open until they give the date" in text
    assert "say they do not have it yet (then guessed" in text


def test_the_interviewer_asks_her_anchor_dates_first_and_offers_the_document() -> None:
    # B-C10 (recertify R-3, lien-desk--gina, recoverable-depreciation--marcus): dates were left as
    # rules because nobody asked, and a date printed on a statement was asked to be typed.
    text = " ".join(INTERVIEW_SYSTEM.split())
    assert "ask them before finer points of a trap" in text
    assert "It's on a letter or statement - I'll add it" in text
    assert "I don't have it yet" in text
    assert len(INTERVIEW_SYSTEM) < INTERVIEW_CAP


def test_the_brief_writer_has_dates_marks_and_no_example_facts() -> None:
    text = " ".join(BRIEF_SYSTEM.split())
    assert '"dates": [{"what"' in text and '"if_missed"' in text
    assert "Never invent a date" in text
    assert '"(from the playbook: <the source it cites>)"' in text
    assert '"(my guess)" only on your own guess about them' in text
    assert "Never write any of it as theirs" in text


# --- slot sources and marks ----------------------------------------------------------------------


def test_a_rule_from_the_playbook_is_confirmed_by_the_library_not_guessed() -> None:
    grown = add_slots(
        mechanical_slots(PLAYBOOK),
        [
            {
                "kind": "trap",
                "label": "Deposit deadline",
                "value": "7 business days (29 CFR 2510.3-102)",
                "status": "confirmed",
                "from": "playbook",
            },
            {"kind": "fact", "label": "Plan size", "value": "38", "status": "guessed"},
            {"kind": "fact", "label": "Said so", "value": "40", "status": "confirmed"},
        ],
    )
    rule, guess, unasked = grown[-3:]
    assert (rule.status, rule.source) == ("confirmed", "default")
    assert provenance(rule) == " (from the playbook)"
    assert (guess.status, provenance(guess)) == ("guessed", " (my guess)")
    assert unasked.status == "open"  # "confirmed" without her words is not hers


@pytest.mark.parametrize(
    ("status", "source", "mark"),
    [
        ("confirmed", "user", ""),
        ("confirmed", "memory", ""),
        ("confirmed", "default", " (from the playbook)"),
        ("guessed", "research", " (from research)"),
        ("guessed", "document", " (from your document)"),
        ("guessed", "user", " (my guess)"),
        ("guessed", "default", " (my guess)"),
    ],
)
def test_every_value_says_where_it_came_from(status: str, source: str, mark: str) -> None:
    slot = Slot(id="f1", kind="fact", label="x", status=status, value="v", source=source)  # type: ignore[arg-type]
    assert provenance(slot) == mark


def test_the_brief_writer_reads_each_slot_by_its_origin() -> None:
    text = slots_block(
        [
            Slot("f1", "fact", "Window", "confirmed", "7 days", "user"),
            Slot("t1", "trap", "Rule", "confirmed", "180 days", "default"),
            Slot("f2", "fact", "Size", "guessed", "38", "default"),
        ],
        nonce="c0ffee",
    )
    assert "- f1 [fact, confirmed, you said it] Window" in text
    assert "- t1 [trap, confirmed, the playbook's rule] Rule" in text
    assert "- f2 [fact, guessed, Athena's guess] Size" in text


def test_a_playbook_rule_from_the_audit_is_the_librarys_even_after_her_answers(rig: Rig) -> None:
    script = clear_script()
    script["audit"] = [
        script["audit"][0],
        {
            "updates": [
                {"slot_id": "p1", "value": "Gusto", "status": "confirmed"},
                {"slot_id": "p2", "value": "Retireline", "status": "confirmed"},
                {"slot_id": "f1", "value": "40", "status": "confirmed"},
                {
                    "slot_id": "t1",
                    "value": "a deposit by day seven is on time (29 CFR 2510.3-102)",
                    "status": "confirmed",
                    "from": "playbook",
                },
                # A playbook rule never overwrites what she said herself.
                {"slot_id": "f1", "value": "38", "status": "confirmed", "from": "playbook"},
            ],
            "open_slot_ids": [],
        },
    ]
    script["brief"] = [{"lead": "I'll find the late deposits for you."}]
    session = answered(rig, script)

    by_id = {s.id: s for s in session.slots}
    assert (by_id["t1"].status, by_id["t1"].source) == ("confirmed", "default")
    assert (by_id["f1"].value, by_id["f1"].source) == ("40", "user")
    md = last(session, "adopt.brief")["md"]
    assert "a deposit by day seven is on time (29 CFR 2510.3-102) (from the playbook)" in md
    assert "People in the plan: 40\n" in md  # her word, unmarked
    assert "(my guess)" not in md
    # The research lane hears only what she confirmed, not the library's rules or gates.
    block = _confirmed_block(session.slots)
    assert "40" in block and "29 CFR" not in block and "asks you first" not in block


# --- dates ---------------------------------------------------------------------------------------


def test_the_brief_has_a_dates_section_before_the_claims_and_the_command_carries_it(
    rig: Rig,
) -> None:
    script = clear_script()
    script["brief"] = [
        {
            "lead": "I'll find the late deposits for you.",
            "dates": [
                {
                    "what": "Pay the lost earnings",
                    "when": "about 30 November 2026, 45 days from your notice of 16 October",
                    "rule": "the plan's correction rule",
                    "if_missed": "the excise tax grows",
                },
                {"what": "", "when": "never"},  # nothing to act on: dropped
            ],
            "claim": ["Lost earnings on each late deferral"],
        }
    ]
    session = answered(rig, script)
    brief = last(session, "adopt.brief")
    line = (
        "- Pay the lost earnings: about 30 November 2026, 45 days from your notice of "
        "16 October (the plan's correction rule). If missed: the excise tax grows."
    )
    assert "**Dates that matter:**\n" + line in brief["md"]
    assert brief["md"].index("Dates that matter") < brief["md"].index("What I'll claim")
    assert "Dates that matter:\n" + line in brief["command"]


# --- the example world stays out -----------------------------------------------------------------


def test_a_brief_line_with_the_examples_names_or_amounts_is_dropped(rig: Rig) -> None:
    script = clear_script()
    script["brief"] = [
        {
            "lead": "I'll find the late deposits Neil Ostrander made, worth $87.93.",
            "setup": ["Gusto for the payroll firm", "Neil Ostrander runs payroll for you"],
            "claim": ["Lost earnings on each late deferral", "Refund $87.93 to Neil Ostrander"],
            "left_alone": ["Deposits on the seventh day"],
        }
    ]
    session = answered(
        rig,
        script,
        command="I'm Neil Ostrander. Find the late deposits at Wexcombe Packaging, $87.93 owed.",
        caveat="Neil Ostrander, Wexcombe Packaging and Retireline are invented.",
    )
    md = last(session, "adopt.brief")["md"]
    for term in ("Neil", "Ostrander", "Wexcombe", "87.93"):
        assert term not in md
    assert md.startswith("I'll do this chore for your case:")  # the lead leaked: the floor
    assert "- Lost earnings on each late deferral" in md
    assert session.counters.get("example_leak_dropped") == 3


def test_a_name_she_said_herself_is_hers_to_mention(rig: Rig) -> None:
    script = clear_script()
    script["brief"] = [
        {"lead": "I'll find the late deposits in Gusto.", "claim": ["Lost earnings at Retireline"]}
    ]
    session = answered(rig, script)  # she confirmed Retireline as her recordkeeper
    assert "- Lost earnings at Retireline" in last(session, "adopt.brief")["md"]
    assert not session.counters.get("example_leak_dropped")


def _proper_tokens(text: str) -> set[str]:
    """Capitalised words that are not a sentence's first word, and dollar amounts."""
    out: set[str] = set(re.findall(r"\$\s?\d[\d,]*(?:\.\d+)?", text))
    for sentence in re.split(r"(?<=[.!?:;])\s+", text):
        words = sentence.split()
        out.update(re.sub(r"\W+$", "", w) for w in words[1:] if w[:1].isupper())
    return {t for t in out if len(t) > 1}


@pytest.mark.parametrize("playbook_id", ["tenant-deposit-return", "change-order-notices"])
def test_start_for_real_never_carries_the_example_command(playbook_id: str) -> None:
    playbook = load_playbook_json(playbook_id)
    slots = [
        Slot(s.id, s.kind, s.label, "confirmed", "Gmail", "user") if s.kind == "portal" else s
        for s in mechanical_slots(playbook)
    ]
    setup = loop._setup_lines(playbook, slots)
    claim = ["Each deduction the law does not allow"]
    md = loop._brief_md("I'll do it.", setup, claim, [])
    command = loop.fitted_command(playbook, slots, setup=setup, claim=claim)
    world = _proper_tokens(str(playbook["command"]))
    assert world, "the test needs a command with names in it"
    leaked = {t for t in world if mentions(command, t) and not mentions(md, t)}
    assert leaked == set()
    assert str(playbook["command"]) not in command
    assert not any(mentions(command, t) for t in example_terms(playbook))


@pytest.mark.skipif(LIBRARY is None, reason="no playbook library in this checkout")
@pytest.mark.parametrize("playbook_id", ALL_IDS)
def test_the_first_card_and_the_opening_offer_no_invented_name(playbook_id: str) -> None:
    playbook = load_playbook_json(playbook_id)
    invented = invented_names(playbook)
    for slot in mechanical_slots(playbook):
        if slot.kind == "portal":
            assert slot.value == ""
            assert slot.label.startswith("Which app or site do you use for ")
            assert not any(mentions(slot.label, name) for name in invented), slot.label
    # The opening tells no story: no example name or amount (a fee from ``fit.costs`` is fine).
    line = opening(playbook)
    assert not any(mentions(line, t) for t in example_terms(playbook)), line


def test_the_playbook_block_lists_apps_by_role_and_fences_off_the_example() -> None:
    block = playbook_block(PLAYBOOK)
    assert "- the payroll firm [Payroll Harbor]" in block
    head, example = block.split("EXAMPLE (invented, someone else's case")
    assert "Find the late deposits" not in head and "Find the late deposits" in example
    assert "An owner checks **13 deposit lines**." in example


# --- fit -----------------------------------------------------------------------------------------


def test_fit_reaches_every_leg_and_the_opening_and_is_silent_when_absent() -> None:
    fitted = {**PLAYBOOK, "fit": FIT}
    block = playbook_block(fitted)
    assert "FIT\n- Where: TX - Texas law; elsewhere the deadlines differ" in block
    assert "- Not for: Renters, or a house that is not your home" in block
    assert "- Athena will ask for: your appraisal notice, your deed" in block
    assert "- Costs: No fees; only your Claude usage" in block
    line = opening(fitted)
    assert line.startswith(
        "**Late 401(k) deposits repaid.** It fits a homeowner in Texas who lives in the house. "
        "Texas law; elsewhere the deadlines differ. "
        "I'll ask you for your appraisal notice and your deed. No fees; only your Claude usage."
    )
    assert "FIT" not in playbook_block(PLAYBOOK)
    assert opening(PLAYBOOK).startswith("**Late 401(k) deposits repaid.**\n\n")
    # The opening no longer offers to ask about approvals: those are fixed.
    assert "which acts you want me to ask you about" not in opening(PLAYBOOK)


def test_a_card_option_naming_the_examples_app_is_dropped(rig: Rig) -> None:
    script = clear_script()
    script["interview"] = [
        {
            "questions": [
                {
                    "slot_ids": ["p1"],
                    "text": "Which app or site runs your payroll?",
                    "options": [
                        {"label": "Payroll Harbor"},
                        {"label": "Your payroll provider's own website"},
                        {"label": "Another app - which?"},
                    ],
                }
            ]
        }
    ]
    rig.model.script = script
    session = rig.store.create(PLAYBOOK_ID)
    loop.start(session)
    session.drain()
    card = last(session, "adopt.questions")
    labels = [o["label"] for o in card["questions"][0]["options"]]
    assert labels == ["Your payroll provider's own website", "Another app - which?"]
    assert session.counters.get("example_option_dropped") == 1


def _class_of_origin(text: str) -> str:
    """The class a brief-writer origin phrase puts a value in."""
    for phrase, name in (
        ("earlier answer", "earlier"),
        ("you said it", "hers"),
        ("playbook", "playbook"),
        ("guess", "guess"),
        ("research", "lane"),
        ("document", "lane"),
        ("account", "lane"),
    ):
        if phrase in text:
            return name
    raise AssertionError(text)


def _class_of_mark(mark: str) -> str:
    """The class a setup-line mark puts a value in."""
    if not mark:
        return "hers"
    for phrase, name in (
        ("earlier answer", "earlier"),
        ("playbook", "playbook"),
        ("guess", "guess"),
        ("from ", "lane"),
    ):
        if phrase in mark:
            return name
    raise AssertionError(mark)


@pytest.mark.parametrize("status", ["open", "guessed", "confirmed"])
@pytest.mark.parametrize("source", ["user", "research", "memory", "document", "account", "default"])
def test_the_brief_writer_and_the_setup_lines_classify_every_value_alike(
    status: str, source: str
) -> None:
    """Two renderings of one rule: ``prompts._origin`` (what the model is told) and
    ``slots.provenance`` (what the fallback lines and the command print)."""
    slot = Slot(id="f1", kind="fact", label="x", status=status, value="v", source=source)  # type: ignore[arg-type]
    told = slots_block([slot], nonce="c0ffee").splitlines()[1]
    origin = told.split("] ")[0].split(", ", 2)[2] if told.count(", ") >= 2 else ""
    assert _class_of_origin(origin) == _class_of_mark(provenance(slot)), (told, provenance(slot))

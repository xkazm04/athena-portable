"""Scoring one interview against the sheet: accuracy, false clear, repeat; the blind judge."""

from __future__ import annotations

from dataclasses import asdict
from typing import Any

from athena.contracts.adopt import Slot
from athena.proving.adopt_tiers.scenarios import SCENARIOS_DIR, load_scenario
from athena.proving.adopt_tiers.score import (
    false_clear,
    judge_prompt,
    percentile,
    repeats,
    score_interview,
    slot_verdicts,
)

LEASE = load_scenario(SCENARIOS_DIR / "easy-lease-end.json")


def _slots(**over: tuple[str, str]) -> list[Slot]:
    """The lease scenario's slots, all confirmed right, with ``over`` = {id: (value, status)}."""
    base = {
        "p1": ("portal", "Gmail"),
        "p2": ("portal", "Linestone Inspect"),
        "p3": ("portal", "Google Photos"),
        "p4": ("portal", "Torvane Finance"),
        "g1": ("gate", "Ask her first: show each dispute"),
        "f1": ("fact", "12 September 2026"),
        "f2": ("fact", "Yes, every panel and the tires"),
        "t1": ("trap", "1,900 miles over; fair, leave it"),
    }
    labels = {
        "f1": "When the car was returned",
        "f2": "Photos of the car",
        "t1": "Whether the mileage charge is right",
    }
    out = []
    for sid, (kind, value) in base.items():
        val, status = over.get(sid, (value, "confirmed"))
        out.append(Slot(sid, kind, labels.get(sid, sid), status, val, "user"))  # type: ignore[arg-type]
    return out


def _verdicts(slots: list[Slot]) -> dict[str, str]:
    return {v["entry"]: v["verdict"] for v in slot_verdicts(LEASE, slots)}


def test_all_right() -> None:
    assert set(_verdicts(_slots()).values()) == {"right"}


def test_a_portal_is_read_as_the_product_reads_it() -> None:
    # "Gmail, not Postwren" names Gmail (never Postwren); "Linestone Inspect, as you said" is
    # the playbook's own app; "Postwren, as in the playbook" is not her Gmail.
    verdicts = _verdicts(
        _slots(
            p1=("Gmail, not Postwren", "confirmed"),
            p2=("Linestone Inspect, as you said", "confirmed"),
            p3=("Postwren, as in the playbook", "confirmed"),
        )
    )
    assert (verdicts["p1"], verdicts["p2"], verdicts["p3"]) == ("right", "right", "wrong")


def test_wrong_missed_and_unconfirmed() -> None:
    verdicts = _verdicts(
        _slots(
            p1=("Postwren", "guessed"),  # her mail is Gmail: a guessed playbook default is wrong
            p3=("Google Photos", "guessed"),  # right value, only guessed: missed
            f1=("", "open"),  # nothing known: missed
            t1=("Dispute it, it is wrong", "confirmed"),  # contradicts her
        )
    )
    assert verdicts["p1"] == "wrong"
    assert verdicts["p3"] == "missed"
    assert "g1" not in verdicts  # approval is policy, never scored
    assert verdicts["f-return-date"] == "missed"
    assert verdicts["t-mileage"] == "wrong"
    assert verdicts["p2"] == "right"


def test_a_derived_slot_nobody_made_is_missed() -> None:
    slots = [s for s in _slots() if s.id != "f2"]
    assert _verdicts(slots)["f-photos"] == "missed"


def _event(kind: str, **body: Any) -> dict[str, Any]:
    return {"kind": kind, "seq": 0, **body}


def _record(
    events: list[dict[str, Any]], answers: list[dict[str, Any]] | None = None
) -> dict[str, Any]:
    return {
        "config": "opus-medium",
        "model": "claude-opus-5-5",
        "events": events,
        "answers": answers or [],
        "final_slots": [],
        "stated_round": 1,
    }


def test_false_clear_reads_the_slots_at_clear() -> None:
    wrong = [asdict(s) for s in _slots(p1=("Postwren", "guessed"))]
    right = [asdict(s) for s in _slots()]
    assert false_clear(
        _record([_event("adopt.slots", slots=wrong), _event("adopt.clear", rev=1)]), LEASE
    ) == ["p1"]
    assert (
        false_clear(
            _record([_event("adopt.slots", slots=right), _event("adopt.clear", rev=1)]), LEASE
        )
        == []
    )
    # A brief without a clear is not a false clear, whatever the slots say.
    assert false_clear(_record([_event("adopt.slots", slots=wrong)]), LEASE) == []


def _q(qid: str, text: str, *slot_ids: str) -> dict[str, Any]:
    return {"id": qid, "slot_ids": list(slot_ids), "text": text, "options": [], "multi": False}


def test_repeats() -> None:
    unknown = {"f1": ("", "open"), "f2": ("", "open")}
    open_slots = [
        asdict(s)
        for s in _slots(p1=("Postwren", "open"), p2=("Linestone Inspect", "open"), **unknown)
    ]
    confirmed_p2 = [asdict(s) for s in _slots(p1=("Postwren", "open"), **unknown)]
    events = [
        _event("adopt.slots", slots=open_slots),
        _event(
            "adopt.questions",
            round=1,
            questions=[
                _q("r1q1", "Which app holds your lease letters?", "p1"),
                _q("r1q2", "When did you turn the car in to the dealer?", "f1"),
                _q("r1q3", "Did you take photos of the car before returning it?", "f2"),
            ],
        ),
        _event("adopt.slots", slots=confirmed_p2),
        _event(
            "adopt.questions",
            round=2,
            questions=[
                _q("r2q1", "Which app holds your lease letters, again?", "p1"),  # stated up front
                _q("r2q2", "Is Linestone Inspect where the report is?", "p2"),  # confirmed
                _q("r2q3", "When did you turn the car in to the dealer?", "f9"),  # same text
                _q(
                    "r2q4", "Did you take photos of the car before returning it?", "f8"
                ),  # after "I don't know"
            ],
        ),
    ]
    answers = [
        {"round": 1, "question_id": "r1q1", "text": "All my lease mail comes to my Gmail. Gmail"},
        {"round": 1, "question_id": "r1q2", "text": "12 September"},
        {"round": 1, "question_id": "r1q3", "text": "I don't know."},
    ]
    found = {r["question_id"]: r["why"] for r in repeats(_record(events, answers), LEASE)}
    assert "said up front" in found["r2q1"]
    assert "confirmed slot p2" in found["r2q2"]
    assert "repeats question r1q2" in found["r2q3"]
    assert "r2q4" not in found
    assert not any(k.startswith("r1") for k in found)


def test_score_interview_counts() -> None:
    record = _record(
        [_event("adopt.questions", round=1, questions=[_q("r1q1", "x", "p1")])],
    )
    record["final_slots"] = [asdict(s) for s in _slots(f1=("", "open"))]
    record["round_ms"] = [100, 300]
    record["legs"] = [{"role": "interview", "ok": True, "first_text_ms": 50, "ms": 90}]
    record["ledger"] = [
        {"role": "adopt.interview", "cost_usd": 0.01, "input_tokens": 1, "output_tokens": 2}
    ]
    score = score_interview(record, LEASE)
    assert (score["right"], score["wrong"], score["missed"]) == (6, 0, 1)
    assert score["accuracy"] == 85.7
    assert score["questions"] == 1
    assert score["first_text_ms"] == [50]
    assert score["usage"]["interview"]["cost_usd"] == 0.01
    assert score["usage"]["audit"]["cost_usd"] is None


def test_percentile_nearest_rank_and_absent() -> None:
    assert percentile([1, 2, 3, 4], 50) == 2
    assert percentile([1, 2, 3, 4], 95) == 4
    assert percentile([], 50) is None


def test_the_judge_is_blind() -> None:
    record = _record(
        [
            _event("adopt.say", text="Hello."),
            _event("adopt.usage", leg="interview", model="claude-opus-5-5", effort="medium", ms=5),
            _event("adopt.questions", round=1, questions=[_q("r1q1", "Which mail app?", "p1")]),
        ],
        [{"round": 1, "question_id": "r1q1", "question": "Which mail app?", "text": "Gmail"}],
    )
    prompt = judge_prompt(LEASE.playbook, record)
    assert "Which mail app?" in prompt and "Gmail" in prompt
    for secret in ("opus", "Opus", "claude-", "medium", "effort", "haiku", "sonnet"):
        assert secret not in prompt
    assert "<<<transcript:" in prompt

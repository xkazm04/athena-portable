"""Spike 05 F1: the signer rule table answers whose yes an action needs, and the answers hold."""

from __future__ import annotations

from typing import Any

import pytest

from athena.senses.circle.signers import (
    ACTIONS,
    SignerTableError,
    decide,
    flatten,
    load_table,
    whose_yes,
)

TABLE: dict[str, Any] = {
    "members": [
        {"id": "ruth", "name": "Ruth", "role": "parent"},
        {"id": "maya", "name": "Maya", "role": "primary"},
        {"id": "jon", "name": "Jon", "role": "sibling"},
    ],
    "rules": [
        {"action": "share_record", "subject": "*", "needs": "role:primary", "parent_veto": True},
        {"action": "share_record", "subject": "medication", "needs": "parent"},
        {"action": "change_appointment", "subject": "*", "needs": "quorum:2", "parent_veto": True},
        {"action": "pay_bill", "subject": "*", "needs": "role:primary"},
    ],
}


def test_the_exact_subject_wins_over_the_star_rule() -> None:
    table = load_table(TABLE)
    exact = whose_yes("share_record", "medication", table)
    assert (exact.needs, exact.signers, exact.rule) == (
        "parent",
        ("ruth",),
        "share_record/medication",
    )
    fallback = whose_yes("share_record", "summary", table)
    assert (fallback.needs, fallback.signers, fallback.rule) == (
        "role:primary",
        ("maya",),
        "share_record/*",
    )
    assert fallback.parent_veto and fallback.quorum == 1


@pytest.mark.parametrize(("action", "subject"), [("export_record", "*"), ("delete", "record")])
def test_no_rule_is_a_refusal_that_nobody_can_sign(action: str, subject: str) -> None:
    table = load_table(TABLE)
    req = whose_yes(action, subject, table)
    assert req.refused and req.signers == () and req.rule is None
    assert not decide(req, ["ruth", "maya", "jon"], [], table).runs


@pytest.mark.parametrize(
    ("action", "subject", "proposer", "yes", "no", "runs"),
    [
        # The parent's no beats a met quorum where the rule gives a veto.
        ("change_appointment", "visit", "maya", ["maya", "jon", "ruth"], ["ruth"], False),
        ("change_appointment", "visit", "maya", ["jon", "ruth"], [], True),
        # The proposer's own yes is not one of a quorum's.
        ("change_appointment", "visit", "jon", ["jon", "maya"], [], False),
        # A sibling's yes is not the primary carer's.
        ("pay_bill", "pharmacy", "jon", ["jon"], [], False),
        ("pay_bill", "pharmacy", "maya", ["maya"], [], True),
        # A forged or mistyped member signs nothing.
        ("share_record", "medication", "jon", ["dad", "Ruth"], [], False),
        # A member who said yes and no is a no.
        ("share_record", "medication", "maya", ["ruth"], ["ruth"], False),
        ("share_record", "summary", "jon", ["maya"], ["ruth"], False),
        ("share_record", "medication", "maya", ["ruth"], [], True),
    ],
)
def test_decide_holds_the_recorded_answers_to_the_rule(
    action: str, subject: str, proposer: str, yes: list[str], no: list[str], runs: bool
) -> None:
    table = load_table(TABLE)
    decision = decide(whose_yes(action, subject, table), yes, no, table, proposer)
    assert decision.runs is runs, decision.reason


def test_a_veto_says_whose_it_is() -> None:
    table = load_table(TABLE)
    decision = decide(whose_yes("share_record", "x", table), ["maya"], ["ruth"], table)
    assert decision.reason == "vetoed by ruth"


def test_a_bad_table_reports_every_problem() -> None:
    bad = {
        "members": [{"id": "maya", "role": "primary"}, {"id": "maya", "role": "cousin"}],
        "rules": [
            {"action": "pay_bill", "subject": "*", "needs": "quorum:5"},
            {"action": "pay_bill", "subject": "*", "needs": "role:primary"},
            {"action": "sell_house", "subject": "*", "needs": "anyone"},
            {"action": "share_record", "subject": "*", "needs": "parent", "parent_veto": "yes"},
        ],
    }
    with pytest.raises(SignerTableError) as caught:
        load_table(bad)
    text = " | ".join(caught.value.problems)
    for says in (
        "unique",
        "role must be",
        "quorum",
        "has a rule already",
        "action must be",
        "is not role",
        "parent_veto",
        "no member is the parent",
    ):
        assert says in text, says


def test_the_flattened_table_has_one_row_per_action_and_subject() -> None:
    rows = flatten(load_table(TABLE), "signers.json")
    assert len(rows) == len(ACTIONS) * 2  # "*" and "medication"
    by_id = {r["rule_id"]: r for r in rows}
    assert by_id["pay_bill/medication"]["decided_by"] == "pay_bill/*"
    assert "decided_by" not in by_id["share_record/medication"]
    refused = by_id["export_record/*"]
    assert refused["needs"] == "refuse" and "signers" not in refused
    assert all(r["media_id"] == "signers.json" for r in rows)

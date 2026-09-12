"""The gate's durable half: a card is answered once, exactly as it was shown (README §3.2 step 6).

Each test here is a way a gate has been walked through before: a replay against parameters the user
never saw, a second click on a card that was already answered, a stale card clicked the next
morning, and an answer the card never offered.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from athena.contracts import ids
from athena.contracts.channel import DecisionRequested
from athena.core.approvals import (
    APPROVE_TOKEN,
    ApprovalError,
    ApprovalRow,
    Approvals,
    ApprovalStatus,
)
from athena.core.brain import Brain
from athena.core.brain.reconcile import reconcile_from_disk

T0 = datetime(2026, 9, 12, 9, 0, tzinfo=UTC)
CONVERSATION = ids.conversation_for_app("invoices")
PARAMS = {"ref": "r7", "value": "2026-09-30", "note": "30 days"}


@pytest.fixture
def approvals(tmp_path: Path) -> Approvals:
    return Approvals(Brain(tmp_path / "brain"))


def _create(approvals: Approvals, **overrides: Any) -> ApprovalRow:
    """One card, with the defaults every test but the one under it would have repeated."""
    kwargs: dict[str, Any] = {
        "origin": "host:invoices",
        "conversation": CONVERSATION,
        "surface": "panel",
        "now": T0,
    }
    kwargs.update(overrides)
    action = kwargs.pop("action", "host.invoices.fill")
    params = kwargs.pop("params", PARAMS)
    return approvals.create(action, params, **kwargs)


# -- what the row is ---------------------------------------------------------------------------


def test_a_new_row_is_pending_with_an_apr_id_and_a_day_to_live(approvals: Approvals) -> None:
    row = _create(approvals, summary="chase invoice 7")

    assert ids.is_id("approval", row.id)
    assert row.status == ApprovalStatus.PENDING
    assert row.options == ("approve", "decline")
    assert row.expires_at == (T0 + timedelta(hours=24)).isoformat()
    assert row.summary == "chase invoice 7"


def test_the_card_offers_exactly_the_tokens_resolve_will_take(approvals: Approvals) -> None:
    row = _create(approvals, capture_id=ids.mint("capture"))

    event = row.to_event()

    assert isinstance(event, DecisionRequested)
    assert [option.id for option in event.options] == list(row.options)
    assert event.capture_id == row.capture_id
    assert event.params == PARAMS


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("action", "fill"),
        ("origin", "invoices"),
        ("conversation", "not-a-conversation"),
        ("surface", ""),
        ("capture_id", "cap_nonsense"),
        ("ttl", timedelta(0)),
    ],
)
def test_a_row_that_could_not_be_replayed_is_refused_at_create(
    approvals: Approvals, field: str, value: Any
) -> None:
    with pytest.raises(ApprovalError):
        _create(approvals, **{field: value})


def test_options_must_be_non_empty_and_distinct(approvals: Approvals) -> None:
    with pytest.raises(ApprovalError, match="distinct"):
        _create(approvals, options=("approve", "approve"))


def test_params_that_do_not_survive_json_are_refused(approvals: Approvals) -> None:
    with pytest.raises(ApprovalError, match="JSON-serialisable"):
        _create(approvals, params={"when": object()})


# -- the replay --------------------------------------------------------------------------------


def test_an_approval_cannot_be_replayed_against_different_params(approvals: Approvals) -> None:
    """``describe`` is the grant: the action and the parameters the user was actually shown."""
    row = _create(approvals)
    approvals.resolve(row.id, APPROVE_TOKEN, now=T0 + timedelta(minutes=1))

    grant = approvals.describe(row.id)

    assert grant.approved
    assert grant.action == "host.invoices.fill"
    assert grant.params == PARAMS
    assert grant.matches("host.invoices.fill", PARAMS)
    assert grant.matches("host.invoices.fill", dict(reversed(list(PARAMS.items()))))
    assert not grant.matches("host.invoices.fill", {**PARAMS, "value": "2026-10-30"})
    assert not grant.matches("host.invoices.fill", {"ref": "r7"})
    assert not grant.matches("host.invoices.send", PARAMS)


def test_a_resolve_with_a_token_the_card_never_offered_is_refused(approvals: Approvals) -> None:
    row = _create(approvals)

    for answer in ("yes", "Approve", "approve.", "ok", ""):
        with pytest.raises(ApprovalError, match="not one of the answers"):
            approvals.resolve(row.id, answer, now=T0 + timedelta(minutes=1))

    assert approvals.describe(row.id).status == ApprovalStatus.PENDING


def test_only_the_approve_token_approves_every_other_offered_token_declines(
    approvals: Approvals,
) -> None:
    declined = _create(approvals)
    other = _create(approvals, options=("approve", "send_anyway"))

    assert approvals.resolve(declined.id, "decline").status == ApprovalStatus.DECLINED
    assert approvals.resolve(other.id, "send_anyway").status == ApprovalStatus.DECLINED


def test_describe_of_an_unknown_row_raises(approvals: Approvals) -> None:
    with pytest.raises(ApprovalError, match="unknown approval"):
        approvals.describe(ids.mint("approval"))


# -- resolving once ----------------------------------------------------------------------------


def test_resolving_twice_is_refused_and_the_first_answer_stands(approvals: Approvals) -> None:
    row = _create(approvals)
    approvals.resolve(row.id, "decline", now=T0 + timedelta(minutes=1))

    with pytest.raises(ApprovalError, match="is declined, not pending"):
        approvals.resolve(row.id, APPROVE_TOKEN, now=T0 + timedelta(minutes=2))

    stored = approvals.get(row.id)
    assert stored is not None
    assert stored.status == ApprovalStatus.DECLINED
    assert stored.choice == "decline"


def test_the_answer_text_rides_along_with_the_token(approvals: Approvals) -> None:
    row = _create(approvals)

    resolved = approvals.resolve(row.id, "decline", "not this quarter")

    assert resolved.answer == "not this quarter"
    assert resolved.resolution_event().choice == "decline"


# -- expiry ------------------------------------------------------------------------------------


def test_an_expired_row_resolves_to_expired_never_to_approved(approvals: Approvals) -> None:
    row = _create(approvals)

    with pytest.raises(ApprovalError, match="expired"):
        approvals.resolve(row.id, APPROVE_TOKEN, now=T0 + timedelta(hours=25))

    stored = approvals.get(row.id)
    assert stored is not None
    assert stored.status == ApprovalStatus.EXPIRED
    assert stored.reason == "expired"
    assert stored.choice is None


def test_expire_due_names_the_rows_it_swept_and_leaves_the_live_ones(
    approvals: Approvals,
) -> None:
    stale = _create(approvals)
    fresh = _create(approvals, now=T0 + timedelta(hours=20))

    swept = approvals.expire_due(T0 + timedelta(hours=25))

    assert swept == [stale.id]
    assert approvals.describe(fresh.id).status == ApprovalStatus.PENDING
    assert approvals.expire_due(T0 + timedelta(hours=25)) == []


def test_a_row_past_its_expiry_is_out_of_the_inbox_before_the_sweep_runs(
    approvals: Approvals,
) -> None:
    _create(approvals)

    assert approvals.pending(now=T0 + timedelta(hours=25)).total == 0


# -- the inbox ---------------------------------------------------------------------------------


def test_pending_is_bounded_and_announces_what_it_left_out(approvals: Approvals) -> None:
    for index in range(5):
        _create(
            approvals,
            action=f"host.invoices.fill_{index}",
            now=T0 + timedelta(minutes=index),
        )

    page = approvals.pending(limit=2, now=T0 + timedelta(hours=1))

    assert page.shown == 2
    assert page.total == 5
    assert page.footer() == "(showing 2 of 5)"
    assert [row.action for row in page.rows] == ["host.invoices.fill_0", "host.invoices.fill_1"]


def test_a_whole_inbox_announces_nothing(approvals: Approvals) -> None:
    _create(approvals)

    page = approvals.pending(limit=20, now=T0 + timedelta(hours=1))

    assert page.shown == page.total == 1
    assert page.footer() == ""
    assert not page.truncated


def test_a_resolved_row_leaves_the_inbox(approvals: Approvals) -> None:
    row = _create(approvals)
    approvals.resolve(row.id, APPROVE_TOKEN, now=T0 + timedelta(minutes=1))

    assert approvals.pending(now=T0 + timedelta(hours=1)).total == 0


# -- the table is not an index -----------------------------------------------------------------


def test_a_reconcile_rebuilds_the_index_and_keeps_the_approvals(tmp_path: Path) -> None:
    """ADR 0005: an approval is runtime state, so it is not one of the ``INDEX_TABLES``."""
    with Brain(tmp_path / "brain") as brain:
        approvals = Approvals(brain)
        brain.append_episode("the invoice is 32 days old", role="user")
        row = _create(approvals)

        reconcile_from_disk(brain)

        stored = approvals.get(row.id)
        assert stored is not None
        assert stored.status == ApprovalStatus.PENDING
        assert brain.counts()["episode"] == 1

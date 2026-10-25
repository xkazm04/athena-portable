"""The gate's durable half: a card is answered once, exactly as it was shown (README §3.2 step 6).

Each test here is a way a gate has been walked through before: a replay against parameters the user
never saw, a second click on a card that was already answered, a stale card clicked the next
morning, and an answer the card never offered.
"""

from __future__ import annotations

import random
import re
import sqlite3
import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from athena.contracts import ids
from athena.contracts.channel import DecisionRequested, iso
from athena.core.approvals import (
    APPROVAL_SCHEMA,
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
        ("tab_id", -1),
        ("tab_id", True),
        ("tab_id", "2"),
        ("tab_nav", 3),
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

    assert approvals.resolve(declined.id, "decline", now=T0).status == ApprovalStatus.DECLINED
    assert approvals.resolve(other.id, "send_anyway", now=T0).status == ApprovalStatus.DECLINED


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


def test_the_loser_of_two_answers_racing_on_one_card_is_refused_like_a_second_click(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Two surfaces read the card while it was pending; one answer lands first. The other is the
    same second answer the test above refuses, and it must not come back as a success carrying
    the winner's row: the lane would replay the gate for a surface whose user said decline
    (hitl-approval/resume-after-decision: a conflicting verdict is a loud conflict)."""
    first = Approvals(Brain(tmp_path / "brain"))
    second = Approvals(Brain(tmp_path / "brain"))
    row = _create(first)
    stale = second.get(row.id)
    assert stale is not None and stale.pending
    first.resolve(row.id, APPROVE_TOKEN, now=T0 + timedelta(minutes=1))

    reads = iter([stale])
    real_get = second.get

    def get_after_a_stale_read(approval_id: str) -> ApprovalRow | None:
        return next(reads, None) or real_get(approval_id)

    monkeypatch.setattr(second, "get", get_after_a_stale_read)

    with pytest.raises(ApprovalError, match="is approved, not pending"):
        second.resolve(row.id, "decline", now=T0 + timedelta(minutes=1))

    stored = first.get(row.id)
    assert stored is not None
    assert stored.status == ApprovalStatus.APPROVED
    assert stored.choice == APPROVE_TOKEN


def test_the_answer_text_rides_along_with_the_token(approvals: Approvals) -> None:
    row = _create(approvals)

    resolved = approvals.resolve(row.id, "decline", "not this quarter", now=T0)

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


# -- an approval is spent once (ADR 0038) ------------------------------------------------------


def test_consume_spends_an_approved_row_exactly_once(approvals: Approvals) -> None:
    row = _create(approvals)
    approvals.resolve(row.id, APPROVE_TOKEN, now=T0 + timedelta(minutes=1))
    assert not approvals.describe(row.id).consumed

    assert approvals.consume(row.id, now=T0 + timedelta(minutes=2)) is True
    assert approvals.consume(row.id, now=T0 + timedelta(minutes=3)) is False

    grant = approvals.describe(row.id)
    assert grant.consumed and grant.consumed_at == (T0 + timedelta(minutes=2)).isoformat()
    assert grant.status == ApprovalStatus.APPROVED  # the user's answer is unchanged


@pytest.mark.parametrize("choice", [None, "decline", "expire"])
def test_a_row_that_is_not_approved_cannot_be_spent_and_is_left_alone(
    approvals: Approvals, choice: str | None
) -> None:
    row = _create(approvals)
    if choice == "expire":
        approvals.expire_due(T0 + timedelta(days=2))
    elif choice is not None:
        approvals.resolve(row.id, choice, now=T0 + timedelta(minutes=1))
    before = approvals.get(row.id)

    assert approvals.consume(row.id) is False
    assert approvals.get(row.id) == before


def test_an_unknown_row_cannot_be_spent(approvals: Approvals) -> None:
    assert approvals.consume("apr_000000000000") is False


def test_two_replays_racing_on_one_approval_split_into_one_winner(tmp_path: Path) -> None:
    """Two brains on one directory are two writers; ``BEGIN IMMEDIATE`` and the conditional
    update are what make exactly one of many concurrent spends succeed."""
    first = Approvals(Brain(tmp_path / "brain"))
    second = Approvals(Brain(tmp_path / "brain"))
    row = _create(first)
    first.resolve(row.id, APPROVE_TOKEN, now=T0 + timedelta(minutes=1))

    tables = [first, second] * 4
    start = threading.Barrier(len(tables))
    wins: list[bool] = []
    lock = threading.Lock()

    def spend(table: Approvals) -> None:
        start.wait()
        won = table.consume(row.id)
        with lock:
            wins.append(won)

    threads = [threading.Thread(target=spend, args=(table,)) for table in tables]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert sorted(wins) == [False] * (len(tables) - 1) + [True]


def test_a_brain_from_before_consumed_at_gains_the_column_on_open(tmp_path: Path) -> None:
    """The migration: a table created without ``consumed_at`` keeps its rows and can spend them."""
    brain = Brain(tmp_path / "brain")
    old_schema = re.sub(r",\s*consumed_at TEXT", "", APPROVAL_SCHEMA[0])
    assert "consumed_at" not in old_schema
    with brain.write_txn() as con:
        con.execute(old_schema)
        con.execute(
            """INSERT INTO companion_approval
               (id, action, params_json, origin, conversation_id, surface, options_json,
                status, choice, created_at, expires_at, resolved_at)
               VALUES ('apr_0123456789ab', 'host.invoices.fill', '{}', 'host:invoices', ?,
                       'panel', '["approve","decline"]', 'approved', 'approve', ?, ?, ?)""",
            (CONVERSATION, T0.isoformat(), (T0 + timedelta(days=1)).isoformat(), T0.isoformat()),
        )

    approvals = Approvals(brain)
    Approvals(brain)  # a second open is a no-op, not a duplicate column

    assert approvals.consume("apr_0123456789ab") is True
    assert approvals.consume("apr_0123456789ab") is False
    with (
        pytest.raises(sqlite3.OperationalError, match="duplicate column"),
        brain.write_txn() as con,
    ):
        con.execute("ALTER TABLE companion_approval ADD COLUMN consumed_at TEXT")


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


def test_a_reconcile_keeps_a_spent_approval_spent(tmp_path: Path) -> None:
    """Spending is runtime state too: a rebuild from disk must not make a grant usable again."""
    with Brain(tmp_path / "brain") as brain:
        approvals = Approvals(brain)
        row = _create(approvals)
        approvals.resolve(row.id, APPROVE_TOKEN, now=T0 + timedelta(minutes=1))
        assert approvals.consume(row.id)

        reconcile_from_disk(brain)

        assert approvals.describe(row.id).consumed
        assert approvals.consume(row.id) is False


def test_decline_approved_closes_an_unspent_approval_and_only_that(approvals: Approvals) -> None:
    """ADR 0060: one conditional update, from approved and unspent to declined."""
    row = _create(approvals)
    assert approvals.decline_approved(row.id, "decline") is False, "a pending row is not closed"
    approvals.resolve(row.id, "approve", now=T0)
    assert approvals.decline_approved(row.id, "approve") is False
    assert approvals.decline_approved(row.id, "sure") is False, "a token the card never offered"
    assert approvals.decline_approved(row.id, "decline") is True
    closed = approvals.get(row.id)
    assert closed is not None and (closed.status, closed.choice) == ("declined", "decline")
    assert approvals.consume(row.id, now=T0) is False, "a closed row can never be spent"


def test_decline_approved_leaves_a_spent_approval_alone(approvals: Approvals) -> None:
    row = _create(approvals)
    approvals.resolve(row.id, "approve", now=T0)
    assert approvals.consume(row.id, now=T0) is True

    assert approvals.decline_approved(row.id, "decline") is False
    spent = approvals.get(row.id)
    assert spent is not None and spent.status == "approved"
    assert approvals.decline_approved("apr_nope", "decline") is False


# -- the same call, already let through (ADR 0101) ----------------------------------------------


def test_spent_recently_names_the_approval_of_the_same_call_spent_within_a_day(
    approvals: Approvals,
) -> None:
    row = _create(approvals)
    assert approvals.spent_recently("host.invoices.fill", PARAMS, now=T0) is None, "not approved"
    approvals.resolve(row.id, APPROVE_TOKEN, now=T0 + timedelta(minutes=2))
    assert approvals.spent_recently("host.invoices.fill", PARAMS, now=T0) is None, "not spent"
    assert approvals.consume(row.id, now=T0 + timedelta(minutes=3))

    later = T0 + timedelta(hours=5)
    reordered = dict(reversed(list(PARAMS.items())))
    stamp = approvals.spent_recently("host.invoices.fill", reordered, now=later)
    assert stamp == (T0 + timedelta(minutes=2)).isoformat(), "the moment of the yes, canonical"
    assert (
        approvals.spent_recently("host.invoices.fill", {**PARAMS, "note": "x"}, now=later) is None
    )
    assert approvals.spent_recently("host.invoices.send", PARAMS, now=later) is None
    assert (
        approvals.spent_recently("host.invoices.fill", PARAMS, now=T0 + timedelta(hours=25)) is None
    )


# -- the tab binding (ADR 0103) ----------------------------------------------------------------


def test_a_row_keeps_the_tab_it_was_proposed_on_through_every_read(approvals: Approvals) -> None:
    row = _create(approvals, tab_id=2, tab_nav=7)

    assert (row.tab_id, row.tab_nav) == (2, 7)
    stored = approvals.get(row.id)
    assert stored is not None and (stored.tab_id, stored.tab_nav) == (2, 7)
    grant = approvals.describe(row.id)
    assert (grant.tab_id, grant.tab_nav) == (2, 7)
    event = stored.to_event()
    assert (event.tab_id, event.tab_nav) == (2, 7)
    (pending,) = approvals.pending(10, now=T0).rows
    assert (pending.tab_id, pending.tab_nav) == (2, 7)


def test_a_row_with_no_binding_reads_back_unbound(approvals: Approvals) -> None:
    row = _create(approvals)

    grant = approvals.describe(row.id)
    assert (grant.tab_id, grant.tab_nav) == (None, None)
    assert row.to_event().tab_id is None


def test_a_brain_from_before_the_tab_binding_gains_the_columns_on_open(tmp_path: Path) -> None:
    """The migration: an old table keeps its rows, which read as unbound, and binds new ones."""
    brain = Brain(tmp_path / "brain")
    old_schema = re.sub(r",\s*tab_id INTEGER,\s*tab_nav INTEGER", "", APPROVAL_SCHEMA[0])
    assert "tab_id" not in old_schema
    with brain.write_txn() as con:
        con.execute(old_schema)
        con.execute(
            """INSERT INTO companion_approval
               (id, action, params_json, origin, conversation_id, surface, options_json,
                status, created_at, expires_at)
               VALUES ('apr_0123456789ab', 'host.invoices.fill', '{}', 'host:invoices', ?,
                       'panel', '["approve","decline"]', 'pending', ?, ?)""",
            (CONVERSATION, T0.isoformat(), (T0 + timedelta(days=1)).isoformat()),
        )

    approvals = Approvals(brain)
    Approvals(brain)  # a second open adds nothing twice

    old = approvals.describe("apr_0123456789ab")
    assert (old.tab_id, old.tab_nav) == (None, None)
    new = _create(approvals, tab_id=4, tab_nav=1)
    assert approvals.describe(new.id).tab_id == 4


# -- the cards some turns filed (ADR 0124, 0127) -------------------------------------------------


def test_the_cards_of_some_turns_are_counted_by_state_whatever_their_conversation(
    approvals: Approvals,
) -> None:
    """The receipt of a case's run is these counts: every card its turns filed, not the page's,
    in whichever tab's conversation each turn talked."""
    one, two, elsewhere = ids.mint("turn"), ids.mint("turn"), ids.mint("turn")
    yes = _create(approvals, turn_id=one, params={"n": 1})
    no = _create(
        approvals,
        turn_id=two,
        conversation="conv_crm",
        params={"n": 2},
        now=T0 + timedelta(minutes=1),
    )
    _create(approvals, turn_id=two, params={"n": 3}, now=T0 + timedelta(minutes=2))
    _create(approvals, turn_id=elsewhere, params={"n": 4})  # another run's turn
    _create(approvals, params={"n": 5})  # a card filed with no turn is in no run
    approvals.resolve(yes.id, APPROVE_TOKEN, now=T0 + timedelta(minutes=3))
    approvals.consume(yes.id, now=T0 + timedelta(minutes=3))
    approvals.resolve(no.id, "decline", now=T0 + timedelta(minutes=3))
    assert approvals.get(yes.id).turn_id == one  # type: ignore[union-attr]

    page = approvals.of_turns([one, two], limit=2)
    assert page.total == 3 and [r.id for r in page.rows] == [yes.id, no.id]
    assert page.by_status == {"approved": 1, "declined": 1, "pending": 1}
    assert page.consumed == 1
    assert page.first_at == yes.created_at and page.last_at == iso(T0 + timedelta(minutes=2))
    only = approvals.of_turns([one, two], status="approved")
    assert only.total == 1 and [r.id for r in only.rows] == [yes.id]
    assert approvals.of_turns([two]).consumed == 0
    assert approvals.of_turns([]).by_status == {} and approvals.of_turns([]).first_at == ""


def test_a_card_names_only_a_minted_turn(approvals: Approvals) -> None:
    with pytest.raises(ApprovalError, match="not a turn id"):
        _create(approvals, turn_id="t1")


# -- one declared lifecycle, every verdict an append-only event (ADR 0164) ----------------------


def _fold(events: Any) -> tuple[str | None, str | None, str | None]:
    """The row a history says, ``(status, choice, consumed_at)``, replayed oldest first."""
    status: str | None = None
    choice: str | None = None
    consumed_at: str | None = None
    for event in events:
        if event.kind == "consumed":
            consumed_at = event.at
            continue
        status = event.status_after
        if event.kind in ("approved", "declined"):
            choice = event.choice
    return status, choice, consumed_at


class _Refusals:
    """A context that eats an :class:`ApprovalError`, the refusals a random walk provokes."""

    def __enter__(self) -> None:
        return None

    def __exit__(self, kind: Any, value: Any, tb: Any) -> bool:
        return kind is not None and issubclass(kind, ApprovalError)


def test_a_filed_card_has_exactly_one_filed_event(approvals: Approvals) -> None:
    row = _create(approvals)

    (event,) = approvals.history(row.id).events
    assert (event.kind, event.status_after, event.at) == ("filed", "pending", row.created_at)
    assert event.approval_id == row.id and not event.backfilled


def test_declining_an_approval_supersedes_it_and_the_yes_stays_readable(
    approvals: Approvals,
) -> None:
    row = _create(approvals)
    t1, t2 = T0 + timedelta(minutes=1), T0 + timedelta(minutes=9)
    approvals.resolve(row.id, "approve", now=t1)
    assert approvals.decline_approved(row.id, "decline", now=t2) is True

    stored = approvals.get(row.id)
    assert stored is not None and stored.status == "declined"
    filed, approved, declined = approvals.history(row.id).events
    assert [e.kind for e in (filed, approved, declined)] == ["filed", "approved", "declined"]
    assert (approved.choice, approved.at) == ("approve", iso(t1))
    assert (declined.choice, declined.at) == ("decline", iso(t2))
    assert declined.supersedes == approved.seq
    assert approved.supersedes is None


def test_consume_writes_one_consumed_event_and_a_refused_spend_writes_none(
    approvals: Approvals,
) -> None:
    row = _create(approvals)
    approvals.resolve(row.id, APPROVE_TOKEN, now=T0 + timedelta(minutes=1))

    results = [approvals.consume(row.id, now=T0 + timedelta(minutes=m)) for m in (2, 3)]
    assert sorted(results) == [False, True]
    kinds = [e.kind for e in approvals.history(row.id).events]
    assert kinds.count("consumed") == 1

    for setup in ("pending", "decline", "expire"):
        other = _create(approvals, params={"n": setup})
        if setup == "decline":
            approvals.resolve(other.id, "decline", now=T0 + timedelta(minutes=1))
        elif setup == "expire":
            approvals.expire_due(T0 + timedelta(days=2))
        before = approvals.history(other.id).events
        assert approvals.consume(other.id, now=T0 + timedelta(days=3)) is False
        assert approvals.history(other.id).events == before


def test_every_expired_row_has_exactly_one_expired_event(approvals: Approvals) -> None:
    due = [_create(approvals, params={"n": n}, ttl=timedelta(hours=1)) for n in range(3)]
    sweep = T0 + timedelta(hours=2)
    assert sorted(approvals.expire_due(sweep)) == sorted(r.id for r in due)
    assert approvals.expire_due(sweep + timedelta(hours=1)) == []
    for row in due:
        expired = [e for e in approvals.history(row.id).events if e.kind == "expired"]
        assert len(expired) == 1
        assert (expired[0].reason, expired[0].at) == ("expired", iso(sweep))

    late = _create(approvals, params={"n": "late"}, ttl=timedelta(hours=1), now=sweep)
    for _ in range(2):
        with pytest.raises(ApprovalError):
            approvals.resolve(late.id, APPROVE_TOKEN, now=sweep + timedelta(hours=5))
    assert [e.kind for e in approvals.history(late.id).events] == ["filed", "expired"]


def test_a_refused_resolve_writes_no_event(approvals: Approvals) -> None:
    row = _create(approvals)
    before = approvals.history(row.id).events
    with pytest.raises(ApprovalError):
        approvals.resolve(row.id, "sure", now=T0 + timedelta(minutes=1))
    assert approvals.history(row.id).events == before

    approvals.resolve(row.id, "decline", now=T0 + timedelta(minutes=1))
    answered = approvals.history(row.id).events
    with pytest.raises(ApprovalError):
        approvals.resolve(row.id, APPROVE_TOKEN, now=T0 + timedelta(minutes=2))
    assert approvals.history(row.id).events == answered

    with pytest.raises(ApprovalError):
        approvals.resolve("apr_000000000000", APPROVE_TOKEN, now=T0)
    assert approvals.history("apr_000000000000").events == ()


def test_the_lifecycle_is_one_table_and_every_history_folds_to_its_row(
    approvals: Approvals,
) -> None:
    from athena.core import approvals as module

    assert module.APPROVAL_TRANSITIONS == {
        ("pending", "approved"): "approved",
        ("pending", "declined"): "declined",
        ("pending", "expired"): "expired",
        ("approved", "consumed"): "approved",
        ("approved", "declined"): "declined",
    }
    edges = re.findall(
        r"^\s+(\w+)(?:, unspent)? --.*?-+> (\w+)", module.__doc__ or "", flags=re.MULTILINE
    )
    declared = [(src, dst) for (src, _), dst in module.APPROVAL_TRANSITIONS.items()]
    assert sorted(edges) == sorted(declared)

    rng = random.Random(20261025)
    rows: list[str] = []
    clock = T0
    for _ in range(200):
        clock += timedelta(minutes=rng.randint(1, 20))
        op = rng.choice(["create", "resolve", "resolve", "expire", "consume", "decline"])
        if op == "create" or not rows:
            if len(rows) < 10:
                ttl = timedelta(minutes=rng.choice([30, 90, 600]))
                rows.append(_create(approvals, params={"n": len(rows)}, ttl=ttl, now=clock).id)
            continue
        target = rng.choice(rows)
        token = rng.choice(["approve", "approve", "decline", "sure"])
        if op == "resolve":
            with _Refusals():
                approvals.resolve(target, token, now=clock)
        elif op == "expire":
            approvals.expire_due(clock)
        elif op == "consume":
            approvals.consume(target, now=clock)
        else:
            approvals.decline_approved(target, token, now=clock)

    assert len(rows) == 10
    trail: list[Any] = []
    for approval_id in rows:
        stored = approvals.get(approval_id)
        assert stored is not None
        trail.extend(approvals.history(approval_id).events)
        assert _fold(approvals.history(approval_id).events) == (
            stored.status,
            stored.choice,
            stored.consumed_at,
        )
    kinds = {e.kind for e in trail}
    assert kinds == {"filed", "approved", "declined", "expired", "consumed"}, kinds
    assert any(e.supersedes is not None for e in trail), "the walk declines a yes"


def test_a_brain_from_before_the_event_table_is_backfilled_once_on_open(tmp_path: Path) -> None:
    brain = Brain(tmp_path / "brain")
    later = (T0 + timedelta(minutes=5)).isoformat()
    spent = (T0 + timedelta(minutes=6)).isoformat()
    legacy = [
        ("apr_00000000000a", "pending", None, None, None, None),
        ("apr_00000000000b", "approved", "approve", None, later, spent),
        ("apr_00000000000c", "declined", "decline", None, later, None),
        ("apr_00000000000d", "expired", None, "expired", later, None),
    ]
    with brain.write_txn() as con:
        con.execute(APPROVAL_SCHEMA[0])
        for approval_id, status, choice, reason, resolved, consumed in legacy:
            con.execute(
                """INSERT INTO companion_approval
                   (id, action, params_json, origin, conversation_id, surface, options_json,
                    status, choice, reason, created_at, expires_at, resolved_at, consumed_at)
                   VALUES (?, 'host.invoices.fill', '{}', 'host:invoices', ?, 'panel',
                           '["approve","decline"]', ?, ?, ?, ?, ?, ?, ?)""",
                (
                    approval_id,
                    CONVERSATION,
                    status,
                    choice,
                    reason,
                    T0.isoformat(),
                    (T0 + timedelta(days=1)).isoformat(),
                    resolved,
                    consumed,
                ),
            )

    approvals = Approvals(brain)
    counts = {a: len(approvals.history(a).events) for a, *_ in legacy}
    Approvals(brain)  # a second open backfills nothing twice

    for approval_id, *_ in legacy:
        stored = approvals.get(approval_id)
        assert stored is not None
        events = approvals.history(approval_id).events
        assert len(events) == counts[approval_id]
        assert events and all(e.backfilled for e in events)
        assert [e.kind for e in events].count("filed") == 1
        assert _fold(events) == (stored.status, stored.choice, stored.consumed_at)


def test_the_readers_answer_exactly_as_before_for_the_same_ops(approvals: Approvals) -> None:
    turn = ids.mint("turn")
    a = _create(approvals, turn_id=turn, params={"n": 1})
    b = _create(approvals, turn_id=turn, params={"n": 2}, now=T0 + timedelta(minutes=1))
    c = _create(approvals, turn_id=turn, params={"n": 3}, now=T0 + timedelta(minutes=2))
    d = _create(approvals, params={"n": 4}, ttl=timedelta(minutes=30))
    _create(approvals, params={"n": 5}, now=T0 + timedelta(minutes=3))
    approvals.resolve(a.id, APPROVE_TOKEN, now=T0 + timedelta(minutes=4))
    assert approvals.consume(a.id, now=T0 + timedelta(minutes=5))
    approvals.resolve(b.id, APPROVE_TOKEN, now=T0 + timedelta(minutes=4))
    assert approvals.decline_approved(b.id, "decline", now=T0 + timedelta(minutes=6))
    assert approvals.expire_due(T0 + timedelta(hours=1)) == [d.id]

    page = approvals.pending(1, now=T0 + timedelta(hours=1))
    assert ([r.id for r in page.rows], page.total, page.footer()) == ([c.id], 2, "(showing 1 of 2)")
    cards = approvals.of_turns([turn])
    assert (cards.total, cards.by_status, cards.consumed) == (
        3,
        {"approved": 1, "declined": 1, "pending": 1},
        1,
    )
    within = T0 + timedelta(hours=1)
    assert approvals.spent_recently("host.invoices.fill", {"n": 1}, now=within) == iso(
        T0 + timedelta(minutes=4)
    )
    assert approvals.spent_recently("host.invoices.fill", {"n": 2}, now=within) is None
    grant = approvals.describe(b.id)
    assert (grant.status, grant.choice, grant.consumed_at) == ("declined", "decline", None)
    closed = approvals.get(b.id)
    assert closed is not None and closed.resolved_at == iso(T0 + timedelta(minutes=6))
    expired = approvals.get(d.id)
    assert expired is not None
    assert (expired.reason, expired.resolved_at) == ("expired", iso(T0 + timedelta(hours=1)))

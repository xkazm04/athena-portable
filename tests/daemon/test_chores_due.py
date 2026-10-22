"""Chores come due over HTTP (ADR 0131): the cadence and review routes, and the scheduled turn.

The person sets a cadence on her case, the loop (ticked here on a fake clock) opens a review, the
review route answers it with no model call (no ledger row), and her first send after "Open and
prepare" is the one turn whose ledger row says ``trigger_kind='schedule'``.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from athena.adopt.cadence import QuietWindow
from athena.adopt.cases import render_case
from athena.adopt.chores import ChoreClock
from athena.contracts import ids
from athena.contracts.adopt import Case
from athena.contracts.channel import iso
from athena.daemon.server import AthenaDaemon
from athena.wiring import AthenaLocal

from .conftest import Live, claude_round

T0 = datetime(2026, 10, 19, 9, 0, tzinfo=UTC)


def _case(daemon: AthenaDaemon) -> str:
    case_id = ids.mint("project")
    case = Case(
        id=case_id,
        playbook_id="invoice-chase",
        title="Chase the invoices",
        approved_rev=1,
        approved_at=iso(T0),
        episode_id="",
        created=iso(T0),
        command="Chase every overdue invoice.",
    )
    daemon.brain.write_goal(
        case_id,
        case.title,
        render_case(case),
        session_id=ids.conversation_for_project(case_id),
        created=iso(T0),
    )
    return case_id


def _clock(local: AthenaLocal, at: list[datetime]) -> ChoreClock:
    assert local.adopt is not None and local.adopt.chores is not None
    clock = local.adopt.chores
    clock.clock = lambda: at[0]
    clock.set_quiet(QuietWindow(start="00:00", end="00:00", timezone="UTC"))
    return clock


def _rows(daemon: AthenaDaemon) -> list[tuple[str, str]]:
    with daemon.brain.read_connection() as con:
        return [
            (str(r[0]), str(r[1]))
            for r in con.execute("SELECT turn_id, trigger_kind FROM companion_turn ORDER BY rowid")
        ]


def test_a_due_review_over_http_calls_no_model(
    live: Live, daemon: AthenaDaemon, local: AthenaLocal
) -> None:
    case_id = _case(daemon)
    at = [T0 - timedelta(days=1)]
    clock = _clock(local, at)

    nothing = live.request(f"/adopt/cases/{case_id}/cadence")
    assert nothing.status == 200 and nothing.body["cadence"] is None
    bad = live.request(
        f"/adopt/cases/{case_id}/cadence",
        method="POST",
        json_body={"rule": {"kind": "weekly", "weekday": 9}},
    )
    assert bad.status == 400 and "weekday" in bad.body["detail"]
    set_ = live.request(
        f"/adopt/cases/{case_id}/cadence",
        method="POST",
        json_body={"rule": {"kind": "weekly", "weekday": 0, "at": "09:00"}, "timezone": "UTC"},
    )
    assert set_.status == 200
    assert set_.body["rule_text"] == "every Monday at 09:00"
    assert set_.body["cadence"]["next_run_at"] == iso(T0)
    assert set_.body["upcoming"][0] == iso(T0)

    at[0] = T0 + timedelta(days=14, minutes=1)
    clock.tick()
    before = _rows(daemon)
    due = live.request("/adopt/chores/due")
    assert due.status == 200 and [n["case_id"] for n in due.body["notices"]] == [case_id]
    assert due.body["notices"][0]["missed"] == 2 and due.body["ticked_at"] == iso(at[0])

    review = live.request(f"/adopt/cases/{case_id}/review")
    assert review.status == 200
    body = review.body["review"]
    assert body["command"] == "Chase every overdue invoice."
    assert body["review"]["due_at"] == iso(T0) and body["review"]["missed"] == 2
    # No model was asked (the scripted engine has no round, and would raise), no ledger row.
    assert _rows(daemon) == before

    stale = live.request(
        f"/adopt/cases/{case_id}/review",
        method="POST",
        json_body={"due_at": iso(T0 + timedelta(days=7)), "answer": "seen"},
    )
    assert stale.status == 409
    seen = live.request(
        f"/adopt/cases/{case_id}/review",
        method="POST",
        json_body={"due_at": iso(T0), "answer": "seen"},
    )
    assert seen.status == 200
    assert live.request("/adopt/chores/due").body["notices"] == []
    # Pause from the route: the open review closes, nothing more comes due.
    paused = live.request(
        f"/adopt/cases/{case_id}/cadence", method="POST", json_body={"enabled": False}
    )
    assert paused.status == 200 and paused.body["cadence"]["enabled"] is False
    assert paused.body["cadence"]["review"]["answer"] == "paused"
    assert paused.body["log"][0]["event"] == "paused"


def test_only_the_first_send_after_open_and_prepare_is_scheduled(
    live: Live, daemon: AthenaDaemon, local: AthenaLocal
) -> None:
    case_id = _case(daemon)
    at = [T0 - timedelta(days=1)]
    clock = _clock(local, at)
    live.request(
        f"/adopt/cases/{case_id}/cadence",
        method="POST",
        json_body={"rule": {"kind": "weekly", "weekday": 0}, "timezone": "UTC"},
    )
    at[0] = T0 + timedelta(minutes=1)
    clock.tick()
    assert live.register().status == 200

    # Marked, but she has not pressed "Open and prepare": an ordinary turn.
    live.script(claude_round("Not yet."))
    assert live.run("hello", case_id=case_id, trigger="schedule").status == 200

    prepared = live.request(
        f"/adopt/cases/{case_id}/review",
        method="POST",
        json_body={"due_at": iso(T0), "answer": "prepare"},
    )
    assert prepared.status == 200 and prepared.body["review"]["review"]["answer"] == "prepare"
    at[0] = T0 + timedelta(minutes=5)

    live.script(claude_round("Starting."), claude_round("Next."), claude_round("Again."))
    assert (
        live.run("Chase every overdue invoice.", case_id=case_id, trigger="schedule").status == 200
    )
    # A second marked request (a stale surface) and an unmarked one are ordinary.
    assert live.run("more", case_id=case_id, trigger="schedule").status == 200
    assert live.run("and more", case_id=case_id).status == 200

    triggers = [t for _, t in _rows(daemon)]
    assert triggers == ["cli", "schedule", "cli", "cli"]
    held = clock.book.load(case_id)
    assert held is not None and held.review is not None
    assert held.review.first_turn_id == _rows(daemon)[1][0]

"""What ``GET /health`` says, and how the table the next commit extends behaves.

``/health`` is the whole route table in this commit, so these tests are also the tests of the
table itself: what a duplicate registration does, what a route that is not there does, and that
the one route this daemon ships answers off a read connection rather than the writer.
"""

from __future__ import annotations

import pytest

from athena.core.approvals import Approvals
from athena.daemon.routes import Route, RouteTable, error, health
from athena.daemon.server import AthenaDaemon

from .conftest import ENGINE, Live


def _card(approvals: Approvals, summary: str) -> None:
    approvals.create(
        "host.invoices.fill",
        {"ref": "r7", "value": "2026-09-30"},
        origin="host:invoices",
        conversation="conv_invoices",
        surface="panel",
        summary=summary,
    )


# -- health --------------------------------------------------------------------------------------


def test_health_names_the_engine_the_brain_and_how_long_it_has_been_up(live: Live) -> None:
    reply = live.request("/health")

    assert reply.status == 200
    body = reply.body
    assert body["ok"] is True
    assert body["engine"] == ENGINE
    assert body["model"] == "fake-model"
    assert body["brain"] == str(live.daemon.brain.root)
    assert body["uptime_s"] >= 0.0
    assert body["sessions"] == 0
    assert "GET /health" in body["routes"]


def test_health_counts_the_pending_cards_and_announces_nothing_when_it_shows_them_all(
    daemon: AthenaDaemon,
) -> None:
    _card(daemon.approvals, "chase invoice 7")
    _card(daemon.approvals, "chase invoice 8")

    status, body = health(daemon)

    assert status == 200
    assert body["pending"] == {"showing": 2, "total": 2, "footer": ""}


def test_health_announces_the_bound_when_there_are_more_cards_than_it_counted(
    daemon: AthenaDaemon, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``(showing N of M)``, in the words every other bounded read in this repository uses."""
    monkeypatch.setattr("athena.daemon.routes.HEALTH_PENDING_LIMIT", 2)
    for n in range(3):
        _card(daemon.approvals, f"chase invoice {n}")

    _, body = health(daemon)

    assert body["pending"] == {"showing": 2, "total": 3, "footer": "(showing 2 of 3)"}


def test_health_answers_off_a_read_connection_while_the_brain_is_being_written(
    daemon: AthenaDaemon,
) -> None:
    """Inside a write transaction, on this very thread: the read handle is its own connection."""
    with daemon.brain.write_txn():
        daemon.brain.append_episode("mid-transaction", role="user")

        status, body = health(daemon)

    assert status == 200
    assert body["pending"]["total"] == 0


# -- the table -----------------------------------------------------------------------------------


def test_the_table_ships_the_routes_this_commit_added(daemon: AthenaDaemon) -> None:
    """The read routes — ``/decisions``, ``/ledger``, ``/playbooks`` — arrive in the next one."""
    assert daemon.routes.listing() == [
        "GET /health",
        "POST /manifest",
        "POST /run",
        "POST /decisions/<id>",
    ]


def test_a_route_registered_twice_is_a_programming_error(daemon: AthenaDaemon) -> None:
    with pytest.raises(ValueError, match="already routed"):
        daemon.routes.add(Route("GET", "/health", lambda request: (200, {})))


def test_the_table_tells_an_unknown_path_from_a_wrong_verb() -> None:
    table = RouteTable([Route("GET", "/health", lambda request: (200, {}))])

    assert table.match("GET", "/health") is not None
    assert table.match("POST", "/health") is None
    assert table.knows("/health")
    assert not table.knows("/nope")
    assert len(table) == 1


def test_a_query_string_does_not_change_which_route_matched(live: Live) -> None:
    reply = live.request("/health?limit=3&limit=4")

    assert reply.status == 200


def test_an_error_reason_outside_the_vocabulary_collapses_to_unknown() -> None:
    """One refusal vocabulary (ADR 0009): a route cannot invent a word for the surface to learn."""
    status, body = error(418, "i_made_this_up", "because I could")

    assert status == 418
    assert body == {"ok": False, "reason": "unknown", "detail": "because I could"}

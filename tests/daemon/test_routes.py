"""What ``GET /health`` says, and how the table the next commit extends behaves.

``/health`` is the whole route table in this commit, so these tests are also the tests of the
table itself: what a duplicate registration does, what a route that is not there does, and that
the one route this daemon ships answers off a read connection rather than the writer.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from athena.adopt.cases import render_case
from athena.contracts import ids
from athena.contracts.adopt import Case
from athena.contracts.channel import now_iso
from athena.core.approvals import Approvals
from athena.daemon.routes import Route, RouteTable, base_routes, error, health
from athena.daemon.server import AthenaDaemon
from athena.spaces.book import check_input

from .conftest import ENGINE, Live, claude_round


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


def test_the_table_ships_every_route_the_daemon_answers(daemon: AthenaDaemon) -> None:
    """Three that write, five that read, and the one prefix path last so nothing shadows it."""
    assert daemon.routes.listing() == [
        "GET /health",
        "GET /engines",
        "POST /manifest",
        "POST /run",
        "POST /run/stop",
        "GET /decisions",
        "GET /ledger",
        "GET /ledger/rollup",
        "GET /playbooks",
        "POST /decisions/<id>",
        # The delegated tasks', exact before the prefix (ADR 0141).
        "GET /tasks",
        "POST /tasks/claim",
        "POST /tasks/<id>",
        # This PC's room and her sleep, exact before each prefix (ADR 0143).
        "GET /vitals",
        "GET /sleep",
        "GET /sleep/cycles",
        "GET /sleep/proposals",
        "POST /sleep/run",
        "GET /sleep/cycles/<id>",
        "POST /sleep/proposals/<id>",
        # The voice studio's, added by wiring after the base table (ADR 0028).
        "GET /voice/config",
        "PUT /voice/config",
        "POST /voice/preview",
        "POST /voice/transcribe",
        "POST /voice/install",
        "GET /voice/install",
        "PUT /voice/key",
        "DELETE /voice/key",
        # The adopt studio's, outside the writer lock (ADR 0097).
        "POST /adopt",
        "GET /adopt/cases",
        # When a case comes due (ADR 0131): exact, so before the session prefix.
        "GET /adopt/chores/due",
        "GET /adopt/chores/quiet",
        "POST /adopt/chores/quiet",
        "GET /adopt/cases/<id>",
        "POST /adopt/cases/<id>",
        "GET /adopt/<id>",
        "POST /adopt/<id>",
        "DELETE /adopt/<id>",
        # The Chores front door, the same machine without a playbook (ADR 0098).
        "POST /intake",
        "GET /intake/<id>",
        "POST /intake/<id>",
        "DELETE /intake/<id>",
        # The person's projects, after the studio whose case book they share (ADR 0225).
        "GET /spaces",
        "POST /spaces",
        "GET /spaces/<id>",
        "POST /spaces/<id>",
        "DELETE /spaces/<id>",
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


def test_every_pending_card_reaches_the_frame_and_a_long_one_is_cut() -> None:
    """ADR 0052: the daemon passed ten lines, so the digest counted the page, not the inbox."""
    from types import SimpleNamespace

    from athena.daemon.routes import PENDING_LINE_CAP, pending_lines

    rows = [
        SimpleNamespace(
            id=f"apr_{i:02d}", action="host.bank.pay_bill", params={"reference": f"CL-{i}"}
        )
        for i in range(13)
    ]
    rows.append(
        SimpleNamespace(id="apr_letter", action="host.mail.send_email", params={"body": "x" * 900})
    )
    asked: list[int] = []

    def pending(limit: int) -> SimpleNamespace:
        asked.append(limit)
        return SimpleNamespace(rows=rows[:limit])

    lines = pending_lines(SimpleNamespace(approvals=SimpleNamespace(pending=pending)))  # type: ignore[arg-type]
    assert len(lines) == 14 and asked == [100]
    assert len(lines[-1]) == PENDING_LINE_CAP and lines[-1].endswith("…")
    assert lines[0] == 'apr_00: host.bank.pay_bill {"reference": "CL-0"}'


# -- the docstrings a reader meets first ---------------------------------------------------------


def test_the_routes_docstring_names_every_route_the_base_table_ships(daemon: AthenaDaemon) -> None:
    """The module docstring is the route list a reviewer reads; a route added to the table and
    not to it is a route the reader is told does not exist."""
    from athena.daemon import routes

    doc = routes.__doc__ or ""
    missing = [route.label for route in base_routes(daemon) if f"``{route.label}``" not in doc]
    assert missing == []


def test_the_package_docstring_names_every_module_in_the_package() -> None:
    """``athena.daemon``'s docstring is its table of contents ("read them one at a time")."""
    import athena.daemon as package

    doc = package.__doc__ or ""
    here = Path(package.__file__).parent
    modules = sorted(p.stem for p in here.glob("*.py") if p.stem != "__init__")
    assert [m for m in modules if f":mod:`athena.daemon.{m}`" not in doc] == []


# -- the project a turn runs in (ADR 0225) ---------------------------------------------------------


def _space(daemon: AthenaDaemon, name: str, brief: str = "", apps: list[str] | None = None) -> str:
    """A project on disk, made as ``POST /spaces`` makes one."""
    assert daemon.spaces is not None
    body: dict[str, object] = {"name": name, "brief": brief, "apps": apps or []}
    return daemon.spaces.create(check_input(body, partial=False)).id


def _case_in(daemon: AthenaDaemon, space_id: str) -> str:
    """A saved case filed under ``space_id`` (``""`` is core), as an approve writes it."""
    case_id = ids.mint("project")
    stamp = now_iso()
    case = Case(
        id=case_id,
        playbook_id="invoice-chase",
        title="Chase the invoices",
        approved_rev=1,
        approved_at=stamp,
        episode_id="",
        created=stamp,
        space_id=space_id,
    )
    daemon.brain.write_goal(
        case_id,
        case.title,
        render_case(case),
        session_id=ids.conversation_for_project(case_id),
        created=stamp,
    )
    return case_id


def _told(live: Live) -> str:
    return live.transport.requests[-1].stdin


def test_a_run_with_a_space_id_that_is_no_space_is_refused_before_the_stream(live: Live) -> None:
    assert live.register().status == 200
    for space_id, detail in (
        ("spc_nothex", "not a space id"),
        ("proj_0123456789ab", "not a space id"),
        (7, "not a space id"),
        ("spc_0123456789ab", "no such space"),
    ):
        reply = live.run("hello", space_id=space_id)
        assert reply.status == 400, space_id
        assert reply.body["reason"] == "unknown_ref" and detail in reply.body["detail"]
    assert live.transport.requests == []


def test_a_turn_in_a_project_is_told_its_name_brief_and_apps_and_a_core_turn_is_not(
    live: Live, daemon: AthenaDaemon
) -> None:
    space_id = _space(
        daemon, "Taxes 2026", "File the return by April.", ["https://tax.example:8443"]
    )
    assert live.register().status == 200
    live.script(claude_round("In the project."), claude_round("In core."), claude_round("Core."))

    inside = live.run("what now?", space_id=space_id)
    assert inside.status == 200 and inside.frames()[-1][0] == "turn.finished"
    told = _told(live)
    assert "## Project: Taxes 2026\n\nFile the return by April.\n" in told
    assert "Apps in this project: tax.example:8443" in told
    assert "### Kept for this project" in told
    # The chore's frame.project is untouched beside it.
    assert "## Active project" in told

    for body in ({}, {"space_id": ""}):
        assert live.run("and now?", **body).status == 200
        assert "## Project:" not in _told(live)
        assert "Kept for this project" not in _told(live)


def test_a_turn_under_a_case_runs_where_the_case_is_filed_whatever_the_body_says(
    live: Live, daemon: AthenaDaemon
) -> None:
    asked = _space(daemon, "Garden", "Plant the beds.")
    filed = _space(daemon, "Taxes 2026", "File the return.")
    in_filed = _case_in(daemon, filed)
    in_core = _case_in(daemon, "")
    assert live.register().status == 200
    live.script(*(claude_round("ok") for _ in range(3)))

    # The case's project wins over the one the body names.
    assert live.run("go", case_id=in_filed, space_id=asked).status == 200
    assert "## Project: Taxes 2026" in _told(live) and "Garden" not in _told(live)

    # A core chore run from inside a project is core's work: no project in the frame.
    assert live.run("go", case_id=in_core, space_id=asked).status == 200
    assert "## Project:" not in _told(live)

    # A case id that names no saved case leaves the turn where it was asked to run.
    assert live.run("go", case_id="proj_0123456789ab", space_id=asked).status == 200
    assert "## Project: Garden" in _told(live)

"""Sessions are keyed by origin, derive their conversation, and never assemble a prefix."""

from __future__ import annotations

import threading

import pytest

from athena.contracts import ids
from athena.daemon.sessions import Session, Sessions, conversation_for


def test_a_session_pins_its_origin_and_derives_its_conversation() -> None:
    sessions = Sessions()

    session = sessions.touch("https://invoices.example", "invoices")

    assert session.origin == "https://invoices.example"
    assert session.app_id == "invoices"
    assert session.conversation_id == "conv_invoices"
    assert ids.is_id("conversation", session.conversation_id)
    assert session.created_at == session.last_seen_at


def test_touching_an_origin_again_keeps_when_it_was_first_seen(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stamps = iter(["2026-09-12T09:00:00+00:00", "2026-09-12T09:05:00+00:00"])
    monkeypatch.setattr("athena.daemon.sessions._now_iso", lambda: next(stamps))
    sessions = Sessions()

    first = sessions.touch("https://invoices.example", "invoices")
    again = sessions.touch("https://invoices.example", "invoices")

    assert again.created_at == first.created_at
    assert again.last_seen_at == "2026-09-12T09:05:00+00:00"
    assert len(sessions) == 1


def test_a_session_is_keyed_by_origin_so_two_origins_are_two_sessions() -> None:
    sessions = Sessions()

    sessions.touch("https://invoices.example", "invoices")
    sessions.touch("https://inbox.example", "inbox")

    assert len(sessions) == 2
    assert sessions.get("https://inbox.example") is not None
    assert [s.app_id for s in sessions.all()] == ["invoices", "inbox"]


def test_an_origin_that_reloads_under_a_new_app_id_gets_the_new_conversation() -> None:
    sessions = Sessions()
    sessions.touch("https://invoices.example", "invoices")

    session = sessions.touch("https://invoices.example", "invoices_v2")

    assert session.conversation_id == "conv_invoices_v2"
    assert len(sessions) == 1


def test_an_app_id_that_is_not_a_slug_is_refused_rather_than_slugged_here() -> None:
    sessions = Sessions()

    with pytest.raises(ValueError, match="lowercase slug"):
        sessions.touch("https://invoices.example", "Invoices Inc.")


def test_a_session_needs_an_origin() -> None:
    with pytest.raises(ValueError, match="origin"):
        Sessions().touch("", "invoices")


def test_a_project_moves_the_conversation_and_adds_no_second_prefix() -> None:
    """The ``conv_proj_proj_<id>`` finding of README §3.5, asserted rather than remembered."""
    sessions = Sessions()
    session = sessions.touch("https://invoices.example", "invoices")
    project = ids.mint("project")

    conversation = conversation_for(session, project)

    assert conversation == f"conv_{project}"
    assert conversation.count("proj_") == 1
    assert ids.is_id("conversation", conversation)


def test_without_a_project_a_turn_stays_in_the_sessions_conversation() -> None:
    session = Sessions().touch("https://invoices.example", "invoices")

    assert conversation_for(session) == "conv_invoices"
    assert conversation_for(session, "") == "conv_invoices"


def test_a_bare_project_slug_is_refused_rather_than_prefixed_here() -> None:
    session = Sessions().touch("https://invoices.example", "invoices")

    with pytest.raises(ValueError, match="not a project id"):
        conversation_for(session, "quarter-close")


def test_dropping_an_origin_forgets_exactly_one() -> None:
    sessions = Sessions()
    sessions.touch("https://invoices.example", "invoices")
    sessions.touch("https://inbox.example", "inbox")

    assert sessions.drop("https://inbox.example") is True
    assert sessions.drop("https://inbox.example") is False
    assert len(sessions) == 1


def test_a_session_is_frozen_so_a_reader_holds_a_value(monkeypatch: pytest.MonkeyPatch) -> None:
    sessions = Sessions()
    held = sessions.touch("https://invoices.example", "invoices")

    sessions.touch("https://invoices.example", "invoices_v2")

    assert held.app_id == "invoices"
    with pytest.raises(AttributeError):
        held.app_id = "mutated"  # type: ignore[misc]


def test_the_table_survives_threads_touching_it_at_once() -> None:
    """The server is threaded, so the dictionary behind the sessions has to be."""
    sessions = Sessions()
    barrier = threading.Barrier(8)

    def touch(n: int) -> None:
        barrier.wait(timeout=10)
        for _ in range(25):
            sessions.touch(f"https://app{n}.example", f"app{n}")

    threads = [threading.Thread(target=touch, args=(n,)) for n in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=20)

    assert len(sessions) == 8
    assert all(isinstance(s, Session) for s in sessions.all())

"""The session store: the event log, the bound, the TTL, the hooks (ADR 0097)."""

from __future__ import annotations

import threading
from pathlib import Path

import pytest

from athena.adopt import loop
from athena.adopt.session import (
    ADOPT_ERROR_REASONS,
    SESSION_CLOSED,
    Busy,
    current_hooks,
    register_hooks,
    reset_hooks,
)
from athena.adopt.slots import PlaybookMissing
from athena.contracts.adopt import Progress
from athena.contracts.harness import ERROR_REASONS

from .conftest import PLAYBOOK_ID, Rig, clear_script, make_rig


def test_emit_stamps_a_monotonic_seq_across_threads(rig: Rig) -> None:
    session = rig.store.create(PLAYBOOK_ID)

    def burst() -> None:
        for _ in range(50):
            session.emit(Progress(text="beat"))

    threads = [threading.Thread(target=burst) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    seqs = [e.seq for e in session.events_after(0)]
    assert seqs == list(range(1, 201))
    assert [e.seq for e in session.events_after(150)] == list(range(151, 201))
    assert session.wait_after(200, timeout=0.01) is False
    assert session.wait_after(199, timeout=0.01) is True


def test_a_fourth_live_session_is_busy(rig: Rig) -> None:
    for _ in range(3):
        rig.store.create(PLAYBOOK_ID)
    with pytest.raises(Busy):
        rig.store.create(PLAYBOOK_ID)
    rig.store.delete(rig.store.live()[0].id)
    rig.store.create(PLAYBOOK_ID)


def test_an_unknown_playbook_makes_no_session(rig: Rig) -> None:
    with pytest.raises(PlaybookMissing):
        rig.store.create("nope")
    assert rig.store.live() == []


def test_idle_past_the_ttl_is_reaped_and_its_temp_dir_deleted(tmp_path: Path) -> None:
    now = [1000.0]
    rig = make_rig(tmp_path, clock=lambda: now[0])
    try:
        rig.model.script = clear_script()
        session = rig.store.create(PLAYBOOK_ID)
        loop.start(session)
        session.drain()
        (session.temp_dir / "docs").mkdir()
        (session.temp_dir / "docs" / "doc1-a.pdf").write_bytes(b"%PDF")
        warm = rig.warm.spawned[0]
        now[0] += rig.store.ttl_s - 1
        assert rig.store.reap() == []
        session.touch()
        now[0] += rig.store.ttl_s
        assert rig.store.reap() == [session.id]
        assert not session.temp_dir.exists()
        assert session.closed and session.cancelled.is_set()
        assert warm.killed
        assert ("close", session.id) in rig.seen
        assert rig.store.get(session.id) is None
        assert session.wait_after(10_000, timeout=0.01) is True  # streams wake and end
        final = session.events_after(0)[-1].to_dict()
        assert final["reason"] == "session_closed"
        assert final["detail"] == "the session expired after 2 h idle"
    finally:
        rig.store.close_all()


def test_the_last_event_of_a_closed_session_is_session_closed(rig: Rig) -> None:
    session = rig.store.create(PLAYBOOK_ID)
    session.emit(Progress(text="beat"))
    rig.store.delete(session.id)
    events = [e.to_dict() for e in session.events_after(0)]
    assert events[-1] == {
        "kind": "adopt.error",
        "seq": 2,
        "reason": SESSION_CLOSED,
        "detail": "the session was closed (DELETE)",
    }
    # Nothing follows it: a lane finishing late is dropped, not raised.
    assert session.emit(Progress(text="late")).seq == 0
    assert len(session.events_after(0)) == 2


def test_session_closed_is_an_adopt_error_reason_beside_the_closed_set() -> None:
    assert SESSION_CLOSED == "session_closed"
    assert (*ERROR_REASONS, "session_closed") == ADOPT_ERROR_REASONS
    assert SESSION_CLOSED not in ERROR_REASONS  # the gate's vocabulary is unchanged


def test_apply_findings_emits_slots_only_on_change(rig: Rig) -> None:
    session = rig.store.create(PLAYBOOK_ID)
    session.apply_findings([{"slot_id": "p1", "value": "Gusto", "status": "guessed"}])
    session.apply_findings([{"slot_id": "p1", "value": "Gusto", "status": "guessed"}])
    slots_events = [e for e in session.events_after(0) if e.kind == "adopt.slots"]
    assert len(slots_events) == 1
    assert next(s for s in session.slots if s.id == "p1").source == "research"


def test_leftover_session_dirs_of_a_dead_process_are_swept(tmp_path: Path) -> None:
    stale = tmp_path / "sessions" / "sess_000000000000"
    stale.mkdir(parents=True)
    keep = tmp_path / "sessions" / "notes"
    keep.mkdir()
    rig = make_rig(tmp_path)
    try:
        rig.store.create(PLAYBOOK_ID)
        assert not stale.exists() and keep.exists()
    finally:
        rig.store.close_all()


def test_hooks_are_registered_once_and_a_session_reads_them_at_creation() -> None:
    calls: list[str] = []
    register_hooks(on_start=lambda s: calls.append("start"))
    hooks = current_hooks()
    hooks.on_start(None)  # type: ignore[arg-type]
    assert calls == ["start"]
    reset_hooks()
    current_hooks().on_start(None)  # type: ignore[arg-type]
    assert calls == ["start"]


def test_a_hook_that_raises_is_an_error_event_and_the_session_goes_on(rig: Rig) -> None:
    def boom(session: object) -> None:
        raise RuntimeError("lane exploded")

    rig.hooks.on_start = boom
    rig.model.script = clear_script()
    session = rig.store.create(PLAYBOOK_ID)
    loop.start(session)
    session.drain()
    errors = [e.to_dict() for e in session.events_after(0) if e.kind == "adopt.error"]
    assert errors == [
        {
            "kind": "adopt.error",
            "seq": errors[0]["seq"],
            "reason": "unknown",
            "detail": "on_start failed: RuntimeError",
        }
    ]
    assert any(e.kind == "adopt.questions" for e in session.events_after(0))

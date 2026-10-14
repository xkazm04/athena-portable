"""The adopt routes over a real socket, outside the writer lock (ADR 0097)."""

from __future__ import annotations

import base64
from typing import Any

from .conftest import PLAYBOOK_ID, Live, clear_script, read_frames


def start(live: Live) -> str:
    live.rig.model.script = clear_script()
    status, body = live.request("/adopt", method="POST", body={"playbook_id": PLAYBOOK_ID})
    assert status == 200 and body["ok"], body
    return str(body["session_id"])


def session_of(live: Live, sid: str) -> Any:
    session = live.rig.store.get(sid)
    assert session is not None
    session.drain()
    return session


def has(kind: str) -> Any:
    return lambda frames, comments: any(f["kind"] == kind for f in frames)


def test_start_answers_the_session_and_its_slots(live: Live) -> None:
    status, body = live.request("/adopt", method="POST", body={"playbook_id": PLAYBOOK_ID})
    assert status == 200
    assert body["session_id"].startswith("sess_")
    assert [s["id"] for s in body["slots"]] == ["p1", "p2", "g1"]
    assert body["slots"][0] == {
        "id": "p1",
        "kind": "portal",
        "label": "Do you use Payroll Harbor for the payroll firm, or something else?",
        "status": "open",
        "value": "Payroll Harbor",
        "source": "default",
    }


def test_start_refuses_a_missing_or_unknown_playbook_and_a_fourth_session(live: Live) -> None:
    assert live.request("/adopt", method="POST", body={})[0] == 400
    status, body = live.request("/adopt", method="POST", body={"playbook_id": "nope"})
    assert (status, body["reason"]) == (404, "unknown_ref")
    for _ in range(3):
        start(live)
    status, body = live.request("/adopt", method="POST", body={"playbook_id": PLAYBOOK_ID})
    assert status == 429 and body["ok"] is False
    assert body["reason"] == "budget_exhausted" and body["detail"].startswith("busy:")


def test_every_route_wants_the_token(live: Live) -> None:
    status, body = live.request("/adopt", method="POST", body={}, token=None)
    assert (status, body["reason"]) == (401, "foreign_token")


def test_an_unknown_session_or_verb_is_refused(live: Live) -> None:
    assert live.request("/adopt/sess_000000000000/enough", method="POST")[0] == 404
    sid = start(live)
    assert live.request(f"/adopt/{sid}/dance", method="POST")[0] == 404
    assert live.request(f"/adopt/{sid}/answer")[0] == 404
    status, body = live.request(f"/adopt/{sid}/events?after=x")
    assert (status, body["reason"]) == (400, "validator_failed")


def test_events_replay_after_a_seq_then_follow(live: Live) -> None:
    sid = start(live)
    session_of(live, sid)
    connection, reply = live.stream(f"/adopt/{sid}/events?after=0")
    try:
        assert reply.status == 200
        assert reply.getheader("Content-Type") == "text/event-stream"
        frames, _ = read_frames(reply, has("adopt.questions"))
    finally:
        connection.close()
    seqs = [f["seq"] for f in frames]
    assert seqs == list(range(1, len(seqs) + 1))
    assert frames[0]["kind"] == "adopt.slots" and frames[1]["kind"] == "adopt.say"

    connection, reply = live.stream(f"/adopt/{sid}/events?after=3")
    try:
        resumed, _ = read_frames(reply, lambda fr, c: len(fr) >= len(frames) - 3)
    finally:
        connection.close()
    assert [f["seq"] for f in resumed] == seqs[3:]


def test_a_quiet_stream_heartbeats_and_ends_with_session_closed(live: Live) -> None:
    sid = start(live)
    session = session_of(live, sid)
    connection, reply = live.stream(f"/adopt/{sid}/events?after={session.seq}")
    try:
        _, comments = read_frames(reply, lambda frames, comments: bool(comments))
        assert comments == [": heartbeat"]
        status, body = live.request(f"/adopt/{sid}", method="DELETE")
        assert (status, body) == (200, {"ok": True})
        frames, _ = read_frames(reply, lambda frames, comments: False)  # reads to the close
    finally:
        connection.close()
    assert frames[-1]["kind"] == "adopt.error"
    assert frames[-1]["reason"] == "session_closed"
    assert not session.temp_dir.exists()
    assert live.request(f"/adopt/{sid}", method="DELETE")[0] == 404


def test_answer_to_clear_then_approve_the_current_rev_only(live: Live) -> None:
    sid = start(live)
    session = session_of(live, sid)
    card = next(e.to_dict() for e in session.events_after(0) if e.kind == "adopt.questions")
    bad = {"answers": [{"question_id": "r7q1", "choice_ids": [], "text": "x"}]}
    assert live.request(f"/adopt/{sid}/answer", method="POST", body=bad)[0] == 400
    assert live.request(f"/adopt/{sid}/answer", method="POST", body={"answers": "x"})[0] == 400
    assert (
        live.request(f"/adopt/{sid}/answer", method="POST", body={"answers": [], "via": "fax"})[0]
        == 400
    )
    answers = {
        "answers": [
            {"question_id": card["questions"][0]["id"], "choice_ids": ["b"], "text": ""},
            {"question_id": card["questions"][1]["id"], "choice_ids": [], "text": "yes"},
        ],
        "via": "voice",
    }
    assert live.request(f"/adopt/{sid}/answer", method="POST", body=answers) == (200, {"ok": True})
    session.drain()
    assert any(e.kind == "adopt.clear" for e in session.events_after(0))

    status, body = live.request(f"/adopt/{sid}/approve", method="POST", body={"rev": 2})
    assert (status, body["reason"]) == (409, "validator_failed")
    assert body["detail"].startswith("stale_rev:")
    assert live.request(f"/adopt/{sid}/approve", method="POST", body={"rev": "1"})[0] == 400
    assert live.request(f"/adopt/{sid}/approve", method="POST", body={"rev": 1}) == (
        200,
        {"ok": True, "rev": 1},
    )
    session.drain()
    assert ("approve", 1) in live.rig.seen


def test_enough_drafts_a_brief(live: Live) -> None:
    sid = start(live)
    session = session_of(live, sid)
    assert live.request(f"/adopt/{sid}/enough", method="POST") == (200, {"ok": True})
    session.drain()
    assert any(e.kind == "adopt.brief" for e in session.events_after(0))


def test_a_document_is_kept_in_the_session_and_handed_to_the_hook(live: Live) -> None:
    sid = start(live)
    session = session_of(live, sid)
    data = base64.b64encode(b"%PDF-1.7 a letter").decode()
    status, body = live.request(
        f"/adopt/{sid}/documents",
        method="POST",
        body={"name": "../../Letter from IRS.pdf", "mime": "application/pdf", "data_b64": data},
    )
    assert (status, body) == (200, {"ok": True, "doc_id": "doc1"})
    session.drain()
    ((doc_id, path),) = [value for name, value in live.rig.seen if name == "document"]
    assert doc_id == "doc1" and path.parent == session.temp_dir / "docs"
    assert path.name == "doc1-Letter_from_IRS.pdf" and path.read_bytes() == b"%PDF-1.7 a letter"
    bad = {"name": "a.pdf", "mime": "application/pdf", "data_b64": "not base64!"}
    assert live.request(f"/adopt/{sid}/documents", method="POST", body=bad)[0] == 400
    assert live.request(f"/adopt/{sid}/documents", method="POST", body={"name": "a"})[0] == 400


def test_the_studio_answers_while_a_turn_holds_the_writer_lock(live: Live) -> None:
    """A session route never takes ``daemon.writing()``: with the lock held by a 'turn', a
    session starts, streams its card and takes an answer."""
    lock = live.local.daemon.lock
    assert lock.acquire(timeout=5)
    try:
        sid = start(live)
        session = session_of(live, sid)
        connection, reply = live.stream(f"/adopt/{sid}/events?after=0", timeout=5)
        try:
            frames, _ = read_frames(reply, has("adopt.questions"))
        finally:
            connection.close()
        card = next(f for f in frames if f["kind"] == "adopt.questions")
        body = {"answers": [{"question_id": card["questions"][0]["id"], "text": "Gusto"}]}
        status, _ = live.request(f"/adopt/{sid}/answer", method="POST", body=body, timeout=5)
        assert status == 200
        session.drain()
        assert lock.locked()
    finally:
        lock.release()

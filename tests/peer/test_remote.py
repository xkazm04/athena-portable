"""The remote composer over real sockets: another device's message runs in this panel (ADR 0140).

athena/peer/remote.py and the ``via`` tee on ``POST /run``. Every device here is a real loopback
daemon with its peer listener, built by ``build_local`` as ``athena serve`` builds it; the engine is
a scripted transport the test holds, so a whole gated turn runs with no binary. "The window" is the
test: it listens on ``/events``, takes the message, and drives ``/manifest`` and ``/run`` exactly as
``apps/desktop/src/stores/run.ts`` does, with ``via`` on every request of the exchange.
"""

from __future__ import annotations

import json
import threading
from collections.abc import Iterator, Sequence
from http.client import HTTPConnection, HTTPResponse
from pathlib import Path
from typing import Any

import pytest

from athena.channels.voice.config import VoiceStudio
from athena.channels.voice.home import EngineHomes
from athena.connectors.seal import FileSeal
from athena.daemon.server import TOKEN_HEADER, DaemonConfig, make_server
from athena.harness.transports import ScriptedTransport
from athena.peer import remote
from athena.peer.remote import CLOSED_KIND, MAX_EVENTS, RemoteTurns
from athena.wiring import build_local

from .conftest import TOKEN, Clock, Device, MemorySeal, Probe, Reply, make_host

APP_ID = "invoices"
PAGE_ORIGIN = "https://invoices.example"
SESSION = "01J9CLAUDESESSION"


# --- the scripted engine (the daemon tests' own grammar) ---------------------------------------


def claude_round(text: str) -> list[str]:
    return [
        json.dumps({"type": "system", "session_id": SESSION}),
        json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": text}]}}),
        json.dumps(
            {
                "type": "result",
                "is_error": False,
                "total_cost_usd": 0.01,
                "usage": {"input_tokens": 10, "output_tokens": 5},
            }
        ),
    ]


def op(action: str, **params: Any) -> str:
    return "OP: " + json.dumps({"op": "propose_action", "action": action, "params": params})


MANIFEST = {
    "app_id": APP_ID,
    "app_version": "1",
    "page_origin": PAGE_ORIGIN,
    "tools": [
        {
            "name": "pay",
            "description": "Pay an invoice.",
            "params_schema": {"type": "object", "properties": {"invoice": {"type": "string"}}},
            "reversible": False,
            "side_effects": "external",
        }
    ],
}


# --- devices with an engine the test scripts ----------------------------------------------------


class Scripted(Device):
    transport: ScriptedTransport

    def script(self, *rounds: Sequence[str]) -> None:
        self.transport.rounds.extend(list(lines) for lines in rounds)

    def run(self, message: str, **body: Any) -> list[tuple[str, dict[str, Any]]]:
        sent = {"message": message, "origin": PAGE_ORIGIN, **body}
        reply = self.ui("/run", method="POST", body=sent)
        assert reply.status == 200, reply.raw
        return frames(reply.raw)


def _scripted(tmp_path: Path, name: str, clock: Clock, probe: Probe) -> Iterator[Scripted]:
    base = tmp_path / name
    seal = MemorySeal()
    host = make_host(base / "peer", clock, probe, seal)
    transport = ScriptedTransport([])
    studio = VoiceStudio(
        base / "voice",
        homes=EngineHomes(base / "personas"),
        seal=FileSeal(base / "voice" / "sealed"),
        environ={},
    )
    with build_local(
        brain_root=base / "brain",
        engine="claude_code",
        model="fake-model",
        transport=lambda dialect: transport,
        workspace=base / "engine",
        voice_studio=studio,
        peer=host,
    ) as local:
        server = make_server(local.daemon, DaemonConfig(port=0, token=TOKEN))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            device = Scripted(local, server, host, seal, base / "peer")
            device.transport = transport
            yield device
        finally:
            host.close()
            server.shutdown()
            server.server_close()
            thread.join(timeout=10)


@pytest.fixture
def b(
    tmp_path: Path, clock: Clock, probe: Probe, monkeypatch: pytest.MonkeyPatch
) -> Iterator[Scripted]:
    monkeypatch.setattr(remote, "OFFER_S", 0.8)
    yield from _scripted(tmp_path, "b", clock, probe)


@pytest.fixture
def a(tmp_path: Path, clock: Clock, probe: Probe) -> Iterator[Scripted]:
    yield from _scripted(tmp_path, "a", clock, probe)


# --- reading streams ----------------------------------------------------------------------------


def frames(raw: bytes) -> list[tuple[str, dict[str, Any]]]:
    """``(kind, data)`` per SSE frame; comments and ``retry`` blocks skipped, ``id:`` allowed."""
    out: list[tuple[str, dict[str, Any]]] = []
    for block in raw.decode("utf-8").split("\n\n"):
        data = [line[6:] for line in block.split("\n") if line.startswith("data: ")]
        if not data:
            continue
        payload = json.loads("\n".join(data))
        named = [line[7:] for line in block.split("\n") if line.startswith("event: ")]
        assert named == [payload["kind"]], "a frame disagrees with itself"
        out.append((str(payload["kind"]), payload))
    return out


class Events:
    """The window's ``GET /events`` stream, read frame by frame."""

    def __init__(self, device: Device) -> None:
        self.connection = HTTPConnection("127.0.0.1", device.port, timeout=10)
        self.connection.request("GET", "/events", headers={TOKEN_HEADER: TOKEN})
        self.reply: HTTPResponse = self.connection.getresponse()
        assert self.reply.status == 200
        while self.reply.readline() not in (b"\n", b""):
            pass  # the preamble block

    def next(self, kind: str) -> dict[str, Any]:
        while True:
            block: list[str] = []
            while True:
                line = self.reply.readline().decode("utf-8")
                assert line, f"the stream ended before {kind}"
                if line == "\n":
                    break
                block.append(line.rstrip("\n"))
            data = [line[6:] for line in block if line.startswith("data: ")]
            if data and json.loads(data[0])["kind"] == kind:
                return dict(json.loads(data[0]))

    def close(self) -> None:
        self.connection.close()


def _phone(device: Device, name: str, grants: list[str]) -> tuple[str, str]:
    """Pair a phone with ``grants`` through the QR path; its token and peer id."""
    url = device.ui("/devices/pairing", method="POST", body={"kind": "phone"}).body["url"]
    pairing_id, nonce = url.split("#claim=", 1)[1].split(".", 1)
    asked = device.peer(
        "/peer/pair/request",
        method="POST",
        body={
            "pairing_id": pairing_id,
            "nonce": nonce,
            "name": name,
            "kind": "phone",
            "device_id": None,
            "requested_grants": grants,
        },
    )
    assert asked.status == 200, asked.body
    approved = device.ui(
        f"/devices/pending/{pairing_id}",
        method="POST",
        body={"choice": "approve", "grants": None, "expires_days": None},
    )
    assert approved.status == 200, approved.body
    claimed = device.peer(
        "/peer/pair/claim", method="POST", body={"pairing_id": pairing_id, "nonce": nonce}
    )
    assert claimed.status == 200, claimed.body
    return claimed.body["token"], claimed.body["peer_id"]


def _send(device: Device, token: str, text: str) -> tuple[dict[str, Any], Reply]:
    """The peer's ``POST /peer/message`` with a window that takes it: (the event, the answer)."""
    events = Events(device)
    answer: list[Reply] = []
    asking = threading.Thread(
        target=lambda: answer.append(
            device.peer("/peer/message", method="POST", body={"text": text}, token=token)
        )
    )
    asking.start()
    try:
        message = events.next("remote.message")
        took = device.ui(f"/remote/{message['request_id']}/accept", method="POST", body={})
        assert took.status == 200 and took.body["text"] == text
    finally:
        asking.join(timeout=10)
        events.close()
    return message, answer[0]


# --- offered ------------------------------------------------------------------------------------


def test_a_message_with_no_window_listening_is_409_window_closed(b: Scripted) -> None:
    token, _ = _phone(b, "Phone", ["chat"])
    asked = b.peer("/peer/message", method="POST", body={"text": "hello"}, token=token)
    assert asked.status == 409
    assert asked.body["error"] == "window_closed"
    assert asked.body["name"] == b.host.identity.identity.name


def test_a_message_names_its_sender_and_never_a_token(b: Scripted) -> None:
    token, peer_id = _phone(b, "Kitchen phone", ["chat"])
    message, answer = _send(b, token, "what is due?")
    assert answer.status == 200, answer.body
    assert answer.body["request_id"] == message["request_id"]
    assert message["peer_id"] == peer_id and message["peer_name"] == "Kitchen phone"
    assert message["text"] == "what is due?" and message["target_app"] is None
    assert token not in json.dumps(message)


def test_a_message_needs_the_chat_grant(b: Scripted) -> None:
    token, _ = _phone(b, "Phone", ["approve"])
    asked = b.peer("/peer/message", method="POST", body={"text": "hi"}, token=token)
    assert asked.status == 403 and asked.body["error"] == "grant_missing"


def test_a_message_past_the_cap_is_refused_whole(b: Scripted) -> None:
    token, _ = _phone(b, "Phone", ["chat"])
    text = "x" * (remote.MAX_TEXT_CHARS + 1)
    asked = b.peer("/peer/message", method="POST", body={"text": text}, token=token)
    assert asked.status == 400


# --- teed, through the same gate ----------------------------------------------------------------


def test_a_remote_message_runs_through_the_same_gate_as_a_typed_one(b: Scripted) -> None:
    token, _ = _phone(b, "Phone", ["chat", "approve"])
    assert b.ui("/manifest", method="POST", body=MANIFEST).status == 200

    # Typed: what the gate does with this proposal when the person asks here.
    b.script(claude_round("Needs you.\n" + op("host.invoices.pay", invoice="7")))
    typed = b.run("pay invoice 7")
    typed_card = next(p for k, p in typed if k == "decision.requested")
    b.ui(f"/decisions/{typed_card['id']}", method="POST", body={"choice": "decline"})

    # Remote: the same words from the phone, run by the window with ``via``.
    message, _ = _send(b, token, "pay invoice 7")
    via = {"peer_id": message["peer_id"], "request_id": message["request_id"]}
    b.script(claude_round("Needs you.\n" + op("host.invoices.pay", invoice="7")))
    first = b.run(message["text"], via=via)
    assert [k for k, _ in first] == [k for k, _ in typed], "via changed what the turn did"
    card = next(p for k, p in first if k == "decision.requested")
    for key in ("action", "params", "origin", "options", "decision_kind"):
        assert card[key] == typed_card[key], key

    # The phone sees the card and answers it; it is spent here, once.
    listed = b.peer("/peer/decisions", token=token)
    assert listed.status == 200 and [c["id"] for c in listed.body["pending"]] == [card["id"]]
    events = Events(b)
    try:
        answered = b.peer(
            f"/peer/decisions/{card['id']}", method="POST", body={"choice": "approve"}, token=token
        )
        decided = events.next("remote.decided")
    finally:
        events.close()
    assert answered.status == 200 and answered.body["status"] == "approved"
    execute = answered.body["execute"][0]
    assert decided["approval_id"] == card["id"] and decided["execute"] == [execute]
    assert b.local.daemon.approvals.describe(card["id"]).status == "approved"
    again = b.peer(
        f"/peer/decisions/{card['id']}", method="POST", body={"choice": "approve"}, token=token
    )
    assert again.status != 200, "a card is spent once"

    # The window ran the execute on its page and continues the exchange with the same via.
    b.script(claude_round("Paid invoice 7."))
    result = {
        "call_id": execute["call_id"],
        "name": execute["name"],
        "ok": True,
        "output": "paid",
        "error": None,
        "tier": 1,
        "ms": 3,
    }
    last = b.run("(continue)", via=via, tool_results=[result])
    assert last[-1][0] == "turn.finished"

    streamed = b.peer(f"/peer/turns/{message['request_id']}", token=token)
    assert streamed.status == 200
    kinds = [k for k, _ in frames(streamed.raw)]
    assert kinds[-1] == CLOSED_KIND, "the tee ends once nothing is left to continue"
    assert "decision.requested" in kinds and "decision.resolved" in kinds
    assert kinds.count("turn.finished") == 2
    assert frames(streamed.raw)[-1][1]["reason"] == "finished"


def test_only_the_sender_reads_its_turn(b: Scripted) -> None:
    sender, _ = _phone(b, "Phone", ["chat"])
    stranger, _ = _phone(b, "Tablet", ["chat"])
    message, _ = _send(b, sender, "hello")
    refused = b.peer(f"/peer/turns/{message['request_id']}", token=stranger)
    assert refused.status == 403 and refused.body["error"] == "not_sender"
    assert b.peer("/peer/turns/job_000000000000", token=sender).status == 404


def test_the_tee_ends_on_turn_error(b: Scripted) -> None:
    token, _ = _phone(b, "Phone", ["chat"])
    assert b.ui("/manifest", method="POST", body=MANIFEST).status == 200
    message, _ = _send(b, token, "hello")
    via = {"peer_id": message["peer_id"], "request_id": message["request_id"]}
    ran = b.run(message["text"], via=via)  # nothing scripted: the engine fails the turn
    assert ran[-1][0] == "turn.error"
    streamed = frames(b.peer(f"/peer/turns/{message['request_id']}", token=token).raw)
    assert [k for k, _ in streamed][-2:] == ["turn.error", CLOSED_KIND]
    assert streamed[-1][1]["reason"] == "error"


def test_a_run_that_proposed_host_calls_keeps_the_tee_open_until_the_window_continues(
    b: Scripted,
) -> None:
    token, _ = _phone(b, "Phone", ["chat"])
    chase = {
        "name": "chase",
        "description": "Draft a chase note on an invoice.",
        "params_schema": {"type": "object", "properties": {"invoice": {"type": "string"}}},
        "reversible": True,
        "side_effects": "internal",
    }
    body = {**MANIFEST, "tools": [*MANIFEST["tools"], chase]}  # type: ignore[list-item]
    assert b.ui("/manifest", method="POST", body=body).status == 200
    message, _ = _send(b, token, "chase invoice 7")
    via = {"peer_id": message["peer_id"], "request_id": message["request_id"]}
    b.script(claude_round("Drafting.\n" + op("host.invoices.chase", invoice="7")))
    first = b.run(message["text"], via=via)
    call = next(p for k, p in first if k == "tool.call")
    assert first[-1][0] == "turn.finished"

    def stream() -> list[str]:
        read = b.peer(f"/peer/turns/{message['request_id']}", token=token)
        return [k for k, _ in frames(read.raw)]

    remote_turns = b.local.daemon.via_tee.__self__  # type: ignore[union-attr]
    remote_turns.quiet_s = 0.1
    assert CLOSED_KIND not in stream(), "the page has a call to run: the window will continue"

    b.script(claude_round("Drafted."))
    result = {"call_id": call["call_id"], "name": call["name"], "ok": True, "output": "drafted"}
    b.run("(continue)", via=via, tool_results=[result])
    assert stream()[-1] == CLOSED_KIND


def test_the_window_ends_an_exchange_it_could_not_continue(b: Scripted) -> None:
    token, _ = _phone(b, "Phone", ["chat"])
    message, _ = _send(b, token, "hello")
    ended = b.ui(
        f"/remote/{message['request_id']}/end",
        method="POST",
        body={"reason": "budget_exhausted", "detail": "the page answered 8 times"},
    )
    assert ended.status == 200
    streamed = frames(b.peer(f"/peer/turns/{message['request_id']}", token=token).raw)
    assert [k for k, _ in streamed] == ["turn.error", CLOSED_KIND]
    assert streamed[0][1]["reason"] == "budget_exhausted"


def test_a_via_naming_no_message_runs_the_turn_and_tees_nothing(b: Scripted) -> None:
    assert b.ui("/manifest", method="POST", body=MANIFEST).status == 200
    b.script(claude_round("Hello."))
    ran = b.run("hi", via={"peer_id": "dev_000000000000", "request_id": "job_000000000000"})
    assert ran[-1][0] == "turn.finished"


def test_decisions_need_the_approve_grant(b: Scripted) -> None:
    token, _ = _phone(b, "Phone", ["chat"])
    listed = b.peer("/peer/decisions", token=token)
    assert listed.status == 403 and listed.body["grant"] == "approve"


# --- the turn buffer, alone ---------------------------------------------------------------------


class _Row:
    peer_id = "dev_00000000000a"
    name = "Phone"


def _accepted(turns: RemoteTurns) -> str:
    published: list[dict[str, Any]] = []
    turns._publish = lambda kind, **fields: published.append(fields)
    taken: list[str] = []

    def take() -> None:
        while not published:
            threading.Event().wait(0.01)
        taken.append(published[0]["request_id"])
        turns.accept(published[0]["request_id"])

    threading.Thread(target=take).start()
    turn = turns.offer(_Row(), "hi", None)  # type: ignore[arg-type]
    assert turn is not None and taken == [turn.request_id]
    return turn.request_id


def test_a_quiet_stream_ends_and_resumes_from_where_the_reader_was() -> None:
    from athena.contracts.channel import TextDelta, TurnFinished

    turns = RemoteTurns(lambda *_a, **_k: None, quiet_s=0.05)
    request_id = _accepted(turns)
    see = turns.observer({"peer_id": _Row.peer_id, "request_id": request_id})
    assert see is not None
    see(TextDelta(text="one"))
    turn = turns.get(request_id)
    assert turn is not None
    first = "".join(turns.frames(turn, 0))
    assert first.count("event: text.delta") == 1 and CLOSED_KIND not in first
    see(TextDelta(text="two"))
    see(TurnFinished(text="two"))
    rest = "".join(turns.frames(turn, 1))
    assert "one" not in rest and '"two"' in rest and rest.rstrip().endswith("}")
    assert f"event: {CLOSED_KIND}" in rest


def test_a_buffer_past_its_cap_says_what_it_kept() -> None:
    from athena.contracts.channel import TextDelta, TurnFinished

    turns = RemoteTurns(lambda *_a, **_k: None, quiet_s=0.05)
    request_id = _accepted(turns)
    see = turns.observer({"peer_id": _Row.peer_id, "request_id": request_id})
    assert see is not None
    for n in range(MAX_EVENTS + 4):
        see(TextDelta(text=str(n)))
    see(TurnFinished(text=""))
    turn = turns.get(request_id)
    assert turn is not None and turn.closed is not None
    assert turn.closed["footer"] == f"(showing {MAX_EVENTS} of {MAX_EVENTS + 5})"


def test_a_message_nobody_took_is_forgotten() -> None:
    turns = RemoteTurns(lambda *_a, **_k: None, offer_s=0.1)
    assert turns.offer(_Row(), "hi", None) is None  # type: ignore[arg-type]
    assert turns._turns == {}


@pytest.mark.parametrize(
    ("given", "start"), [("3", 3), ("0", 0), ("²", 0), ("٣", 0), ("-1", 0), ("x", 0)]
)
def test_a_from_that_is_not_ascii_digits_reads_from_the_start(given: str, start: int) -> None:
    # ``"²".isdigit()`` is true and ``int("²")`` raises: a superscript two in ``?from=``
    # was a 500 from the route, on the peer listener and on the loopback relay alike.
    from athena.peer.listener import PeerRequest

    assert remote.resume_index({"from": given}) == start
    turns = RemoteTurns(lambda *_a, **_k: None, quiet_s=0.05)
    request_id = _accepted(turns)
    asked = PeerRequest(
        method="GET",
        path=f"/peer/turns/{request_id}",
        query={"from": given},
        peer=_Row(),  # type: ignore[arg-type]
    )
    answer = remote.peer_turn(turns, asked, request_id)
    assert isinstance(answer, remote.EventStream)


# --- PC to PC, through the asking side's loopback -----------------------------------------------


def _pair_both_ways(a: Device, b: Device) -> None:
    """A asks B in; B's person approves A with chat and approve; A's person approves B back."""
    code = b.ui("/devices/pairing", method="POST", body={"kind": "pc"}).body["code"]
    joined = a.ui(
        "/devices/join",
        method="POST",
        body={
            "address": "127.0.0.1",
            "port": b.peer_port,
            "code": code,
            "requested_grants": ["chat", "approve"],
        },
    )
    assert joined.status == 200, joined.body
    pending = b.ui("/devices").body["pending"]
    approved = b.ui(
        f"/devices/pending/{pending[0]['pairing_id']}",
        method="POST",
        body={"choice": "approve", "grants": None, "expires_days": None},
    )
    assert approved.status == 200
    a.host.tick()
    back = a.ui("/devices").body["pending"]
    answered = a.ui(
        f"/devices/pending/{back[0]['pairing_id']}",
        method="POST",
        body={"choice": "approve", "grants": None, "expires_days": None},
    )
    assert answered.status == 200


def test_a_pc_messages_another_and_reads_the_reply_through_its_own_loopback(
    a: Scripted, b: Scripted
) -> None:
    _pair_both_ways(a, b)
    b_id = b.host.identity.identity.device_id
    assert b.ui("/manifest", method="POST", body=MANIFEST).status == 200

    events = Events(b)
    sent: list[Reply] = []
    asking = threading.Thread(
        target=lambda: sent.append(
            a.ui(f"/devices/{b_id}/message", method="POST", body={"text": "what is due?"})
        )
    )
    asking.start()
    try:
        message = events.next("remote.message")
        assert message["peer_name"] == a.host.identity.identity.name
        assert b.ui(f"/remote/{message['request_id']}/accept", method="POST").status == 200
    finally:
        asking.join(timeout=10)
        events.close()
    assert sent[0].status == 200, sent[0].body
    request_id = sent[0].body["request_id"]

    b.script(claude_round("Two invoices are due."))
    b.run(message["text"], via={"peer_id": message["peer_id"], "request_id": request_id})

    relayed = a.ui(f"/devices/{b_id}/turns/{request_id}?from=0")
    assert relayed.status == 200
    kinds = [k for k, _ in frames(relayed.raw)]
    assert "text.delta" in kinds and kinds[-2:] == ["turn.finished", CLOSED_KIND]


def test_a_pc_with_no_key_for_a_device_is_told_so(a: Scripted) -> None:
    sent = a.ui("/devices/dev_000000000000/message", method="POST", body={"text": "hi"})
    assert sent.status == 404


def test_a_message_to_a_sleeping_pc_is_window_closed_on_the_asking_side(
    a: Scripted, b: Scripted
) -> None:
    _pair_both_ways(a, b)
    b_id = b.host.identity.identity.device_id
    sent = a.ui(f"/devices/{b_id}/message", method="POST", body={"text": "hi"})
    assert sent.status == 409
    assert sent.body["error"] == "window_closed"
    assert sent.body["name"] == b.host.identity.identity.name

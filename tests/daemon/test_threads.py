"""A turn locks its thread, not the daemon (ADR 0141).

Before this, a turn held the daemon's one writer lock for its whole length: a second conversation
waited, a card waited, and a second ``POST /run`` got its 200 and SSE headers and then sat blocked
inside the stream. These run a real daemon over a real socket against an engine whose rounds hang
until released, so each claim is proved against the same locks, door and harness a person's turn
uses: two conversations stream at once, a second turn into a busy conversation is a 409 before
any header, a card is answered while another thread's turn runs, and a stop names its thread.
"""

from __future__ import annotations

import asyncio
import json
import threading
import time
from collections.abc import AsyncIterator, Iterator, Sequence
from dataclasses import replace
from typing import Any

import pytest

from athena.contracts.manifest import HostTool
from athena.contracts.registry import ExecResult
from athena.daemon import routes
from athena.daemon.routes import Request
from athena.daemon.server import AthenaDaemon, ThreadLocks
from athena.harness.transports import CliRequest, ScriptedTransport

from .conftest import (
    OTHER_APP_ID,
    OTHER_PAGE_ORIGIN,
    PAGE_ORIGIN,
    SESSION,
    Live,
    Response,
    claude_round,
    manifest_body,
    op,
)

#: A round the script answers by hanging until released or cancelled.
HANG: list[str] = ["<hang>"]


class HangingTransport(ScriptedTransport):
    """A scripted engine whose ``HANG`` rounds start, then wait. Counts the rounds in the engine
    at once, which is the number this file is about."""

    def __init__(self) -> None:
        super().__init__([])
        self.release = threading.Event()
        self._guard = threading.Condition()
        self.inside = 0
        self.most_inside = 0
        self.started = 0

    def wait_started(self, count: int, timeout: float = 10.0) -> bool:
        with self._guard:
            return self._guard.wait_for(lambda: self.started >= count, timeout)

    async def run(self, request: CliRequest) -> AsyncIterator[str]:
        with self._guard:
            index = len(self.requests)
            hang = index < len(self.rounds) and self.rounds[index] == HANG
            if hang:
                self.requests.append(request)
        if not hang:
            async for line in super().run(request):
                yield line
            return
        with self._guard:
            self.inside += 1
            self.started += 1
            self.most_inside = max(self.most_inside, self.inside)
            self._guard.notify_all()
        try:
            yield json.dumps({"type": "system", "session_id": SESSION})
            while not self.release.is_set():
                await asyncio.sleep(0.01)
            for line in claude_round("Released.")[1:]:
                yield line
        finally:
            with self._guard:
                self.inside -= 1


@pytest.fixture
def transport() -> HangingTransport:  # overrides the directory's scripted engine
    return HangingTransport()


@pytest.fixture
def two(live: Live) -> Iterator[Live]:
    """Two pages, so two conversations: ``conv_invoices`` and ``conv_crm``."""
    assert live.register().status == 200
    assert live.register(OTHER_APP_ID, OTHER_PAGE_ORIGIN).status == 200
    yield live


def _running(
    live: Live, origin: str = PAGE_ORIGIN, **body: object
) -> tuple[threading.Thread, list[Response]]:
    out: list[Response] = []
    thread = threading.Thread(
        target=lambda: out.append(live.run("go on", origin=origin, **body)),
        name="run-under-test",
        daemon=True,
    )
    thread.start()
    return thread, out


# -- two threads ---------------------------------------------------------------------------------


def test_two_conversations_stream_at_the_same_time(
    two: Live, daemon: AthenaDaemon, transport: HangingTransport
) -> None:
    two.script(HANG, HANG)
    first, first_out = _running(two, PAGE_ORIGIN)
    assert transport.wait_started(1)
    second, second_out = _running(two, OTHER_PAGE_ORIGIN)

    # The second turn is inside the engine while the first still is: neither waited on the other.
    assert transport.wait_started(2), "the second conversation waited behind the first"
    assert transport.most_inside == 2
    assert daemon.threads.busy("conv_invoices") and daemon.threads.busy("conv_crm")
    transport.release.set()
    first.join(10)
    second.join(10)

    for out in (first_out, second_out):
        assert out[0].status == 200
        assert out[0].frames()[-1][0] == "turn.finished"
    assert len(daemon.threads) == 0, "a quiet conversation still holds a lock entry"


def test_a_second_turn_into_a_busy_conversation_is_a_409_before_any_sse_header(
    two: Live, daemon: AthenaDaemon, transport: HangingTransport
) -> None:
    two.script(HANG)
    running, out = _running(two)
    assert transport.wait_started(1)

    refused = two.run("and another thing")

    assert refused.status == 409
    assert "event-stream" not in refused.header("Content-Type")
    assert refused.header("Content-Type") == "application/json"
    assert refused.body["error"] == "thread_busy"
    assert refused.body["ok"] is False
    assert refused.body["reason"] == "validator_failed"
    assert len(transport.requests) == 1, "the refused turn reached the engine"

    transport.release.set()
    running.join(10)
    assert out[0].frames()[-1][0] == "turn.finished"
    # The lock went back with the stream: the same conversation takes a turn again.
    two.script(claude_round("Next."))
    again = two.run("now")
    assert again.status == 200
    assert again.frames()[-1][0] == "turn.finished"


def test_a_card_is_answered_while_another_threads_turn_runs(
    two: Live, daemon: AthenaDaemon, transport: HangingTransport
) -> None:
    two.script(claude_round("I need your signature.\n" + op("host.invoices.pay", invoice="7")))
    card = two.run("pay invoice 7").frames()[2][1]
    two.script(HANG)
    running, _ = _running(two, OTHER_PAGE_ORIGIN)
    assert transport.wait_started(1)

    began = time.monotonic()
    answer = two.request(
        f"/decisions/{card['id']}",
        method="POST",
        json_body={"choice": "decline", "origin": PAGE_ORIGIN},
        timeout=5.0,
    )
    elapsed = time.monotonic() - began

    assert answer.status == 200
    assert answer.body["status"] == "declined"
    assert elapsed < 2, f"the answer waited {elapsed:.1f}s on the other thread's turn"
    assert daemon.threads.busy("conv_crm"), "the other turn ended before the answer was tested"
    transport.release.set()
    running.join(10)


def test_a_manifest_merges_while_a_turn_runs(
    two: Live, daemon: AthenaDaemon, transport: HangingTransport
) -> None:
    two.script(HANG)
    running, _ = _running(two)
    assert transport.wait_started(1)

    began = time.monotonic()
    merged = two.register("ledger", "https://ledger.example")

    assert merged.status == 200
    assert time.monotonic() - began < 2
    transport.release.set()
    running.join(10)


# -- the stop names its thread -------------------------------------------------------------------


def test_a_stop_with_a_conversation_stops_that_thread_only(
    two: Live, daemon: AthenaDaemon, transport: HangingTransport
) -> None:
    # One origin, two conversations: the page's own, and a project's.
    project = "proj_0123456789ab"
    two.script(HANG, HANG)
    page, page_out = _running(two)
    assert transport.wait_started(1)
    projected, projected_out = _running(two, project_id=project)
    assert transport.wait_started(2)

    stopped = two.request(
        "/run/stop",
        method="POST",
        json_body={"origin": PAGE_ORIGIN, "conversation_id": f"conv_{project}"},
    )
    assert stopped.body == {"ok": True, "stopped": True}
    projected.join(10)
    assert projected_out[0].frames()[-1][1]["reason"] == "cancelled"
    assert daemon.threads.busy("conv_invoices"), "the page's own thread was stopped too"

    # Another origin naming the conversation stops nothing.
    other = two.request(
        "/run/stop",
        method="POST",
        json_body={"origin": OTHER_PAGE_ORIGIN, "conversation_id": "conv_invoices"},
    )
    assert other.body["stopped"] is False
    transport.release.set()
    page.join(10)
    assert page_out[0].frames()[-1][0] == "turn.finished"


def test_a_stop_with_a_null_conversation_stops_the_origins_turns(
    two: Live, transport: HangingTransport
) -> None:
    two.script(HANG)
    running, out = _running(two)
    assert transport.wait_started(1)

    stopped = two.request(
        "/run/stop", method="POST", json_body={"origin": PAGE_ORIGIN, "conversation_id": None}
    )

    assert stopped.body == {"ok": True, "stopped": True}
    running.join(10)
    assert out[0].frames()[-1][1]["reason"] == "cancelled"


# -- the lock map --------------------------------------------------------------------------------


def test_the_lock_map_holds_only_conversations_in_use() -> None:
    locks = ThreadLocks()
    lease = locks.try_take("conv_a")
    assert lease is not None
    assert locks.try_take("conv_a") is None
    other = locks.try_take("conv_b")
    assert other is not None
    assert len(locks) == 2 and locks.busy("conv_a")

    lease.release()
    lease.release()  # a second release gives nothing back twice
    other.release()

    assert len(locks) == 0
    assert not locks.busy("conv_a")
    again = locks.try_take("conv_a")
    assert again is not None
    again.release()


def test_a_waiting_taker_gets_the_lock_when_the_holder_lets_go() -> None:
    locks = ThreadLocks()
    held = locks.try_take("conv_a")
    assert held is not None
    got = threading.Event()

    def wait() -> None:
        with locks.take("conv_a"):
            got.set()

    waiter = threading.Thread(target=wait, daemon=True)
    waiter.start()
    assert not got.wait(0.2), "the waiter took a held lock"
    assert len(locks) == 1
    held.release()
    assert got.wait(5)
    waiter.join(5)
    assert len(locks) == 0


# -- an answer holds its card's lock, never the daemon's write lock -------------------------------

#: How long the fake connector's call takes unless the test lets it go sooner: the length of one
#: outbound send, which every other route used to wait out behind ``daemon.writing()``.
SLOW_S = 3.0
#: An answer that did not wait on another card's action. Well under ``SLOW_S``.
QUICK_S = 1.0
RECIPIENT = "ana@example.com"
SEND = "connector.gmail.send_mail"


class SlowMail:
    """A connector whose send takes ``SLOW_S`` seconds, as a Gmail send or an MCP ``tools/call``
    can take its whole request timeout. Counts its calls, which is the executor's run count."""

    def __init__(self) -> None:
        self.entered = threading.Event()
        self.release = threading.Event()
        self.fail = False
        self._guard = threading.Lock()
        self.calls = 0

    def list_tools(self) -> Sequence[HostTool]:
        return [
            HostTool(
                name="send_mail",
                description="Send a message.",
                params_schema={"type": "object", "properties": {"to": {"type": "string"}}},
                reversible=True,
                side_effects="external",
            )
        ]

    def call(self, name: str, params: dict[str, Any]) -> ExecResult:
        with self._guard:
            self.calls += 1
        self.entered.set()
        if self.fail:
            raise RuntimeError("the provider fell over")
        self.release.wait(SLOW_S)
        return ExecResult(ok=True, output=f"sent to {params.get('to', '')}", tier=3)


class _AlwaysLive:
    def is_live(self, connector_id: str) -> bool:
        return True


@pytest.fixture
def mail(live: Live, daemon: AthenaDaemon) -> Iterator[SlowMail]:
    """The page registered, and a slow Gmail connected and live."""
    assert live.register().status == 200
    port = SlowMail()
    daemon.catalog.merge_connector("gmail", port)
    daemon.gate.policy = replace(daemon.gate.policy, connectors=_AlwaysLive())
    yield port
    port.release.set()


def _filed(live: Live, call: str) -> str:
    live.script(claude_round("That needs your approval.\n" + call))
    cards = [p for kind, p in live.run("do it").frames() if kind == "decision.requested"]
    assert len(cards) == 1, "the turn did not file exactly one card"
    return str(cards[0]["id"])


def _mail_card(live: Live) -> str:
    return _filed(live, op(SEND, to=RECIPIENT))


def _pay_card(live: Live, invoice: str = "7") -> str:
    return _filed(live, op("host.invoices.pay", invoice=invoice))


def _answer(live: Live, approval_id: str, choice: str) -> Response:
    return live.request(
        f"/decisions/{approval_id}",
        method="POST",
        json_body={"choice": choice},
        timeout=SLOW_S * 4,
    )


def _in_process(daemon: AthenaDaemon, approval_id: str, choice: str) -> routes.Reply:
    """An answer through ``routes.decide``, the voice gateway's door for a spoken yes or no."""
    request = Request(method="POST", path=f"/decisions/{approval_id}", body={"choice": choice})
    return routes.decide(daemon, request, approval_id)


def _slow_approval(live: Live, mail: SlowMail) -> tuple[threading.Thread, list[Response]]:
    """A connector card approved, its send in flight when this returns."""
    card = _mail_card(live)
    out: list[Response] = []
    thread = threading.Thread(
        target=lambda: out.append(_answer(live, card, "approve")),
        name="approval-under-test",
        daemon=True,
    )
    thread.start()
    assert mail.entered.wait(10), "the approved card never reached its executor"
    return thread, out


def _finish(mail: SlowMail, approving: threading.Thread, out: list[Response]) -> None:
    mail.release.set()
    approving.join(SLOW_S * 4)
    assert out and out[0].status == 200
    assert out[0].body["output"] == f"sent to {RECIPIENT}"


def _race(*answers: tuple[Live, str, str]) -> list[tuple[str, Response]]:
    """Answers sent at the same instant from their own threads, as two surfaces would."""
    start = threading.Barrier(len(answers))
    replies: list[tuple[str, Response]] = []
    guard = threading.Lock()

    def send(live: Live, approval_id: str, choice: str) -> None:
        start.wait(5)
        reply = _answer(live, approval_id, choice)
        with guard:
            replies.append((choice, reply))

    racers = [threading.Thread(target=send, args=answer, daemon=True) for answer in answers]
    for racer in racers:
        racer.start()
    for racer in racers:
        racer.join(SLOW_S * 4)
    return replies


def _decision_episodes(daemon: AthenaDaemon) -> list[str]:
    with daemon.brain.read_connection() as con:
        node_ids = [
            str(row[0])
            for row in con.execute(
                "SELECT id FROM companion_node WHERE kind = 'episode' ORDER BY created_at, id"
            ).fetchall()
        ]
    bodies = [daemon.brain.read_body(node_id) for node_id in node_ids]
    return [body for body in bodies if "[decision] the user" in body and SEND in body]


def test_a_manifest_merges_while_a_slow_connector_card_is_approved(
    live: Live, daemon: AthenaDaemon, mail: SlowMail
) -> None:
    approving, out = _slow_approval(live, mail)

    began = time.monotonic()
    merged = live.register("ledger", "https://ledger.example")
    elapsed = time.monotonic() - began

    assert merged.status == 200
    assert elapsed < QUICK_S, f"the manifest waited {elapsed:.1f}s on another card's send"
    assert approving.is_alive(), "the send ended before the manifest was tested"
    _finish(mail, approving, out)


def test_another_card_is_declined_while_a_slow_connector_card_is_approved(
    live: Live, daemon: AthenaDaemon, mail: SlowMail
) -> None:
    other = _pay_card(live)
    approving, out = _slow_approval(live, mail)

    began = time.monotonic()
    declined = _answer(live, other, "decline")
    elapsed = time.monotonic() - began

    assert declined.status == 200
    assert declined.body["status"] == "declined"
    assert elapsed < QUICK_S, f"the decline waited {elapsed:.1f}s on another card's send"
    assert approving.is_alive(), "the send ended before the decline was tested"
    _finish(mail, approving, out)


def test_the_voice_door_answers_a_third_card_while_a_slow_card_is_approved(
    live: Live, daemon: AthenaDaemon, mail: SlowMail
) -> None:
    third = _pay_card(live, invoice="9")
    approving, out = _slow_approval(live, mail)

    began = time.monotonic()
    status, body = _in_process(daemon, third, "decline")
    elapsed = time.monotonic() - began

    assert status == 200
    assert body["status"] == "declined"
    assert elapsed < QUICK_S, f"the spoken answer waited {elapsed:.1f}s on another card's send"
    assert approving.is_alive(), "the send ended before the spoken answer was tested"
    _finish(mail, approving, out)


def test_two_approvals_of_one_card_run_its_action_once(
    live: Live, daemon: AthenaDaemon, mail: SlowMail
) -> None:
    card = _mail_card(live)
    mail.release.set()

    replies = _race((live, card, "approve"), (live, card, "approve"))

    assert sorted(reply.status for _, reply in replies) == [200, 409]
    won = next(reply for _, reply in replies if reply.status == 200)
    lost = next(reply for _, reply in replies if reply.status == 409)
    assert won.body["output"] == f"sent to {RECIPIENT}"
    assert lost.body["reason"] in ("pending_approval", "approval_spent")
    assert mail.calls == 1


def test_an_approve_and_a_decline_racing_on_one_card_land_once(
    live: Live, daemon: AthenaDaemon, mail: SlowMail
) -> None:
    card = _mail_card(live)
    mail.release.set()

    replies = _race((live, card, "approve"), (live, card, "decline"))

    landed = [choice for choice, reply in replies if reply.status == 200]
    assert len(landed) == 1, [(choice, reply.status) for choice, reply in replies]
    approved = landed == ["approve"]
    assert mail.calls == (1 if approved else 0)
    assert daemon.approvals.describe(card).status == ("approved" if approved else "declined")
    # One record of the answer: one decision episode, and one ledger row for a decline. An
    # approval that ran writes none (the lane ledgers refusals only; its turn already was).
    assert len(_decision_episodes(daemon)) == 1
    denied = [
        row
        for row in daemon.ledger.recent(20).rows
        if row.trigger == "decision" and row.error_reason == "user_denied"
    ]
    assert len(denied) == (0 if approved else 1)


def test_the_card_lock_map_is_empty_after_every_answer_even_a_failed_one(
    live: Live, daemon: AthenaDaemon, mail: SlowMail
) -> None:
    approving, out = _slow_approval(live, mail)
    assert _in_process(daemon, _pay_card(live), "decline")[0] == 200
    _finish(mail, approving, out)

    mail.fail = True
    failing = _mail_card(live)
    with pytest.raises(RuntimeError, match="fell over"):
        _in_process(daemon, failing, "approve")

    assert len(daemon.cards) == 0, "an answered card still holds a lock entry"


def test_health_answers_while_a_slow_connector_card_is_approved(
    live: Live, daemon: AthenaDaemon, mail: SlowMail
) -> None:
    approving, out = _slow_approval(live, mail)

    began = time.monotonic()
    health = live.request("/health")
    elapsed = time.monotonic() - began

    assert health.status == 200
    assert elapsed < QUICK_S
    _finish(mail, approving, out)


def test_a_refused_manifest_during_a_slow_approval_changes_nothing(
    live: Live, daemon: AthenaDaemon, mail: SlowMail
) -> None:
    approving, out = _slow_approval(live, mail)
    names = daemon.catalog.names()
    pins = dict(daemon.gate.policy.pinned_origins)
    sessions = len(daemon.sessions)

    refused = live.request(
        "/manifest",
        method="POST",
        json_body=manifest_body("gmail", "https://evil.example", origin_kind="connector"),
        timeout=SLOW_S * 4,
    )

    assert refused.status == 400
    assert refused.body["reason"] == "manifest_invalid"
    assert daemon.catalog.names() == names
    assert dict(daemon.gate.policy.pinned_origins) == pins
    assert len(daemon.sessions) == sessions
    _finish(mail, approving, out)

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
from collections.abc import AsyncIterator, Iterator

import pytest

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

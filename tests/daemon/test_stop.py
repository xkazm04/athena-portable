"""``POST /run/stop``: a running turn can be stopped, and stopping it frees the writer lock.

A turn holds the daemon's one writer lock for as long as it runs, and approvals and new tabs wait
behind it. Before the route existed nothing could end a turn but the engine itself. These run a
real daemon over a real socket against an engine that hangs in its first round until it is
released or cancelled, so a stop is proved against the same lock, the same drain and the same
harness a person's turn uses.
"""

from __future__ import annotations

import asyncio
import json
import threading
import time
from collections.abc import AsyncIterator

import pytest

from athena.contracts.channel import ChannelEvent, TurnError
from athena.daemon.routes import turn_context, turn_events
from athena.daemon.server import AthenaDaemon
from athena.harness.transports import CliRequest, ScriptedTransport

from .conftest import (
    OTHER_PAGE_ORIGIN,
    PAGE_ORIGIN,
    SESSION,
    Live,
    Response,
    claude_round,
    op,
)

#: A round the script answers by hanging until it is released or cancelled.
HANG: list[str] = ["<hang>"]


class HangingTransport(ScriptedTransport):
    """A scripted engine whose ``HANG`` rounds start, then wait, like a CLI that went quiet."""

    def __init__(self) -> None:
        super().__init__([])
        self.started = threading.Event()
        self.release = threading.Event()
        #: Set by the run's ``finally``: where the real transport kills and reaps its child.
        self.closed = threading.Event()

    async def run(self, request: CliRequest) -> AsyncIterator[str]:
        index = len(self.requests)
        if index < len(self.rounds) and self.rounds[index] == HANG:
            self.requests.append(request)
            try:
                yield json.dumps({"type": "system", "session_id": SESSION})
                self.started.set()
                while not self.release.is_set():
                    await asyncio.sleep(0.01)
                for line in claude_round("Released.")[1:]:
                    yield line
            finally:
                self.closed.set()
            return
        async for line in super().run(request):
            yield line


@pytest.fixture
def transport() -> HangingTransport:  # overrides the directory's scripted engine
    return HangingTransport()


def _running(live: Live, origin: str = PAGE_ORIGIN) -> tuple[threading.Thread, list[Response]]:
    """Start ``POST /run`` on its own thread; the reply lands in the list when the stream ends."""
    out: list[Response] = []
    thread = threading.Thread(
        target=lambda: out.append(live.run("go on", origin=origin)),
        name="run-under-test",
        daemon=True,
    )
    thread.start()
    return thread, out


def _stop(live: Live, origin: str) -> Response:
    return live.request("/run/stop", method="POST", json_body={"origin": origin})


def _rows(daemon: AthenaDaemon) -> list[str | None]:
    return [row.error_reason for row in daemon.ledger.recent(20).rows]


def test_a_stop_ends_a_hung_turn_with_a_cancelled_frame_one_row_and_a_free_lock(
    live: Live, daemon: AthenaDaemon, transport: HangingTransport
) -> None:
    live.register()
    live.script(claude_round("I need your signature.\n" + op("host.invoices.pay", invoice="7")))
    card = live.run("pay invoice 7").frames()[2][1]
    live.script(HANG)
    thread, out = _running(live)
    assert transport.started.wait(10)

    stopped = _stop(live, PAGE_ORIGIN)

    assert stopped.status == 200
    assert stopped.body == {"ok": True, "stopped": True}
    thread.join(10)
    assert not thread.is_alive()
    frames = out[0].frames()
    assert frames[-1][0] == "turn.error"
    assert frames[-1][1]["reason"] == "cancelled"
    assert transport.closed.is_set()
    # The first turn's row, then exactly one for the stopped turn.
    assert _rows(daemon).count("cancelled") == 1
    # The writer lock is free: an answer to a card goes straight through.
    began = time.monotonic()
    answer = live.request(
        f"/decisions/{card['id']}",
        method="POST",
        json_body={"choice": "decline", "origin": PAGE_ORIGIN},
    )
    assert answer.status == 200
    assert time.monotonic() - began < 1


def test_a_stop_with_no_turn_running_stops_nothing(live: Live) -> None:
    reply = _stop(live, PAGE_ORIGIN)

    assert reply.status == 200
    assert reply.body == {"ok": True, "stopped": False}


def test_a_stop_for_another_origin_leaves_the_running_turn_to_finish(
    live: Live, daemon: AthenaDaemon, transport: HangingTransport
) -> None:
    live.register()
    live.script(HANG)
    thread, out = _running(live)
    assert transport.started.wait(10)

    reply = _stop(live, OTHER_PAGE_ORIGIN)
    empty = _stop(live, "")
    transport.release.set()
    thread.join(10)

    assert reply.body == {"ok": True, "stopped": False}
    assert empty.body == {"ok": True, "stopped": False}
    assert out[0].frames()[-1][0] == "turn.finished"
    assert "cancelled" not in _rows(daemon)


def test_a_card_filed_before_the_stop_is_still_pending_and_answerable(
    live: Live, daemon: AthenaDaemon, transport: HangingTransport
) -> None:
    live.register()
    live.script(claude_round("I need your signature.\n" + op("host.invoices.pay", invoice="7")))
    card = live.run("pay invoice 7").frames()[2][1]
    live.script(HANG)
    thread, _ = _running(live)
    assert transport.started.wait(10)

    assert _stop(live, PAGE_ORIGIN).body["stopped"] is True
    thread.join(10)

    pending = live.request("/decisions").body
    assert [row["id"] for row in pending["pending"]] == [card["id"]]
    answer = live.request(
        f"/decisions/{card['id']}",
        method="POST",
        json_body={"choice": "approve", "origin": PAGE_ORIGIN},
    )
    assert answer.status == 200
    assert answer.body["status"] == "approved"


def test_the_stop_route_is_token_checked_like_every_route(live: Live) -> None:
    reply = live.request("/run/stop", method="POST", token=None, json_body={"origin": PAGE_ORIGIN})

    assert reply.status == 401


# -- a hang-up and a stop on one turn ----------------------------------------------------------


@pytest.mark.parametrize("stop_lands", ["between_frames", "inside_the_engine"])
def test_a_hang_up_and_a_stop_that_race_on_one_turn_write_one_cancelled_row(
    live: Live, daemon: AthenaDaemon, transport: HangingTransport, stop_lands: str
) -> None:
    live.register()
    # Round 1 speaks and drops an op, so the turn streams a frame and asks again; round 2 hangs.
    live.script(claude_round("Looking.\n" + op("nope")), HANG)
    session = daemon.sessions.get(PAGE_ORIGIN)
    assert session is not None
    frames = turn_events(
        daemon,
        turn_context(daemon, session),
        message="go on",
        host_state={},
        results=(),
        project=None,
    )
    seen: list[ChannelEvent] = [next(frames)]  # the stream is open

    if stop_lands == "between_frames":
        assert daemon.stop_turn(PAGE_ORIGIN)
    else:
        stopper = threading.Thread(
            target=lambda: (transport.started.wait(10), daemon.stop_turn(PAGE_ORIGIN))
        )
        stopper.start()
        while not isinstance(seen[-1], TurnError):
            seen.append(next(frames))
        stopper.join(10)
        last = seen[-1]
        assert isinstance(last, TurnError)
        assert last.reason == "cancelled"
    frames.close()  # the client hangs up as the stop lands

    assert _rows(daemon) == ["cancelled"]
    assert not daemon.lock.locked()

"""The peer tick keeps its cadence whatever the other computers do (ADR 0140).

athena/peer/listener.py: the outbound pair-back delivery and join polling are blocking calls, each
up to ``CALL_TIMEOUT_S``. Run on the tick's own thread they stretched every beat, so the beacon
going off or a window expiring reached the listener that much late. They run on their own thread
now; this holds it with an unreachable fake peer (a socket that accepts and never answers).
"""

from __future__ import annotations

import socket
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from athena.peer import listener as listener_module
from athena.peer.client import call as real_call
from athena.peer.listener import PeerHost

from .conftest import Clock, MemorySeal, Probe, make_host

STUCK_CALL_S = 1.2
TICK_S = 0.15


@pytest.fixture
def stuck_peer() -> Iterator[str]:
    """A listener that completes the TCP handshake and then says nothing, ever."""
    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen(16)
    try:
        yield f"http://127.0.0.1:{server.getsockname()[1]}"
    finally:
        server.close()


def _stuck_pair_back(host: PeerHost, url: str) -> None:
    other = "dev_" + "0" * (len(host.identity.identity.device_id) - 4)
    record = host.pairings.file_pair_back(
        device_id=other, name="Far PC", requested_grants=["chat"], deliver_to=url
    )
    host.pairings.approve(record.pairing_id, ["chat"], None)
    host.keys.keep(other, url, "t" * 43)


def test_an_unreachable_pair_back_does_not_delay_the_listener_closing(
    tmp_path: Path, clock: Clock, probe: Probe, stuck_peer: str, monkeypatch: Any
) -> None:
    def short_call(*args: Any, **kwargs: Any) -> Any:
        return real_call(*args, **{**kwargs, "timeout": STUCK_CALL_S})

    monkeypatch.setattr(listener_module, "call", short_call)
    host = make_host(tmp_path / "peer", clock, probe, MemorySeal())
    host.tick_s = TICK_S
    try:
        _stuck_pair_back(host, stuck_peer)
        host.beacon = True
        host.start()
        deadline = time.monotonic() + 5
        while host.bound is None and time.monotonic() < deadline:
            time.sleep(0.02)
        assert host.bound is not None, "the beacon should have bound the listener"
        time.sleep(TICK_S * 3)  # the worker is now inside the stuck delivery
        started = time.monotonic()
        host.beacon = False
        while host.bound is not None and time.monotonic() - started < 10:
            time.sleep(0.01)
        closed_after = time.monotonic() - started
        assert host.bound is None
        # Before: the tick sat in deliver() for up to STUCK_CALL_S, so the close came after it.
        assert closed_after < STUCK_CALL_S * 0.6, f"the listener closed {closed_after:.2f}s late"
    finally:
        host.close()


def test_an_unreachable_pair_back_is_still_attempted_and_leaves_the_record_pending(
    tmp_path: Path, clock: Clock, probe: Probe, stuck_peer: str, monkeypatch: Any
) -> None:
    def short_call(*args: Any, **kwargs: Any) -> Any:
        return real_call(*args, **{**kwargs, "timeout": 0.3})

    monkeypatch.setattr(listener_module, "call", short_call)
    host = make_host(tmp_path / "peer", clock, probe, MemorySeal())
    try:
        _stuck_pair_back(host, stuck_peer)
        host.tick()  # inline: the whole beat, as callers that want the answer now run it
        assert len(host.pairings.undelivered()) == 1
    finally:
        host.close()

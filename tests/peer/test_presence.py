"""Presence: is each paired PC there right now (fleet-surfaces WP2).

athena/peer/presence.py, read through ``GET /devices`` as the Devices surface reads it. The hello
and the overlay are fakes the test sets, except in the one test that says hello over a real socket.
"""

from __future__ import annotations

import queue
import time
from pathlib import Path
from typing import Any

import pytest

from athena.contracts import ids
from athena.peer import presence
from athena.peer.client import CallResult
from athena.peer.listener import PeerHost
from athena.peer.presence import HELLO_TIMEOUT_S, PresenceProbe, authorized_hello
from athena.peer.registry import mint_token

from .conftest import Clock, Device, MemorySeal, Probe, make_host


class FakeHello:
    """Answers every hello with :attr:`ok`, and counts the calls."""

    def __init__(self, ok: bool = True) -> None:
        self.ok = ok
        self.calls: list[str] = []

    def __call__(self, base_url: str, token: str) -> bool:
        self.calls.append(base_url)
        return self.ok


class FakeOverlay:
    """The overlay's online addresses, or ``None`` for no overlay; counts the reads."""

    def __init__(self, online: frozenset[str] | None = frozenset()) -> None:
        self.online = online
        self.reads = 0

    def __call__(self) -> frozenset[str] | None:
        self.reads += 1
        return self.online


@pytest.fixture
def host(tmp_path: Path, clock: Clock, probe: Probe) -> PeerHost:
    return make_host(tmp_path / "peer", clock, probe, MemorySeal())


def _pc(host: PeerHost, address: str = "100.64.0.7", *, keyed: bool = True) -> str:
    """A paired PC, and (``keyed``) the key and reach address this device calls it with."""
    peer_id = ids.mint("device")
    host.registry.admit(
        peer_id, name="Study PC", kind="pc", grants=["chat"], token=mint_token(), expires_days=None
    )
    if keyed:
        host.keys.keep(peer_id, f"http://{address}:17491", mint_token())
    return peer_id


def _phone(host: PeerHost) -> str:
    peer_id = ids.mint("device")
    host.registry.admit(
        peer_id, name="Phone", kind="phone", grants=["chat"], token=mint_token(), expires_days=None
    )
    return peer_id


def _published(inbox: queue.Queue[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    while True:
        try:
            out.append(inbox.get_nowait())
        except queue.Empty:
            return out


def test_a_peer_moves_from_unprobed_to_online_to_asleep_to_unreachable(
    host: PeerHost, clock: Clock
) -> None:
    hello, overlay = FakeHello(ok=True), FakeOverlay(frozenset({"100.64.0.7"}))
    probe = PresenceProbe(host, hello=hello, overlay=overlay, now=clock)
    peer_id = _pc(host)
    assert probe.view(peer_id) == {"presence": None, "presence_at": None}

    assert probe.probe_all() == [peer_id]
    assert probe.view(peer_id) == {"presence": "online", "presence_at": "2026-10-24T12:00:00+00:00"}
    assert overlay.reads == 0, "the overlay is asked only when a hello failed"

    clock.advance(30)
    hello.ok = False
    assert probe.probe_all() == [peer_id]
    assert probe.view(peer_id) == {"presence": "asleep", "presence_at": "2026-10-24T12:00:30+00:00"}

    clock.advance(30)
    overlay.online = frozenset()
    assert probe.probe_all() == [peer_id]
    assert probe.view(peer_id)["presence"] == "unreachable"
    assert probe.view(peer_id)["presence_at"] == "2026-10-24T12:01:00+00:00"


def test_no_overlay_at_all_reads_as_unreachable(host: PeerHost, clock: Clock) -> None:
    probe = PresenceProbe(host, hello=FakeHello(ok=False), overlay=FakeOverlay(None), now=clock)
    peer_id = _pc(host)
    probe.probe_all()
    assert probe.view(peer_id)["presence"] == "unreachable"


def test_nothing_is_probed_while_no_peer_is_paired(host: PeerHost, clock: Clock) -> None:
    hello, overlay = FakeHello(), FakeOverlay()
    probe = PresenceProbe(host, hello=hello, overlay=overlay, now=clock)
    inbox = host.bus.subscribe()
    assert probe.probe_all() == []
    assert hello.calls == [] and overlay.reads == 0
    assert _published(inbox) == []


def test_a_phone_and_an_unkeyed_pc_are_never_dialled_and_stay_null(
    host: PeerHost, clock: Clock
) -> None:
    hello, overlay = FakeHello(), FakeOverlay()
    probe = PresenceProbe(host, hello=hello, overlay=overlay, now=clock)
    phone, waiting = _phone(host), _pc(host, keyed=False)
    assert probe.probe_all() == []
    assert hello.calls == [] and overlay.reads == 0
    for peer_id in (phone, waiting):
        assert probe.view(peer_id) == {"presence": None, "presence_at": None}


def test_a_change_publishes_peer_changed_and_a_steady_pass_publishes_nothing(
    host: PeerHost, clock: Clock
) -> None:
    hello = FakeHello(ok=True)
    probe = PresenceProbe(host, hello=hello, overlay=FakeOverlay(), now=clock)
    steady, flapping = _pc(host, "100.64.0.7"), _pc(host, "100.64.0.8")
    inbox = host.bus.subscribe()

    probe.probe_all()
    first = _published(inbox)
    assert sorted(e["peer_id"] for e in first) == sorted([steady, flapping])
    assert {e["kind"] for e in first} == {"peer.changed"}

    clock.advance(30)
    assert probe.probe_all() == []
    assert _published(inbox) == [], "the same verdict again is not news"
    assert probe.view(steady)["presence_at"] == "2026-10-24T12:00:00+00:00"

    probe.hello = lambda url, token: "100.64.0.7" in url
    assert probe.probe_all() == [flapping]
    assert _published(inbox) == [{"kind": "peer.changed", "peer_id": flapping}]


def test_a_revoked_peer_takes_its_verdict_with_it(host: PeerHost, clock: Clock) -> None:
    probe = PresenceProbe(host, hello=FakeHello(), overlay=FakeOverlay(), now=clock)
    peer_id = _pc(host)
    probe.probe_all()
    assert host.revoke(peer_id)
    probe.probe_all()
    assert peer_id not in probe._seen


def test_the_hello_carries_the_token_and_the_three_second_timeout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: dict[str, Any] = {}

    def fake_call(base_url: str, method: str, path: str, **kwargs: Any) -> CallResult:
        seen.update(base_url=base_url, method=method, path=path, **kwargs)
        return CallResult(200, {"ok": True})

    monkeypatch.setattr(presence, "call", fake_call)
    assert authorized_hello("http://100.64.0.7:17491", "a-token") is True
    assert seen == {
        "base_url": "http://100.64.0.7:17491",
        "method": "GET",
        "path": "/peer/hello",
        "token": "a-token",
        "timeout": HELLO_TIMEOUT_S,
    }
    assert HELLO_TIMEOUT_S == 3.0
    monkeypatch.setattr(presence, "call", lambda *a, **k: CallResult(401, {}))
    assert authorized_hello("http://100.64.0.7:17491", "a-revoked-token") is False


def test_the_probe_runs_with_the_host_lifecycle(host: PeerHost, clock: Clock) -> None:
    hello = FakeHello(ok=True)
    host.presence = PresenceProbe(host, hello=hello, overlay=FakeOverlay(), every_s=0.05, now=clock)
    peer_id = _pc(host)
    host.start()
    try:
        deadline = time.monotonic() + 5
        while host.presence.view(peer_id)["presence"] is None and time.monotonic() < deadline:
            time.sleep(0.01)
        assert host.presence.view(peer_id)["presence"] == "online"
    finally:
        host.close()
    thread = host.presence._thread
    assert thread is not None and not thread.is_alive()
    calls = len(hello.calls)
    time.sleep(0.15)
    assert len(hello.calls) == calls, "a closed host probes no more"


def test_devices_shows_presence_from_a_real_hello(device: Device) -> None:
    host = device.host
    peer_id = ids.mint("device")
    token = mint_token()
    host.registry.admit(
        peer_id, name="Study PC", kind="pc", grants=["chat"], token=token, expires_days=None
    )
    host.reconcile()
    # The peer's key points back at this device's own listener, which the same token admits: a
    # real authorized hello over a real socket, answered 200.
    host.keys.keep(peer_id, f"http://127.0.0.1:{device.peer_port}", token)
    overlay = FakeOverlay(frozenset({"127.0.0.1"}))
    host.presence = PresenceProbe(host, overlay=overlay)

    row = device.ui("/devices").body["peers"][0]
    assert row["presence"] is None and row["presence_at"] is None, "keys always present"

    host.presence.probe_all()
    row = device.ui("/devices").body["peers"][0]
    assert row["presence"] == "online" and isinstance(row["presence_at"], str)

    host.keys.keep(peer_id, f"http://127.0.0.1:{device.peer_port}", mint_token())  # now refused
    host.presence.probe_all()
    assert device.ui("/devices").body["peers"][0]["presence"] == "asleep"

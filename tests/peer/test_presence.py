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
from athena.vitals import VITALS_STALE_S

from .conftest import Clock, Device, MemorySeal, Probe, make_host


class FakeHello:
    """Answers every hello with a body when :attr:`ok` (carrying :attr:`vitals`), else ``None``,
    and counts the calls."""

    def __init__(self, ok: bool = True, vitals: dict[str, Any] | None = None) -> None:
        self.ok = ok
        self.vitals = vitals
        self.calls: list[str] = []

    def __call__(self, base_url: str, token: str) -> dict[str, Any] | None:
        self.calls.append(base_url)
        return {"ok": True, "vitals": self.vitals} if self.ok else None


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
    first = probe.view(peer_id)
    assert (first["presence"], first["presence_at"], first["vitals"]) == (None, None, None)
    assert first["link"]["state"] is None, "keyed but not probed yet"

    assert probe.probe_all() == [peer_id]
    view = probe.view(peer_id)
    assert (view["presence"], view["presence_at"], view["vitals"]) == (
        "online",
        "2026-10-24T12:00:00+00:00",
        None,
    )
    assert view["link"]["state"] == "online"
    assert overlay.reads == 0, "the overlay is asked only when a hello failed"

    clock.advance(30)
    hello.ok = False
    assert probe.probe_all() == [peer_id]
    assert probe.view(peer_id)["presence"] == "asleep"
    assert probe.view(peer_id)["presence_at"] == "2026-10-24T12:00:30+00:00"

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
        view = probe.view(peer_id)
        assert (view["presence"], view["presence_at"], view["vitals"]) == (None, None, None)
    assert probe.view(phone)["link"]["state"] == "phone", "guard 7: a phone is named, not dialled"
    assert probe.view(waiting)["link"]["state"] == "awaiting_key"
    assert probe.view(waiting)["link"]["evidence"]["key"] is False


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

    probe.hello = lambda url, token: {"ok": True} if "100.64.0.7" in url else None
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
    assert authorized_hello("http://100.64.0.7:17491", "a-token") == (200, {"ok": True})
    assert seen == {
        "base_url": "http://100.64.0.7:17491",
        "method": "GET",
        "path": "/peer/hello",
        "token": "a-token",
        "timeout": HELLO_TIMEOUT_S,
    }
    assert HELLO_TIMEOUT_S == 3.0
    monkeypatch.setattr(presence, "call", lambda *a, **k: CallResult(401, {}))
    assert authorized_hello("http://100.64.0.7:17491", "a-revoked-token") == (401, None)
    monkeypatch.setattr(presence, "call", lambda *a, **k: CallResult(0, {}, "OSError"))
    assert authorized_hello("http://100.64.0.7:17491", "a-token") == (0, None)


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
    row = device.ui("/devices").body["peers"][0]
    assert row["presence"] is None, "a refusal is not sleep"
    assert row["link"]["state"] == "removed_there" and row["link"]["evidence"]["hello"] == 401


# -- vitals ride the hello (device-vitals WP1, ADR 0143) ----------------------------------------


def _vitals(room: str = "ok", held: str | None = None, cpu: float = 12.0) -> dict[str, Any]:
    return {
        "at": "2026-10-24T12:00:00+00:00",
        "cpu_pct": cpu,
        "cores": 16,
        "ram_total_mb": 64000,
        "ram_free_mb": 38400,
        "ram_pct": 40.0,
        "gpus": [],
        "power": "mains",
        "battery_pct": None,
        "disk_free_mb": 200000,
        "room": room,
        "slots": 3,
        "held": held,
        "runs": None,
        "sleep": None,
    }


def test_the_probe_keeps_a_peers_vitals_and_drops_them_when_stale(
    host: PeerHost, clock: Clock
) -> None:
    hello = FakeHello(ok=True, vitals=_vitals())
    probe = PresenceProbe(host, hello=hello, overlay=FakeOverlay(), now=clock)
    peer_id = _pc(host)
    probe.probe_all()
    assert probe.vitals(peer_id) == _vitals()
    assert probe.view(peer_id)["vitals"] == _vitals()

    clock.advance(VITALS_STALE_S)
    assert probe.vitals(peer_id) == _vitals(), "exactly at the line is still fresh"
    clock.advance(1)
    assert probe.vitals(peer_id) is None and probe.view(peer_id)["vitals"] is None

    hello.ok = False  # a failed hello keeps the last vitals; time makes them stale, not the miss
    probe.probe_all()
    assert probe.vitals(peer_id) is None


def test_peer_changed_fires_on_room_or_held_and_not_on_every_number(
    host: PeerHost, clock: Clock
) -> None:
    hello = FakeHello(ok=True, vitals=_vitals())
    probe = PresenceProbe(host, hello=hello, overlay=FakeOverlay(), now=clock)
    peer_id = _pc(host)
    inbox = host.bus.subscribe()
    assert probe.probe_all() == [peer_id]  # first verdict
    _published(inbox)

    hello.vitals = _vitals(cpu=55.0)
    assert probe.probe_all() == [], "a CPU figure that moved is not news"
    assert probe.vitals(peer_id) == _vitals(cpu=55.0), "but the figure is kept"

    hello.vitals = _vitals(room="full", held="Waiting for room: RAM is at 93% (resumes below 85%).")
    assert probe.probe_all() == [peer_id]
    assert _published(inbox) == [{"kind": "peer.changed", "peer_id": peer_id}]


def test_a_peer_whose_vitals_are_junk_is_still_online_with_a_clean_view(
    host: PeerHost, clock: Clock
) -> None:
    probe = PresenceProbe(
        host,
        hello=lambda url, token: {"ok": True, "vitals": {"room": "roomy", "slots": "x"}},
        overlay=FakeOverlay(),
        now=clock,
    )
    peer_id = _pc(host)
    probe.probe_all()
    assert probe.view(peer_id)["presence"] == "online"
    view = probe.vitals(peer_id)
    assert view is not None and view["room"] is None and view["slots"] == 0


def test_a_hello_that_raises_is_a_hello_that_did_not_answer(host: PeerHost, clock: Clock) -> None:
    def broken(url: str, token: str) -> dict[str, Any] | None:
        raise OSError("socket")

    probe = PresenceProbe(host, hello=broken, overlay=FakeOverlay(None), now=clock)
    peer_id = _pc(host)
    probe.probe_all()
    assert probe.view(peer_id)["presence"] == "unreachable"


def test_the_hello_carries_this_pcs_vitals_over_a_real_socket(device: Device) -> None:
    """``GET /peer/hello`` answers with ``vitals`` (``null`` with no vitals service), the probe
    keeps it, and ``GET /devices`` shows it on the peer's row and on ``self``."""
    host = device.host
    peer_id = ids.mint("device")
    token = mint_token()
    host.registry.admit(
        peer_id, name="Study PC", kind="pc", grants=["chat"], token=token, expires_days=None
    )
    host.reconcile()
    host.keys.keep(peer_id, f"http://127.0.0.1:{device.peer_port}", token)
    host.presence = PresenceProbe(host, overlay=FakeOverlay())

    answer = device.peer("/peer/hello", token=token)
    assert answer.status == 200 and answer.body["vitals"] is None, "no vitals service yet"
    assert device.ui("/devices").body["self"]["vitals"] is None

    host.presence.own_vitals = lambda: _vitals(room="tight")  # what VitalsService sets
    assert device.peer("/peer/hello", token=token).body["vitals"] == _vitals(room="tight")
    host.presence.probe_all()  # this device says hello to itself: the peer is its own listener
    shown = device.ui("/devices").body
    assert shown["self"]["vitals"] == _vitals(room="tight")
    assert shown["peers"][0]["vitals"] == _vitals(room="tight")


def test_a_vitals_service_that_raises_says_null_on_the_hello(device: Device) -> None:
    host = device.host
    token = mint_token()
    peer_id = ids.mint("device")
    host.registry.admit(
        peer_id, name="Study PC", kind="pc", grants=["chat"], token=token, expires_days=None
    )
    host.reconcile()

    def broken() -> None:
        raise RuntimeError("probe died")

    host.presence.own_vitals = broken  # type: ignore[assignment]
    answer = device.peer("/peer/hello", token=token)
    assert answer.status == 200 and answer.body["vitals"] is None
    assert device.ui("/devices").body["self"]["vitals"] is None


# -- one link state per peer, from named evidence (ADR 0140 "Link state") -----------------------


class StatusHello:
    """Answers every hello with ``(status, body)``, as :func:`authorized_hello` does."""

    def __init__(self, status: int) -> None:
        self.status = status
        self.calls = 0

    def __call__(self, base_url: str, token: str) -> tuple[int, dict[str, Any] | None]:
        self.calls += 1
        return self.status, ({"ok": True} if self.status == 200 else None)


def test_case2_a_401_hello_is_removed_there_not_asleep(host: PeerHost, clock: Clock) -> None:
    overlay = FakeOverlay(frozenset({"100.64.0.7"}))
    probe = PresenceProbe(host, hello=StatusHello(401), overlay=overlay, now=clock)
    peer_id = _pc(host)
    probe.probe_all()
    view = probe.view(peer_id)
    assert view["presence"] is None and view["presence_at"] is None
    assert view["link"]["state"] == "removed_there"
    assert view["link"]["since"] == "2026-10-24T12:00:00+00:00"
    assert view["link"]["evidence"]["hello"] == 401


def test_case4_a_probe_that_stops_leaves_online_to_go_stale(host: PeerHost, clock: Clock) -> None:
    probe = PresenceProbe(host, hello=FakeHello(ok=True), overlay=FakeOverlay(), now=clock)
    peer_id = _pc(host)
    probe.probe_all()
    clock.advance(30)
    probe.probe_all()  # confirms: the hello's latest is now 12:00:30
    clock.advance(3 * 30 + 1)
    link = probe.view(peer_id)["link"]
    assert link["state"] == "stale" and link["since"] == "2026-10-24T12:00:30+00:00"
    assert link["evidence"]["hello_at"] == "2026-10-24T12:00:30+00:00"


def test_case6_moving_to_removed_there_publishes_once(host: PeerHost, clock: Clock) -> None:
    hello = StatusHello(200)
    probe = PresenceProbe(host, hello=hello, overlay=FakeOverlay(), now=clock)
    peer_id = _pc(host)
    probe.probe_all()
    inbox = host.bus.subscribe()

    clock.advance(30)
    hello.status = 401
    assert probe.probe_all() == [peer_id]
    assert _published(inbox) == [{"kind": "peer.changed", "peer_id": peer_id}]

    clock.advance(30)
    assert probe.probe_all() == []
    assert _published(inbox) == [], "the same refusal again is not news"
    assert probe.view(peer_id)["link"]["since"] == "2026-10-24T12:00:30+00:00"


def test_a_peer_removed_here_takes_its_link_with_it(host: PeerHost, clock: Clock) -> None:
    probe = PresenceProbe(host, hello=StatusHello(401), overlay=FakeOverlay(), now=clock)
    peer_id = _pc(host)
    probe.probe_all()
    assert host.revoke(peer_id)
    assert probe.view(peer_id)["link"] is None
    probe.probe_all()
    assert peer_id not in probe._hellos

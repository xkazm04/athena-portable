"""The peer socket: refused before a byte is read, bound only while trust exists (ADR 0140, WP1 AC).

athena/peer/listener.py - PeerServer.verify_request and PeerHost.reconcile / tick.
"""

from __future__ import annotations

import socket
from pathlib import Path

import pytest

from athena.contracts import ids
from athena.peer.listener import REFUSAL, PeerHost, PeerServer, build_peer_handler
from athena.peer.overlay import Overlay
from athena.peer.pairing import WINDOW_TTL_S
from athena.peer.registry import mint_token

from .conftest import Clock, MemorySeal, Probe, http, make_host


class Recorder:
    """A connection that records what was written to it and fails any read."""

    def __init__(self) -> None:
        self.sent = b""

    def settimeout(self, value: float) -> None:
        pass

    def sendall(self, data: bytes) -> None:
        self.sent += data

    def recv(self, *args: object) -> bytes:
        raise AssertionError("a refused connection is never read")


@pytest.fixture
def host(tmp_path: Path, clock: Clock, probe: Probe) -> PeerHost:
    built = make_host(tmp_path / "peer", clock, probe, MemorySeal())
    yield built  # type: ignore[misc]
    built.close()


@pytest.mark.parametrize(
    "addr", ["8.8.8.8", "192.168.1.20", "10.0.0.5", "::ffff:8.8.8.8", "2001:db8::1"]
)
def test_a_public_lan_or_mapped_public_address_gets_the_fixed_refusal_unread(
    host: PeerHost, addr: str
) -> None:
    server = PeerServer(("127.0.0.1", 0), build_peer_handler(host))
    try:
        connection = Recorder()
        assert server.verify_request(connection, (addr, 50000)) is False
        assert connection.sent == REFUSAL
    finally:
        server.server_close()


def test_an_overlay_address_is_admitted_and_loopback_only_with_the_test_flag(
    host: PeerHost,
) -> None:
    server = PeerServer(("127.0.0.1", 0), build_peer_handler(host))
    try:
        assert server.verify_request(Recorder(), ("100.100.1.2", 1)) is True
        assert server.verify_request(Recorder(), ("::ffff:100.100.1.2", 1)) is True
        assert server.verify_request(Recorder(), ("127.0.0.1", 1)) is False
        server.admit_loopback = True
        assert server.verify_request(Recorder(), ("127.0.0.1", 1)) is True
    finally:
        server.server_close()


def test_a_listener_without_the_flag_refuses_a_real_loopback_socket(
    tmp_path: Path, clock: Clock, probe: Probe
) -> None:
    strict = PeerHost(tmp_path / "strict", port=0, probe=probe, seal=MemorySeal(), now=clock)
    try:
        strict.beacon = True
        strict.reconcile()
        bound = strict.bound
        assert bound is not None
        with socket.create_connection(bound, timeout=5) as raw:
            raw.sendall(b"GET /peer/hello HTTP/1.1\r\nHost: x\r\n\r\n")
            assert raw.recv(4096) == REFUSAL
    finally:
        strict.close()


def test_the_listener_is_not_bound_with_no_peer_no_window_and_no_beacon(host: PeerHost) -> None:
    host.tick()
    assert host.bound is None


def test_a_window_binds_it_and_its_expiry_closes_it(host: PeerHost, clock: Clock) -> None:
    host.pairings.open_window("phone")
    host.reconcile()
    assert host.bound is not None
    clock.advance(WINDOW_TTL_S + 1)
    host.tick()
    assert host.bound is None


def test_a_peer_row_keeps_it_up_and_its_revoke_closes_it(host: PeerHost) -> None:
    peer_id = ids.mint("device")
    host.registry.admit(
        peer_id, name="Phone", kind="phone", grants=[], token=mint_token(), expires_days=None
    )
    host.tick()
    assert host.bound is not None
    host.revoke(peer_id)
    assert host.bound is None


def test_an_expired_peer_is_reaped_by_the_tick_and_the_listener_closes(
    host: PeerHost, clock: Clock
) -> None:
    host.registry.admit(
        ids.mint("device"), name="P", kind="phone", grants=[], token=mint_token(), expires_days=1
    )
    host.tick()
    assert host.bound is not None
    clock.advance(86_401)
    host.tick()
    assert host.bound is None
    assert host.registry.path.read_text(encoding="utf-8").strip() == "[]"


def test_the_beacon_keeps_it_up(host: PeerHost) -> None:
    host.beacon = True
    host.tick()
    assert host.bound is not None
    host.beacon = False
    host.tick()
    assert host.bound is None


def test_with_no_overlay_it_stays_down_whatever_is_wanted(host: PeerHost, probe: Probe) -> None:
    probe.overlay = Overlay("absent")
    host.beacon = True
    host.reconcile()
    assert host.bound is None
    assert host.base_url() is None


def test_a_stranger_gets_401_for_any_path_and_a_body_over_the_cap_is_refused(
    host: PeerHost,
) -> None:
    host.beacon = True
    host.reconcile()
    bound = host.bound
    assert bound is not None
    assert http(bound[1], "/peer/hello").status == 401
    assert http(bound[1], "/nowhere").status == 401
    big = http(
        bound[1],
        "/peer/pair/request",
        method="POST",
        raw_body=b"{" + b" " * 70_000 + b"}",
        headers={"Content-Type": "application/json"},
    )
    assert big.status == 400 and big.body["error"] == "parse_error"
    foreign = http(
        bound[1],
        "/peer/pair/request",
        method="POST",
        body={},
        headers={"Origin": "https://evil.example"},
    )
    assert foreign.status == 403 and foreign.body["error"] == "foreign_origin"


def test_a_host_nobody_pairs_with_writes_nothing(host: PeerHost) -> None:
    host.tick()
    assert not host.root.exists()


def test_serve_takes_the_peer_port_and_can_go_without_the_peer_surface() -> None:
    from athena.daemon.server import build_parser
    from athena.peer.listener import DEFAULT_PEER_PORT

    assert DEFAULT_PEER_PORT == 17491
    args = build_parser().parse_args([])
    assert args.peer_port == 17491 and args.no_peer is False
    assert build_parser().parse_args(["--no-peer", "--peer-port", "18000"]).no_peer is True


def test_every_peer_word_collapses_onto_a_member_of_the_shared_vocabulary() -> None:
    # ``reason`` is the daemon's closed ERROR_REASONS (the list gate.js mirrors, held equal by
    # tests/test_refusal_parity.py), so no peer word adds a member: each maps onto one, and none
    # of the remote composer's words falls through to ``unknown``.
    from athena.contracts.harness import ERROR_REASONS
    from athena.peer.listener import PEER_REASONS, peer_error

    assert set(PEER_REASONS.values()) <= set(ERROR_REASONS)
    for word, reason in {
        "window_closed": "timeout",
        "not_sender": "foreign_token",
        "busy": "budget_exhausted",
    }.items():
        _, body = peer_error(409, word, "detail")
        assert body["reason"] == reason and body["error"] == word, word
    assert peer_error(400, "a_word_nobody_declared")[1]["reason"] == "unknown"

"""A peer host on real sockets, with no overlay and no OS seal (ADR 0140).

There is no Tailscale in a test run, so the overlay probe is a value the test sets, and the
listener is built with ``admit_loopback`` - the one flag that lets a loopback caller in, which
production never sets. Everything else is real: the loopback daemon built by ``build_local`` with
the peer host wired in exactly as ``athena serve`` wires it, the peer listener's own socket, and
``peers.json`` on disk under ``tmp_path``. The clock is a value too, so a TTL passes in a line.
"""

from __future__ import annotations

import json
import threading
from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from http.client import HTTPConnection
from pathlib import Path
from typing import Any

import pytest

from athena.channels.voice.config import VoiceStudio
from athena.channels.voice.home import EngineHomes
from athena.connectors.seal import FileSeal
from athena.daemon.server import TOKEN_HEADER, DaemonConfig, DaemonServer, make_server
from athena.harness.transports import ScriptedTransport
from athena.peer.listener import PeerHost
from athena.peer.overlay import Overlay
from athena.wiring import AthenaLocal, build_local

TOKEN = "test-token-not-a-secret"


class Clock:
    def __init__(self) -> None:
        self.now = datetime(2026, 10, 24, 12, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += timedelta(seconds=seconds)


class MemorySeal:
    """A seal that keeps values in memory, so a test can grep the disk for a token."""

    kind = "memory"

    def __init__(self) -> None:
        self.values: dict[str, str] = {}

    def seal(self, name: str, value: str) -> None:
        self.values[name] = value

    def unseal(self, name: str) -> str | None:
        return self.values.get(name)

    def destroy(self, name: str) -> None:
        self.values.pop(name, None)


@dataclass
class Probe:
    overlay: Overlay = field(default_factory=lambda: Overlay("up", "127.0.0.1"))
    calls: int = 0

    def __call__(self) -> Overlay:
        self.calls += 1
        return self.overlay


@dataclass
class Reply:
    status: int
    body: dict[str, Any]
    raw: bytes = b""


def http(
    port: int,
    path: str,
    *,
    method: str = "GET",
    body: Mapping[str, Any] | None = None,
    headers: Mapping[str, str] | None = None,
    raw_body: bytes | None = None,
    timeout: float = 10.0,
) -> Reply:
    sent = dict(headers or {})
    payload = raw_body
    if body is not None:
        payload = json.dumps(dict(body)).encode("utf-8")
        sent["Content-Type"] = "application/json"
    connection = HTTPConnection("127.0.0.1", port, timeout=timeout)
    try:
        connection.request(method, path, body=payload, headers=sent)
        answer = connection.getresponse()
        raw = answer.read()
    finally:
        connection.close()
    decoded: Any = {}
    if raw and "json" in (answer.getheader("Content-Type") or ""):
        decoded = json.loads(raw)
    return Reply(answer.status, decoded if isinstance(decoded, dict) else {}, raw)


def make_host(root: Path, clock: Clock, probe: Probe, seal: MemorySeal) -> PeerHost:
    return PeerHost(root, port=0, probe=probe, seal=seal, admit_loopback=True, now=clock)


@dataclass
class Device:
    """One Athena: its loopback daemon on a real socket and its peer host."""

    local: AthenaLocal
    server: DaemonServer
    host: PeerHost
    seal: MemorySeal
    root: Path

    @property
    def port(self) -> int:
        return int(self.server.server_address[1])

    def ui(self, path: str, *, method: str = "GET", body: Mapping[str, Any] | None = None) -> Reply:
        """A request from this device's own window, on the loopback daemon."""
        return http(self.port, path, method=method, body=body, headers={TOKEN_HEADER: TOKEN})

    @property
    def peer_port(self) -> int:
        bound = self.host.bound
        assert bound is not None, "the peer listener is not bound"
        return bound[1]

    def peer(
        self,
        path: str,
        *,
        method: str = "GET",
        body: Mapping[str, Any] | None = None,
        token: str | None = None,
    ) -> Reply:
        """A request from another device, on this device's peer listener."""
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return http(self.peer_port, path, method=method, body=body, headers=headers)


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def probe() -> Probe:
    return Probe()


def _device(tmp_path: Path, name: str, clock: Clock, probe: Probe) -> Iterator[Device]:
    base = tmp_path / name
    seal = MemorySeal()
    host = make_host(base / "peer", clock, probe, seal)
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
        transport=lambda dialect: ScriptedTransport([]),
        workspace=base / "engine",
        voice_studio=studio,
        peer=host,
    ) as local:
        server = make_server(local.daemon, DaemonConfig(port=0, token=TOKEN))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield Device(local, server, host, seal, base / "peer")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=10)


@pytest.fixture
def device(tmp_path: Path, clock: Clock, probe: Probe) -> Iterator[Device]:
    yield from _device(tmp_path, "a", clock, probe)


@pytest.fixture
def other(tmp_path: Path, clock: Clock, probe: Probe) -> Iterator[Device]:
    yield from _device(tmp_path, "b", clock, probe)

"""A real daemon on a real socket, and a client that speaks to it (README §3.5).

Every test in this directory runs against ``127.0.0.1:0`` — a kernel-chosen port, so two runs in
parallel never collide — with a real ``Brain`` under ``tmp_path``. Nothing here mocks HTTP: the
claims the daemon makes are about sockets (one request per connection, a held connection that
starves nobody, a token on every route), and a claim about a socket proved against a fake is not
proved at all.

The engine is a name and nothing more in this commit: no route runs a turn yet, so there is no
model to fake. ``ENGINE`` is the fake, and ``/health`` reporting it is the whole of its job.
"""

from __future__ import annotations

import json
import threading
from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field
from http.client import HTTPConnection
from pathlib import Path
from typing import Any

import pytest

from athena.core.approvals import Approvals
from athena.core.brain import Brain
from athena.core.catalog import CoreServices, build_catalog
from athena.core.ledger import Ledger
from athena.daemon.server import (
    TOKEN_HEADER,
    AthenaDaemon,
    DaemonConfig,
    DaemonServer,
    bound_url,
    make_server,
)

#: The fake engine's name. It is a label until the lane lands; ``/health`` repeats it back.
ENGINE = "fake_engine"
TOKEN = "test-token-not-a-secret"
SHELL_ORIGIN = "http://tauri.localhost"
EXTENSION_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop"
#: A response that takes longer than this to arrive while another request holds the writer lock
#: is the starvation this daemon exists to avoid. Generous: the bug it catches was unbounded.
FAST_S = 2.0


@dataclass
class Response:
    status: int
    headers: Mapping[str, str]
    body: dict[str, Any] = field(default_factory=dict)
    raw: bytes = b""

    def header(self, name: str) -> str:
        for key, value in self.headers.items():
            if key.lower() == name.lower():
                return value
        return ""

    def has_header(self, name: str) -> bool:
        return any(key.lower() == name.lower() for key in self.headers)


@dataclass
class Live:
    """A daemon that is listening, and everything a test needs to reach it."""

    daemon: AthenaDaemon
    config: DaemonConfig
    server: DaemonServer
    url: str

    @property
    def host(self) -> str:
        return self.config.host

    @property
    def port(self) -> int:
        return int(self.server.server_address[1])

    def request(
        self,
        path: str,
        *,
        method: str = "GET",
        token: str | None = TOKEN,
        origin: str = "",
        body: str | None = None,
        timeout: float = 10.0,
    ) -> Response:
        """One request on its own connection, which is the only kind this daemon answers."""
        headers: dict[str, str] = {}
        if token is not None:
            headers[TOKEN_HEADER] = token
        if origin:
            headers["Origin"] = origin
        if body is not None:
            headers["Content-Type"] = "application/json"
        connection = HTTPConnection(self.host, self.port, timeout=timeout)
        try:
            connection.request(method, path, body=body, headers=headers)
            reply = connection.getresponse()
            raw = reply.read()
            payload: dict[str, Any] = {}
            if raw:
                decoded = json.loads(raw)
                payload = decoded if isinstance(decoded, dict) else {}
            return Response(reply.status, dict(reply.getheaders()), payload, raw)
        finally:
            connection.close()


@pytest.fixture
def brain(tmp_path: Path) -> Iterator[Brain]:
    with Brain(tmp_path / "brain", session_id="daemon") as opened:
        yield opened


@pytest.fixture
def daemon(brain: Brain) -> AthenaDaemon:
    services = CoreServices(
        sources_alive=lambda sources: set(sources) <= brain.live_episode_ids(list(sources))
    )
    return AthenaDaemon(
        brain=brain,
        catalog=build_catalog(services),
        approvals=Approvals(brain),
        ledger=Ledger(brain),
        engine=ENGINE,
        model="fake-model",
    )


@pytest.fixture
def live(daemon: AthenaDaemon) -> Iterator[Live]:
    config = DaemonConfig(
        port=0,
        token=TOKEN,
        engine=ENGINE,
        model="fake-model",
        allow_origins=(SHELL_ORIGIN,),
    )
    server = make_server(daemon, config)
    thread = threading.Thread(target=server.serve_forever, name="daemon-test", daemon=True)
    thread.start()
    try:
        yield Live(daemon=daemon, config=config, server=server, url=bound_url(server, config))
    finally:
        server.shutdown()
        # ``block_on_close`` is False, so this returns even with a client still holding a socket —
        # which is the point of the setting and the reason this teardown cannot hang.
        server.server_close()
        thread.join(timeout=10)
        assert not thread.is_alive()

"""A real daemon on a real socket, and a client that speaks to it (README §3.5).

Every test in this directory runs against ``127.0.0.1:0`` — a kernel-chosen port, so two runs in
parallel never collide — with a real ``Brain`` under ``tmp_path``. Nothing here mocks HTTP: the
claims the daemon makes are about sockets (one request per connection, a held connection that
starves nobody, a token on every route) and about turns (a gated call becomes a card, an approval
comes back as an ``execute``), and neither is proved against a fake server.

The daemon is built by :func:`athena.wiring.build_local`, exactly as ``athena serve`` builds one:
the real brain, the real catalog, the real approval table, the real gate with structural policy in
front of it, the real lane. The one thing that is not real is the engine's *transport* — a
:class:`~athena.harness.transports.ScriptedTransport` replaying recorded ``claude`` stdout — so a
whole gated turn runs over real HTTP with no binary, no network and no login (ADR 0007).
"""

from __future__ import annotations

import json
import threading
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from http.client import HTTPConnection
from pathlib import Path
from typing import Any

import pytest

from athena.contracts.manifest import HostManifest, HostTool
from athena.core.brain import Brain
from athena.daemon.server import (
    TOKEN_HEADER,
    AthenaDaemon,
    DaemonConfig,
    DaemonServer,
    bound_url,
    make_server,
)
from athena.harness.transports import ScriptedTransport
from athena.wiring import AthenaLocal, build_local

#: The engine the scripted transport is pretending to be. The dialect is real — the argv, the
#: stream-json decoding and the resume rule are all exercised — only the process is not.
ENGINE = "claude_code"
MODEL = "fake-model"
TOKEN = "test-token-not-a-secret"
SHELL_ORIGIN = "http://tauri.localhost"
EXTENSION_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop"
#: A response that takes longer than this to arrive while another request holds the writer lock
#: is the starvation this daemon exists to avoid. Generous: the bug it catches was unbounded.
FAST_S = 2.0

#: The page every test registers. One reversible tool and one that leaves the app, so the class
#: of each falls out of the manifest's own flags and never out of a preference (README §3.3).
APP_ID = "invoices"
PAGE_ORIGIN = "https://invoices.example"
OTHER_APP_ID = "crm"
OTHER_PAGE_ORIGIN = "https://crm.example"
#: The CLI session id the scripted ``system`` line reports, so ``--resume`` has something to hold.
SESSION = "01J9CLAUDESESSION"


# --- the scripted engine --------------------------------------------------------------------


def claude_round(text: str, *, cost: float = 0.04) -> list[str]:
    """One invocation of ``claude -p - --output-format stream-json``, as recorded lines."""
    return [
        json.dumps({"type": "system", "session_id": SESSION}),
        json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": text}]}}),
        json.dumps(
            {
                "type": "result",
                "is_error": False,
                "total_cost_usd": cost,
                "usage": {"input_tokens": 1840, "output_tokens": 96},
            }
        ),
    ]


def op(action: str, rationale: str = "", **params: Any) -> str:
    """One ``OP:`` envelope, the grammar the capability block teaches (README §3.2 step 3)."""
    envelope: dict[str, Any] = {"op": "propose_action", "action": action, "params": params}
    if rationale:
        envelope["rationale"] = rationale
    return "OP: " + json.dumps(envelope)


def manifest_body(
    app_id: str = APP_ID, page_origin: str = PAGE_ORIGIN, **overrides: Any
) -> dict[str, Any]:
    """The JSON a page posts to ``/manifest``: two tools, one of each class."""
    body: dict[str, Any] = {
        "app_id": app_id,
        "app_version": "1",
        "page_origin": page_origin,
        "tools": [
            {
                "name": "chase",
                "description": "Draft a chase note on an invoice.",
                "params_schema": {"type": "object", "properties": {"invoice": {"type": "string"}}},
                "reversible": True,
                "side_effects": "internal",
            },
            {
                "name": "pay",
                "description": "Pay an invoice.",
                "params_schema": {"type": "object", "properties": {"invoice": {"type": "string"}}},
                "reversible": False,
                "side_effects": "external",
            },
        ],
    }
    body.update(overrides)
    return body


def host_manifest(app_id: str = APP_ID, page_origin: str = PAGE_ORIGIN) -> HostManifest:
    """The same page, as the contract value — for a test that merges without going over HTTP."""
    body = manifest_body(app_id, page_origin)
    return HostManifest(
        app_id=str(body["app_id"]),
        page_origin=str(body["page_origin"]),
        tools=[HostTool.from_dict(tool) for tool in body["tools"]],
    )


# --- the client -------------------------------------------------------------------------------


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

    @property
    def text(self) -> str:
        return self.raw.decode("utf-8")

    def frames(self) -> list[tuple[str, dict[str, Any]]]:
        """The SSE stream as ``(event name, decoded data)`` pairs.

        It parses rather than searches, so a frame that is not two lines, or whose ``event:`` name
        disagrees with the ``kind`` inside its ``data:``, fails the test that reads it.
        """
        out: list[tuple[str, dict[str, Any]]] = []
        for block in self.text.split("\n\n"):
            if not block.strip():
                continue
            lines = block.split("\n")
            assert len(lines) == 2, f"an SSE frame is two lines, got {lines!r}"
            assert lines[0].startswith("event: "), f"no event name on {lines[0]!r}"
            assert lines[1].startswith("data: "), f"no data on {lines[1]!r}"
            payload = json.loads(lines[1][len("data: ") :])
            assert payload["kind"] == lines[0][len("event: ") :], "the frame disagrees with itself"
            out.append((str(payload["kind"]), payload))
        return out


@dataclass
class Live:
    """A daemon that is listening, and everything a test needs to reach it."""

    daemon: AthenaDaemon
    config: DaemonConfig
    server: DaemonServer
    url: str
    transport: ScriptedTransport

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
        json_body: Mapping[str, Any] | None = None,
        timeout: float = 10.0,
    ) -> Response:
        """One request on its own connection, which is the only kind this daemon answers."""
        if json_body is not None:
            body = json.dumps(dict(json_body))
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
            if raw and "json" in (reply.getheader("Content-Type") or ""):
                decoded = json.loads(raw)
                payload = decoded if isinstance(decoded, dict) else {}
            return Response(reply.status, dict(reply.getheaders()), payload, raw)
        finally:
            connection.close()

    # -- the two things every turn test does first ---------------------------------------------

    def register(
        self, app_id: str = APP_ID, page_origin: str = PAGE_ORIGIN, **overrides: Any
    ) -> Response:
        return self.request(
            "/manifest", method="POST", json_body=manifest_body(app_id, page_origin, **overrides)
        )

    def script(self, *rounds: Sequence[str]) -> None:
        """What the engine will say, one list of stdout lines per invocation."""
        self.transport.rounds.extend(list(lines) for lines in rounds)

    def run(self, message: str, *, origin: str = PAGE_ORIGIN, **body: Any) -> Response:
        return self.request(
            "/run", method="POST", json_body={"message": message, "origin": origin, **body}
        )


# --- the fixtures -------------------------------------------------------------------------------


@pytest.fixture
def transport() -> ScriptedTransport:
    """The engine, empty. A test appends the rounds it means to be asked for, and a round the
    script does not have raises rather than answering with silence."""
    return ScriptedTransport([])


@pytest.fixture
def local(tmp_path: Path, transport: ScriptedTransport) -> Iterator[AthenaLocal]:
    with build_local(
        brain_root=tmp_path / "brain",
        engine=ENGINE,
        model=MODEL,
        transport=lambda dialect: transport,
        workspace=tmp_path / "engine",
        session_id="daemon",
    ) as built:
        yield built


@pytest.fixture
def brain(local: AthenaLocal) -> Brain:
    return local.brain


@pytest.fixture
def daemon(local: AthenaLocal) -> AthenaDaemon:
    return local.daemon


@pytest.fixture
def live(daemon: AthenaDaemon, transport: ScriptedTransport) -> Iterator[Live]:
    config = DaemonConfig(
        port=0,
        token=TOKEN,
        engine=ENGINE,
        model=MODEL,
        allow_origins=(SHELL_ORIGIN,),
    )
    server = make_server(daemon, config)
    thread = threading.Thread(target=server.serve_forever, name="daemon-test", daemon=True)
    thread.start()
    try:
        yield Live(
            daemon=daemon,
            config=config,
            server=server,
            url=bound_url(server, config),
            transport=transport,
        )
    finally:
        server.shutdown()
        # ``block_on_close`` is False, so this returns even with a client still holding a socket —
        # which is the point of the setting and the reason this teardown cannot hang.
        server.server_close()
        thread.join(timeout=10)
        assert not thread.is_alive()

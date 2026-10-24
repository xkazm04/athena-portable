"""A stdlib fake MCP server over Streamable HTTP, on loopback (connectors/mcp; ADR 0123).

Stateless JSON-RPC by hand, the way Gravitone's ``/api/mcp`` is: ``initialize`` answers the
asked protocol version, a notification is 202, ``tools/list`` lists :attr:`FakeMcp.tools`,
``tools/call`` answers from :attr:`FakeMcp.results` (a tool name to a result object, or to a
callable of the arguments). A request without ``Authorization: Bearer <token>`` is 401. Every
request is kept in :attr:`FakeMcp.seen`, headers included, so a test can assert what left Athena.

Shared by the unit tests here and the daemon-level test in ``tests/e2e``.
"""

from __future__ import annotations

import json
import socket
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

TOKEN = "gt_fake_token_0123456789abcdef"

READS = {
    "readOnlyHint": True,
    "destructiveHint": False,
    "idempotentHint": True,
    "openWorldHint": False,
}
WRITES = {
    "readOnlyHint": False,
    "destructiveHint": False,
    "idempotentHint": False,
    "openWorldHint": False,
}
DESTROYS = {**WRITES, "destructiveHint": True}

SCHEMA = {
    "type": "object",
    "properties": {"op": {"type": "string", "enum": ["projects", "jobs"]}},
    "required": ["op"],
}


def gravitone_like_tools() -> list[dict[str, Any]]:
    """Four tools shaped like Gravitone's default projection."""
    return [
        {"name": "gt_read", "description": "Read the studio.", "inputSchema": SCHEMA,
         "annotations": READS},
        {"name": "gt_launch", "description": "Compose and launch.", "inputSchema": SCHEMA,
         "annotations": WRITES},
        {"name": "gt_job", "description": "Act on jobs.", "inputSchema": SCHEMA,
         "annotations": DESTROYS},
        {"name": "gt_plain", "description": "No annotations.", "inputSchema": SCHEMA},
    ]  # fmt: skip


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


@dataclass
class Seen:
    #: Lower-cased names: urllib re-cases them on the way out.
    headers: dict[str, str]
    body: dict[str, Any]

    @property
    def method(self) -> str:
        return str(self.body.get("method", ""))


Result = dict[str, Any] | Callable[[dict[str, Any]], dict[str, Any]]


@dataclass
class FakeMcp:
    token: str = TOKEN
    port: int = 0
    tools: list[dict[str, Any]] = field(default_factory=gravitone_like_tools)
    results: dict[str, Result] = field(default_factory=dict)
    seen: list[Seen] = field(default_factory=list)
    _server: ThreadingHTTPServer | None = None

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}/api/mcp"

    def start(self) -> FakeMcp:
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format: str, *args: Any) -> None:
                return

            def _reply(self, status: int, payload: Any = None) -> None:
                body = b"" if payload is None else json.dumps(payload).encode("utf-8")
                self.send_response(status)
                if payload is not None:
                    self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self) -> None:
                length = int(self.headers.get("Content-Length") or 0)
                message = json.loads(self.rfile.read(length) or b"{}")
                fake.seen.append(Seen({k.lower(): v for k, v in self.headers.items()}, message))
                if self.headers.get("Authorization") != f"Bearer {fake.token}":
                    self._reply(401, {"error": "unauthorized"})
                    return
                ident, method = message.get("id"), message.get("method", "")
                if ident is None:
                    self._reply(202)
                    return
                if method != "initialize" and not self.headers.get("MCP-Protocol-Version"):
                    self._reply(400, {"error": "no MCP-Protocol-Version"})
                    return
                self._reply(200, {"jsonrpc": "2.0", "id": ident, **fake.answer(message)})

        self._server = ThreadingHTTPServer(("127.0.0.1", self.port), Handler)
        self.port = int(self._server.server_address[1])
        threading.Thread(target=self._server.serve_forever, daemon=True).start()
        return self

    def answer(self, message: dict[str, Any]) -> dict[str, Any]:
        method, params = message.get("method"), message.get("params") or {}
        if method == "initialize":
            return {
                "result": {
                    "protocolVersion": params.get("protocolVersion"),
                    "capabilities": {"tools": {"listChanged": False}},
                    "serverInfo": {"name": "fake", "version": "0"},
                }
            }
        if method == "tools/list":
            return {"result": {"tools": self.tools}}
        if method == "tools/call":
            name = params.get("name")
            found = self.results.get(str(name))
            if found is None:
                return {"error": {"code": -32602, "message": f"unknown tool {name!r}"}}
            args = params.get("arguments") or {}
            return {"result": found(args) if callable(found) else found}
        return {"error": {"code": -32601, "message": f"no method {method!r}"}}

    def stop(self) -> None:
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
            self._server = None

    def calls(self) -> list[Seen]:
        return [s for s in self.seen if s.method == "tools/call"]


def structured(value: dict[str, Any], *, error: bool = False) -> dict[str, Any]:
    """A result shaped the way Gravitone shapes one."""
    out: dict[str, Any] = {
        "content": [{"type": "text", "text": json.dumps(value)}],
        "structuredContent": value,
    }
    if error:
        out["isError"] = True
    return out

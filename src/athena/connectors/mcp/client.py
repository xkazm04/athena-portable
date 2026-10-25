"""A stdlib MCP client over Streamable HTTP: initialize, list, call (README §4; ADR 0144).

Only the client half of MCP that a connector port needs, hand-rolled on ``urllib`` like the vault:

1. ``initialize`` with the newest protocol version this client speaks; the server's answer must be
   one of :data:`PROTOCOL_VERSIONS`, and every later request carries it as ``MCP-Protocol-Version``
   (and the ``Mcp-Session-Id`` the server issued, when it issued one).
2. ``notifications/initialized``, answered 202 by a conforming server.
3. ``tools/list`` (following ``nextCursor`` for at most :data:`MAX_PAGES` pages) or
   ``tools/call``.

The transport is the vault's :class:`~athena.connectors.vault.UrllibTransport`: no redirect is
followed, so the bearer token never rides to a host the configuration did not name, and a reply is
read to at most :data:`~athena.connectors.vault.MAX_RESPONSE_BYTES` (1 MiB). Every request has a
:data:`TIMEOUT_S` timeout. A reply may be ``application/json`` or a ``text/event-stream`` carrying
the one JSON-RPC response.

**The token.** It is read from the environment variable the configuration names at the moment of
each request, put in the ``Authorization`` header, and nowhere else: every :class:`McpError`
sentence names the server id, the method and the HTTP status, and passes through
:func:`~athena.connectors.vault.redact` with the token before it leaves, in case a server quoted
it back.
"""

from __future__ import annotations

import json
import os
from collections.abc import Mapping
from contextlib import suppress
from typing import Any

from athena.connectors.mcp.config import McpServer
from athena.connectors.vault import (
    MAX_RESPONSE_BYTES,
    NoAnswer,
    Transport,
    UrllibTransport,
    VaultError,
    redact,
)

__all__ = [
    "MAX_PAGES",
    "PROTOCOL_VERSIONS",
    "TIMEOUT_S",
    "McpClient",
    "McpError",
]

#: The protocol versions this client speaks, newest first; the first is the one it asks for.
PROTOCOL_VERSIONS: tuple[str, ...] = ("2025-11-25", "2025-06-18", "2025-03-26")
TIMEOUT_S = 20.0
#: ``tools/list`` pages followed before the listing is called complete enough to be refused.
MAX_PAGES = 10
CLIENT_INFO = {"name": "athena", "version": "0"}


class McpError(RuntimeError):
    """A request that did not get a usable answer. Safe to show a model: never a token.

    ``status`` is the HTTP status when one came back; ``unanswered`` is true when the request may
    have reached the server and no answer did (a timeout, a dropped connection). ``said`` is the
    server's own error message, kept out of the sentence because it is foreign text: a caller that
    shows it to a model fences it.
    """

    def __init__(
        self,
        message: str,
        *,
        status: int | None = None,
        unanswered: bool = False,
        said: str = "",
    ) -> None:
        super().__init__(message)
        self.status = status
        self.unanswered = unanswered
        self.said = said


def _header(headers: Mapping[str, str], name: str) -> str:
    lowered = name.lower()
    for key, value in headers.items():
        if key.lower() == lowered:
            return value
    return ""


def _sse_messages(text: str) -> list[Any]:
    """The JSON payload of every ``data:`` event in an event-stream body."""
    out: list[Any] = []
    data: list[str] = []
    for line in [*text.splitlines(), ""]:
        if line.startswith("data:"):
            data.append(line[5:].removeprefix(" "))
        elif not line.strip() and data:
            with suppress(json.JSONDecodeError):
                out.append(json.loads("\n".join(data)))
            data = []
    return out


class McpClient:
    """One server's client. Not thread-safe on its own; :class:`McpService` serialises it."""

    def __init__(
        self,
        server: McpServer,
        *,
        transport: Transport | None = None,
        environ: Mapping[str, str] | None = None,
        timeout: float = TIMEOUT_S,
    ) -> None:
        self.server = server
        self.transport: Transport = transport or UrllibTransport()
        self._environ = environ
        self.timeout = timeout
        self.protocol_version = ""
        self.session_id = ""
        self._next_id = 0

    # -- the token -----------------------------------------------------------------------------

    def token(self) -> str:
        """The bearer token, read now. Empty when the variable is unset or blank."""
        environ = self._environ if self._environ is not None else os.environ
        return (environ.get(self.server.token_env) or "").strip()

    def _fail(self, sentence: str, **kw: Any) -> McpError:
        return McpError(redact(sentence, [self.token()]), **kw)

    # -- the wire ------------------------------------------------------------------------------

    def _post(self, message: dict[str, Any], *, initialized: bool) -> tuple[int, bytes, str]:
        token = self.token()
        if not token:
            raise McpError(
                f"MCP server {self.server.id!r}: the environment variable "
                f"{self.server.token_env} is not set"
            )
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "Authorization": f"Bearer {token}",
        }
        if initialized:
            headers["MCP-Protocol-Version"] = self.protocol_version
            if self.session_id:
                headers["Mcp-Session-Id"] = self.session_id
        body = json.dumps(message).encode("utf-8")
        method = str(message.get("method", ""))
        try:
            status, raw, *rest = self.transport(
                "POST", self.server.url, headers, body, self.timeout
            )
        except NoAnswer as exc:
            raise self._fail(
                f"MCP server {self.server.id!r} did not answer {method}: {exc}", unanswered=True
            ) from None
        except VaultError as exc:
            raise self._fail(
                f"MCP server {self.server.id!r} could not be reached for {method}: {exc}"
            ) from None
        reply_headers: Mapping[str, str] = rest[0] if rest else {}
        if len(raw) > MAX_RESPONSE_BYTES:
            raise self._fail(
                f"MCP server {self.server.id!r} answered {method} with more than "
                f"{MAX_RESPONSE_BYTES} bytes",
                status=status,
            )
        if method == "initialize":
            self.session_id = _header(reply_headers, "Mcp-Session-Id").strip()
        return status, raw, _header(reply_headers, "Content-Type")

    def _request(self, method: str, params: dict[str, Any], *, initialized: bool = True) -> Any:
        self._next_id += 1
        ident = self._next_id
        message = {"jsonrpc": "2.0", "id": ident, "method": method, "params": params}
        status, raw, content_type = self._post(message, initialized=initialized)
        if not 200 <= status < 300:
            raise self._fail(
                f"MCP server {self.server.id!r} answered {method} with HTTP {status}",
                status=status,
            )
        text = raw.decode("utf-8", errors="replace")
        if "text/event-stream" in content_type.lower():
            candidates = _sse_messages(text)
        else:
            try:
                candidates = [json.loads(text)]
            except json.JSONDecodeError:
                candidates = []
        reply = next((m for m in candidates if isinstance(m, dict) and m.get("id") == ident), None)
        if reply is None:
            raise self._fail(
                f"MCP server {self.server.id!r} answered {method} with no JSON-RPC response",
                status=status,
            )
        error = reply.get("error")
        if isinstance(error, dict):
            code = error.get("code")
            raise self._fail(
                f"MCP server {self.server.id!r} refused {method} "
                f"(JSON-RPC error {code if isinstance(code, int) else '?'})",
                status=status,
                said=redact(str(error.get("message", ""))[:300], [self.token()]),
            )
        result = reply.get("result")
        if not isinstance(result, dict):
            raise self._fail(
                f"MCP server {self.server.id!r} answered {method} with no result object",
                status=status,
            )
        return result

    def _notify(self, method: str) -> None:
        status, _raw, _ = self._post({"jsonrpc": "2.0", "method": method}, initialized=True)
        if not 200 <= status < 300:
            raise self._fail(
                f"MCP server {self.server.id!r} answered {method} with HTTP {status}",
                status=status,
            )

    # -- the three acts ------------------------------------------------------------------------

    def initialize(self) -> None:
        """The handshake. Sets :attr:`protocol_version` (and the session id, if one is issued)."""
        self.protocol_version = ""
        self.session_id = ""
        result = self._request(
            "initialize",
            {
                "protocolVersion": PROTOCOL_VERSIONS[0],
                "capabilities": {},
                "clientInfo": CLIENT_INFO,
            },
            initialized=False,
        )
        version = result.get("protocolVersion")
        if version not in PROTOCOL_VERSIONS:
            raise self._fail(
                f"MCP server {self.server.id!r} speaks protocol {str(version)[:40]!r}; this "
                f"client speaks {', '.join(PROTOCOL_VERSIONS)}"
            )
        self.protocol_version = str(version)
        self._notify("notifications/initialized")

    def _ensure(self) -> None:
        if not self.protocol_version:
            self.initialize()

    def list_tools(self) -> list[dict[str, Any]]:
        """Every tool the server lists, after a fresh handshake."""
        self.initialize()
        tools: list[dict[str, Any]] = []
        cursor: str | None = None
        for _ in range(MAX_PAGES):
            params: dict[str, Any] = {"cursor": cursor} if cursor else {}
            result = self._request("tools/list", params)
            page = result.get("tools")
            if not isinstance(page, list):
                raise self._fail(f"MCP server {self.server.id!r} listed no tools array")
            tools.extend(t for t in page if isinstance(t, dict))
            nxt = result.get("nextCursor")
            if not isinstance(nxt, str) or not nxt:
                return tools
            cursor = nxt
        raise self._fail(
            f"MCP server {self.server.id!r} listed more than {MAX_PAGES} pages of tools"
        )

    def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        """One ``tools/call``; the result object as the server sent it.

        A server that issued a session and now answers 404 has ended it (MCP Streamable HTTP):
        the handshake is made again once and the call sent once more.
        """
        self._ensure()
        params = {"name": name, "arguments": arguments}
        try:
            result: dict[str, Any] = self._request("tools/call", params)
        except McpError as exc:
            if exc.status != 404 or not self.session_id:
                raise
            self.initialize()
            result = self._request("tools/call", params)
        return result

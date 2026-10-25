"""One MCP server as a :class:`~athena.connectors.port.ConnectorPort` (README §4; ADR 0144).

The catalog merges an :class:`McpService` with :meth:`Catalog.merge_connector` exactly as it merges
a vault connector, so its tools are ``connector.<id>.<tool>`` under the origin ``connector:<id>``
and are classed by the catalog from the flags :mod:`~athena.connectors.mcp.annotations` derived.
There is no new origin kind and no second gate: this module never decides a class.

1. **Listing.** :meth:`refresh` asks the server for its tools: at daemon start, and — while the
   port holds no tools — again when a turn starts, at most once every :data:`RELIST_S`, so a
   server that booted after the daemon is picked up by the next turn. A server that listed its
   tools is not asked again: Athena's MCP servers do not announce ``listChanged``.
2. **Liveness.** A server is live while its token variable is set (:meth:`is_live`); policy rule 4
   asks this on every call, so unsetting the variable refuses the next call.
3. **Results.** A call's answer reaches the model as the server's ``structuredContent`` as JSON
   (or its text content when there is none), capped at the connector cap with the cut announced
   and wrapped in the nonce fence labelled with the server id, like a connector read. A result
   with ``isError: true`` is a failure carrying that same fenced text.
4. **Errors.** Anything that kept the call from an answer — the server unreachable, a non-2xx
   status, a protocol refusal — is ``engine_error`` with a sentence naming the server id and the
   HTTP status. No sentence, log record, event or view holds the token.
5. **Health.** ``unknown`` until the server is first reached, ``healthy`` after an answer,
   ``broken`` with the reason after a failure — the server's state, not a credential verdict.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from collections.abc import Callable, Mapping, Sequence
from typing import Any
from urllib.parse import urlsplit

from athena.connectors.mcp.annotations import host_tool
from athena.connectors.mcp.client import McpClient, McpError
from athena.connectors.mcp.config import McpConfig, McpServer
from athena.connectors.service import CONNECTOR_TIER, read_result
from athena.connectors.vault import Transport, redact
from athena.contracts.manifest import HostTool
from athena.contracts.registry import ExecResult

__all__ = ["RELIST_S", "McpService", "services_for_config"]

log = logging.getLogger(__name__)

#: The fewest seconds between two listings of a server that holds no tools.
RELIST_S = 30.0


def _shown_url(url: str) -> str:
    """The URL a view may show: scheme, host, port and path; never a query or a fragment."""
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}{parts.path}"


def result_text(result: Mapping[str, Any]) -> str:
    """What the model reads of one ``tools/call`` result: ``structuredContent`` as JSON when the
    server sent it, else the text of every ``text`` content item."""
    structured = result.get("structuredContent")
    if structured is not None:
        return json.dumps(structured, ensure_ascii=False, sort_keys=True)
    content = result.get("content")
    parts: list[str] = []
    if isinstance(content, list):
        for item in content:
            if isinstance(item, Mapping) and item.get("type") == "text":
                parts.append(str(item.get("text", "")))
            elif isinstance(item, Mapping):
                parts.append(f"[{str(item.get('type', 'content'))[:40]} content omitted]")
    return "\n".join(parts)


class McpService:
    """The port over one configured server. Thread-safe: a view may read while a turn calls."""

    def __init__(
        self,
        server: McpServer,
        *,
        transport: Transport | None = None,
        environ: Mapping[str, str] | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.server = server
        self.client = McpClient(server, transport=transport, environ=environ)
        self.clock = clock
        self._lock = threading.RLock()
        self._tools: list[HostTool] = []
        self._listed_at: float | None = None
        self.health = "unknown"
        self.health_detail = ""

    @property
    def id(self) -> str:
        return self.server.id

    # -- liveness (policy rule 4) -----------------------------------------------------------------

    def is_live(self, connector_id: str | None = None) -> bool:
        """Live while the token variable is set. ``connector_id`` is the port's shape and must be
        this server's id when given."""
        if connector_id is not None and connector_id != self.server.id:
            return False
        return bool(self.client.token())

    # -- listing ----------------------------------------------------------------------------------

    def _mark(self, health: str, detail: str = "") -> None:
        self.health = health
        self.health_detail = redact(detail, [self.client.token()])

    def refresh(self) -> bool:
        """List the server's tools now. ``True`` when it answered with a list this port holds."""
        with self._lock:
            self._listed_at = self.clock()
            if not self.is_live():
                self._tools = []
                self._mark("unknown", f"{self.server.token_env} is not set")
                return False
            try:
                tools = [host_tool(raw) for raw in self.client.list_tools()]
            except (McpError, ValueError) as exc:
                self._tools = []
                self._mark("broken", str(exc))
                log.warning("MCP server %s: tools/list failed: %s", self.id, self.health_detail)
                return False
            self._tools = tools
            self._mark("healthy")
            return True

    def refused(self, reason: str) -> None:
        """The catalog refused the listing whole: hold nothing, say why, list again later."""
        with self._lock:
            self._tools = []
            self._mark("broken", reason)
            log.warning("MCP server %s: the catalog refused its tools: %s", self.id, reason)

    def due(self) -> bool:
        """Whether a turn starting now should list again: no tools held, and the last listing at
        least :data:`RELIST_S` ago."""
        with self._lock:
            if self._tools:
                return False
            return self._listed_at is None or self.clock() - self._listed_at >= RELIST_S

    def list_tools(self) -> Sequence[HostTool]:
        with self._lock:
            return list(self._tools) if self.is_live() else []

    # -- calling ----------------------------------------------------------------------------------

    def call(self, name: str, params: dict[str, Any]) -> ExecResult:
        with self._lock:
            if not any(tool.name == name for tool in self._tools):
                return ExecResult.failure(
                    "unknown_ref",
                    f"MCP server {self.id!r} has no tool {name!r}",
                    tier=CONNECTOR_TIER,
                )
            try:
                result = self.client.call_tool(name, params)
            except McpError as exc:
                self._mark("broken", str(exc))
                log.warning("MCP server %s: %s failed: %s", self.id, name, self.health_detail)
                said = "\n" + read_result(exc.said, self.id) if exc.said else ""
                return ExecResult.failure(
                    "engine_error", self.health_detail + said, tier=CONNECTOR_TIER
                )
            self._mark("healthy")
            text = read_result(result_text(result), self.id)
            if result.get("isError") is True:
                return ExecResult.failure("engine_error", text, tier=CONNECTOR_TIER)
            return ExecResult(ok=True, output=text, tier=CONNECTOR_TIER)

    # -- the view (GET /connectors) ---------------------------------------------------------------

    def view(self) -> dict[str, Any]:
        """What a surface may see. The variable's name and whether it is set; never its value."""
        with self._lock:
            return {
                "id": self.id,
                "origin": self.server.origin,
                "kind": "mcp",
                "url": _shown_url(self.server.url),
                "token_env": self.server.token_env,
                "token_set": self.is_live(),
                "live": self.is_live(),
                "health": self.health,
                "health_detail": self.health_detail,
                "tools": [
                    {"name": f"connector.{self.id}.{t.name}", "class": t.default_class().value}
                    for t in self._tools
                ],
            }


def services_for_config(
    config: McpConfig,
    *,
    transport: Transport | None = None,
    environ: Mapping[str, str] | None = None,
) -> dict[str, McpService]:
    """One service per configured server, in file order."""
    return {
        server.id: McpService(server, transport=transport, environ=environ)
        for server in config.servers
    }

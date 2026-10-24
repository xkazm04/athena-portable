"""MCP servers as connector ports: an external server's tools in the catalog (README §4; ADR 0123).

- :mod:`athena.connectors.mcp.config` — ``ATHENA_HOME/mcp.json``: which servers, where, and which
  environment variable holds each one's token.
- :mod:`athena.connectors.mcp.annotations` — MCP tool annotations as the manifest flags the
  catalog classes by.
- :mod:`athena.connectors.mcp.client` — the stdlib Streamable HTTP client: initialize, tools/list,
  tools/call.
- :mod:`athena.connectors.mcp.service` — :class:`McpService`, the
  :class:`~athena.connectors.port.ConnectorPort` over one server.
"""

from athena.connectors.mcp.annotations import flags_for, host_tool
from athena.connectors.mcp.client import PROTOCOL_VERSIONS, McpClient, McpError
from athena.connectors.mcp.config import (
    CONFIG_FILENAME,
    McpConfig,
    McpConfigError,
    McpServer,
    load_config,
    parse_config,
)
from athena.connectors.mcp.service import RELIST_S, McpService, services_for_config

__all__ = [
    "CONFIG_FILENAME",
    "PROTOCOL_VERSIONS",
    "RELIST_S",
    "McpClient",
    "McpConfig",
    "McpConfigError",
    "McpError",
    "McpServer",
    "McpService",
    "flags_for",
    "host_tool",
    "load_config",
    "parse_config",
    "services_for_config",
]

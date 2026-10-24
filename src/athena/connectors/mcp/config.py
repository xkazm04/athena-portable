"""The MCP servers this Athena may list and call: ``ATHENA_HOME/mcp.json`` (README §4; ADR 0123).

One file, one shape::

    {"servers": [{"id": "gravitone", "url": "http://localhost:3150/api/mcp",
                  "token_env": "GRAVITONE_MCP_TOKEN"}]}

The file holds no secret and is refused if it tries to: ``token_env`` *names* the environment
variable the bearer token is read from at call time, and a server object with any other key is
refused whole, so a pasted ``"token": "gt_..."`` never becomes a configuration Athena accepted. An
absent file is no MCP servers at all; a file that is present and wrong stops ``athena serve`` on
its failure line, with the field named and never the field's value, because a mistyped value may
be the token itself.

The URL rule is the page rule's (ADR 0119), read off the parsed URL and never off a prefix:
``https`` with a host, or plain ``http`` only on this machine's loopback names (``localhost``,
``127.0.0.1``, ``[::1]``), so a bearer token never rides plain text across a network.
"""

from __future__ import annotations

import json
import re
from collections.abc import Collection
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

__all__ = [
    "CONFIG_FILENAME",
    "LOOPBACK_HOSTS",
    "MAX_SERVERS",
    "McpConfig",
    "McpConfigError",
    "McpServer",
    "load_config",
    "parse_config",
]

#: The file's name under ``ATHENA_HOME``.
CONFIG_FILENAME = "mcp.json"

#: The hosts plain ``http`` is admitted on, as ``urlsplit(...).hostname`` spells them.
LOOPBACK_HOSTS: frozenset[str] = frozenset({"localhost", "127.0.0.1", "::1"})

#: More servers than this is a configuration nobody reads; every one is a dial at start.
MAX_SERVERS = 16

#: The id rule is the fence label's and the origin id's: it becomes ``connector:<id>``, the
#: namespace ``connector.<id>.<tool>`` and the fence label of every result.
_ID = re.compile(r"[a-z][a-z0-9_-]{0,31}\Z")
#: A portable environment variable name.
_ENV = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,127}\Z")
_KEYS = frozenset({"id", "url", "token_env"})


class McpConfigError(ValueError):
    """``mcp.json`` is present and not acceptable. The sentence names the field, never its value."""


@dataclass(frozen=True)
class McpServer:
    """One configured MCP server. Nothing here is or holds a credential."""

    id: str
    url: str
    #: The environment variable the bearer token is read from, at call time.
    token_env: str

    @property
    def origin(self) -> str:
        return f"connector:{self.id}"


@dataclass(frozen=True)
class McpConfig:
    """Every configured server, in file order, and the file they came from (``""`` for none)."""

    servers: tuple[McpServer, ...] = ()
    path: str = ""


def url_admitted(url: str) -> bool:
    """``https`` with a host, or ``http`` on a loopback name; no credentials in the URL."""
    try:
        parts = urlsplit(url)
        _ = parts.port
    except ValueError:
        return False
    if parts.username is not None or parts.password is not None or not parts.hostname:
        return False
    if parts.scheme == "https":
        return True
    return parts.scheme == "http" and parts.hostname in LOOPBACK_HOSTS


def _server(index: int, raw: Any, reserved: Collection[str]) -> McpServer:
    where = f"servers[{index}]"
    if not isinstance(raw, dict):
        raise McpConfigError(f"mcp.json: {where} must be an object")
    extra = sorted(str(key) for key in raw if key not in _KEYS)
    if extra:
        raise McpConfigError(
            f"mcp.json: {where} has unknown field(s) {', '.join(extra)}; a server is id, url and "
            "token_env, and the token itself is never written here"
        )
    ident = raw.get("id")
    if not isinstance(ident, str) or not _ID.match(ident):
        raise McpConfigError(f"mcp.json: {where}.id must match ^[a-z][a-z0-9_-]{{0,31}}$")
    if ident in reserved:
        raise McpConfigError(f"mcp.json: {where}.id {ident!r} is a built-in connector's id")
    url = raw.get("url")
    if not isinstance(url, str) or not url_admitted(url):
        raise McpConfigError(
            f"mcp.json: {where}.url must be https, or http only on localhost, 127.0.0.1 or "
            "[::1], with no credentials in it"
        )
    token_env = raw.get("token_env")
    if token_env is None:
        raise McpConfigError(f"mcp.json: {where}.token_env is missing")
    if not isinstance(token_env, str) or not _ENV.match(token_env):
        raise McpConfigError(f"mcp.json: {where}.token_env must name an environment variable")
    return McpServer(id=ident, url=url, token_env=token_env)


def parse_config(data: Any, *, path: str = "", reserved: Collection[str] = ()) -> McpConfig:
    """Validate a decoded ``mcp.json``. ``reserved`` holds the ids no MCP server may take."""
    if not isinstance(data, dict):
        raise McpConfigError("mcp.json must be an object with a servers list")
    extra = sorted(str(key) for key in data if key != "servers")
    if extra:
        raise McpConfigError(f"mcp.json has unknown field(s) {', '.join(extra)}")
    raw = data.get("servers", [])
    if not isinstance(raw, list):
        raise McpConfigError("mcp.json: servers must be a list")
    if len(raw) > MAX_SERVERS:
        raise McpConfigError(f"mcp.json: servers lists {len(raw)}; the most is {MAX_SERVERS}")
    servers: list[McpServer] = []
    for index, item in enumerate(raw):
        server = _server(index, item, reserved)
        if any(s.id == server.id for s in servers):
            raise McpConfigError(f"mcp.json: servers[{index}].id {server.id!r} is listed twice")
        servers.append(server)
    return McpConfig(servers=tuple(servers), path=path)


def load_config(
    path: str | Path, *, required: bool = False, reserved: Collection[str] = ()
) -> McpConfig:
    """Read and validate ``path``. Absent is no servers unless ``required`` (an explicit flag)."""
    file = Path(path)
    if not file.exists():
        if required:
            raise McpConfigError(f"mcp.json: no file at {file}")
        return McpConfig()
    try:
        data = json.loads(file.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError) as exc:
        raise McpConfigError(
            f"mcp.json at {file} could not be read: {type(exc).__name__}"
        ) from None
    except json.JSONDecodeError as exc:
        # The position only: the decoder's message can quote the document.
        raise McpConfigError(
            f"mcp.json at {file} is not JSON (line {exc.lineno}, column {exc.colno})"
        ) from None
    return parse_config(data, path=str(file), reserved=reserved)

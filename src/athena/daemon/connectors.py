"""The connector routes: what is connected, and the acts that change it (README §4; ADR 0021).

``GET /connectors``
    Every spec with its connection record: status, identity, the switches, the last probe with
    its age, the setup guide, the tools it yields. ``records_notice`` is empty, or says in plain
    words that the connections file could not be read and where its bytes were kept. Nothing here
    is or names a credential; the record has no such field to leak. ``mcp_servers`` lists each
    configured MCP server (ADR 0144): its id, origin, URL, token variable's name and whether it is
    set, health (``healthy``, ``broken`` or ``unknown``) and tools. With no vault
    (``--no-connectors``) and an MCP server configured, this route still answers, with no
    ``connectors`` and the servers alone.

``POST /connectors/<id>/connect``
    ``{"token": "..."}`` for a pasted-token service, or ``{"client_id": "...",
    "client_secret": "..."}`` for an OAuth one, which starts the consent flow and answers with
    its authorize URL. The daemon opens the browser itself unless ``"open_browser": false``.
    ``{"reuse_client": true}`` with no pasted pair reconnects with the client the vault sealed at
    the last connect (ADR 0117): no client value comes in or goes out, so that flow's authorize
    URL is left out of every answer, and a connector with no kept client is a 409 asking for the
    client id. A pasted pair always wins. Each view says ``client_kept``, a yes or a no.

``POST /connectors/<id>/flow``
    Where the consent flow stands: ``awaiting_consent``, ``exchanging``, ``done`` or ``failed``
    with its detail. A surface polls this after ``connect``.

``POST /connectors/<id>/disconnect``, ``.../probe``, ``.../settings``
    Revoke and destroy; re-check the credential; ``{"enabled", "writes_enabled", "allowlist"}``,
    the two switches JSON booleans (anything else is a 409 and changes nothing).

Every write here takes the writer lock and re-merges the connector's tools into the catalog, so
a connect is visible to the very next turn and a disconnect refuses the very next call. An OAuth
connect admits later, on the flow's own thread; the vault takes the same lock around that
admission (``guard``), so its re-merge never lands beside a running turn either.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import TYPE_CHECKING, Any

from athena.connectors.mcp.service import McpService
from athena.connectors.vault import Vault, VaultError
from athena.daemon.routes import Reply, Request, Route, error

if TYPE_CHECKING:
    from athena.daemon.server import AthenaDaemon

__all__ = ["CONNECTOR_PREFIX", "connector_act", "connector_routes", "connectors"]

CONNECTOR_PREFIX = "/connectors/"
ACTS: tuple[str, ...] = ("connect", "flow", "disconnect", "probe", "settings")


def connectors(daemon: AthenaDaemon, vault: Vault | None, mcp: Sequence[McpService] = ()) -> Reply:
    specs = len(vault.specs) if vault is not None else 0
    return 200, {
        "ok": True,
        "connectors": vault.views() if vault is not None else [],
        "records_notice": vault.records_notice if vault is not None else "",
        "mcp_servers": [service.view() for service in mcp],
        "showing": specs,
        "total": specs,
        "footer": "",
    }


def connector_act(daemon: AthenaDaemon, vault: Vault, request: Request, tail: str) -> Reply:
    connector_id, _, act = tail.partition("/")
    if connector_id not in vault.specs:
        return error(404, "unknown_ref", f"no connector {connector_id!r}")
    if act not in ACTS:
        return error(404, "unknown", f"no act {act!r}; one of {', '.join(ACTS)}")
    body = request.body
    try:
        if act == "connect":
            return _connect(daemon, vault, connector_id, body)
        if act == "flow":
            flow = vault.flows.for_connector(connector_id)
            return 200, {
                "ok": True,
                "flow": flow.view() if flow else None,
                "connector": vault.view(connector_id),
            }
        with daemon.writing():
            if act == "disconnect":
                vault.disconnect(connector_id)
            elif act == "probe":
                vault.probe(connector_id)
            else:
                _settings(vault, connector_id, body)
    except VaultError as exc:
        return error(409, "validator_failed", str(exc))
    return 200, {"ok": True, "connector": vault.view(connector_id)}


def _connect(daemon: AthenaDaemon, vault: Vault, connector_id: str, body: Any) -> Reply:
    spec = vault.spec(connector_id)
    if spec.auth.type == "token":
        token = str(body.get("token", ""))
        with daemon.writing():
            vault.connect_token(connector_id, token)
        return 200, {"ok": True, "connector": vault.view(connector_id)}
    flow = vault.connect_oauth(
        connector_id,
        client_id=str(body.get("client_id", "")),
        client_secret=str(body.get("client_secret", "")),
        open_browser=bool(body.get("open_browser", True)),
        reuse_client=body.get("reuse_client") is True,
        guard=daemon.writing,
    )
    return 200, {"ok": True, "flow": flow.view(), "connector": vault.view(connector_id)}


def _switch(body: Any, key: str) -> bool | None:
    """A switch is JSON ``true`` or ``false``, nothing else: ``bool("false")`` is ``True``, and a
    sloppy client must not turn writes on by saying no."""
    if key not in body:
        return None
    value = body[key]
    if not isinstance(value, bool):
        raise VaultError(f"{key} must be true or false, got {value!r}")
    return value


def _settings(vault: Vault, connector_id: str, body: Any) -> None:
    # Every switch is read before any is set, so a refused body changes nothing.
    enabled, writes = _switch(body, "enabled"), _switch(body, "writes_enabled")
    if enabled is not None:
        vault.set_enabled(connector_id, enabled)
    if writes is not None:
        vault.set_writes(connector_id, writes)
    if "allowlist" in body:
        raw = body["allowlist"]
        values = (
            [str(v) for v in raw]
            if isinstance(raw, list)
            else str(raw).replace("\n", ",").split(",")
        )
        vault.set_allowlist(connector_id, values)


def connector_routes(
    daemon: AthenaDaemon, vault: Vault | None, mcp: Sequence[McpService] = ()
) -> list[Route]:
    """The two routes, exact before prefix, for :meth:`RouteTable.add`; with no vault, the
    listing alone (it then lists only the MCP servers)."""
    listing = Route("GET", "/connectors", lambda request: connectors(daemon, vault, mcp))
    if vault is None:
        return [listing]
    return [
        listing,
        Route(
            "POST",
            CONNECTOR_PREFIX,
            lambda request: connector_act(
                daemon, vault, request, request.path[len(CONNECTOR_PREFIX) :]
            ),
            prefix=True,
        ),
    ]

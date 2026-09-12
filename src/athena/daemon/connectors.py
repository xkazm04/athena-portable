"""The connector routes: what is connected, and the acts that change it (README §4; ADR 0021).

``GET /connectors``
    Every spec with its connection record: status, identity, the switches, the last probe with
    its age, the setup guide, the tools it yields. Nothing here is or names a credential; the
    record has no such field to leak.

``POST /connectors/<id>/connect``
    ``{"token": "..."}`` for a pasted-token service, or ``{"client_id": "...",
    "client_secret": "..."}`` for an OAuth one, which starts the consent flow and answers with
    its authorize URL. The daemon opens the browser itself unless ``"open_browser": false``.

``POST /connectors/<id>/flow``
    Where the consent flow stands: ``awaiting_consent``, ``exchanging``, ``done`` or ``failed``
    with its detail. A surface polls this after ``connect``.

``POST /connectors/<id>/disconnect``, ``.../probe``, ``.../settings``
    Revoke and destroy; re-check the credential; ``{"enabled", "writes_enabled", "allowlist"}``.

Every write here takes the writer lock and re-merges the connector's tools into the catalog, so
a connect is visible to the very next turn and a disconnect refuses the very next call.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from athena.connectors.vault import Vault, VaultError
from athena.daemon.routes import Reply, Request, Route, error

if TYPE_CHECKING:
    from athena.daemon.server import AthenaDaemon

__all__ = ["CONNECTOR_PREFIX", "connector_act", "connector_routes", "connectors"]

CONNECTOR_PREFIX = "/connectors/"
ACTS: tuple[str, ...] = ("connect", "flow", "disconnect", "probe", "settings")


def connectors(daemon: AthenaDaemon, vault: Vault) -> Reply:
    return 200, {
        "ok": True,
        "connectors": vault.views(),
        "showing": len(vault.specs),
        "total": len(vault.specs),
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
    )
    return 200, {"ok": True, "flow": flow.view(), "connector": vault.view(connector_id)}


def _settings(vault: Vault, connector_id: str, body: Any) -> None:
    if "enabled" in body:
        vault.set_enabled(connector_id, bool(body["enabled"]))
    if "writes_enabled" in body:
        vault.set_writes(connector_id, bool(body["writes_enabled"]))
    if "allowlist" in body:
        raw = body["allowlist"]
        values = (
            [str(v) for v in raw]
            if isinstance(raw, list)
            else str(raw).replace("\n", ",").split(",")
        )
        vault.set_allowlist(connector_id, values)


def connector_routes(daemon: AthenaDaemon, vault: Vault) -> list[Route]:
    """The two routes, exact before prefix, for :meth:`RouteTable.add`."""
    return [
        Route("GET", "/connectors", lambda request: connectors(daemon, vault)),
        Route(
            "POST",
            CONNECTOR_PREFIX,
            lambda request: connector_act(
                daemon, vault, request, request.path[len(CONNECTOR_PREFIX) :]
            ),
            prefix=True,
        ),
    ]

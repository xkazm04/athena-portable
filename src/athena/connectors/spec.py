"""A connector is data: one JSON spec per service (README §4; ADR 0021).

The spec declares everything the daemon needs to know about a service before a credential
exists: how a credential is acquired, the hosts the broker will ever dial, the probe that admits
a credential, what its write allow-list is a list *of*, and the intent-shaped tools it yields.
The tools are declared in the same shape a page's manifest carries — ``name``, ``description``,
``params_schema``, ``reversible``, ``side_effects`` — so a connector enters the catalog through
:meth:`~athena.core.catalog.Catalog.merge_connector` exactly as a page does, and the class of
each tool is the catalog's decision, never the spec's.

The parser is partial and typed: unknown keys are ignored so a newer spec still loads, and a
malformed required field refuses the whole spec (:class:`SpecError`) rather than producing half a
connector the gate would have to guess about.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from athena.contracts.manifest import HostTool

__all__ = [
    "AUTH_TYPES",
    "BUILTIN_DIR",
    "EGRESS_KINDS",
    "AuthSpec",
    "ConnectorSpec",
    "ProbeSpec",
    "SpecError",
    "ToolSpec",
    "load_builtin",
    "load_spec",
    "parse_spec",
]

BUILTIN_DIR = Path(__file__).resolve().parent / "builtin"

#: What a connector's write allow-list is a list of. ``none`` means it has no write tools.
EGRESS_KINDS: tuple[str, ...] = ("recipients", "resources", "none")
AUTH_TYPES: tuple[str, ...] = ("token", "oauth")


class SpecError(ValueError):
    """A spec refused whole. Never a partially loaded connector."""


def _str(data: Mapping[str, Any], key: str, where: str, *, required: bool = True) -> str:
    value = data.get(key)
    if value is None and not required:
        return ""
    if not isinstance(value, str) or not value.strip():
        raise SpecError(f"{where}: {key!r} must be a non-empty string, got {value!r}")
    return value


def _str_list(data: Mapping[str, Any], key: str, where: str) -> tuple[str, ...]:
    value = data.get(key, [])
    if not isinstance(value, list) or not all(isinstance(v, str) and v for v in value):
        raise SpecError(f"{where}: {key!r} must be a list of non-empty strings, got {value!r}")
    return tuple(value)


def _str_map(data: Mapping[str, Any], key: str, where: str) -> dict[str, str]:
    value = data.get(key, {})
    if not isinstance(value, dict) or not all(
        isinstance(k, str) and isinstance(v, str) for k, v in value.items()
    ):
        raise SpecError(f"{where}: {key!r} must map strings to strings, got {value!r}")
    return dict(value)


@dataclass(frozen=True)
class AuthSpec:
    """How a credential is acquired. A pasted token, or a delegated grant over OAuth."""

    type: str
    #: For ``token``: the header the token rides in and the scheme in front of it.
    header: str = "Authorization"
    scheme: str = "Bearer"
    extra_headers: dict[str, str] = field(default_factory=dict)
    #: For ``oauth``: the endpoints and the scopes. The client is the user's own (README §4:
    #: a tool distributed as source cannot keep a client secret).
    authorize_url: str = ""
    token_url: str = ""
    revoke_url: str = ""
    pkce: bool = True
    scopes: tuple[str, ...] = ()
    extra_auth_params: dict[str, str] = field(default_factory=dict)
    #: What the user has to do, as markdown, shown by the surface and never by the model.
    guide: str = ""

    def credential_header(self, token: str) -> tuple[str, str]:
        """Where a credential goes on a request. The scheme is a prefix; empty means bare."""
        value = f"{self.scheme} {token}" if self.scheme else token
        return self.header, value


@dataclass(frozen=True)
class ProbeSpec:
    """The one request that admits a credential: it must answer 2xx, and names the identity."""

    method: str
    url: str
    identity_field: str = ""


@dataclass(frozen=True)
class ToolSpec:
    """One tool, in the manifest's shape plus what the egress gate needs to know."""

    tool: HostTool
    #: The parameters whose values the write allow-list is checked against.
    egress_params: tuple[str, ...] = ()

    @property
    def name(self) -> str:
        return self.tool.name


@dataclass(frozen=True)
class ConnectorSpec:
    id: str
    label: str
    description: str
    auth: AuthSpec
    api_hosts: tuple[str, ...]
    probe: ProbeSpec
    egress: str
    tools: tuple[ToolSpec, ...]

    @property
    def origin(self) -> str:
        return f"connector:{self.id}"

    def tool(self, name: str) -> ToolSpec | None:
        return next((t for t in self.tools if t.name == name), None)

    def view(self) -> dict[str, Any]:
        """What a surface may see of a spec. Nothing here is or names a credential."""
        return {
            "id": self.id,
            "label": self.label,
            "description": self.description,
            "auth": self.auth.type,
            "guide": self.auth.guide,
            "api_hosts": list(self.api_hosts),
            "egress": self.egress,
            "tools": [
                {
                    "name": t.name,
                    "description": t.tool.description,
                    "reversible": t.tool.reversible,
                    "side_effects": t.tool.side_effects,
                }
                for t in self.tools
            ],
        }


def parse_spec(data: Mapping[str, Any]) -> ConnectorSpec:
    where = f"connector {data.get('id', '?')!r}"
    spec_id = _str(data, "id", where)
    if not spec_id.replace("_", "").isalnum() or spec_id != spec_id.lower():
        raise SpecError(f"{where}: id must be a lowercase slug")

    raw_auth = data.get("auth")
    if not isinstance(raw_auth, Mapping):
        raise SpecError(f"{where}: 'auth' must be an object")
    auth_type = _str(raw_auth, "type", f"{where} auth")
    if auth_type not in AUTH_TYPES:
        raise SpecError(f"{where}: auth type {auth_type!r} is not one of {AUTH_TYPES}")
    auth = AuthSpec(
        type=auth_type,
        header=_str(raw_auth, "header", where, required=False) or "Authorization",
        scheme=str(raw_auth.get("scheme", "Bearer")),
        extra_headers=_str_map(raw_auth, "extra_headers", where),
        authorize_url=_str(raw_auth, "authorize_url", where, required=auth_type == "oauth"),
        token_url=_str(raw_auth, "token_url", where, required=auth_type == "oauth"),
        revoke_url=_str(raw_auth, "revoke_url", where, required=False),
        pkce=bool(raw_auth.get("pkce", True)),
        scopes=_str_list(raw_auth, "scopes", where),
        extra_auth_params=_str_map(raw_auth, "extra_auth_params", where),
        guide=str(raw_auth.get("guide", "")),
    )

    raw_probe = data.get("probe")
    if not isinstance(raw_probe, Mapping):
        raise SpecError(f"{where}: 'probe' must be an object")
    probe = ProbeSpec(
        method=_str(raw_probe, "method", where).upper(),
        url=_str(raw_probe, "url", where),
        identity_field=_str(raw_probe, "identity_field", where, required=False),
    )

    hosts = _str_list(data, "api_hosts", where)
    if not hosts:
        raise SpecError(f"{where}: 'api_hosts' must name at least one host")
    egress = str(data.get("egress", "none"))
    if egress not in EGRESS_KINDS:
        raise SpecError(f"{where}: egress {egress!r} is not one of {EGRESS_KINDS}")

    raw_tools = data.get("tools")
    if not isinstance(raw_tools, list) or not raw_tools:
        raise SpecError(f"{where}: 'tools' must be a non-empty list")
    tools: list[ToolSpec] = []
    for raw in raw_tools:
        if not isinstance(raw, Mapping):
            raise SpecError(f"{where}: every tool must be an object")
        egress_params = _str_list(raw, "egress_params", where)
        fields = {k: v for k, v in raw.items() if k != "egress_params"}
        try:
            tool = HostTool.from_dict(dict(fields))
        except (TypeError, ValueError, AttributeError) as exc:
            raise SpecError(f"{where}: tool {raw.get('name')!r}: {exc}") from exc
        tools.append(ToolSpec(tool=tool, egress_params=egress_params))
    if egress == "none" and any(t.egress_params for t in tools):
        raise SpecError(f"{where}: egress is 'none' but a tool names egress_params")

    return ConnectorSpec(
        id=spec_id,
        label=_str(data, "label", where),
        description=_str(data, "description", where, required=False),
        auth=auth,
        api_hosts=hosts,
        probe=probe,
        egress=egress,
        tools=tuple(tools),
    )


def load_spec(path: str | Path) -> ConnectorSpec:
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SpecError(f"{path}: {exc}") from exc
    if not isinstance(data, dict):
        raise SpecError(f"{path}: a spec is a JSON object")
    return parse_spec(data)


def load_builtin(directory: str | Path | None = None) -> dict[str, ConnectorSpec]:
    """Every ``*.json`` under the builtin directory, by id. A bad file refuses the whole load."""
    root = Path(directory) if directory is not None else BUILTIN_DIR
    specs: dict[str, ConnectorSpec] = {}
    for path in sorted(root.glob("*.json")):
        spec = load_spec(path)
        if spec.id in specs:
            raise SpecError(f"{path}: connector {spec.id!r} is declared twice")
        specs[spec.id] = spec
    return specs

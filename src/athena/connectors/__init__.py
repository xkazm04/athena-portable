"""Connectors: third-party services as gated tools, from any surface (README §4; ADR 0021).

A connector is data — one JSON spec per service under ``builtin/`` — that, once a person has
connected it, yields a handful of intent-shaped tools in the catalog under ``connector:<id>``.
Credentials live in one user-level vault under ``ATHENA_HOME/connectors/``, never in a brain, so
a brain stays portable by copying and every surface sees the same connections.

- :mod:`athena.connectors.port` — the :class:`ConnectorPort` seam the catalog merges through.
- :mod:`athena.connectors.spec` — the spec parser and the builtin specs (Gmail, Notion).
- :mod:`athena.connectors.seal` — where a credential rests: the keystore, DPAPI, or a file.
- :mod:`athena.connectors.vault` — the broker: every outbound call, the probe that admits a
  credential, the switches, the record a surface may see.
- :mod:`athena.connectors.oauth` — the delegated grant over a one-shot loopback listener.
- :mod:`athena.connectors.service` — the port over one spec and the vault: registration follows
  connection, the writes switch, the egress gate, fenced and capped reads.
- :mod:`athena.connectors.providers` — the request shapes of each service, pure.

Nothing here decides a class. The catalog derives ``READ`` or ``GATED`` from the spec's own
``reversible`` and ``side_effects`` exactly as it does for a page, and a connector cannot argue
itself out of ``GATED``.
"""

from athena.connectors.port import ConnectorPort
from athena.connectors.seal import SealPort, SealUnavailable, select_seal
from athena.connectors.service import READ_CAP, Service, services_for
from athena.connectors.spec import (
    BUILTIN_DIR,
    AuthSpec,
    ConnectorSpec,
    ProbeSpec,
    SpecError,
    ToolSpec,
    load_builtin,
    load_spec,
    parse_spec,
)
from athena.connectors.vault import (
    ConnectionRecord,
    HostRefused,
    NeedsReauth,
    NotConnected,
    Transport,
    Vault,
    VaultError,
    redact,
)

__all__ = [
    "BUILTIN_DIR",
    "READ_CAP",
    "AuthSpec",
    "ConnectionRecord",
    "ConnectorPort",
    "ConnectorSpec",
    "HostRefused",
    "NeedsReauth",
    "NotConnected",
    "ProbeSpec",
    "SealPort",
    "SealUnavailable",
    "Service",
    "SpecError",
    "ToolSpec",
    "Transport",
    "Vault",
    "VaultError",
    "load_builtin",
    "load_spec",
    "parse_spec",
    "redact",
    "select_seal",
    "services_for",
]

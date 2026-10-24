"""MCP tool annotations as the manifest flags the catalog classes by (README §3.3, §4; ADR 0123).

The catalog decides ``AUTO`` or ``GATED`` from ``reversible`` and ``side_effects`` and from nothing
else (ADR 0004), so an MCP server's tool is classed by translating its MCP annotations into those
two flags, once, here:

=========================================================================  ======================
annotations                                                                flags (class)
=========================================================================  ======================
``readOnlyHint: true``                                                     reversible, ``none``
                                                                           (``AUTO``)
``readOnlyHint`` false or absent, ``destructiveHint: false`` *and*         reversible,
``openWorldHint: false``                                                   ``internal`` (``AUTO``)
anything else: ``destructiveHint: true``, ``openWorldHint: true``, either  irreversible,
left out, or no annotations at all                                         ``external`` (``GATED``)
=========================================================================  ======================

A hint counts only as the JSON boolean it is spelled as: ``"false"`` is not false. MCP's own
defaults are the fail-closed ones (``destructiveHint`` and ``openWorldHint`` default to ``true``),
so a hint left out reads as the dangerous answer. ``idempotentHint`` never loosens a class: a call
that is safe to repeat is not therefore safe to make without a card.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from athena.contracts.manifest import HostTool

__all__ = ["MCP_TRANSPORT", "flags_for", "host_tool"]

#: What :attr:`HostTool.transport` says for a tool that came over MCP. Informational only.
MCP_TRANSPORT = "mcp"


def flags_for(annotations: Any) -> tuple[bool, str]:
    """``(reversible, side_effects)`` for one tool's ``annotations`` object, per the table above."""
    if not isinstance(annotations, Mapping):
        return False, "external"
    if annotations.get("readOnlyHint") is True:
        return True, "none"
    if annotations.get("destructiveHint") is False and annotations.get("openWorldHint") is False:
        return True, "internal"
    return False, "external"


def host_tool(raw: Mapping[str, Any]) -> HostTool:
    """One ``tools/list`` entry as the :class:`HostTool` the catalog merges.

    The name and the input schema are passed through untouched, so the catalog's own door refuses
    a name that is not a slug or a schema it cannot check — the manifest rule, not a second one
    written here. A description falls back to the tool's ``title``. An ``inputSchema`` that is
    not an object raises ``ValueError``: MCP requires one, and reading it as absent would admit
    any parameters.
    """
    reversible, side_effects = flags_for(raw.get("annotations"))
    description = raw.get("description")
    if not isinstance(description, str) or not description.strip():
        title = raw.get("title")
        description = title if isinstance(title, str) else ""
    name = str(raw.get("name", ""))
    schema = raw.get("inputSchema", {})
    if not isinstance(schema, Mapping):
        # Read as "no schema" this would admit any parameters; MCP requires an object here.
        raise ValueError(f"tool {name!r}: inputSchema must be an object")
    return HostTool(
        name=name,
        description=description,
        params_schema=dict(schema),
        reversible=reversible,
        side_effects=side_effects,
        transport=MCP_TRANSPORT,
    )

"""The connector seam: what the catalog needs from a third-party service (README §4).

Connectors themselves are built by another team, in another repository. This build reserves their
seam so the two halves land without a merge fight, and the reservation is one Protocol.

A connector presents its tools as :class:`~athena.contracts.manifest.HostTool` values — the same
shape a page's manifest carries — and the catalog merges them exactly as it merges a page's
manifest: the class is derived from ``reversible`` and ``side_effects``, never from a preference,
so a connector cannot argue itself out of ``GATED`` any more than a page can (ADR 0004).

The one difference from a page is the executor. A page executes its own tools and the lane holds
no executor for them; a connector's tools are executed in the daemon's process by
:meth:`ConnectorPort.call`. The port receives the **bare** tool name — the one it declared in
``list_tools`` — and not the catalog's ``connector.<id>.<name>``: the namespace is the catalog's
business and a connector should never have to reproduce it.

The port brokers; it does not hold. A connector's credentials live in the vault behind it, and
nothing that crosses this seam is, returns or names a secret.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, Protocol, runtime_checkable

from athena.contracts.manifest import HostTool
from athena.contracts.registry import ExecResult

__all__ = ["ConnectorPort"]


@runtime_checkable
class ConnectorPort(Protocol):
    """One connected third-party service, as the catalog sees it.

    Implementations are expected to yield **intent-shaped** tools — "search mail", not nine
    endpoints — because every name here becomes a line in the capability block the model reads.
    """

    def list_tools(self) -> Sequence[HostTool]:
        """The tools this connector offers right now.

        Called at merge time only. A connector that is disconnected or switched off returns
        nothing, so an unusable name is never rendered into the prompt and then refused.
        """
        ...

    def call(self, name: str, params: dict[str, Any]) -> ExecResult:
        """Run one already-gated call and return its bounded result.

        ``name`` is the bare tool name from :meth:`list_tools`. The gate has already classified
        and validated the call; a port that re-decides policy here is a second gate, which is
        exactly what ADR 0004 forbids.
        """
        ...

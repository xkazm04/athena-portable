"""The host capability manifest — a page or a connector describing itself (README §3.3, §4).

A page registers its own tools through the bridge; a connector presents a manifest of the same
shape. Either way the class is derived from the manifest's own flags and never from what the host
would prefer: ``AUTO`` only if the tool is ``reversible`` and its ``side_effects`` are not
``external``, otherwise ``GATED``. A manifest that fails :meth:`HostManifest.validate` is refused
whole — a half-merged manifest is a catalog nobody can reason about.

The three refusals this module is built around: a tool that does not say whether it is
``reversible`` (an omission read permissively is a tool that executes without a card), two
tools with one name, and an empty ``app_id`` (which namespaces every tool as ``host..<tool>``).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from athena.contracts.registry import ToolClass, ToolOrigin, is_origin, parse_origin

__all__ = [
    "HostManifest",
    "HostTool",
    "SideEffects",
    "StateReadable",
    "ToolOrigin",
    "is_origin",
    "parse_origin",
]

#: ``none`` changes nothing; ``internal`` changes state inside the app; ``external`` leaves it —
#: an email sent, a payment made, a webhook fired. Only ``external`` is beyond recall.
SideEffects = Literal["none", "internal", "external"]

SIDE_EFFECTS: tuple[str, ...] = ("none", "internal", "external")


@dataclass(frozen=True)
class StateReadable:
    """A slice of host state Athena may read. Bounded at the source, so the fence stays small."""

    name: str
    schema: dict[str, Any] = field(default_factory=dict)
    max_chars: int | None = None
    max_items: int | None = None


@dataclass
class HostTool:
    """One tool a host declares.

    ``reversible`` is ``None`` until the host says. That is not a style choice: a ``bool`` with a
    default would let a manifest that forgot the flag be read as whichever default we picked, and
    the permissive reading is a tool that executes without a card. :meth:`HostManifest.validate`
    refuses the omission, and :meth:`default_class` treats it as ``GATED`` in the meantime.
    """

    name: str
    description: str = ""
    params_schema: dict[str, Any] = field(default_factory=dict)
    reversible: bool | None = None
    side_effects: str = "internal"
    transport: str = "webmcp"

    def default_class(self) -> ToolClass:
        """``AUTO`` iff reversible and not externally visible; ``GATED`` in every other case."""
        if self.reversible is not True or self.side_effects == "external":
            return ToolClass.GATED
        return ToolClass.AUTO

    def registry_name(self, app_id: str) -> str:
        return f"host.{app_id}.{self.name}"

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> HostTool:
        raw = d.get("reversible")
        return cls(
            name=str(d.get("name", "")),
            description=str(d.get("description", "")),
            params_schema=dict(d.get("params_schema") or d.get("input_schema") or {}),
            reversible=None if raw is None else bool(raw),
            side_effects=str(d.get("side_effects", "internal")),
            transport=str(d.get("transport", "webmcp")),
        )


@dataclass
class HostManifest:
    """What a page (or a connector) sends. ``app_id`` is the slug every tool is namespaced under.

    ``page_origin`` is the web origin the tools belong to (``https://…``); it is what structural
    policy pins a session to. ``registry_origin`` is the catalog's origin string
    (``host:<app_id>``), which is a different thing and is why they are two fields.
    """

    app_id: str
    app_version: str = "0"
    page_origin: str = ""
    generated_at: str = ""
    tools: list[HostTool] = field(default_factory=list)
    state_readables: list[StateReadable] = field(default_factory=list)
    #: ``connector:<id>`` when this manifest came from a connector rather than a page (README §4).
    origin_kind: str = "host"

    @property
    def registry_origin(self) -> str:
        return f"{self.origin_kind}:{self.app_id}"

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> HostManifest:
        return cls(
            app_id=str(d.get("app_id", "")),
            app_version=str(d.get("app_version", "0")),
            page_origin=str(d.get("page_origin", d.get("origin", ""))),
            generated_at=str(d.get("generated_at", "")),
            tools=[HostTool.from_dict(t) for t in d.get("tools", [])],
            state_readables=[
                StateReadable(
                    name=str(r.get("name", "")),
                    schema=dict(r.get("schema") or {}),
                    max_chars=r.get("max_chars"),
                    max_items=r.get("max_items"),
                )
                for r in d.get("state_readables", [])
            ],
            origin_kind=str(d.get("origin_kind", "host")),
        )

    def validate(self) -> list[str]:
        """Every problem with this manifest. An empty list means it may be merged.

        The caller merges all of it or none of it; there is no "merge the good tools".
        """
        problems: list[str] = []

        if not self.app_id.strip():
            problems.append("app_id must not be empty")
        elif not self.app_id.replace("-", "").replace("_", "").isalnum():
            problems.append(f"app_id must be a slug: {self.app_id!r}")
        elif not is_origin(self.registry_origin):
            problems.append(f"origin is not addressable: {self.registry_origin!r}")

        if self.origin_kind not in ("host", "connector"):
            problems.append(f"origin_kind must be 'host' or 'connector': {self.origin_kind!r}")

        if self.origin_kind == "host" and self.page_origin:
            ok = self.page_origin.startswith("https://") or self.page_origin.startswith(
                "http://localhost"
            )
            if not ok:
                problems.append(
                    f"page_origin must be https (or http://localhost): {self.page_origin!r}"
                )

        seen: set[str] = set()
        for tool in self.tools:
            if not tool.name.strip():
                problems.append("a tool has an empty name")
            elif tool.name in seen:
                problems.append(f"duplicate tool {tool.name!r}")
            seen.add(tool.name)

            if tool.reversible is None:
                problems.append(f"tool {tool.name!r} must declare reversible")
            if tool.side_effects not in SIDE_EFFECTS:
                problems.append(
                    f"tool {tool.name!r}: side_effects must be one of {SIDE_EFFECTS}, "
                    f"got {tool.side_effects!r}"
                )

            props = (
                tool.params_schema.get("properties", {})
                if isinstance(tool.params_schema, dict)
                else {}
            )
            for pname, pschema in props.items():
                if not isinstance(pschema, dict):
                    continue
                if pschema.get("type") == "array" and "maxItems" not in pschema:
                    problems.append(f"{tool.name}.{pname}: an array parameter needs maxItems")

        for readable in self.state_readables:
            if readable.max_chars is None and readable.max_items is None:
                problems.append(f"readable {readable.name!r} needs max_chars or max_items")

        return problems

    def is_valid(self) -> bool:
        return not self.validate()

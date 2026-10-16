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
from urllib.parse import urlsplit

from athena.contracts.registry import ToolClass, ToolOrigin, is_origin, parse_origin

__all__ = [
    "HAND_RUNNER",
    "LOOPBACK_PAGE_HOSTS",
    "MAX_PROPERTIES_PER_TOOL",
    "MAX_TOOLS_PER_MANIFEST",
    "HostManifest",
    "HostTool",
    "SideEffects",
    "StateReadable",
    "ToolOrigin",
    "is_origin",
    "page_origin_admitted",
    "params_schema_problems",
    "parse_origin",
]

#: ``none`` changes nothing; ``internal`` changes state inside the app; ``external`` leaves it —
#: an email sent, a payment made, a webhook fired. Only ``external`` is beyond recall.
SideEffects = Literal["none", "internal", "external"]

SIDE_EFFECTS: tuple[str, ...] = ("none", "internal", "external")


#: The most tools one manifest may declare, and the most parameters one tool may take (ADR 0070).
#: Every one of them is a line, or part of a line, in every model call's system prompt, so a
#: manifest past either is refused whole. The largest the repository ships are Ledgerbox at 41
#: tools (32 of its own and the nine hands) and Hirelane's ``search_candidates`` at 8 parameters;
#: each cap stands at more than twice that.
MAX_TOOLS_PER_MANIFEST = 96
MAX_PROPERTIES_PER_TOOL = 24

#: The hosts a page may register from over plain ``http``: this machine, by exact name (ADR 0119).
#: ``apps/desktop/src/lib/manifest.ts`` spells the same list; a parity test holds the two.
LOOPBACK_PAGE_HOSTS: tuple[str, ...] = ("localhost", "127.0.0.1")


def page_origin_admitted(origin: str) -> bool:
    """Whether a page at ``origin`` may register: ``https`` with a host, or ``http`` on loopback.

    Read off the parsed origin, never off a prefix of the string. A prefix test admits
    ``http://localhost.evil.example``: a remote page over plain http, which a network attacker
    can rewrite in transit, is the one class this rule exists to refuse. A port that is not a
    port is refused too, as the browser's own URL parser refuses it.
    """
    try:
        parts = urlsplit(origin)
        _ = parts.port
    except ValueError:
        return False
    if parts.scheme == "https":
        return bool(parts.hostname)
    return parts.scheme == "http" and parts.hostname in LOOPBACK_PAGE_HOSTS


def params_schema_problems(schema: object) -> list[str]:
    """What is wrong with the *shape* of one tool's ``params_schema``; empty when nothing is.

    The render and the gate's validator read ``properties``, ``required`` and each property's
    ``type`` and ``enum`` as the types JSON Schema gives them, so a schema that holds anything
    else there is refused at the door rather than raising in every later render (council
    injection-resistance r1, robustness-2). ``core.validators`` checks the same shape before it
    validates a call, so one that reached a catalog anyway fails closed.
    """
    if not isinstance(schema, dict):
        return [f"params_schema must be an object, got {type(schema).__name__}"]
    problems: list[str] = []
    props = schema.get("properties", {})
    if not isinstance(props, dict):
        problems.append(f"params_schema.properties must be an object, got {type(props).__name__}")
        props = {}
    for name, sub in props.items():
        if not isinstance(name, str):
            problems.append(f"params_schema.properties has a non-string key {name!r}")
            continue
        if not isinstance(sub, dict):
            problems.append(f"params_schema.properties.{name} must be an object")
            continue
        if "enum" in sub and not isinstance(sub["enum"], list):
            problems.append(f"params_schema.properties.{name}.enum must be a list")
        kind = sub.get("type")
        if not (
            kind is None
            or isinstance(kind, str)
            or (isinstance(kind, list) and all(isinstance(k, str) for k in kind))
        ):
            problems.append(
                f"params_schema.properties.{name}.type must be a string or a list of strings"
            )
    required = schema.get("required", [])
    if not isinstance(required, list) or not all(isinstance(r, str) for r in required):
        problems.append("params_schema.required must be a list of strings")
    return problems


#: The one value of a tool's ``runner`` that means "the shell appended this generic hand" (README
#: §3.4 tier 2; ADR 0066). The TypeScript spells it once as ``HAND_RUNNER`` in ``lib/hands.ts``.
#: Only a host manifest's marker is read: a connector is tier 3 whatever it says.
HAND_RUNNER = "shell"


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
    #: ``HAND_RUNNER`` for a hand the shell appended, ``""`` for everything else. It says which
    #: tier the tool is reported at and nothing about its class, which only the flags decide.
    runner: str = ""

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
        # A schema that is not an object is kept as it came, so ``validate`` names it, rather
        # than coerced here into whatever ``dict()`` would make of it.
        schema: Any = d.get("params_schema") or d.get("input_schema") or {}
        return cls(
            name=str(d.get("name", "")),
            description=str(d.get("description", "")),
            params_schema=dict(schema) if isinstance(schema, dict) else schema,
            reversible=None if raw is None else bool(raw),
            side_effects=str(d.get("side_effects", "internal")),
            transport=str(d.get("transport", "webmcp")),
            runner=str(d.get("runner", "")),
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

        if (
            self.origin_kind == "host"
            and self.page_origin
            and not page_origin_admitted(self.page_origin)
        ):
            problems.append(
                "page_origin must be https with a host, or http on "
                f"{' or '.join(LOOPBACK_PAGE_HOSTS)}: {self.page_origin!r}"
            )

        if len(self.tools) > MAX_TOOLS_PER_MANIFEST:
            problems.append(
                f"{len(self.tools)} tools is over the cap of {MAX_TOOLS_PER_MANIFEST} per manifest"
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

            shape = params_schema_problems(tool.params_schema)
            problems.extend(f"tool {tool.name!r}: {problem}" for problem in shape)
            if shape:
                continue
            props = tool.params_schema.get("properties", {})
            if len(props) > MAX_PROPERTIES_PER_TOOL:
                problems.append(
                    f"tool {tool.name!r}: {len(props)} parameters is over the cap of "
                    f"{MAX_PROPERTIES_PER_TOOL} per tool"
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

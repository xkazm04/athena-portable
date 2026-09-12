"""The catalog is the policy — one module owns every allow-list (README §3.3, §3.4; ADR 0004).

Three classes, one gate: ``GATED`` (an approval row and a decision card), ``READ`` (synchronous,
capped, the answer written back as a system episode) and ``AUTO`` (fires, but only once its
validator passes). A model never decides which class something is, and neither does a host: the
class is derived from the manifest's own ``reversible`` and ``side_effects`` flags.

Three registries, one lookup. Athena's own tools are registered once; a page's tools are merged
per origin and replaced wholesale when the page re-registers; a connector's tools are merged the
same way and differ only in carrying an executor (README §4). Keeping them apart is what makes
``drop_origin`` a single ``pop`` and what makes a re-merge atomic — a half-replaced origin is a
gate with a hole in it, and the moment between the two writes is when the hole is reachable.

The prompt's capability section is *generated* from this registry
(:meth:`Catalog.render_capabilities`), so a name the catalog does not hold is a name the model was
never told about, rather than one it is told about and then refused.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

from athena.connectors.port import ConnectorPort
from athena.contracts.harness import PromptBlock
from athena.contracts.manifest import HostManifest, HostTool
from athena.contracts.registry import (
    ExecResult,
    ExecutorFn,
    Lane,
    ToolClass,
    ToolEntry,
    TurnContext,
    ValidationResult,
    parse_origin,
)
from athena.core.validators import all_of, live_sources, schema_validator

__all__ = [
    "READ_CAP",
    "Catalog",
    "CatalogError",
    "CoreServices",
    "build_catalog",
    "core_entries",
]

#: A ``READ`` answer is capped before it becomes a system episode, and announces what it cut
#: (README §3.3).
READ_CAP = 1600

#: A tool name a host or a connector declares. The catalog namespaces it as
#: ``<kind>.<id>.<name>``, so a dot inside the name would make the namespace unparseable to
#: anything that splits on one — and the panel, the ledger and the policy all split on one.
_TOOL_NAME = re.compile(r"[A-Za-z0-9_-]{1,64}\Z")


class CatalogError(ValueError):
    """A registration or a lookup the gate refuses."""


# --- what the core tools need ----------------------------------------------------------------


@dataclass
class CoreServices:
    """The ports Athena's own tools run on. Constructed by ``wiring``; never a provider handle.

    Every field but the first is an executor the memory engine supplies. They are ports and not a
    ``Brain`` handle for one reason: ``core/catalog.py`` states the policy and must not import the
    thing the policy is about. A port left at ``None`` yields a tool that refuses honestly rather
    than one that is missing from the prompt, because a missing name is indistinguishable from a
    name that was never designed.
    """

    #: Answers "are all of these live episode ids?" — the brain's half of README §2 invariant 2.
    sources_alive: Callable[[Sequence[str]], bool]
    recall: ExecutorFn | None = None
    write_fact: ExecutorFn | None = None
    checkpoint: ExecutorFn | None = None
    answer_decision: ExecutorFn | None = None


RECALL_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "query": {"type": "string", "maxLength": 400},
        "limit": {"type": "integer", "minimum": 1, "maximum": 20},
    },
    "required": ["query"],
}

WRITE_FACT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "key": {"type": "string", "maxLength": 120},
        "value": {"type": "string", "maxLength": 4000},
        "scope": {"type": "string", "enum": ["user", "project", "world"]},
        "sources": {
            "type": "array",
            "items": {"type": "string", "maxLength": 64},
            "minItems": 1,
            "maxItems": 12,
        },
        "confidence": {"type": "number", "minimum": 0.0, "maximum": 1.0},
    },
    "required": ["key", "value", "sources"],
}

CHECKPOINT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"text": {"type": "string", "maxLength": 2000}},
    "required": ["text"],
}

ANSWER_DECISION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "id": {"type": "string", "maxLength": 64},
        "choice": {"type": "string", "maxLength": 64},
    },
    "required": ["id", "choice"],
}


def _unattached(name: str) -> ExecutorFn:
    """The executor of a core tool whose service was never wired in."""

    def _refuse(params: dict[str, Any], ctx: TurnContext) -> ExecResult:
        return ExecResult.failure("unknown", f"{name}: no service is attached to this catalog")

    return _refuse


def core_entries(services: CoreServices) -> list[ToolEntry]:
    """Athena's own four names (README §3.2, §3.3).

    ``write_fact`` is ``GATED`` and not ``AUTO`` because a fact is what the record in act 4 of the
    demo is made of: it outlives the turn, and nothing that outlives a turn is written without the
    user seeing a card. Its validator carries the provenance rule as well as the schema, so a
    write with dead sources is refused *before* a card is filed rather than after the user
    approves one.

    It keeps an executor even though the browser lane never runs a gated one during a turn: the
    lane emits ``decision.requested`` and the executor runs later, when the daemon replays the
    gate with the resolved approval id (README §3.2 step 6).
    """
    return [
        ToolEntry(
            name="core.recall",
            origin="core",
            cls=ToolClass.READ,
            params_schema=RECALL_SCHEMA,
            validator=schema_validator(RECALL_SCHEMA),
            executor=services.recall or _unattached("core.recall"),
            description="Search memory; the capped answer returns as a system episode.",
            cap_chars=READ_CAP,
        ),
        ToolEntry(
            name="core.write_fact",
            origin="core",
            cls=ToolClass.GATED,
            params_schema=WRITE_FACT_SCHEMA,
            validator=all_of(
                schema_validator(WRITE_FACT_SCHEMA),
                live_sources(services.sources_alive),
            ),
            executor=services.write_fact or _unattached("core.write_fact"),
            description="Distil a claim about the user, a project or the world; cites episodes.",
        ),
        ToolEntry(
            name="core.checkpoint",
            origin="core",
            cls=ToolClass.AUTO,
            params_schema=CHECKPOINT_SCHEMA,
            validator=schema_validator(CHECKPOINT_SCHEMA),
            executor=services.checkpoint or _unattached("core.checkpoint"),
            description="Write a progress or blocker note as a system episode.",
        ),
        ToolEntry(
            name="core.answer_decision",
            origin="core",
            cls=ToolClass.AUTO,
            params_schema=ANSWER_DECISION_SCHEMA,
            validator=schema_validator(ANSWER_DECISION_SCHEMA),
            executor=services.answer_decision or _unattached("core.answer_decision"),
            description="Relay the user's answer to a pending decision card.",
        ),
    ]


def _connector_executor(port: ConnectorPort, tool_name: str) -> ExecutorFn:
    """Bind one of a connector's tools to its port.

    The port is handed the bare name it declared; the ``connector.<id>.`` namespace is the
    catalog's and a connector never has to reproduce it.
    """

    def _call(params: dict[str, Any], ctx: TurnContext) -> ExecResult:
        return port.call(tool_name, params)

    return _call


# --- the registry ------------------------------------------------------------------------------


@dataclass
class Catalog:
    """Everything addressable is in here, or it is unreachable.

    Three registries: Athena's own tools, a page's tools per ``host:<app_id>``, and a connector's
    per ``connector:<id>``. :attr:`entries` is the flat view every lookup goes through.
    """

    core: dict[str, ToolEntry] = field(default_factory=dict)
    host: dict[str, dict[str, ToolEntry]] = field(default_factory=dict)
    connector: dict[str, dict[str, ToolEntry]] = field(default_factory=dict)

    # -- the flat view ---------------------------------------------------------------------------

    @property
    def entries(self) -> dict[str, ToolEntry]:
        """Every entry, core first and then each origin in a stable order."""
        flat: dict[str, ToolEntry] = dict(self.core)
        for registry in (self.host, self.connector):
            for origin in sorted(registry):
                flat.update(registry[origin])
        return flat

    @property
    def origins(self) -> list[str]:
        """Every origin that currently holds at least one entry, ``core`` included."""
        found = [origin for registry in (self.host, self.connector) for origin in registry]
        return (["core"] if self.core else []) + sorted(found)

    def __contains__(self, name: object) -> bool:
        return name in self.entries

    def __len__(self) -> int:
        return len(self.entries)

    # -- registration ----------------------------------------------------------------------------

    def register_core(self, services: CoreServices) -> list[str]:
        """Register Athena's own tools, replacing any previous set."""
        self.core = {entry.name: entry for entry in core_entries(services)}
        return sorted(self.core)

    def merge_manifest(self, manifest: HostManifest) -> list[str]:
        """Merge a page's capability manifest (README §3.3). Returns the registered names.

        The manifest is merged whole or refused whole, and a merge replaces that origin's previous
        set in one assignment. Refused means refused: the origin keeps exactly the tools it had.
        """
        return self._merge(manifest, executor_for=lambda tool: None)

    def merge_connector(self, connector_id: str, port: ConnectorPort) -> list[str]:
        """Merge a connector's tools like a page's, with each entry bound to the port (README §4).

        Same manifest shape, same validation, same class derivation — a connector cannot argue
        itself out of ``GATED`` any more than a page can. The one difference is the executor: a
        page is executed by the page, a connector by its port in the daemon's process.
        """
        manifest = HostManifest(
            app_id=connector_id,
            origin_kind="connector",
            tools=list(port.list_tools()),
        )
        return self._merge(
            manifest,
            executor_for=lambda tool: _connector_executor(port, tool.name),
        )

    def _merge(
        self,
        manifest: HostManifest,
        *,
        executor_for: Callable[[HostTool], ExecutorFn | None],
    ) -> list[str]:
        problems = manifest.validate()
        if problems:
            raise CatalogError(
                f"manifest {manifest.app_id!r} is refused whole: {'; '.join(problems)}"
            )
        parsed = parse_origin(manifest.registry_origin)
        if parsed.kind == "core":
            raise CatalogError("a manifest cannot register core tools")
        origin = str(parsed)
        registry = self.host if parsed.kind == "host" else self.connector

        staged: dict[str, ToolEntry] = {}
        for tool in manifest.tools:
            if not _TOOL_NAME.fullmatch(tool.name):
                raise CatalogError(
                    f"manifest {manifest.app_id!r} is refused whole: tool name {tool.name!r} is "
                    "not a slug; the catalog namespaces it as <kind>.<id>.<name>"
                )
            name = f"{parsed.kind}.{parsed.id}.{tool.name}"
            # A duplicate inside the manifest is normally refused by ``validate`` above; this is
            # the gate's own guard, so that a change to the namespace scheme or to the manifest
            # rules can never quietly let one name mean two tools.
            owner = "this manifest" if name in staged else self._owner_of(name)
            if owner is not None and owner != origin:
                raise CatalogError(
                    f"manifest {manifest.app_id!r} is refused whole: {name!r} is already "
                    f"registered by {owner}"
                )
            cls = tool.default_class()
            try:
                staged[name] = ToolEntry(
                    name=name,
                    origin=origin,
                    cls=cls,
                    params_schema=tool.params_schema,
                    description=tool.description,
                    validator=schema_validator(tool.params_schema),
                    executor=executor_for(tool),
                    cap_chars=READ_CAP if cls is ToolClass.READ else None,
                )
            except ValueError as exc:
                raise CatalogError(
                    f"manifest {manifest.app_id!r} is refused whole: {exc}"
                ) from None

        # One assignment, so there is no moment at which this origin is half-merged.
        registry[origin] = staged
        return sorted(staged)

    def _owner_of(self, name: str) -> str | None:
        if name in self.core:
            return "core"
        for registry in (self.host, self.connector):
            for origin, entries in registry.items():
                if name in entries:
                    return origin
        return None

    def drop_origin(self, origin: str) -> int:
        """Un-register everything one page or connector registered. Returns how many entries went.

        A page that navigated away and a connector that was disconnected both take this path: the
        capability leaves the prompt rather than staying in it to be refused at the gate.
        """
        try:
            parsed = parse_origin(origin)
        except ValueError as exc:
            raise CatalogError(str(exc)) from None
        if parsed.kind == "core":
            raise CatalogError("core tools are Athena's own and are not dropped by origin")
        registry = self.host if parsed.kind == "host" else self.connector
        return len(registry.pop(str(parsed), {}))

    # -- lookup ----------------------------------------------------------------------------------

    def get(self, name: str) -> ToolEntry:
        try:
            return self.entries[name]
        except KeyError:
            raise CatalogError(f"unknown tool {name!r}") from None

    def names(self, lane: Lane | None = None) -> list[str]:
        return sorted(
            entry.name for entry in self.entries.values() if lane is None or entry.enabled_in(lane)
        )

    def for_lane(self, lane: Lane) -> list[ToolEntry]:
        entries = self.entries
        return [entries[name] for name in self.names(lane)]

    def by_class(self, cls: ToolClass, lane: Lane | None = None) -> list[ToolEntry]:
        pool = self.for_lane(lane) if lane is not None else list(self.entries.values())
        return [entry for entry in pool if entry.cls is cls]

    def classify(self, name: str) -> ToolClass:
        """What the gate will do with this name. The one answer; a model never supplies it."""
        return self.get(name).cls

    def validate(self, name: str, params: dict[str, Any], ctx: TurnContext) -> ValidationResult:
        """The gate's decision. An unknown name, or one not enabled for this lane, is a rejection
        with a reason — never an execution."""
        try:
            entry = self.get(name)
        except CatalogError as exc:
            return ValidationResult.reject("unknown_ref", str(exc))
        if not entry.enabled_in(ctx.lane):
            return ValidationResult.reject(
                "unknown_ref", f"{name} is not enabled in the {ctx.lane.value} lane"
            )
        return entry.validator(params, ctx)

    # -- the generated capability section ---------------------------------------------------------

    def render_capabilities(self, lane: Lane) -> PromptBlock:
        """The capability block of the prompt, generated from the registry (README §2 invariant 4).

        Every entry enabled in this lane appears exactly once, under its class, with its
        parameters. The order is by class and then by name, so two calls over an unchanged
        registry produce identical text — which is what lets the ledger's block hash mean
        something.
        """
        entries = self.for_lane(lane)
        total = len(self.entries)
        lines = [
            "## Capabilities",
            "",
            f"These are every name you can address in the {lane.value} lane. A name that is not",
            "listed here does not exist; asking for it is a dropped call, not an action.",
            "",
            "- GATED: proposing it files a decision card; it runs only after the user answers.",
            "- READ: answers synchronously, capped, and the answer returns as a system episode.",
            "- AUTO: fires immediately once its validator passes.",
            "",
            "### How to address one",
            "",
            "You have no tool-call API here. You act by writing an `OP:` line on its own line in",
            "your reply, and that is the only way anything runs:",
            "",
            '    OP: {"op":"propose_action","action":"<name from the list above>",'
            '"params":{...},"rationale":"<why, in one clause>"}',
            "",
            "The line must be one line of compact JSON. Everything else you write is what the user",
            "reads. Write the op even when the name is GATED: that is what files the card. Do not",
            "look for these names anywhere but this list, and do not ask the user to run them for",
            "you — a name listed here is a name you address with an `OP:` line.",
            "",
        ]
        for cls in (ToolClass.GATED, ToolClass.READ, ToolClass.AUTO):
            group = [entry for entry in entries if entry.cls is cls]
            if not group:
                continue
            lines.append(f"### {cls.value}")
            for entry in group:
                params = _params_line(entry.params_schema)
                cap = f" [cap {entry.cap_chars} chars]" if entry.cap_chars else ""
                description = entry.description or "(no description)"
                lines.append(f"- `{entry.name}`({params}) — {description}{cap}")
            lines.append("")
        lines.append(f"(showing {len(entries)} of {total})")
        return PromptBlock(
            name="capabilities",
            text="\n".join(lines).rstrip() + "\n",
            shown=len(entries),
            total=total,
        )


def _params_line(schema: dict[str, Any]) -> str:
    """``key: string, scope?: [...]`` — an optional parameter carries the question mark."""
    props = schema.get("properties")
    if not isinstance(props, dict) or not props:
        return ""
    required = set(schema.get("required", []))
    parts: list[str] = []
    for name, sub in props.items():
        kind = sub.get("type", "any") if isinstance(sub, dict) else "any"
        enum = sub.get("enum") if isinstance(sub, dict) else None
        rendered = f"{name}: {json.dumps(enum)}" if enum else f"{name}: {kind}"
        parts.append(rendered if name in required else rendered.replace(":", "?:", 1))
    return ", ".join(parts)


def build_catalog(services: CoreServices, manifest: HostManifest | None = None) -> Catalog:
    """The usual construction: Athena's own names, then a page's manifest merged beside them."""
    catalog = Catalog()
    catalog.register_core(services)
    if manifest is not None:
        catalog.merge_manifest(manifest)
    return catalog

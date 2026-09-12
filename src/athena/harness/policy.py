"""Structural policy: the refusals decided from a call's shape, not its parameters (README §3.1).

A validator answers "are these parameters acceptable for this tool?". Structural policy answers a
different question that no validator can see: "may *this session* address *this name* at all?" A
host tool belongs to one application, a connector tool is only callable while its connection is
live, and a tool that is not in this lane has no business being addressable from it. None of the
three is a fact about parameters, and writing them as validators would put the same three checks
on every registered tool and let a manifest forget one.

So they live here, in front of the catalog, and they reach the gate the way everything else does —
through ``CatalogPort``. :class:`PolicyCatalog` wraps a catalog, runs the rules, and delegates. The
gate is unchanged and does not know the rules exist, which is the point: adding a structural rule
must never be a change to the gate, because a gate that grows a special case is a gate nobody can
read in one page (README §3.3, ADR 0010).

The refusals come from ``ERROR_REASONS`` and each one means a distinct thing:

``foreign_origin``
    the tool belongs to an application this turn is not pinned to.
``unknown_ref``
    the name is not addressable here at all — wrong lane, or a connector with nothing live
    behind it.

``foreign_token`` is deliberately not minted here. It belongs to the minted refs the generic hands
hand out (README §3.4 tier 2), where a ref from one session arriving in another is a real and
different failure; a rule that spent the reason on something else would leave that one unnamed.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable

from athena.contracts.harness import PromptBlock
from athena.contracts.registry import (
    Lane,
    ToolClass,
    ToolEntry,
    TurnContext,
    ValidationResult,
)
from athena.harness.ports import CatalogPort

__all__ = [
    "LivenessPort",
    "PolicyCatalog",
    "Rule",
    "StructuralPolicy",
    "connector_enabled",
    "default_policy",
    "entries_by_name",
    "lane_enabled",
    "same_origin",
]

Rule = Callable[[ToolEntry, dict[str, Any], TurnContext], ValidationResult]
"""One structural check. Pure, like a validator, and refuses with a closed-set reason."""


@runtime_checkable
class LivenessPort(Protocol):
    """The vault, as policy sees it: one question, asked fresh on every call (README §4).

    Deliberately not a cached flag on the entry. A disconnect must take effect on the *next* call
    and not at the next catalog rebuild, and the only way to promise that is to ask every time.
    """

    def is_live(self, connector_id: str) -> bool: ...


# --- the rules ----------------------------------------------------------------------------------


def lane_enabled(entry: ToolEntry, params: dict[str, Any], ctx: TurnContext) -> ValidationResult:
    """The entry must be masked into the lane this turn runs in."""
    if entry.enabled_in(ctx.lane):
        return ValidationResult.accept()
    return ValidationResult.reject(
        "unknown_ref", f"{entry.name} is not addressable in the {ctx.lane} lane"
    )


def same_origin(entry: ToolEntry, params: dict[str, Any], ctx: TurnContext) -> ValidationResult:
    """A host tool is callable only from a turn pinned to its own application.

    Two tabs are two applications and two ``app_id``s, so this is what stops a turn raised on the
    invoicing tab from reaching into the support inbox's own tools. It is a refusal and not a
    silent drop, because the model asked for something it could see in its capability block and is
    owed the reason it could not have it.
    """
    origin = entry.parsed_origin
    if origin.kind != "host":
        return ValidationResult.accept()
    if not ctx.app_id:
        return ValidationResult.reject(
            "foreign_origin",
            f"{entry.name} belongs to an application; this turn is pinned to none",
        )
    if origin.id != ctx.app_id:
        return ValidationResult.reject(
            "foreign_origin",
            f"{entry.name} belongs to {origin.id!r}; this turn is pinned to {ctx.app_id!r}",
        )
    return ValidationResult.accept()


def connector_enabled(liveness: LivenessPort | None) -> Rule:
    """A ``connector:`` entry is permitted only while the vault says it is connected (README §4).

    With no vault attached every connector name refuses. That is the honest answer rather than the
    convenient one: a build with no vault has no credentials, so a connector call could only fail
    later and further from the reason.
    """

    def _rule(entry: ToolEntry, params: dict[str, Any], ctx: TurnContext) -> ValidationResult:
        origin = entry.parsed_origin
        if origin.kind != "connector":
            return ValidationResult.accept()
        if liveness is None:
            return ValidationResult.reject(
                "unknown_ref", f"{entry.name}: no vault is attached, so no connection is live"
            )
        if not liveness.is_live(origin.id):
            return ValidationResult.reject(
                "unknown_ref", f"{entry.name}: the {origin.id} connection is not live"
            )
        return ValidationResult.accept()

    return _rule


# --- the policy ---------------------------------------------------------------------------------


@dataclass(frozen=True)
class StructuralPolicy:
    """An ordered set of rules. The first refusal wins and the rest are not run.

    Order is the design: ``lane_enabled`` is asked first because a name that is not in this lane
    should be refused for *that*, not for belonging to another application — a reason that names
    the wrong cause is a reason nobody can act on.
    """

    rules: tuple[Rule, ...] = ()

    def check(self, entry: ToolEntry, params: dict[str, Any], ctx: TurnContext) -> ValidationResult:
        for rule in self.rules:
            verdict = rule(entry, params, ctx)
            if not verdict.ok:
                return verdict
        return ValidationResult.accept()

    def permits(self, entry: ToolEntry, ctx: TurnContext) -> bool:
        """Would a call on ``entry`` survive the rules in this context, parameters aside?"""
        return self.check(entry, {}, ctx).ok


def default_policy(liveness: LivenessPort | None = None) -> StructuralPolicy:
    """The three rules this build runs with."""
    return StructuralPolicy(rules=(lane_enabled, same_origin, connector_enabled(liveness)))


# --- the catalog the gate actually sees ----------------------------------------------------------


class PolicyCatalog:
    """A :class:`CatalogPort` that runs structural policy in front of a real catalog.

    :meth:`for_lane` filters, and that is not the same decision as :meth:`validate` refusing. A
    name the session could never call has no business being rendered into the capability block and
    then refused when the model takes the offer — the prompt would be teaching a tool that does not
    exist for this turn. Filtering needs a context, so an unbound catalog filters nothing and only
    the refusal applies; the browser lane always binds one.
    """

    def __init__(
        self, inner: CatalogPort, policy: StructuralPolicy, ctx: TurnContext | None = None
    ) -> None:
        self.inner = inner
        self.policy = policy
        self.ctx = ctx

    def for_ctx(self, ctx: TurnContext) -> PolicyCatalog:
        """This catalog bound to one turn, so ``for_lane`` can filter what that turn may see."""
        return PolicyCatalog(self.inner, self.policy, ctx)

    # -- CatalogPort -------------------------------------------------------------------------------

    def for_lane(self, lane: Lane) -> list[ToolEntry]:
        entries = self.inner.for_lane(lane)
        if self.ctx is None:
            return entries
        return [entry for entry in entries if self.policy.permits(entry, self.ctx)]

    def classify(self, name: str) -> ToolClass:
        return self.inner.classify(name)

    def validate(self, name: str, params: dict[str, Any], ctx: TurnContext) -> ValidationResult:
        entry = self._entry(name)
        if entry is None:
            return ValidationResult.reject("unknown_ref", f"{name} is not a registered name")
        verdict = self.policy.check(entry, params, ctx)
        if not verdict.ok:
            return verdict
        return self.inner.validate(name, params, ctx)

    # -- rendering, when the inner catalog can -----------------------------------------------------

    def render_capabilities(self, lane: Lane) -> PromptBlock:
        """Delegated, so the prompt composer can take a :class:`PolicyCatalog` unchanged.

        ``athena.core.prompt`` declares its own narrow catalog port with this one method;
        forwarding it here is what lets the lane hand the composer the same object the gate holds,
        rather than two catalogs that could disagree about which names exist. The block is rebuilt
        from the filtered entries when the inner catalog can render a subset, so the prompt names
        what this turn may call and nothing else (README §2 invariant 4).
        """
        render = getattr(self.inner, "render_capabilities", None)
        if render is None:
            raise AttributeError("the wrapped catalog cannot render capabilities")
        block: PromptBlock = render(lane)
        return block

    def _entry(self, name: str) -> ToolEntry | None:
        get = getattr(self.inner, "get", None)
        if get is not None:
            try:
                found: ToolEntry = get(name)
            except (KeyError, ValueError):
                return None
            return found
        return _scan(self.inner, name)


def _scan(catalog: CatalogPort, name: str) -> ToolEntry | None:
    """Find an entry by name in a catalog that offers no ``get`` — a fake, in a test."""
    for lane in Lane:
        for entry in catalog.for_lane(lane):
            if entry.name == name:
                return entry
    return None


def entries_by_name(entries: Sequence[ToolEntry]) -> dict[str, ToolEntry]:
    """The lookup the lane hands the harness. Here, so both halves build it the same way."""
    return {entry.name: entry for entry in entries}

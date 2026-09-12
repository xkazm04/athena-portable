"""Structural policy — the four rules that run *before* the gate (README §3.3, §3.4, §4).

The catalog decides what class a name is and whether these parameters are well formed. It does
not decide whether *this session* may address that name at all, and that second question is
structural: it is answered from the session's own pin, the surface's per-origin trust table, the
lane, and the vault's liveness — never from a parameter and never from a model's text.

Four rules, evaluated in order, first refusal wins (Cedar's forbid-overrides-permit):

1. ``per_lane_allow_list`` — the entry's lane mask must admit the turn's lane, and a lane that
   declares an explicit allow-list admits nothing outside it.
2. ``origin_enabled`` — an origin the surface switched off in the trust table may not act. A
   disconnect or a Forget takes effect on the next call, not on the next restart.
3. ``origin_pinning`` — a ``host:<app_id>`` tool may only be called from the session pinned to
   that app, and only while that session is still on the page origin the manifest was published
   under. Refused ``foreign_origin``.
4. ``connector_enabled`` — a ``connector:<id>`` entry is permitted only while the vault says the
   connection is live *now* (README §4). The state is read through :class:`ConnectorStatePort` on
   every call rather than captured at merge time, so switching a connector off is immediate. A
   deployment with no vault has no connector it may call, and the refusal names the connector
   rather than saying "no".

Why these run before the validator rather than beside it: a validator answers "are these
parameters acceptable for this tool", which presumes the tool is addressable here. Asking the
second question first means a call from a foreign origin is refused as ``foreign_origin`` and not
as ``validator_failed``, so the ledger can count how often a page tried to drive another page's
tools. :class:`PolicyHook` is a :class:`~athena.harness.hooks.GateHook` with the rules in front of
it, which is why nothing in the harness has to remember to call them.

The original repository's policy had a fifth rule pinning a working directory under a registered
project. It has no counterpart here: nothing in this build takes a filesystem path as a tool
parameter, and a rule with no parameter to read is a rule nobody maintains.

:meth:`Policy.to_cedar` renders the same semantics as Cedar policy text, for the docs and for a
later deployment that wants a real engine to evaluate them. Nothing here requires Cedar and this
module never evaluates that text.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

from athena.contracts.harness import normalize_reason
from athena.contracts.registry import Lane, ToolEntry, TurnContext
from athena.harness.hooks import Cancel, GateHook, GateOutcome
from athena.harness.ports import ApprovalsPort, CatalogPort

__all__ = [
    "RULES",
    "ConnectorStatePort",
    "Policy",
    "PolicyDecision",
    "PolicyHook",
]

#: Every rule name this module can refuse under. Closed, and in evaluation order, so a refusal
#: names a rule a reader can find rather than a sentence somebody wrote at a call site.
RULES: tuple[str, ...] = (
    "per_lane_allow_list",
    "origin_enabled",
    "origin_pinning",
    "connector_enabled",
)


@runtime_checkable
class ConnectorStatePort(Protocol):
    """Is this connection live *right now*?

    The connector team's vault is the implementation (README §4). This package never imports it,
    and a deployment with no connectors passes nothing — which is not the same as passing a port
    that says yes.
    """

    def is_live(self, connector_id: str) -> bool: ...


@dataclass(frozen=True)
class PolicyDecision:
    """One evaluation. ``reason`` is a member of ``ERROR_REASONS`` whenever this is a refusal."""

    allow: bool
    rule: str = ""
    reason: str | None = None
    detail: str = ""

    @classmethod
    def permit(cls) -> PolicyDecision:
        return cls(True)

    @classmethod
    def forbid(cls, rule: str, reason: str, detail: str) -> PolicyDecision:
        return cls(False, rule, normalize_reason(reason) or "unknown", detail)

    def as_cancel(self) -> Cancel:
        """This refusal as the gate's own answer, with the rule named in the sentence."""
        return Cancel(self.reason or "unknown", f"{self.rule}: {self.detail}")


@dataclass(frozen=True)
class Policy:
    """The rule set, as data.

    Everything a rule reads is a field here or a field of :class:`~athena.contracts.registry
    .TurnContext`, which is what makes the set trivially testable and trivially renderable as
    Cedar. An empty :class:`Policy` pins nothing, disables nothing and admits every lane — but
    still refuses every connector, because rule 4 fails closed.
    """

    #: ``app_id`` → the page origin (``https://…``) that app's manifest was published under.
    #: An app that is absent is one no manifest has been merged for in this process.
    pinned_origins: Mapping[str, str] = field(default_factory=dict)
    #: Origin strings (``host:<app_id>``, ``connector:<id>``) the surface switched off.
    disabled_origins: frozenset[str] = frozenset()
    #: Lane → the only registry names that lane may address. A lane with no entry here admits
    #: whatever the entries' own lane masks admit.
    lane_tools: Mapping[Lane, frozenset[str]] = field(default_factory=dict)
    #: The vault, as the one question rule 4 asks it.
    connectors: ConnectorStatePort | None = None

    @classmethod
    def build(
        cls,
        *,
        pinned_origins: Mapping[str, str] | None = None,
        disabled_origins: Sequence[str] = (),
        lane_tools: Mapping[Lane, Sequence[str]] | None = None,
        connectors: ConnectorStatePort | None = None,
    ) -> Policy:
        """The constructor callers use: sequences in, frozen sets out."""
        return cls(
            pinned_origins=dict(pinned_origins or {}),
            disabled_origins=frozenset(disabled_origins),
            lane_tools={lane: frozenset(names) for lane, names in (lane_tools or {}).items()},
            connectors=connectors,
        )

    # -- evaluation --------------------------------------------------------------------------

    def authorize(
        self, entry: ToolEntry, params: Mapping[str, Any], ctx: TurnContext
    ) -> PolicyDecision:
        """Every rule, in :data:`RULES` order. The first refusal wins and the rest are not run."""
        for check in (
            self._per_lane_allow_list,
            self._origin_enabled,
            self._origin_pinning,
            self._connector_enabled,
        ):
            decision = check(entry, params, ctx)
            if not decision.allow:
                return decision
        return PolicyDecision.permit()

    def _per_lane_allow_list(
        self, entry: ToolEntry, params: Mapping[str, Any], ctx: TurnContext
    ) -> PolicyDecision:
        if not entry.enabled_in(ctx.lane):
            return PolicyDecision.forbid(
                "per_lane_allow_list",
                "unknown_ref",
                f"{entry.name} is not enabled in the {ctx.lane.value} lane",
            )
        allowed = self.lane_tools.get(ctx.lane)
        if allowed is not None and entry.name not in allowed:
            return PolicyDecision.forbid(
                "per_lane_allow_list",
                "unknown_ref",
                f"{entry.name} is not on the {ctx.lane.value} lane's allow-list",
            )
        return PolicyDecision.permit()

    def _origin_enabled(
        self, entry: ToolEntry, params: Mapping[str, Any], ctx: TurnContext
    ) -> PolicyDecision:
        origin = str(entry.parsed_origin)
        if origin in self.disabled_origins:
            return PolicyDecision.forbid(
                "origin_enabled",
                "foreign_origin",
                f"{origin} is switched off for this user; its tools may not act",
            )
        return PolicyDecision.permit()

    def _origin_pinning(
        self, entry: ToolEntry, params: Mapping[str, Any], ctx: TurnContext
    ) -> PolicyDecision:
        """A host tool belongs to one app and one page origin (README §3.4).

        Two comparisons, and both are needed. The session's ``app_id`` is what the daemon keyed
        the session by, so a page that talks another page's tools is caught even when both are
        registered. The session's ``page_origin`` is where that tab actually is now, so a tab that
        navigated away from the origin its manifest was published under stops being able to drive
        those tools — which is the case a per-app check alone would miss.

        A session with no pin at all (``app_id`` and ``page_origin`` both unset) is not a browser
        session: a turn raised over MCP has no page, and the catalog it is composed against is the
        pin. Nothing is compared, so nothing is refused here.
        """
        parsed = entry.parsed_origin
        if parsed.kind != "host":
            return PolicyDecision.permit()
        app_id = parsed.id
        if ctx.app_id is not None and ctx.app_id != app_id:
            return PolicyDecision.forbid(
                "origin_pinning",
                "foreign_origin",
                f"this session is pinned to host:{ctx.app_id} and {entry.name} belongs to "
                f"host:{app_id}",
            )
        expected = self.pinned_origins.get(app_id)
        if expected is not None and ctx.page_origin is not None and ctx.page_origin != expected:
            return PolicyDecision.forbid(
                "origin_pinning",
                "foreign_origin",
                f"host:{app_id} published its manifest from {expected!r} and this session is "
                f"on {ctx.page_origin!r}",
            )
        return PolicyDecision.permit()

    def _connector_enabled(
        self, entry: ToolEntry, params: Mapping[str, Any], ctx: TurnContext
    ) -> PolicyDecision:
        parsed = entry.parsed_origin
        if parsed.kind != "connector":
            return PolicyDecision.permit()
        if self.connectors is None:
            return PolicyDecision.forbid(
                "connector_enabled",
                "unknown_ref",
                f"connector:{parsed.id} cannot be reached here: this deployment has no vault",
            )
        if not self.connectors.is_live(parsed.id):
            return PolicyDecision.forbid(
                "connector_enabled",
                "unknown_ref",
                f"connector:{parsed.id} is not connected, or is switched off, right now",
            )
        return PolicyDecision.permit()

    # -- Cedar text --------------------------------------------------------------------------

    def to_cedar(self) -> str:
        """The same semantics as Cedar policy text (README §3.3), for the docs.

        It is generated from the same fields :meth:`authorize` reads, so a rule that is added to
        one and not the other is visible in the rendering rather than only in a review. This
        package never evaluates it and never imports a Cedar engine.
        """
        parts: list[str] = [
            "// Generated by athena.harness.policy.Policy.to_cedar() — README §3.3, §3.4, §4.",
            "// forbid overrides permit, which is the order Policy.authorize() evaluates in.",
            "",
            "permit (principal, action, resource);",
            "",
            "// 1. per_lane_allow_list",
            "forbid (principal, action, resource)",
            "unless { context.lane in action.lanes };",
        ]
        for lane in sorted(self.lane_tools, key=lambda item: item.value):
            names = ", ".join(f'Action::"{name}"' for name in sorted(self.lane_tools[lane]))
            parts.append(
                f'forbid (principal, action, resource)\nwhen {{ context.lane == "{lane.value}" }}'
                f"\nunless {{ action in [{names}] }};"
            )
        parts += ["", "// 2. origin_enabled: an origin the surface switched off may not act"]
        for origin in sorted(self.disabled_origins):
            parts.append(f'forbid (principal, action, resource in Origin::"{_cedar(origin)}");')
        parts += ["", "// 3. origin_pinning for host tools (README §3.4)"]
        parts.append(
            "forbid (principal, action, resource)\n"
            "when { resource has app_id && context has app_id && "
            "context.app_id != resource.app_id };"
        )
        for app_id, origin in sorted(self.pinned_origins.items()):
            parts.append(
                f'forbid (principal, action, resource in App::"{_cedar(app_id)}")\n'
                f'when {{ context has page_origin && context.page_origin != "{_cedar(origin)}" }};'
            )
        parts += [
            "",
            "// 4. connector_enabled (README §4)",
            "// Liveness is a fact about the vault at call time, so the context carries it and the",
            "// clause only says what a false answer means. A deployment with no vault has no live",
            "// connector at all, which is this same clause with nothing ever true.",
            "forbid (principal, action, resource)",
            "when { resource has connector_id && !context.connector_live };",
        ]
        return "\n".join(parts) + "\n"


def _cedar(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


class PolicyHook(GateHook):
    """The gate with structural policy in front of it (README §3.3).

    It is a subclass rather than a wrapper so that everything already written against a
    ``GateHook`` — the harness, the lane, the daemon — gets the rules without a second call site
    that could be forgotten. ``wiring`` builds one of these; a bare :class:`GateHook` is the
    unpolicied gate the tests of :mod:`athena.harness.hooks` exercise on purpose.

    Both entrances are guarded. :meth:`before_tool_call` covers the turn, and :meth:`run_tool`
    covers the *replay* of README §3.2 step 6, which does not pass through it. That second guard
    is the one that matters for rules 2 and 4: a card approved while a connector was live must not
    execute ten minutes later, after the user disconnected it.
    """

    def __init__(
        self,
        catalog: CatalogPort,
        approvals: ApprovalsPort,
        policy: Policy | None = None,
    ) -> None:
        super().__init__(catalog, approvals)
        self.policy = policy or Policy()

    def before_tool_call(
        self,
        entry: ToolEntry,
        params: Mapping[str, Any],
        ctx: TurnContext,
        *,
        rationale: str = "",
    ) -> GateOutcome:
        decision = self.policy.authorize(entry, params, ctx)
        if not decision.allow:
            return GateOutcome(decision.as_cancel())
        return super().before_tool_call(entry, params, ctx, rationale=rationale)

    def run_tool(
        self,
        entry: ToolEntry,
        params: Mapping[str, Any],
        ctx: TurnContext,
        *,
        rationale: str = "",
        approval_id: str | None = None,
    ) -> GateOutcome:
        if approval_id is not None:
            decision = self.policy.authorize(entry, params, ctx)
            if not decision.allow:
                return GateOutcome(decision.as_cancel())
        return super().run_tool(entry, params, ctx, rationale=rationale, approval_id=approval_id)

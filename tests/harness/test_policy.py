"""Structural policy: the four rules, and the gate that runs them first (README §3.3, §3.4, §4).

Every test here is policy over data — no SQLite, no subprocess, no provider — because that is what
the module is. The fakes come from ``tests/harness/conftest.py``, which is the same seam
``test_hooks.py`` uses, so a policy refusal and a gate refusal are proved against one catalog.
"""

from __future__ import annotations

from typing import Any

import pytest

from athena.contracts.harness import ERROR_REASONS
from athena.contracts.registry import (
    ExecResult,
    Lane,
    ToolClass,
    ToolEntry,
    TurnContext,
    ValidationResult,
)
from athena.harness.hooks import Cancel, Proceed
from athena.harness.policy import RULES, Policy, PolicyDecision, PolicyHook

from .conftest import FakeApprovals, FakeCatalog, make_ctx, make_entry


class FakeVault:
    """``ConnectorStatePort``: liveness that the test can change between two calls."""

    def __init__(self, live: set[str] | None = None) -> None:
        self.live = live or set()
        self.asked: list[str] = []

    def is_live(self, connector_id: str) -> bool:
        self.asked.append(connector_id)
        return connector_id in self.live


def host_entry(name: str = "host.invoices.mark_paid", app_id: str = "invoices") -> ToolEntry:
    """A page's tool: no executor, ever. The page runs it (README §3.2 step 5)."""
    return make_entry(name, ToolClass.AUTO, origin=f"host:{app_id}")


def connector_entry(name: str = "connector.gmail.search_mail") -> ToolEntry:
    return make_entry(name, ToolClass.AUTO, origin="connector:gmail", executor=_ran)


def _ran(params: dict[str, Any], ctx: TurnContext) -> ExecResult:
    return ExecResult(ok=True, output="ran")


# -- rule 3: origin pinning ----------------------------------------------------------------------


def test_a_call_from_another_origin_is_refused_foreign_origin() -> None:
    """The rule the plan names: this session is pinned to one app and may drive only that one."""
    policy = Policy.build(pinned_origins={"invoices": "https://invoices.example"})
    ctx = make_ctx(app_id="support", page_origin="https://support.example")

    decision = policy.authorize(host_entry(), {}, ctx)

    assert decision.allow is False
    assert decision.reason == "foreign_origin"
    assert decision.rule == "origin_pinning"
    assert "host:support" in decision.detail and "host:invoices" in decision.detail


def test_the_session_that_owns_the_app_is_permitted() -> None:
    policy = Policy.build(pinned_origins={"invoices": "https://invoices.example"})
    ctx = make_ctx(app_id="invoices", page_origin="https://invoices.example")

    assert policy.authorize(host_entry(), {}, ctx).allow is True


def test_a_tab_that_navigated_away_loses_the_apps_tools() -> None:
    """Same app_id, another page origin: the manifest was published somewhere this tab is not."""
    policy = Policy.build(pinned_origins={"invoices": "https://invoices.example"})
    ctx = make_ctx(app_id="invoices", page_origin="https://evil.example")

    decision = policy.authorize(host_entry(), {}, ctx)

    assert (decision.allow, decision.reason) == (False, "foreign_origin")
    assert "https://evil.example" in decision.detail


def test_an_unpinned_session_compares_nothing() -> None:
    """A turn raised over MCP has no page; there is no pin to violate."""
    policy = Policy.build(pinned_origins={"invoices": "https://invoices.example"})

    assert policy.authorize(host_entry(), {}, make_ctx(surface="mcp")).allow is True


def test_a_core_tool_is_never_origin_pinned() -> None:
    policy = Policy.build(pinned_origins={"invoices": "https://invoices.example"})
    ctx = make_ctx(app_id="invoices", page_origin="https://invoices.example")

    assert policy.authorize(make_entry("core.checkpoint"), {}, ctx).allow is True


# -- rule 2: enabled origins ---------------------------------------------------------------------


def test_an_origin_the_surface_disabled_is_refused() -> None:
    policy = Policy.build(disabled_origins=["host:invoices"])
    ctx = make_ctx(app_id="invoices", page_origin="https://invoices.example")

    decision = policy.authorize(host_entry(), {}, ctx)

    assert decision.allow is False
    assert decision.rule == "origin_enabled"
    assert decision.reason == "foreign_origin"
    assert "switched off" in decision.detail


def test_disabling_one_origin_leaves_the_others_alone() -> None:
    policy = Policy.build(disabled_origins=["host:support"])
    ctx = make_ctx(app_id="invoices", page_origin="https://invoices.example")

    assert policy.authorize(host_entry(), {}, ctx).allow is True


# -- rule 1: the per-lane allow-list --------------------------------------------------------------


def test_a_name_off_the_lanes_allow_list_is_refused() -> None:
    policy = Policy.build(lane_tools={Lane.BROWSER: ["core.recall", "core.checkpoint"]})
    ctx = make_ctx(app_id="invoices")

    decision = policy.authorize(host_entry(), {}, ctx)

    assert decision.allow is False
    assert decision.rule == "per_lane_allow_list"
    assert decision.reason == "unknown_ref"


def test_a_name_on_the_lanes_allow_list_passes() -> None:
    policy = Policy.build(lane_tools={Lane.BROWSER: ["core.recall"]})

    assert policy.authorize(make_entry("core.recall"), {}, make_ctx()).allow is True


def test_a_lane_with_no_allow_list_admits_whatever_the_mask_admits() -> None:
    ctx = make_ctx(app_id="invoices")

    assert Policy().authorize(host_entry(), {}, ctx).allow is True


# -- rule 4: connector_enabled --------------------------------------------------------------------


def test_a_connector_that_is_not_live_is_refused() -> None:
    policy = Policy.build(connectors=FakeVault(live=set()))

    decision = policy.authorize(connector_entry(), {}, make_ctx())

    assert decision.allow is False
    assert decision.rule == "connector_enabled"
    assert "gmail" in decision.detail


def test_a_live_connector_passes() -> None:
    vault = FakeVault(live={"gmail"})
    policy = Policy.build(connectors=vault)

    assert policy.authorize(connector_entry(), {}, make_ctx()).allow is True
    assert vault.asked == ["gmail"], "liveness is read on the call, not captured at merge time"


def test_liveness_is_asked_again_on_every_call() -> None:
    """A disconnect takes effect on the next call (README §4), not on the next restart."""
    vault = FakeVault(live={"gmail"})
    policy = Policy.build(connectors=vault)
    entry = connector_entry()

    assert policy.authorize(entry, {}, make_ctx()).allow is True
    vault.live.clear()
    assert policy.authorize(entry, {}, make_ctx()).allow is False


def test_a_deployment_with_no_vault_may_call_no_connector() -> None:
    decision = Policy().authorize(connector_entry(), {}, make_ctx())

    assert decision.allow is False
    assert "no vault" in decision.detail


def test_a_host_tool_never_asks_the_vault() -> None:
    vault = FakeVault(live={"gmail"})
    policy = Policy.build(connectors=vault)

    policy.authorize(host_entry(), {}, make_ctx(app_id="invoices"))

    assert vault.asked == []


# -- ordering and vocabulary ----------------------------------------------------------------------


def test_the_first_refusal_wins_and_it_is_the_first_rule_in_order() -> None:
    """Both rule 1 and rule 3 refuse this call; the decision names the earlier one."""
    policy = Policy.build(
        lane_tools={Lane.BROWSER: ["core.recall"]},
        pinned_origins={"invoices": "https://invoices.example"},
    )
    ctx = make_ctx(app_id="support")

    assert policy.authorize(host_entry(), {}, ctx).rule == "per_lane_allow_list"


def test_every_refusal_reason_is_a_member_of_the_closed_set() -> None:
    policy = Policy.build(
        lane_tools={Lane.BROWSER: ["core.recall"]},
        disabled_origins=["host:support"],
        pinned_origins={"invoices": "https://invoices.example"},
    )
    seen = {
        policy.authorize(host_entry(), {}, make_ctx(app_id="support")).reason,
        Policy.build(disabled_origins=["host:invoices"])
        .authorize(host_entry(), {}, make_ctx(app_id="invoices"))
        .reason,
        Policy().authorize(connector_entry(), {}, make_ctx()).reason,
    }

    assert seen <= set(ERROR_REASONS)


def test_an_invented_reason_collapses_rather_than_becoming_a_ledger_value() -> None:
    assert PolicyDecision.forbid("origin_pinning", "because I said so", "d").reason == "unknown"


# -- the Cedar rendering --------------------------------------------------------------------------


def test_to_cedar_names_every_rule_and_every_configured_fact() -> None:
    cedar = Policy.build(
        pinned_origins={"invoices": "https://invoices.example"},
        disabled_origins=["host:support"],
        lane_tools={Lane.BROWSER: ["core.recall"]},
        connectors=FakeVault(),
    ).to_cedar()

    for rule in RULES:
        assert rule in cedar, f"{rule} is evaluated but not rendered"
    assert "https://invoices.example" in cedar
    assert 'Origin::"host:support"' in cedar
    assert 'Action::"core.recall"' in cedar
    assert cedar.count("forbid") >= len(RULES)


# -- the hook -------------------------------------------------------------------------------------


def test_the_gate_refuses_a_foreign_origin_before_it_validates(
    catalog: FakeCatalog, approvals: FakeApprovals
) -> None:
    """Policy first: a foreign call with bad parameters is ``foreign_origin``, not a validator
    failure. Otherwise the ledger cannot count how often one page tried to drive another's."""

    def always_rejects(params: dict[str, Any], ctx: TurnContext) -> ValidationResult:
        return ValidationResult.reject("validator_failed", "no")

    entry = catalog.add(
        make_entry(
            "host.invoices.mark_paid",
            ToolClass.AUTO,
            origin="host:invoices",
            validator=always_rejects,
        )
    )
    gate = PolicyHook(catalog, approvals, Policy.build(pinned_origins={"invoices": "https://i"}))

    outcome = gate.run_tool(entry, {"id": 7}, make_ctx(app_id="support"))

    assert isinstance(outcome.decision, Cancel)
    assert outcome.decision.reason == "foreign_origin"
    assert outcome.result is None
    assert approvals.rows == {}, "a refused call files no card"


def test_a_permitted_call_still_reaches_the_gate(
    catalog: FakeCatalog, approvals: FakeApprovals
) -> None:
    entry = catalog.add(make_entry("core.checkpoint", ToolClass.AUTO))
    gate = PolicyHook(catalog, approvals, Policy())

    outcome = gate.run_tool(entry, {}, make_ctx())

    assert isinstance(outcome.decision, Proceed)
    assert outcome.result is not None and outcome.result.output == "ran"


def test_a_gated_call_from_a_permitted_origin_still_files_a_card(
    catalog: FakeCatalog, approvals: FakeApprovals
) -> None:
    entry = catalog.add(
        make_entry("host.invoices.pay", ToolClass.GATED, origin="host:invoices"),
    )
    gate = PolicyHook(catalog, approvals, Policy.build(pinned_origins={"invoices": "https://i"}))

    outcome = gate.run_tool(entry, {"id": 7}, make_ctx(app_id="invoices", page_origin="https://i"))

    assert outcome.card is not None
    assert isinstance(outcome.decision, Cancel)
    assert outcome.decision.reason == "pending_approval"


def test_the_replay_is_policed_too(catalog: FakeCatalog, approvals: FakeApprovals) -> None:
    """README §3.2 step 6 does not pass through ``before_tool_call``. A card approved while a
    connector was live must not execute after the user disconnected it."""
    vault = FakeVault(live={"gmail"})
    entry = catalog.add(
        make_entry("connector.gmail.send", ToolClass.GATED, origin="connector:gmail", executor=_ran)
    )
    gate = PolicyHook(catalog, approvals, Policy.build(connectors=vault))
    card = approvals.create(
        entry.name, {"to": "a@b.c"}, origin=entry.origin, conversation="conv_x", surface="panel"
    )
    approvals.resolve(card.id, "approve")

    vault.live.clear()
    outcome = gate.run_tool(entry, {"to": "a@b.c"}, make_ctx(), approval_id=card.id)

    assert isinstance(outcome.decision, Cancel)
    assert outcome.decision.reason == "unknown_ref"
    assert outcome.result is None, "nothing executed for a connector that is no longer live"


def test_a_replay_of_a_live_connector_executes(
    catalog: FakeCatalog, approvals: FakeApprovals
) -> None:
    entry = catalog.add(
        make_entry("connector.gmail.send", ToolClass.GATED, origin="connector:gmail", executor=_ran)
    )
    gate = PolicyHook(catalog, approvals, Policy.build(connectors=FakeVault(live={"gmail"})))
    card = approvals.create(
        entry.name, {"to": "a@b.c"}, origin=entry.origin, conversation="conv_x", surface="panel"
    )
    approvals.resolve(card.id, "approve")

    outcome = gate.run_tool(entry, {"to": "a@b.c"}, make_ctx(), approval_id=card.id)

    assert isinstance(outcome.decision, Proceed)
    assert outcome.result is not None and outcome.result.ok


@pytest.mark.parametrize("rule", RULES)
def test_every_rule_name_is_reachable_from_authorize(rule: str) -> None:
    """``RULES`` is the closed list; a name in it that nothing produces is documentation."""
    produced = {
        Policy.build(lane_tools={Lane.BROWSER: []})
        .authorize(make_entry("core.recall"), {}, make_ctx())
        .rule,
        Policy.build(disabled_origins=["host:invoices"])
        .authorize(host_entry(), {}, make_ctx(app_id="invoices"))
        .rule,
        Policy().authorize(host_entry(), {}, make_ctx(app_id="support")).rule,
        Policy().authorize(connector_entry(), {}, make_ctx()).rule,
    }

    assert rule in produced

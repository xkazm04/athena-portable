"""Structural policy refuses by shape, and the gate never learns that it exists (README §3.1)."""

from __future__ import annotations

from typing import Any

import pytest

from athena.contracts.registry import (
    Lane,
    ToolClass,
    ToolEntry,
    TurnContext,
    ValidationResult,
)
from athena.harness.hooks import Cancel, GateHook, Proceed
from athena.harness.policy import (
    PolicyCatalog,
    StructuralPolicy,
    connector_enabled,
    default_policy,
    entries_by_name,
    lane_enabled,
    same_origin,
)

from .conftest import FakeApprovals, FakeCatalog, make_ctx, make_entry


class Vault:
    """A ``LivenessPort`` whose answer a test can move between two calls."""

    def __init__(self, live: set[str] | None = None) -> None:
        self.live = live or set()

    def is_live(self, connector_id: str) -> bool:
        return connector_id in self.live


def host_entry(app_id: str, tool: str = "mark_paid") -> ToolEntry:
    return ToolEntry(name=f"host.{app_id}.{tool}", origin=f"host:{app_id}", cls=ToolClass.GATED)


def connector_entry(connector_id: str, tool: str = "search_mail") -> ToolEntry:
    def _run(params: dict[str, Any], ctx: TurnContext) -> Any:
        raise AssertionError("a refused connector call must never reach its executor")

    return ToolEntry(
        name=f"connector.{connector_id}.{tool}",
        origin=f"connector:{connector_id}",
        cls=ToolClass.AUTO,
        executor=_run,
    )


# --- the rules, one at a time ---------------------------------------------------------------------


def test_lane_enabled_accepts_a_name_masked_into_this_lane() -> None:
    """The browser lane is the only lane in this build, so only the accept path is reachable.

    The rule is written anyway and asserted here because a second lane is a plausible later
    commit, and a mask that nothing consults is a mask that is wrong the first time it matters.
    """
    entry = ToolEntry(
        name="core.elsewhere",
        origin="core",
        cls=ToolClass.AUTO,
        executor=make_entry("core.checkpoint").executor,
        lanes=frozenset({Lane.BROWSER}),
    )
    assert lane_enabled(entry, {}, make_ctx(lane=Lane.BROWSER)).ok


def test_same_origin_accepts_the_application_the_turn_is_pinned_to() -> None:
    verdict = same_origin(host_entry("invoices"), {}, make_ctx(app_id="invoices"))
    assert verdict.ok


def test_same_origin_refuses_another_tabs_tool_with_foreign_origin() -> None:
    verdict = same_origin(host_entry("inbox"), {}, make_ctx(app_id="invoices"))
    assert not verdict.ok
    assert verdict.reason == "foreign_origin"
    assert "inbox" in verdict.detail and "invoices" in verdict.detail


def test_same_origin_refuses_a_host_tool_when_the_turn_is_pinned_to_nothing() -> None:
    verdict = same_origin(host_entry("invoices"), {}, make_ctx(app_id=None))
    assert verdict.reason == "foreign_origin"


def test_same_origin_ignores_a_core_tool() -> None:
    assert same_origin(make_entry("core.checkpoint"), {}, make_ctx(app_id=None)).ok


def test_connector_enabled_refuses_when_no_vault_is_attached() -> None:
    verdict = connector_enabled(None)(connector_entry("gmail"), {}, make_ctx())
    assert verdict.reason == "unknown_ref"
    assert "no vault" in verdict.detail


def test_a_disconnect_takes_effect_on_the_next_call() -> None:
    vault = Vault({"gmail"})
    rule = connector_enabled(vault)
    entry = connector_entry("gmail")

    assert rule(entry, {}, make_ctx()).ok
    vault.live.clear()
    assert rule(entry, {}, make_ctx()).reason == "unknown_ref"


# --- the ordered policy ---------------------------------------------------------------------------


def test_the_first_refusal_wins_and_later_rules_do_not_run() -> None:
    def explode(entry: ToolEntry, params: dict[str, Any], ctx: TurnContext) -> ValidationResult:
        raise AssertionError("a rule after the first refusal must not run")

    policy = StructuralPolicy(rules=(same_origin, explode))
    verdict = policy.check(host_entry("inbox"), {}, make_ctx(app_id="invoices"))
    assert verdict.reason == "foreign_origin"


def test_permits_answers_without_parameters() -> None:
    policy = default_policy()
    assert policy.permits(make_entry("core.checkpoint"), make_ctx())
    assert not policy.permits(host_entry("inbox"), make_ctx(app_id="invoices"))


# --- the catalog the gate sees --------------------------------------------------------------------


@pytest.fixture
def wired() -> tuple[PolicyCatalog, FakeCatalog, FakeApprovals]:
    inner = FakeCatalog()
    inner.add(make_entry("core.checkpoint"))
    inner.add(host_entry("invoices"))
    inner.add(host_entry("inbox"))
    inner.add(connector_entry("gmail"))
    return PolicyCatalog(inner, default_policy()), inner, FakeApprovals()


def test_validate_refuses_an_unregistered_name(wired: tuple[PolicyCatalog, Any, Any]) -> None:
    catalog, _, _ = wired
    verdict = catalog.validate("host.nowhere.x", {}, make_ctx(app_id="nowhere"))
    assert verdict.reason == "unknown_ref"


def test_validate_runs_policy_before_the_catalogs_own_validator(
    wired: tuple[PolicyCatalog, FakeCatalog, Any],
) -> None:
    catalog, inner, _ = wired

    def never(params: dict[str, Any], ctx: TurnContext) -> ValidationResult:
        raise AssertionError("a structurally refused call must not reach the tool's validator")

    inner.entries["host.inbox.mark_paid"].validator = never
    assert catalog.validate("host.inbox.mark_paid", {}, make_ctx(app_id="invoices")).reason == (
        "foreign_origin"
    )


def test_for_lane_filters_only_once_bound_to_a_turn(
    wired: tuple[PolicyCatalog, Any, Any],
) -> None:
    catalog, _, _ = wired
    unbound = {entry.name for entry in catalog.for_lane(Lane.BROWSER)}
    assert "host.inbox.mark_paid" in unbound

    bound = {
        entry.name for entry in catalog.for_ctx(make_ctx(app_id="invoices")).for_lane(Lane.BROWSER)
    }
    assert bound == {"core.checkpoint", "host.invoices.mark_paid"}


def test_the_gate_refuses_a_foreign_origin_without_filing_a_card(
    wired: tuple[PolicyCatalog, Any, FakeApprovals],
) -> None:
    """The gate is unchanged: it asks the catalog, and the catalog now answers with policy."""
    catalog, inner, approvals = wired
    gate = GateHook(catalog, approvals)

    outcome = gate.run_tool(inner.entries["host.inbox.mark_paid"], {}, make_ctx(app_id="invoices"))

    assert isinstance(outcome.decision, Cancel)
    assert outcome.decision.reason == "foreign_origin"
    assert outcome.card is None
    assert approvals.rows == {}


def test_the_gate_still_files_a_card_for_the_pinned_application(
    wired: tuple[PolicyCatalog, Any, FakeApprovals],
) -> None:
    catalog, inner, approvals = wired
    gate = GateHook(catalog, approvals)

    outcome = gate.run_tool(
        inner.entries["host.invoices.mark_paid"], {"id": 7}, make_ctx(app_id="invoices")
    )

    assert isinstance(outcome.decision, Cancel)
    assert outcome.decision.reason == "pending_approval"
    assert outcome.card is not None


def test_an_unattached_vault_stops_a_connector_call_before_its_executor(
    wired: tuple[PolicyCatalog, Any, FakeApprovals],
) -> None:
    catalog, inner, approvals = wired
    gate = GateHook(catalog, approvals)

    outcome = gate.run_tool(inner.entries["connector.gmail.search_mail"], {}, make_ctx())

    assert isinstance(outcome.decision, Cancel)
    assert outcome.decision.reason == "unknown_ref"
    assert outcome.result is None


def test_a_core_tool_passes_policy_and_executes(
    wired: tuple[PolicyCatalog, Any, FakeApprovals],
) -> None:
    catalog, inner, approvals = wired
    outcome = GateHook(catalog, approvals).run_tool(
        inner.entries["core.checkpoint"], {}, make_ctx()
    )
    assert isinstance(outcome.decision, Proceed)
    assert outcome.result is not None and outcome.result.ok


def test_entries_by_name_is_the_one_lookup_both_halves_build() -> None:
    entries = [make_entry("core.checkpoint"), host_entry("invoices")]
    assert set(entries_by_name(entries)) == {"core.checkpoint", "host.invoices.mark_paid"}

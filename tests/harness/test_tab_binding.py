"""A gated host proposal is bound to the tab it was proposed on (ADR 0103).

The surface names the tab and its document generation on the request. The gate files them on a
card only when the card is about that page - the session's own host origin - exactly as it files
the capture. Destination binding, not a class change: the class decides whether there is a card,
and the binding only says where its approval may run.
"""

from __future__ import annotations

from athena.contracts.registry import ToolClass
from athena.harness.hooks import GateHook

from .conftest import FakeApprovals, FakeCatalog, make_ctx, make_entry


def _bound(origin: str, name: str, **ctx: object) -> tuple[int | None, int | None]:
    catalog, approvals = FakeCatalog(), FakeApprovals()
    row = catalog.add(make_entry(name, ToolClass.GATED, origin=origin))
    outcome = GateHook(catalog, approvals).before_tool_call(
        row, {}, make_ctx(app_id="ledgerbox", **ctx)
    )
    assert outcome.card is not None
    (stored,) = approvals.rows.values()
    assert (outcome.card.tab_id, outcome.card.tab_nav) == (stored.tab_id, stored.tab_nav)
    return outcome.card.tab_id, outcome.card.tab_nav


def test_a_gated_call_on_the_sessions_own_host_is_bound_to_the_tab_and_its_document() -> None:
    assert _bound("host:ledgerbox", "host.ledgerbox.pay", tab_id=2, tab_nav=5) == (2, 5)


def test_a_connector_a_core_tool_and_another_host_stay_unbound() -> None:
    for origin, name in (
        ("connector:gmail", "connector.gmail.send"),
        ("core", "core.write_fact"),
        ("host:crm", "host.crm.delete"),
    ):
        assert _bound(origin, name, tab_id=2, tab_nav=5) == (None, None)


def test_a_turn_that_named_no_tab_files_an_unbound_card() -> None:
    assert _bound("host:ledgerbox", "host.ledgerbox.pay") == (None, None)


def test_the_binding_never_makes_a_card_of_a_call_the_class_lets_through() -> None:
    catalog, approvals = FakeCatalog(), FakeApprovals()
    row = catalog.add(make_entry("host.ledgerbox.look", ToolClass.AUTO, origin="host:ledgerbox"))
    ctx = make_ctx(app_id="ledgerbox", tab_id=2, tab_nav=5)

    outcome = GateHook(catalog, approvals).before_tool_call(row, {}, ctx)

    assert outcome.allowed and outcome.card is None and approvals.rows == {}

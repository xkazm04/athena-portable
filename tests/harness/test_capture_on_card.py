"""A gated host proposal carries the capture of its tab (README §3.5; ADR 0066).

The surface captures the tab it is looking at and names the capture on the request. The gate files
it on a card only when the card is about that page: the session's own host origin.
"""

from __future__ import annotations

from athena.contracts.registry import ToolClass
from athena.harness.hooks import GateHook

from .conftest import FakeApprovals, FakeCatalog, make_ctx, make_entry

CAPTURE = "cap_0123456789ab"


def _card_for(origin: str, name: str) -> str | None:
    catalog, approvals = FakeCatalog(), FakeApprovals()
    row = catalog.add(make_entry(name, ToolClass.GATED, origin=origin))
    ctx = make_ctx(app_id="ledgerbox", capture_id=CAPTURE)
    outcome = GateHook(catalog, approvals).before_tool_call(row, {}, ctx)
    assert outcome.card is not None
    (stored,) = approvals.rows.values()
    assert outcome.card.capture_id == stored.capture_id
    return outcome.card.capture_id


def test_a_gated_call_on_the_sessions_own_host_carries_the_capture() -> None:
    assert _card_for("host:ledgerbox", "host.ledgerbox.pay") == CAPTURE


def test_a_connector_a_core_tool_and_another_host_carry_none() -> None:
    assert _card_for("connector:gmail", "connector.gmail.send") is None
    assert _card_for("core", "core.write_fact") is None
    assert _card_for("host:crm", "host.crm.delete") is None


def test_a_turn_with_no_capture_files_a_card_with_none() -> None:
    catalog, approvals = FakeCatalog(), FakeApprovals()
    row = catalog.add(make_entry("host.ledgerbox.pay", ToolClass.GATED, origin="host:ledgerbox"))
    outcome = GateHook(catalog, approvals).before_tool_call(row, {}, make_ctx(app_id="ledgerbox"))

    assert outcome.card is not None and outcome.card.capture_id is None

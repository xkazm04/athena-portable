"""A tool of another open, trusted tab may be proposed, and only proposed (ADR 0106).

The session is pinned to ``ledgerbox``. The surface lists the other open tabs whose app is an
enabled row of the origins table in ``open_apps``, each with its tab and document. Policy then lets
a call of a listed app through rule 3, and the gate makes every such call ``GATED`` - ``READ`` and
``AUTO`` included - and binds its card to that app's tab. Everything else stays refused
``foreign_origin``: an app not listed, one listed but first sight or switched off, one listed twice,
and one whose tab is no longer on the origin its manifest was published from.
"""

from __future__ import annotations

from athena.contracts.registry import OpenApp, ToolClass, TurnContext
from athena.harness.hooks import Cancel, GateHook, another_tab, open_app_for
from athena.harness.policy import Policy, PolicyHook

from .conftest import FakeApprovals, FakeCatalog, make_ctx, make_entry

CRM = OpenApp("host:tidycrm", "https://tidycrm.local", tab_id=7, tab_nav=2)
PINS = {"ledgerbox": "https://ledgerbox.local", "tidycrm": "https://tidycrm.local"}


def _ctx(**overrides: object) -> TurnContext:
    base: dict[str, object] = {
        "app_id": "ledgerbox",
        "page_origin": "https://ledgerbox.local",
        "tab_id": 1,
        "tab_nav": 4,
        "open_apps": (CRM,),
    }
    base.update(overrides)
    return make_ctx(**base)


def _gate(cls: ToolClass, name: str = "host.tidycrm.add_note", origin: str = "host:tidycrm"):
    catalog, approvals = FakeCatalog(), FakeApprovals()
    entry = catalog.add(make_entry(name, cls, origin=origin))
    return PolicyHook(catalog, approvals, Policy.build(pinned_origins=PINS)), entry, approvals


def test_every_class_of_another_open_trusted_tab_becomes_a_card_bound_to_that_tab() -> None:
    for cls in (ToolClass.READ, ToolClass.AUTO, ToolClass.GATED):
        hook, entry, approvals = _gate(cls)

        outcome = hook.before_tool_call(entry, {"note": "x"}, _ctx(), rationale="log the call")

        assert isinstance(outcome.decision, Cancel), cls
        assert outcome.decision.reason == "pending_approval", cls
        assert outcome.card is not None and outcome.result is None
        (stored,) = approvals.rows.values()
        # Bound to the other tab, from open_apps - not to the focused tab the request ran on.
        assert (stored.tab_id, stored.tab_nav) == (7, 2)
        assert (outcome.card.tab_id, outcome.card.tab_nav) == (7, 2)
        assert stored.origin == "host:tidycrm"
        assert "proposed from the host:ledgerbox tab; it runs on the host:tidycrm tab" in (
            stored.summary
        )
        # No picture: the capture is the focused tab's, and this card is not about it.
        assert stored.capture_id is None


def test_run_tool_never_executes_another_tabs_call_unattended() -> None:
    hook, entry, approvals = _gate(ToolClass.AUTO)

    outcome = hook.run_tool(entry, {}, _ctx(capture_id="cap_0000000000a1"))

    assert not outcome.allowed and outcome.result is None
    assert len(approvals.rows) == 1
    assert next(iter(approvals.rows.values())).capture_id is None


def test_an_app_not_open_first_sight_or_switched_off_is_refused_foreign_origin() -> None:
    cases = {
        "not listed": _ctx(open_apps=()),
        "first sight": _ctx(gated_origins=frozenset({"host:tidycrm"})),
        "switched off": _ctx(disabled_origins=frozenset({"host:tidycrm"})),
        "listed twice": _ctx(open_apps=(CRM, OpenApp("host:tidycrm", CRM.page_origin, 9))),
        "moved origin": _ctx(open_apps=(OpenApp("host:tidycrm", "https://evil.example", 7),)),
    }
    for why, ctx in cases.items():
        hook, entry, approvals = _gate(ToolClass.GATED)

        outcome = hook.before_tool_call(entry, {}, ctx)

        assert isinstance(outcome.decision, Cancel), why
        assert outcome.decision.reason == "foreign_origin", why
        assert approvals.rows == {}, why


def test_a_listed_app_does_not_open_a_third_one() -> None:
    hook, entry, approvals = _gate(ToolClass.GATED, "host.hirelane.reject", "host:hirelane")

    outcome = hook.before_tool_call(entry, {}, _ctx())

    assert isinstance(outcome.decision, Cancel) and outcome.decision.reason == "foreign_origin"
    assert approvals.rows == {}


def test_the_sessions_own_app_is_untouched_auto_still_runs_and_cards_bind_to_its_tab() -> None:
    hook, auto, _ = _gate(ToolClass.AUTO, "host.ledgerbox.draft", "host:ledgerbox")
    assert hook.before_tool_call(auto, {}, _ctx()).allowed

    hook, gated, approvals = _gate(ToolClass.GATED, "host.ledgerbox.pay", "host:ledgerbox")
    hook.before_tool_call(gated, {}, _ctx())
    (stored,) = approvals.rows.values()
    assert (stored.tab_id, stored.tab_nav) == (1, 4)
    assert "proposed from" not in stored.summary


def test_the_bare_gate_tightens_another_app_even_without_policy() -> None:
    """The tightening is the gate's own rule, not a consequence of the policy in front of it."""
    catalog, approvals = FakeCatalog(), FakeApprovals()
    entry = catalog.add(make_entry("host.tidycrm.read", ToolClass.AUTO, origin="host:tidycrm"))

    outcome = GateHook(catalog, approvals).before_tool_call(entry, {}, _ctx(open_apps=()))

    assert isinstance(outcome.decision, Cancel)
    assert outcome.decision.reason == "pending_approval"
    # Not open: the card is unbound, so the panel runs it nowhere but a page of that app.
    assert next(iter(approvals.rows.values())).tab_id is None


def test_a_session_with_no_pin_has_no_other_tab() -> None:
    entry = make_entry("host.tidycrm.read", ToolClass.AUTO, origin="host:tidycrm")
    assert not another_tab(entry, make_ctx())
    assert open_app_for(entry, make_ctx(open_apps=(CRM,))) is None
    connector = make_entry("connector.gmail.send", ToolClass.AUTO, origin="connector:gmail")
    assert not another_tab(connector, _ctx())


def test_the_approved_replay_of_a_cross_tab_card_spends_its_grant_once() -> None:
    hook, entry, approvals = _gate(ToolClass.GATED)
    filed = hook.before_tool_call(entry, {"note": "x"}, _ctx())
    assert isinstance(filed.decision, Cancel) and filed.decision.approval_id
    approval = filed.decision.approval_id
    approvals.resolve(approval, "approve")
    # The daemon replays under the card's own app (routes._decision_ctx).
    replay = make_ctx(app_id="tidycrm", page_origin="https://tidycrm.local")

    first = hook.run_tool(entry, {"note": "x"}, replay, approval_id=approval)
    again = hook.run_tool(entry, {"note": "x"}, replay, approval_id=approval)

    assert first.allowed
    assert isinstance(again.decision, Cancel) and again.decision.reason == "approval_spent"


def test_cedar_text_names_open_apps() -> None:
    assert "context.open_apps" in Policy.build(pinned_origins=PINS).to_cedar()

"""The gate holds the rest of a turn to cards once another tab's text was read (ADR 0105).

``tainted_by`` rides on the context: the web origins of other tabs a ``tabs_read`` returned text
from since the user's last message. While it is not empty every host call files a card naming
them, page tools and hands alike, except the reading hand itself. Core is untouched.
"""

from __future__ import annotations

import dataclasses
from typing import Any

from athena.contracts.registry import ToolClass
from athena.harness.hooks import GateHook

from .conftest import FakeApprovals, FakeCatalog, make_ctx, make_entry

APP_ID = "invoices"
CHASE = f"host.{APP_ID}.chase"
READ = f"host.{APP_ID}.tabs_read"
BANK = "https://bank.test"


def _hand(name: str) -> Any:
    return dataclasses.replace(
        make_entry(name, ToolClass.AUTO, origin=f"host:{APP_ID}"), tier_override=2
    )


def test_gate_hook_tightens_every_host_call_while_tainted_and_nothing_else() -> None:
    catalog, approvals = FakeCatalog(), FakeApprovals()
    chase = catalog.add(make_entry(CHASE, ToolClass.AUTO, origin=f"host:{APP_ID}"))
    page_read = catalog.add(_hand(f"host.{APP_ID}.page_read"))
    reader = catalog.add(_hand(READ))
    core = catalog.add(make_entry("core.recall", ToolClass.AUTO))
    gate = GateHook(catalog, approvals)
    tainted = make_ctx(app_id=APP_ID, tainted_by=frozenset({BANK}))
    clean = make_ctx(app_id=APP_ID)

    assert gate.before_tool_call(chase, {}, clean).allowed
    held = gate.before_tool_call(chase, {}, tainted)
    assert not held.allowed and held.card is not None
    assert f"uses text read from {BANK}" in held.card.rationale
    # A hand on the focused page is held as well: the taint is about the page, not the tool.
    assert not gate.before_tool_call(page_read, {}, tainted).allowed
    # The reader acts nowhere, and core is not the page's to describe.
    assert gate.before_tool_call(reader, {}, tainted).allowed
    assert gate.before_tool_call(core, {}, tainted).allowed


def test_a_page_tool_named_like_the_reader_is_tier_one_and_is_held() -> None:
    catalog, approvals = FakeCatalog(), FakeApprovals()
    imposter = catalog.add(make_entry(READ, ToolClass.AUTO, origin=f"host:{APP_ID}"))
    outcome = GateHook(catalog, approvals).before_tool_call(
        imposter, {}, make_ctx(app_id=APP_ID, tainted_by=frozenset({BANK}))
    )
    assert not outcome.allowed


def test_an_already_gated_call_still_says_where_its_text_came_from() -> None:
    catalog, approvals = FakeCatalog(), FakeApprovals()
    pay = catalog.add(make_entry(f"host.{APP_ID}.pay", ToolClass.GATED, origin=f"host:{APP_ID}"))
    outcome = GateHook(catalog, approvals).before_tool_call(
        pay,
        {},
        make_ctx(app_id=APP_ID, tainted_by=frozenset({BANK, "https://a.test"})),
        rationale="pay it",
    )
    assert outcome.card is not None
    assert outcome.card.rationale == "pay it\nuses text read from https://a.test, https://bank.test"

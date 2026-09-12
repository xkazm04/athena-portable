"""The real ``athena.core`` classes satisfy the harness's ports (README §3.1).

A structural claim is worth what a call proves, so this file does not stop at ``isinstance``: it
builds a real brain, a real catalog, a real approval table and a real ledger, and drives one gated
call through the gate and back — file the card, resolve it, replay it, execute. If a core
signature ever drifts from a port, this is the test that goes red, and it goes red at the call and
not at a type comment.

The fact's source is a real episode appended to the brain, because provenance is enforced at write
and a fixture that bypassed it would be testing a system nobody ships.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Sequence
from pathlib import Path
from typing import Any

import pytest

from athena.contracts.channel import DecisionRequested
from athena.contracts.registry import ExecResult, Lane, ToolClass, TurnContext
from athena.core.approvals import Approvals
from athena.core.brain import Brain
from athena.core.catalog import Catalog, CoreServices
from athena.core.ledger import Ledger
from athena.harness.hooks import Cancel, GateHook, LedgerHook, TruncationHook
from athena.harness.ports import (
    ApprovalsPort,
    Card,
    CatalogPort,
    FlagPort,
    Grant,
    LedgerPort,
    ModelChunk,
    ModelFn,
    ModelRequest,
    Row,
    stream_of,
)


@pytest.fixture
def brain(tmp_path: Path) -> Brain:
    return Brain(tmp_path / "brain")


def _catalog(brain: Brain, written: list[dict[str, Any]]) -> Catalog:
    def sources_alive(sources: Sequence[str]) -> bool:
        return bool(sources) and len(brain.live_episode_ids(sources)) == len(set(sources))

    def write_fact(params: dict[str, Any], ctx: TurnContext) -> ExecResult:
        written.append(dict(params))
        return ExecResult(ok=True, output=f"wrote {params['key']}")

    catalog = Catalog()
    catalog.register_core(CoreServices(sources_alive=sources_alive, write_fact=write_fact))
    return catalog


def test_the_core_classes_are_the_ports(brain: Brain) -> None:
    catalog = _catalog(brain, [])
    approvals = Approvals(brain)
    ledger = Ledger(brain)

    assert isinstance(catalog, CatalogPort)
    assert isinstance(approvals, ApprovalsPort)
    assert isinstance(ledger, LedgerPort)
    assert isinstance(LedgerHook(ledger), FlagPort)


def test_an_approval_row_is_a_card_and_a_grant(brain: Brain) -> None:
    approvals = Approvals(brain)
    row = approvals.create(
        "core.write_fact",
        {"key": "late-payer"},
        origin="core",
        conversation="conv_invoices",
        surface="panel",
    )
    assert isinstance(row, Card)
    assert isinstance(row.to_event(), DecisionRequested)
    assert isinstance(approvals.describe(row.id), Grant)


def test_a_ledger_row_is_a_row(brain: Brain) -> None:
    row = Ledger(brain).record(
        engine="claude_code",
        model="claude-opus-5",
        conversation="conv_invoices",
        origin="core",
        surface="panel",
        trigger="cli",
        rounds=8,
    )
    assert isinstance(row, Row)
    assert row.rounds == 8


def test_the_gate_drives_the_real_core_from_card_to_execution(brain: Brain) -> None:
    """One gated call, end to end, on nothing but real core objects."""
    written: list[dict[str, Any]] = []
    catalog = _catalog(brain, written)
    approvals = Approvals(brain)
    ledger = Ledger(brain)
    gate = GateHook(catalog, approvals)

    episode = brain.append_episode("The client has not paid since June.", role="user")
    params = {"key": "late-payer", "value": "pays at 45 days", "sources": [episode.id]}
    ctx = TurnContext(
        conversation_id="conv_invoices", turn_id="turn_000000000001", lane=Lane.BROWSER
    )

    assert catalog.classify("core.write_fact") is ToolClass.GATED
    first = gate.run_tool(catalog.get("core.write_fact"), params, ctx, rationale="act 4")
    assert isinstance(first.decision, Cancel)
    assert first.decision.reason == "pending_approval"
    assert written == []

    approval_id = first.decision.approval_id
    assert approval_id is not None
    grant = approvals.describe(approval_id)
    assert grant.matches("core.write_fact", params)
    approvals.resolve(approval_id, "approve")

    replay = gate.run_tool(catalog.get("core.write_fact"), params, ctx, approval_id=approval_id)
    assert replay.allowed
    assert written == [params]
    assert replay.result is not None and replay.result.ok

    # and the same objects carry the row and the tripwire
    hook = LedgerHook(ledger)
    TruncationHook(hook).before_prompt([], "turn_000000000001")
    assert hook.flags == []


def test_a_dead_source_is_refused_before_a_card_is_filed(brain: Brain) -> None:
    """Provenance is the validator's, so the user is never shown a card that could not execute."""
    written: list[dict[str, Any]] = []
    catalog = _catalog(brain, written)
    approvals = Approvals(brain)
    ctx = TurnContext(conversation_id="conv_invoices", turn_id="turn_000000000002")

    outcome = GateHook(catalog, approvals).run_tool(
        catalog.get("core.write_fact"),
        {"key": "k", "value": "v", "sources": ["ep_deadbeef"]},
        ctx,
    )
    assert isinstance(outcome.decision, Cancel)
    assert outcome.decision.reason == "validator_failed"
    assert approvals.pending().total == 0
    assert written == []


def test_model_fn_is_satisfied_by_a_scripted_stream() -> None:
    """The seam for an engine that is not a CLI, exercised the only way a seam can be."""
    chunks = [ModelChunk(kind="text", text="hello"), ModelChunk(kind="done")]

    def engine(request: ModelRequest) -> AsyncIterator[ModelChunk]:
        assert request.system == "law"
        return stream_of(chunks)

    fn: ModelFn = engine

    async def drain() -> list[str]:
        return [chunk.kind async for chunk in fn(ModelRequest(system="law", messages=()))]

    assert asyncio.run(drain()) == ["text", "done"]

"""The gate is the policy (README §2 invariant 3, §3.3; ADR 0004).

Each test here is a way a gate has been walked through before: a gated tool that ran anyway, a
validator that was consulted after the card was filed, a capped answer that did not say it was
capped, and an approval spent on a second call with different parameters.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from athena.contracts.harness import ERROR_REASONS, PromptBlock, TurnResult
from athena.contracts.registry import (
    ExecResult,
    ToolClass,
    ToolEntry,
    TurnContext,
    ValidationResult,
)
from athena.harness.hooks import Cancel, GateHook, LedgerHook, Proceed, TruncationHook

from .conftest import FakeApprovals, FakeCatalog, FakeLedger

EntryFactory = Callable[..., ToolEntry]


def _gate(catalog: FakeCatalog, approvals: FakeApprovals) -> GateHook:
    return GateHook(catalog, approvals)


# --- classes -------------------------------------------------------------------------------------


def test_a_gated_op_files_a_card_and_never_executes(
    catalog: FakeCatalog,
    approvals: FakeApprovals,
    ctx: TurnContext,
    entry: EntryFactory,
) -> None:
    ran: list[dict[str, Any]] = []

    def executor(params: dict[str, Any], context: TurnContext) -> ExecResult:
        ran.append(params)
        return ExecResult(ok=True, output="sent")

    row = catalog.add(entry("core.pay", ToolClass.GATED, executor=executor))
    outcome = _gate(catalog, approvals).run_tool(row, {"amount": 40}, ctx, rationale="the invoice")

    assert ran == []
    assert outcome.result is None
    assert isinstance(outcome.decision, Cancel)
    assert outcome.decision.reason == "pending_approval"
    assert outcome.decision.approval_id in approvals.rows
    card = approvals.rows[outcome.decision.approval_id]
    assert (card.action, card.params) == ("core.pay", {"amount": 40})
    assert (card.origin, card.conversation, card.surface) == ("core", ctx.conversation_id, "panel")
    assert card.summary == "the invoice"
    assert outcome.card is not None and outcome.card.action == "core.pay"


def test_an_auto_op_with_a_failing_validator_is_cancelled_with_the_reason(
    catalog: FakeCatalog,
    approvals: FakeApprovals,
    ctx: TurnContext,
    entry: EntryFactory,
) -> None:
    ran: list[str] = []

    def executor(params: dict[str, Any], context: TurnContext) -> ExecResult:
        ran.append("yes")
        return ExecResult(ok=True)

    def validator(params: dict[str, Any], context: TurnContext) -> ValidationResult:
        return ValidationResult.reject("validator_failed", "'text' is required")

    row = catalog.add(
        entry("core.checkpoint", ToolClass.AUTO, executor=executor, validator=validator)
    )
    outcome = _gate(catalog, approvals).run_tool(row, {}, ctx)

    assert ran == []
    assert isinstance(outcome.decision, Cancel)
    assert outcome.decision.reason == "validator_failed"
    assert outcome.decision.detail == "'text' is required"


def test_an_auto_op_whose_validator_passes_executes(
    catalog: FakeCatalog, approvals: FakeApprovals, ctx: TurnContext, entry: EntryFactory
) -> None:
    row = catalog.add(entry("core.checkpoint", ToolClass.AUTO))
    outcome = _gate(catalog, approvals).run_tool(row, {"text": "x"}, ctx)
    assert isinstance(outcome.decision, Proceed)
    assert outcome.result is not None and outcome.result.output == "ran"


def test_the_validator_runs_before_a_card_is_filed(
    catalog: FakeCatalog, approvals: FakeApprovals, ctx: TurnContext, entry: EntryFactory
) -> None:
    """A card the user could approve and that would then fail is a card not worth showing."""

    def validator(params: dict[str, Any], context: TurnContext) -> ValidationResult:
        return ValidationResult.reject("validator_failed", "dead sources")

    row = catalog.add(entry("core.write_fact", ToolClass.GATED, validator=validator))
    outcome = _gate(catalog, approvals).run_tool(row, {"key": "k"}, ctx)

    assert approvals.rows == {}
    assert isinstance(outcome.decision, Cancel)
    assert outcome.decision.reason == "validator_failed"


def test_a_host_tool_is_allowed_but_has_no_executor_here(
    catalog: FakeCatalog, approvals: FakeApprovals, ctx: TurnContext, entry: EntryFactory
) -> None:
    """README §3.2 step 5: the gate allows it, the page runs it."""
    row = catalog.add(entry("host.invoices.read", ToolClass.AUTO, origin="host:invoices"))
    outcome = _gate(catalog, approvals).run_tool(row, {}, ctx)
    assert outcome.allowed
    assert outcome.result is None


# --- the READ cap --------------------------------------------------------------------------------


def test_a_read_answer_over_the_cap_is_cut_and_announces_it(
    catalog: FakeCatalog, approvals: FakeApprovals, ctx: TurnContext, entry: EntryFactory
) -> None:
    def executor(params: dict[str, Any], context: TurnContext) -> ExecResult:
        return ExecResult(ok=True, output="x" * 4000)

    row = catalog.add(entry("core.recall", ToolClass.READ, executor=executor, cap_chars=1600))
    outcome = _gate(catalog, approvals).run_tool(row, {"query": "q"}, ctx)

    assert outcome.result is not None
    result = outcome.result
    assert result.truncated
    assert result.shown == 1600
    assert result.total == 4000
    assert result.output.endswith("(showing 1600 of 4000)")
    assert result.footer() in result.output


def test_a_read_answer_under_the_cap_is_untouched(
    catalog: FakeCatalog, approvals: FakeApprovals, ctx: TurnContext, entry: EntryFactory
) -> None:
    def executor(params: dict[str, Any], context: TurnContext) -> ExecResult:
        return ExecResult(ok=True, output="short")

    row = catalog.add(entry("core.recall", ToolClass.READ, executor=executor))
    outcome = _gate(catalog, approvals).run_tool(row, {"query": "q"}, ctx)
    assert outcome.result is not None
    assert outcome.result.output == "short"
    assert not outcome.result.truncated


def test_an_executor_that_bounded_its_own_answer_is_left_alone(
    catalog: FakeCatalog, approvals: FakeApprovals, ctx: TurnContext, entry: EntryFactory
) -> None:
    def executor(params: dict[str, Any], context: TurnContext) -> ExecResult:
        return ExecResult.bounded(["a", "b", "c"], 2)

    row = catalog.add(entry("core.recall", ToolClass.READ, executor=executor))
    outcome = _gate(catalog, approvals).run_tool(row, {"query": "q"}, ctx)
    assert outcome.result is not None
    assert outcome.result.output == "a\nb\n(showing 2 of 3)"


# --- the replay (README §3.2 step 6) -------------------------------------------------------------


def test_a_gated_call_replayed_with_a_matching_approval_executes(
    catalog: FakeCatalog, approvals: FakeApprovals, ctx: TurnContext, entry: EntryFactory
) -> None:
    ran: list[dict[str, Any]] = []

    def executor(params: dict[str, Any], context: TurnContext) -> ExecResult:
        ran.append(params)
        return ExecResult(ok=True, output="sent")

    row = catalog.add(entry("core.pay", ToolClass.GATED, executor=executor))
    gate = _gate(catalog, approvals)
    first = gate.run_tool(row, {"amount": 40}, ctx)
    assert isinstance(first.decision, Cancel)
    approval_id = first.decision.approval_id
    assert approval_id is not None
    approvals.resolve(approval_id, "approve")

    replay = gate.run_tool(row, {"amount": 40}, ctx, approval_id=approval_id)
    assert replay.allowed
    assert ran == [{"amount": 40}]
    assert replay.result is not None and replay.result.output == "sent"


def test_a_replay_with_different_parameters_is_refused(
    catalog: FakeCatalog, approvals: FakeApprovals, ctx: TurnContext, entry: EntryFactory
) -> None:
    ran: list[dict[str, Any]] = []

    def executor(params: dict[str, Any], context: TurnContext) -> ExecResult:
        ran.append(params)
        return ExecResult(ok=True)

    row = catalog.add(entry("core.pay", ToolClass.GATED, executor=executor))
    gate = _gate(catalog, approvals)
    first = gate.run_tool(row, {"amount": 40}, ctx)
    assert isinstance(first.decision, Cancel) and first.decision.approval_id
    approvals.resolve(first.decision.approval_id, "approve")

    replay = gate.run_tool(row, {"amount": 4000}, ctx, approval_id=first.decision.approval_id)
    assert ran == []
    assert isinstance(replay.decision, Cancel)
    assert replay.decision.reason == "validator_failed"


def test_a_replay_against_a_declined_card_is_user_denied(
    catalog: FakeCatalog, approvals: FakeApprovals, ctx: TurnContext, entry: EntryFactory
) -> None:
    row = catalog.add(entry("core.pay", ToolClass.GATED))
    gate = _gate(catalog, approvals)
    first = gate.run_tool(row, {"amount": 40}, ctx)
    assert isinstance(first.decision, Cancel) and first.decision.approval_id
    approvals.resolve(first.decision.approval_id, "decline")

    replay = gate.run_tool(row, {"amount": 40}, ctx, approval_id=first.decision.approval_id)
    assert isinstance(replay.decision, Cancel)
    assert replay.decision.reason == "user_denied"


def test_a_replay_against_an_unknown_approval_is_unknown_ref(
    catalog: FakeCatalog, approvals: FakeApprovals, ctx: TurnContext, entry: EntryFactory
) -> None:
    row = catalog.add(entry("core.pay", ToolClass.GATED))
    replay = _gate(catalog, approvals).run_tool(row, {}, ctx, approval_id="apr_nope")
    assert isinstance(replay.decision, Cancel)
    assert replay.decision.reason == "unknown_ref"


def test_a_cancel_reason_is_always_from_the_closed_set() -> None:
    assert Cancel("something nobody registered").reason == "unknown"
    assert all(Cancel(reason).reason == reason for reason in ERROR_REASONS)


# --- the ledger ----------------------------------------------------------------------------------


def test_one_turn_is_one_row_even_when_the_hook_is_called_twice(ledger: FakeLedger) -> None:
    hook = LedgerHook(ledger)
    result = TurnResult(turn_id="turn_1", engine="claude_code", model="opus", rounds=3)
    first = hook.after_turn(result, conversation="conv_invoices", origin="core", surface="panel")
    second = hook.after_turn(result, conversation="conv_invoices", origin="core", surface="panel")
    assert first == 1
    assert second is None
    assert len(ledger.rows) == 1
    assert ledger.rows[0].rounds == 3


def test_a_failed_turn_writes_one_error_row_with_a_normalised_reason(ledger: FakeLedger) -> None:
    hook = LedgerHook(ledger)
    result = TurnResult(turn_id="turn_2", engine="codex", is_error=True)
    result.error_reason = "the CLI fell over"  # not a member; set after __post_init__ on purpose
    hook.after_turn(result, conversation="conv_invoices", origin="core", surface="panel")
    assert len(ledger.error_rows) == 1
    assert ledger.error_rows[0].error_reason == "unknown"


# --- truncation ----------------------------------------------------------------------------------


def test_a_truncated_block_without_a_footer_is_a_warning_and_a_flag_never_a_block(
    ledger: FakeLedger,
) -> None:
    hook = LedgerHook(ledger)
    truncation = TruncationHook(hook)
    silent = PromptBlock(name="frame.episodes", text="one episode", shown=1, total=9)

    warnings = truncation.before_prompt([silent], "turn_3")

    assert len(warnings) == 1
    assert "(showing 1 of 9)" in warnings[0]
    flags = hook.flags_for("turn_3")
    assert [flag.name for flag in flags] == ["truncation_unannounced"]
    assert ledger.rows == []  # a flag is not a row, and nothing about the turn changed


def test_an_honest_block_raises_nothing(ledger: FakeLedger) -> None:
    hook = LedgerHook(ledger)
    truncation = TruncationHook(hook)
    honest = PromptBlock(
        name="frame.episodes", text="one episode\n(showing 1 of 9)", shown=1, total=9
    )
    assert truncation.before_prompt([honest], "turn_4") == []
    assert hook.flags == []


def test_block_hashes_are_stable_for_identical_text() -> None:
    first = [PromptBlock(name="capabilities", text="- core.recall")]
    second = [PromptBlock(name="capabilities", text="- core.recall")]
    assert TruncationHook.block_hashes(first) == TruncationHook.block_hashes(second)
    assert TruncationHook.block_sizes(first) == {"capabilities": len("- core.recall")}

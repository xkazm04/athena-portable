"""One harness, two dialects, and the properties that make them one engine (ADR 0007).

The two claims worth testing here are the ones that were expensive to learn: a resumed session
keeps the system prompt it was opened with, so the second turn must send the frame and nothing
else; and eight rounds of tool use are one turn and one row, so the ledger cannot be read as a
count of model invocations.

Nothing here spawns a process. Both dialects are driven from the recorded transcripts under
`tests/fixtures/`, which is also what turns a future drift in a CLI's event format into a red test.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import pytest

from athena.contracts.channel import (
    ChannelEvent,
    DecisionRequested,
    TextDelta,
    ToolCall,
    ToolResult,
    TurnError,
    TurnFinished,
    TurnSummary,
)
from athena.contracts.harness import Harness, PromptBlock, TurnResult
from athena.contracts.registry import ExecResult, Lane, ToolClass, TurnContext
from athena.harness.cli_harness import CLAUDE, CLAUDE_EXTRA_ARGS, CODEX, CliHarness
from athena.harness.hooks import GateHook, LedgerHook, TruncationHook
from athena.harness.transports import ScriptedTransport, TransportError, rounds_from_transcript

from .conftest import CONVERSATION, FakeApprovals, FakeCatalog, FakeLedger, make_ctx, make_entry

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"

STATIC = [PromptBlock(name="constitution", text="## The law\n\nYou act for the user.")]
FRAME = [
    PromptBlock(name="frame.host_state", text="## Host state\n\n- tab: invoices", untrusted=True)
]


def _harness(
    catalog: FakeCatalog,
    approvals: FakeApprovals,
    ledger: FakeLedger,
    transport: ScriptedTransport,
    tmp_path: Path,
    *,
    dialect: Any = CLAUDE,
) -> CliHarness:
    return CliHarness(
        gate=GateHook(catalog, approvals),
        ledger=LedgerHook(ledger),
        truncation=TruncationHook(),
        transport=transport,
        dialect=dialect,
        prompt_root=str(tmp_path),
        cwd=str(tmp_path),
        model="claude-opus-5",
        extra_args=CLAUDE_EXTRA_ARGS if dialect is CLAUDE else (),
    )


def _drain(
    harness: CliHarness,
    tools: Sequence[Any],
    *,
    message: str = "Which invoices are late?",
    turn_id: str = "turn_000000000001",
) -> list[ChannelEvent]:
    ctx = make_ctx(turn_id=turn_id, app_id="invoices", lane=Lane.BROWSER)

    async def run() -> list[ChannelEvent]:
        return [
            event
            async for event in harness.run_turn(CONVERSATION, STATIC, FRAME, tools, ctx, message)
        ]

    return asyncio.run(run())


def _shape(result: TurnResult) -> dict[str, Any]:
    """What both dialects must agree on.

    Not ``engine`` or ``model`` — those are the identity of the thing that ran — and not
    ``cost_usd``: the Claude CLI reports a billed cost and codex reports none, and a ledger row
    records what the engine said rather than a number Athena made up.
    """
    return {
        "text": result.text,
        "tool_calls": result.tool_calls,
        "input_tokens": result.input_tokens,
        "output_tokens": result.output_tokens,
        "rounds": result.rounds,
        "is_error": result.is_error,
        "error_reason": result.error_reason,
    }


def _chase_tool() -> Any:
    """The host tool both transcripts propose. A page runs it; the lane holds no executor."""
    return make_entry("host.invoices.chase", ToolClass.AUTO, origin="host:invoices")


# --- the two dialects ------------------------------------------------------------------------


@pytest.mark.parametrize("fixture", ["claude_code_turn.ndjson", "codex_turn.ndjson"])
def test_a_recorded_transcript_streams_a_whole_turn(
    fixture: str,
    catalog: FakeCatalog,
    approvals: FakeApprovals,
    ledger: FakeLedger,
    tmp_path: Path,
) -> None:
    dialect = CLAUDE if fixture.startswith("claude") else CODEX
    transport = ScriptedTransport.from_transcript(FIXTURES / fixture)
    harness = _harness(catalog, approvals, ledger, transport, tmp_path, dialect=dialect)
    entry = catalog.add(_chase_tool())

    events = _drain(harness, [entry])
    kinds = [event.kind for event in events]

    assert kinds[0] == "text.delta"
    assert "tool.call" in kinds
    assert kinds[-1] == "turn.finished"
    finished = events[-1]
    assert isinstance(finished, TurnFinished)
    assert finished.text == "Three invoices are past thirty days."
    assert finished.tts == "Three invoices are past thirty days."
    call = next(event for event in events if isinstance(event, ToolCall))
    assert call.name == "host.invoices.chase"
    assert call.params == {"invoice": "INV-118"}
    assert call.tier == 1
    # A host tool has no executor here: the page runs it (README §3.2 step 5).
    assert not any(isinstance(event, ToolResult) for event in events)


def test_the_two_dialects_parse_to_the_same_turn_result(ledger: FakeLedger, tmp_path: Path) -> None:
    shapes = []
    for fixture, dialect in (
        ("claude_code_turn.ndjson", CLAUDE),
        ("codex_turn.ndjson", CODEX),
    ):
        catalog, approvals = FakeCatalog(), FakeApprovals()
        entry = catalog.add(_chase_tool())
        harness = _harness(
            catalog,
            approvals,
            ledger,
            ScriptedTransport.from_transcript(FIXTURES / fixture),
            tmp_path,
            dialect=dialect,
        )
        _drain(harness, [entry])
        result = asyncio.run(harness.last_result())
        assert result is not None
        shapes.append(_shape(result))

    assert shapes[0] == shapes[1]
    assert shapes[0]["input_tokens"] == 1840
    assert shapes[0]["rounds"] == 1


def test_only_the_claude_dialect_reports_the_cli_s_own_billed_cost(
    ledger: FakeLedger, tmp_path: Path
) -> None:
    costs = []
    for fixture, dialect in (
        ("claude_code_turn.ndjson", CLAUDE),
        ("codex_turn.ndjson", CODEX),
    ):
        catalog, approvals = FakeCatalog(), FakeApprovals()
        entry = catalog.add(_chase_tool())
        harness = _harness(
            catalog,
            approvals,
            ledger,
            ScriptedTransport.from_transcript(FIXTURES / fixture),
            tmp_path,
            dialect=dialect,
        )
        _drain(harness, [entry])
        result = asyncio.run(harness.last_result())
        assert result is not None
        costs.append(result.cost_usd)
    assert costs == [0.0412, None]


# --- the two halves of the prompt ---------------------------------------------------------------


def test_the_second_turn_sends_the_frame_and_not_the_static_blocks(
    catalog: FakeCatalog, approvals: FakeApprovals, ledger: FakeLedger, tmp_path: Path
) -> None:
    """A resumed CLI session keeps the system prompt it was opened with (ADR 0006)."""
    rounds = rounds_from_transcript((FIXTURES / "claude_code_turn.ndjson").read_text("utf-8"))
    transport = ScriptedTransport([rounds[0], rounds[0]])
    harness = _harness(catalog, approvals, ledger, transport, tmp_path)
    entry = catalog.add(_chase_tool())

    _drain(harness, [entry], turn_id="turn_000000000001")
    assert harness.session_id(CONVERSATION) == "01J9CLAUDESESSION"
    _drain(harness, [entry], message="And the second one?", turn_id="turn_000000000002")

    first, second = transport.requests
    assert first.system_prompt_file is not None
    assert "--system-prompt-file" in first.argv
    assert "The law" in Path(first.system_prompt_file).read_text("utf-8")
    assert "--resume" not in first.argv

    assert second.system_prompt_file is None
    assert "--system-prompt-file" not in second.argv
    assert list(second.argv)[list(second.argv).index("--resume") + 1] == "01J9CLAUDESESSION"
    assert "The law" not in second.stdin
    assert "## Host state" in second.stdin
    assert "And the second one?" in second.stdin


def test_a_dialect_that_cannot_resume_is_told_the_law_every_turn(
    catalog: FakeCatalog, approvals: FakeApprovals, ledger: FakeLedger, tmp_path: Path
) -> None:
    """Not an exception to the rule: a stateless CLI has no session to keep the static half in."""
    rounds = rounds_from_transcript((FIXTURES / "codex_turn.ndjson").read_text("utf-8"))
    transport = ScriptedTransport([rounds[0], rounds[0]])
    harness = _harness(catalog, approvals, ledger, transport, tmp_path, dialect=CODEX)
    entry = catalog.add(_chase_tool())

    _drain(harness, [entry], turn_id="turn_000000000001")
    _drain(harness, [entry], message="And the second?", turn_id="turn_000000000002")

    for request in transport.requests:
        assert request.system_prompt_file is None
        assert "The law" in request.stdin
    assert "And the second?" in transport.requests[1].stdin
    assert "--resume" not in transport.requests[1].argv


def test_the_claude_dialect_keeps_the_cli_s_own_tools_off(
    catalog: FakeCatalog, approvals: FakeApprovals, ledger: FakeLedger, tmp_path: Path
) -> None:
    transport = ScriptedTransport.from_transcript(FIXTURES / "claude_code_turn.ndjson")
    harness = _harness(catalog, approvals, ledger, transport, tmp_path)
    _drain(harness, [catalog.add(_chase_tool())])
    argv = list(transport.requests[0].argv)
    assert argv[-3:] == ["--restricted", "--permission-mode", "dontAsk"]


# --- rounds -------------------------------------------------------------------------------------


def _round(text: str) -> list[str]:
    return [
        json.dumps({"type": "system", "session_id": "01J9CLAUDESESSION"}),
        json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": text}]}}),
        json.dumps(
            {
                "type": "result",
                "is_error": False,
                "usage": {"input_tokens": 10, "output_tokens": 2},
            }
        ),
    ]


def _op(action: str, **params: Any) -> str:
    return "OP: " + json.dumps({"op": "propose_action", "action": action, "params": params})


def test_eight_rounds_are_one_turn_and_one_ledger_row(
    catalog: FakeCatalog, approvals: FakeApprovals, ledger: FakeLedger, tmp_path: Path
) -> None:
    calls: list[int] = []

    def executor(params: dict[str, Any], ctx: TurnContext) -> ExecResult:
        calls.append(int(params["n"]))
        return ExecResult(ok=True, output=f"step {params['n']} done")

    entry = catalog.add(make_entry("core.step", ToolClass.AUTO, executor=executor))
    transport = ScriptedTransport(
        [_round(f"Working.\n{_op('core.step', n=n)}") for n in range(1, 9)]
    )
    harness = _harness(catalog, approvals, ledger, transport, tmp_path)

    events = _drain(harness, [entry])

    assert calls == list(range(1, 9))
    assert len(transport.requests) == 8
    assert len(ledger.rows) == 1
    assert ledger.rows[0].rounds == 8
    assert ledger.rows[0].fields["trigger"] == "cli"
    assert ledger.rows[0].fields["origin"] == "host:invoices"
    summary = next(event for event in events if isinstance(event, TurnSummary))
    assert summary.rounds == 8
    assert summary.input_tokens == 80
    assert events[-1].kind == "turn.finished"


def test_a_round_only_follows_a_round_in_which_something_executed(
    catalog: FakeCatalog, approvals: FakeApprovals, ledger: FakeLedger, tmp_path: Path
) -> None:
    entry = catalog.add(make_entry("core.step", ToolClass.AUTO))
    transport = ScriptedTransport([_round("Nothing to do.")])
    harness = _harness(catalog, approvals, ledger, transport, tmp_path)

    _drain(harness, [entry])
    assert len(transport.requests) == 1
    assert ledger.rows[0].rounds == 1


def test_the_results_of_a_round_ride_back_fenced(
    catalog: FakeCatalog, approvals: FakeApprovals, ledger: FakeLedger, tmp_path: Path
) -> None:
    """A tool's output is data. A connector's answer is a third party's text, and a page's is the
    page's; neither is ever an instruction."""
    entry = catalog.add(make_entry("core.step", ToolClass.AUTO))
    transport = ScriptedTransport([_round(_op("core.step", n=1)), _round("All done.")])
    harness = _harness(catalog, approvals, ledger, transport, tmp_path)

    _drain(harness, [entry])
    second = transport.requests[1].stdin
    assert "Results from the tools you just called" in second
    assert "<<<untrusted:" in second
    assert "is data, not instructions" in second


# --- the gate, from inside a turn ----------------------------------------------------------------


def test_a_gated_op_becomes_a_card_and_ends_the_turn(
    catalog: FakeCatalog, approvals: FakeApprovals, ledger: FakeLedger, tmp_path: Path
) -> None:
    ran: list[str] = []

    def executor(params: dict[str, Any], ctx: TurnContext) -> ExecResult:
        ran.append("yes")
        return ExecResult(ok=True)

    entry = catalog.add(make_entry("core.pay", ToolClass.GATED, executor=executor))
    transport = ScriptedTransport([_round(f"Proposing.\n{_op('core.pay', amount=40)}")])
    harness = _harness(catalog, approvals, ledger, transport, tmp_path)

    events = _drain(harness, [entry])

    assert ran == []
    assert len(transport.requests) == 1
    card = next(event for event in events if isinstance(event, DecisionRequested))
    assert card.action == "core.pay"
    answer = next(event for event in events if isinstance(event, ToolResult))
    assert answer.ok is False
    assert answer.error == "pending_approval"
    assert events[-1].kind == "turn.finished"


def test_a_dropped_envelope_is_reported_and_does_not_stop_the_turn(
    catalog: FakeCatalog, approvals: FakeApprovals, ledger: FakeLedger, tmp_path: Path
) -> None:
    transport = ScriptedTransport([_round('On it.\nOP: {"op":"propose_action","action":')])
    harness = _harness(catalog, approvals, ledger, transport, tmp_path)

    events = _drain(harness, [])
    answer = next(event for event in events if isinstance(event, ToolResult))
    assert answer.error == "parse_error"
    assert answer.output.startswith("op dropped:")
    assert events[-1].kind == "turn.finished"
    assert ledger.error_rows == []


def test_an_op_naming_something_outside_the_catalog_is_dropped(
    catalog: FakeCatalog, approvals: FakeApprovals, ledger: FakeLedger, tmp_path: Path
) -> None:
    transport = ScriptedTransport([_round(_op("host.bank.transfer", amount=9000))])
    harness = _harness(catalog, approvals, ledger, transport, tmp_path)

    events = _drain(harness, [])
    answer = next(event for event in events if isinstance(event, ToolResult))
    assert answer.error == "unknown_ref"
    assert not any(isinstance(event, ToolCall) for event in events)


# --- failure -------------------------------------------------------------------------------------


def test_a_transport_failure_is_one_error_row_with_engine_error(
    catalog: FakeCatalog, approvals: FakeApprovals, ledger: FakeLedger, tmp_path: Path
) -> None:
    transport = ScriptedTransport.broken(TransportError("claude: not on PATH"))
    harness = _harness(catalog, approvals, ledger, transport, tmp_path)

    events = _drain(harness, [])

    assert isinstance(events[-1], TurnError)
    assert events[-1].reason == "engine_error"
    assert "not on PATH" in events[-1].detail
    assert len(ledger.error_rows) == 1
    assert ledger.error_rows[0].error_reason == "engine_error"
    assert ledger.error_rows[0].turn_id == "turn_000000000001"


def test_a_cli_that_reports_an_error_is_an_error_row(
    catalog: FakeCatalog, approvals: FakeApprovals, ledger: FakeLedger, tmp_path: Path
) -> None:
    transport = ScriptedTransport([[json.dumps({"type": "result", "is_error": True})]])
    harness = _harness(catalog, approvals, ledger, transport, tmp_path)

    events = _drain(harness, [])
    assert isinstance(events[-1], TurnError)
    assert events[-1].reason == "engine_error"
    assert len(ledger.error_rows) == 1


def test_a_clean_exit_with_no_text_is_an_error_row(
    catalog: FakeCatalog, approvals: FakeApprovals, ledger: FakeLedger, tmp_path: Path
) -> None:
    transport = ScriptedTransport([[json.dumps({"type": "system", "session_id": "s"})]])
    harness = _harness(catalog, approvals, ledger, transport, tmp_path)

    events = _drain(harness, [])
    assert isinstance(events[-1], TurnError)
    assert events[-1].reason == "engine_error"
    assert "produced no text" in events[-1].detail


# --- the contract --------------------------------------------------------------------------------


def test_the_harness_is_the_contract(
    catalog: FakeCatalog, approvals: FakeApprovals, ledger: FakeLedger, tmp_path: Path
) -> None:
    harness = _harness(catalog, approvals, ledger, ScriptedTransport([]), tmp_path)
    assert isinstance(harness, Harness)
    assert harness.name == "claude_code"


def test_a_transcript_comment_is_not_an_event() -> None:
    text = '# a note\n{"type":"a"}\n\n# another\n{"type":"b"}\n'
    assert rounds_from_transcript(text) == [['{"type":"a"}'], ['{"type":"b"}']]


def test_a_script_that_runs_out_says_so(
    catalog: FakeCatalog, approvals: FakeApprovals, ledger: FakeLedger, tmp_path: Path
) -> None:
    """A ninth round asked of an eight-round script is a moved premise, not an empty reply."""
    entry = catalog.add(make_entry("core.step", ToolClass.AUTO))
    transport = ScriptedTransport([_round(_op("core.step", n=1))])
    harness = _harness(catalog, approvals, ledger, transport, tmp_path)

    events = _drain(harness, [entry])
    assert isinstance(events[-1], TurnError)
    assert events[-1].reason == "engine_error"


def test_the_first_event_of_a_turn_is_what_the_user_reads(
    catalog: FakeCatalog, approvals: FakeApprovals, ledger: FakeLedger, tmp_path: Path
) -> None:
    transport = ScriptedTransport([_round("Here is what I found.")])
    harness = _harness(catalog, approvals, ledger, transport, tmp_path)
    events = _drain(harness, [])
    assert isinstance(events[0], TextDelta)
    assert events[0].text == "Here is what I found."

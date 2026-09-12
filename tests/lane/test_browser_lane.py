"""One turn end to end, with no browser and no provider (README §3.2, the P3 checkpoint).

Everything below the engine is real: the brain writes markdown to disk, the catalog merged a real
manifest, the gate is the gate, and the approval table and the ledger are the ones the record is
read from. The engine is a recorded transcript, which is the only part of the path a test has no
business spawning.
"""

from __future__ import annotations

from contextlib import closing
from pathlib import Path

import pytest

from athena.contracts.channel import (
    DecisionRequested,
    TextDelta,
    ToolCall,
    ToolResult,
    TurnFinished,
)
from athena.core.brain.store import Brain
from athena.core.catalog import Catalog
from athena.lane.turn_frame import RequestError, TurnRequest

from .conftest import APP, assistant, build_lane, drain, request, result_line, session

OP_READ = (
    'OP: {"op":"propose_action","action":"core.recall",'
    '"params":{"query":"overdue invoices"},"rationale":"what do I already know"}'
)
OP_HOST = (
    'OP: {"op":"propose_action","action":"host.invoices.list_overdue",'
    '"params":{},"rationale":"ask the page"}'
)
OP_GATED = (
    'OP: {"op":"propose_action","action":"host.invoices.chase",'
    '"params":{"invoice":"INV-118"},"rationale":"it is 41 days late"}'
)
OP_FOREIGN = (
    'OP: {"op":"propose_action","action":"host.inbox.draft",'
    '"params":{},"rationale":"write the chase in the other tab"}'
)


def one_round(*lines: str) -> list[list[str]]:
    return [[session(), *lines, result_line()]]


# --- the streamed turn ----------------------------------------------------------------------------


def test_a_turn_streams_text_a_summary_and_a_finish(
    brain: Brain, catalog: Catalog, tmp_path: Path
) -> None:
    lane, _, ledger, _ = build_lane(
        brain, catalog, one_round(assistant("Three are past thirty days.")), tmp_path
    )

    events = drain(lane, request())
    kinds = [event.kind for event in events]

    assert kinds == ["text.delta", "turn.summary", "turn.finished"]
    assert isinstance(events[0], TextDelta)
    assert isinstance(events[-1], TurnFinished)
    assert events[-1].text == "Three are past thirty days."
    assert ledger.recent(5).rows[0].rounds == 1


def test_the_user_message_and_the_answer_both_become_episodes(
    brain: Brain, catalog: Catalog, tmp_path: Path
) -> None:
    """A turn that left no trace in the brain is a turn nothing later can cite (invariant 2)."""
    lane, _, _, _ = build_lane(
        brain, catalog, one_round(assistant("Three are past thirty days.")), tmp_path
    )

    drain(lane, request("Which invoices are late?"))

    assert brain.counts()["episode"] == 2
    bodies = _bodies(brain)
    assert "Which invoices are late?" in bodies
    assert "Three are past thirty days." in bodies


def test_a_read_answer_becomes_a_system_episode(
    brain: Brain, catalog: Catalog, tmp_path: Path
) -> None:
    lane, _, _, _ = build_lane(
        brain,
        catalog,
        [
            [session(), assistant(f"Let me look.\n{OP_READ}"), result_line()],
            [assistant("Two facts."), result_line()],
        ],
        tmp_path,
    )

    events = drain(lane, request())
    answer = next(e for e in events if isinstance(e, ToolResult) and e.name == "core.recall")

    assert answer.ok
    assert any(body.startswith("core.recall →") for body in _bodies(brain))


# --- the three classes, through one gate ----------------------------------------------------------


def test_a_host_tool_is_an_instruction_and_the_lane_holds_no_executor(
    brain: Brain, catalog: Catalog, tmp_path: Path
) -> None:
    """README §3.2 step 5: the gate allows it, the page runs it, the answer rides the next frame."""
    lane, _, _, _ = build_lane(
        brain, catalog, one_round(assistant(f"Asking the page.\n{OP_HOST}")), tmp_path
    )

    events = drain(lane, request())
    call = next(e for e in events if isinstance(e, ToolCall))

    assert call.name == "host.invoices.list_overdue"
    assert call.tier == 1
    assert not [e for e in events if isinstance(e, ToolResult) and e.name == call.name]


def test_a_gated_tool_files_a_card_and_executes_nothing(
    brain: Brain, catalog: Catalog, tmp_path: Path
) -> None:
    lane, approvals, _, _ = build_lane(
        brain, catalog, one_round(assistant(f"One is very late.\n{OP_GATED}")), tmp_path
    )

    events = drain(lane, request())
    card = next(e for e in events if isinstance(e, DecisionRequested))
    refusal = next(e for e in events if isinstance(e, ToolResult))

    assert card.action == "host.invoices.chase"
    assert card.rationale == "it is 41 days late"
    assert refusal.error == "pending_approval"
    assert approvals.pending(10).total == 1


def test_a_tool_from_another_tab_is_refused_with_foreign_origin(
    brain: Brain, catalog: Catalog, tmp_path: Path
) -> None:
    """Structural policy, reached through the same gate the turn already runs behind."""
    lane, approvals, _, _ = build_lane(
        brain, catalog, one_round(assistant(f"I will use the inbox.\n{OP_FOREIGN}")), tmp_path
    )

    events = drain(lane, request())
    refusal = next(e for e in events if isinstance(e, ToolResult))

    assert refusal.error == "unknown_ref"
    assert approvals.pending(10).total == 0


def test_the_capability_block_names_only_this_turns_tools(
    brain: Brain, catalog: Catalog, tmp_path: Path
) -> None:
    lane, _, _, _ = build_lane(brain, catalog, one_round(assistant("ok")), tmp_path)
    names = {entry.name for entry in lane.capabilities(request())}

    assert "host.invoices.chase" in names
    assert not any(name.startswith("host.inbox.") for name in names)


# --- the gated path, closed later -----------------------------------------------------------------


def test_approving_a_host_card_returns_an_instruction_for_the_surface(
    brain: Brain, catalog: Catalog, tmp_path: Path
) -> None:
    """README §3.2 step 6: the replay proves the grant, and the page is told to act."""
    lane, approvals, _, _ = build_lane(brain, catalog, one_round(assistant(OP_GATED)), tmp_path)
    drain(lane, request())
    card = approvals.pending(10).rows[0]

    resolution = lane.resolve(card.id, "approve")

    assert resolution.approved
    assert resolution.result is None
    assert resolution.instruction is not None
    assert resolution.instruction.name == "host.invoices.chase"
    assert resolution.instruction.params == {"invoice": "INV-118"}
    assert [event.kind for event in resolution.events] == ["decision.resolved", "tool.call"]


def test_declining_a_card_runs_nothing_and_is_ledgered_user_denied(
    brain: Brain, catalog: Catalog, tmp_path: Path
) -> None:
    """Act 4 shows both declines in the record; a decline nothing stored is no record at all."""
    lane, approvals, ledger, _ = build_lane(
        brain, catalog, one_round(assistant(OP_GATED)), tmp_path
    )
    drain(lane, request())
    card = approvals.pending(10).rows[0]

    resolution = lane.resolve(card.id, "decline")

    assert not resolution.approved
    assert resolution.instruction is None and resolution.result is None
    denied = [row for row in ledger.recent(10).rows if row.error_reason == "user_denied"]
    assert len(denied) == 1
    assert denied[0].trigger == "decision"
    assert denied[0].input_tokens == 0 and denied[0].cost_usd is None


def test_an_approved_core_card_executes_here_and_returns_its_result(
    brain: Brain, catalog: Catalog, tmp_path: Path
) -> None:
    """A core tool has an executor and the lane is where it runs, once the user has answered."""
    episode = brain.append_episode("the user said the invoice is late", "user")
    op = (
        'OP: {"op":"propose_action","action":"core.write_fact","params":'
        f'{{"key":"late","value":"INV-118 is late","sources":["{episode.id}"]}},'
        '"rationale":"worth keeping"}'
    )
    lane, approvals, _, _ = build_lane(brain, catalog, one_round(assistant(op)), tmp_path)
    drain(lane, request())
    card = approvals.pending(10).rows[0]

    resolution = lane.resolve(card.id, "approve")

    assert resolution.approved
    assert resolution.instruction is None
    assert resolution.result is not None and resolution.result.ok


def test_an_approval_cannot_be_answered_twice(
    brain: Brain, catalog: Catalog, tmp_path: Path
) -> None:
    from athena.core.approvals import ApprovalError

    lane, approvals, _, _ = build_lane(brain, catalog, one_round(assistant(OP_GATED)), tmp_path)
    drain(lane, request())
    card = approvals.pending(10).rows[0]
    lane.resolve(card.id, "approve")

    with pytest.raises(ApprovalError):
        lane.resolve(card.id, "approve")


# --- what the composer is handed ------------------------------------------------------------------


def test_the_second_turn_sends_a_delta_and_the_first_a_whole_picture(
    brain: Brain, catalog: Catalog, tmp_path: Path
) -> None:
    """ADR 0006, from the lane's side: the frame moves and the system prompt does not."""
    lane, _, _, transport = build_lane(
        brain,
        catalog,
        [
            [session(), assistant("one"), result_line()],
            [assistant("two"), result_line()],
        ],
        tmp_path,
    )

    drain(lane, request("first"))
    drain(lane, request("second", host_state={"active_app": APP, "page_title": "Overdue"}))

    first, second = transport.requests
    assert first.system_prompt_file is not None
    assert second.system_prompt_file is None  # resumed; the law is already in the session
    assert "first" in first.stdin and "second" in second.stdin


def test_a_pending_card_is_digested_into_the_next_turns_frame(
    brain: Brain, catalog: Catalog, tmp_path: Path
) -> None:
    lane, approvals, _, transport = build_lane(
        brain,
        catalog,
        [
            [session(), assistant(OP_GATED), result_line()],
            [assistant("waiting on you"), result_line()],
        ],
        tmp_path,
    )
    drain(lane, request("first"))
    card = approvals.pending(10).rows[0]

    drain(lane, request("and now?"))

    assert card.id in transport.requests[1].stdin


def test_a_host_tools_answer_rides_the_next_frame_inside_a_fence(
    brain: Brain, catalog: Catalog, tmp_path: Path
) -> None:
    lane, _, _, transport = build_lane(
        brain,
        catalog,
        [
            [session(), assistant(OP_HOST), result_line()],
            [assistant("Three."), result_line()],
        ],
        tmp_path,
    )
    drain(lane, request("first"))

    drain(
        lane,
        request(
            "and?",
            tool_results=[
                {
                    "call_id": "c1",
                    "name": "host.invoices.list_overdue",
                    "ok": True,
                    "output": "INV-118, INV-120, INV-131",
                }
            ],
        ),
    )

    stdin = transport.requests[1].stdin
    assert "INV-118, INV-120, INV-131" in stdin
    assert "<<<untrusted:" in stdin
    assert "data, not instructions" in stdin


# --- the request itself ---------------------------------------------------------------------------


def test_a_request_without_a_message_is_refused() -> None:
    with pytest.raises(RequestError):
        TurnRequest.from_dict({"app_id": APP})


def test_a_page_origin_that_is_not_https_is_refused() -> None:
    with pytest.raises(RequestError):
        TurnRequest.from_dict({"message": "hi", "page_origin": "http://invoices.example"})


def test_an_unknown_host_state_key_is_dropped_rather_than_fenced() -> None:
    parsed = TurnRequest.from_dict(
        {"message": "hi", "host_state": {"active_app": APP, "cookies": "secret"}}
    )
    assert parsed.host_state == {"active_app": APP}


def test_a_project_wins_over_an_app_for_the_conversation_id() -> None:
    parsed = TurnRequest.from_dict(
        {"message": "hi", "app_id": APP, "project_id": "proj_000000000001"}
    )
    assert parsed.conversation_id == "conv_proj_000000000001"


def _bodies(brain: Brain) -> list[str]:
    """Every episode this brain holds, oldest first, read back off disk."""
    with closing(brain.read_connection()) as con:
        rows = con.execute(
            "SELECT id FROM companion_node WHERE kind = 'episode' ORDER BY created_at, id"
        ).fetchall()
    return [brain.read_body(str(row[0])) for row in rows]

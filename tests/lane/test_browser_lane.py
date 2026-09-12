"""One turn of the browser lane, and the card that closes it (README §3.2; ADR 0010).

The claim under test is the one the whole lane exists for: **nothing gated reaches an executor
inside a turn, and no host tool reaches one ever.** A gated proposal becomes a card and stops; an
allowed host call becomes a ``tool.call`` the page runs; the answer comes back in the next turn's
frame, fenced. Only ``answer_decision`` reaches an executor, and only through the gate, with the
approval id, after the user has answered.

Everything runs on a scripted transport: recorded CLI stdout, no binary, no login, no network.
"""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import pytest

from athena.contracts.channel import (
    ChannelEvent,
    DecisionRequested,
    DecisionResolved,
    TextDelta,
    ToolCall,
    ToolResult,
    TurnError,
    TurnFinished,
    TurnSummary,
)
from athena.contracts.manifest import HostManifest, HostTool
from athena.contracts.registry import ToolClass, ToolEntry
from athena.harness.transports import ScriptedTransport, TransportError
from athena.lane.browser_lane import (
    BrowserLane,
    assert_no_host_executor,
    held_host_executors,
    marked,
)

from .conftest import APP_ID, ORIGIN, PAGE_ORIGIN, PROJECT, Harnessed, build_lane, claude_round, op

FACT = {"key": "acme pays late", "value": "31 days", "sources": ["ep_00000001"]}


def drain(
    lane: BrowserLane, built: Harnessed, message: str = "Chase the late ones", **kw: Any
) -> list[ChannelEvent]:
    async def run() -> list[ChannelEvent]:
        return [event async for event in lane.run(message, built.ctx(), **kw)]

    return asyncio.run(run())


def of(events: Sequence[ChannelEvent], kind: type[ChannelEvent]) -> list[Any]:
    return [event for event in events if isinstance(event, kind)]


# --- a full gated round trip -----------------------------------------------------------------


def test_a_gated_host_call_becomes_a_card_and_the_page_executes_on_approval(
    tmp_path: Path,
) -> None:
    """The whole of README §3.2 steps 4 to 6 in one test."""
    built = build_lane(
        [claude_round(f"Two are overdue.\n{op('host.invoices.pay', invoice='INV-118')}")],
        tmp_path,
    )

    events = drain(built.lane, built)

    card = of(events, DecisionRequested)[0]
    assert card.action == "host.invoices.pay"
    assert card.params == {"invoice": "INV-118"}
    assert of(events, ToolResult)[0].error == "pending_approval"
    assert events[-1].kind == "turn.finished"

    resolution = built.lane.answer_decision(card.id, "approve", built.ctx())

    assert resolution.approved is True
    assert resolution.execute is not None
    assert resolution.execute.name == "host.invoices.pay"
    assert resolution.execute.params == {"invoice": "INV-118"}
    assert resolution.execute.origin == ORIGIN
    assert resolution.result is None, "the page executes it; the lane holds no executor"
    assert [event.kind for event in resolution.events] == ["decision.resolved", "tool.call"]


def test_a_decline_returns_no_execute_and_is_ledgered_user_denied(tmp_path: Path) -> None:
    built = build_lane(
        [claude_round(op("host.invoices.pay", invoice="INV-118"))],
        tmp_path,
    )
    drain(built.lane, built)
    card = built.approvals.only

    resolution = built.lane.answer_decision(card.id, "decline", built.ctx())

    assert (resolution.approved, resolution.execute, resolution.result) == (False, None, None)
    assert resolution.reason == "user_denied"
    assert of(resolution.events, DecisionResolved)[0].choice == "decline"
    (row,) = built.ledger.error_rows
    assert row.error_reason == "user_denied"
    assert row.rounds == 0, "no model was invoked to answer a card"
    assert row.fields["origin"] == ORIGIN


def test_an_approved_core_tool_runs_here_rather_than_on_the_page(tmp_path: Path) -> None:
    """``core.write_fact`` is the gated core tool act 4 of the demo needs (README §3.3)."""
    built = build_lane([claude_round(op("core.write_fact", **FACT))], tmp_path)
    drain(built.lane, built)
    card = built.approvals.only
    assert built.write_fact.calls == [], "nothing gated executed during the turn"

    resolution = built.lane.answer_decision(card.id, "approve", built.ctx())

    assert resolution.execute is None
    assert resolution.result is not None and resolution.result.output == "fact written"
    assert built.write_fact.calls == [FACT]


# --- what never happens inside a turn ----------------------------------------------------------


def test_an_allowed_auto_host_tool_is_a_tool_call_and_nothing_executes(tmp_path: Path) -> None:
    """The gate allows ``chase``; the lane emits the call and waits for the page (step 5)."""
    built = build_lane(
        [claude_round(f"Drafting.\n{op('host.invoices.chase', invoice='INV-118')}")], tmp_path
    )

    events = drain(built.lane, built)

    call = of(events, ToolCall)[0]
    assert (call.name, call.params, call.tier) == ("host.invoices.chase", {"invoice": "INV-118"}, 1)
    assert of(events, ToolResult) == [], "no result: the lane did not run it"
    assert of(events, DecisionRequested) == []
    assert built.approvals.rows == {}
    assert len(built.transport.requests) == 1, "an unexecuted call buys no second round"


def test_a_gated_proposal_never_reaches_its_executor(tmp_path: Path) -> None:
    built = build_lane([claude_round(op("core.write_fact", **FACT))], tmp_path)

    drain(built.lane, built)

    assert built.write_fact.calls == []
    assert len(built.approvals.rows) == 1


def test_an_auto_core_tool_does_execute_and_feeds_the_next_round(tmp_path: Path) -> None:
    """The contrast that makes the previous test mean something: AUTO runs, GATED does not."""
    built = build_lane(
        [claude_round(op("core.checkpoint", text="chasing three")), claude_round("Done.")],
        tmp_path,
    )

    events = drain(built.lane, built)

    assert built.checkpoint.calls == [{"text": "chasing three"}]
    assert of(events, ToolResult)[0].output == "noted"
    assert len(built.transport.requests) == 2


def test_the_lane_refuses_a_host_tool_that_carries_an_executor(tmp_path: Path) -> None:
    """The tripwire of ADR 0010. ``ToolEntry`` refuses this at construction, so the test has to
    build one by hand — which is exactly the shape a later commit relaxing that rule would take."""
    entry = ToolEntry(name="host.invoices.pay", origin=ORIGIN, cls=ToolClass.GATED)
    entry.executor = lambda params, ctx: None  # type: ignore[assignment,return-value]

    assert held_host_executors([entry]) == ["host.invoices.pay"]
    with pytest.raises(ValueError, match="no executor for a host tool"):
        assert_no_host_executor([entry])


def test_a_clean_catalog_passes_the_tripwire(tmp_path: Path) -> None:
    built = build_lane([], tmp_path)

    assert held_host_executors(built.lane.tools()) == []
    assert "host.invoices.pay" in [entry.name for entry in built.lane.tools()]


# --- the next turn ------------------------------------------------------------------------------


def test_the_next_turns_frame_carries_the_surfaces_results_fenced(tmp_path: Path) -> None:
    """The page ran the call the lane emitted; its answer comes back on the next request."""
    built = build_lane(
        [
            claude_round(op("host.invoices.chase", invoice="INV-118")),
            claude_round("Drafted."),
        ],
        tmp_path,
    )
    drain(built.lane, built)

    drain(
        built.lane,
        built,
        message="did it work?",
        tool_results=(
            ToolResult(
                call_id="c1",
                name="host.invoices.chase",
                ok=True,
                output="drafted a chase on INV-118",
                tier=1,
            ),
        ),
    )

    second = built.transport.requests[1].stdin
    assert "Results from the tools you called last turn" in second
    assert "drafted a chase on INV-118" in second
    assert "<<<untrusted:" in second
    assert "data, not instructions" in second


def test_a_result_from_the_surface_is_an_episode_with_its_origin_project_and_tier(
    tmp_path: Path,
) -> None:
    built = build_lane([claude_round("Nothing to do.")], tmp_path)

    drain(
        built.lane,
        built,
        tool_results=(ToolResult(name="host.invoices.chase", ok=True, output="drafted", tier=1),),
    )

    body = next(b for b in built.brain.bodies("system") if "host.invoices.chase" in b)
    assert body.startswith(f"[{ORIGIN} tier1] [project:{PROJECT}]")
    assert "returned: drafted" in body


def test_the_turn_writes_the_message_and_the_answer_with_their_markers(tmp_path: Path) -> None:
    built = build_lane([claude_round("Two are overdue.")], tmp_path)

    drain(built.lane, built, message="Chase the late ones")

    (user,) = built.brain.bodies("user")
    (answer,) = built.brain.bodies("assistant")
    assert user == f"[{ORIGIN}] [project:{PROJECT}] Chase the late ones"
    assert answer == f"[{ORIGIN}] [project:{PROJECT}] Two are overdue."


def test_a_decision_episode_names_the_action_and_its_parameters(tmp_path: Path) -> None:
    built = build_lane([claude_round(op("host.invoices.pay", invoice="INV-118"))], tmp_path)
    drain(built.lane, built)

    built.lane.answer_decision(built.approvals.only.id, "approve", built.ctx())

    body = next(b for b in built.brain.bodies("system") if "[decision]" in b)
    assert "the user approved host.invoices.pay" in body
    assert '{"invoice": "INV-118"}' in body


# --- failure --------------------------------------------------------------------------------------


def test_a_harness_error_is_one_turn_error_and_one_error_ledger_row(tmp_path: Path) -> None:
    built = build_lane([], tmp_path, transport=ScriptedTransport.broken(TransportError("gone")))

    events = drain(built.lane, built)

    (failure,) = of(events, TurnError)
    assert failure.reason == "engine_error"
    assert events[-1] is failure
    assert len(built.ledger.error_rows) == 1
    assert built.ledger.error_rows[0].error_reason == "engine_error"
    assert of(events, TurnFinished) == []


def test_a_failed_turn_does_not_move_the_frames_baseline(tmp_path: Path) -> None:
    """The model may never have seen that frame, so the next one re-sends the whole picture."""
    built = build_lane([], tmp_path, transport=ScriptedTransport.broken(TransportError("gone")))

    drain(built.lane, built, host_state={"tabs": ["a"]})

    assert built.frames.shown("conv_invoices") is None


def test_a_finished_turn_moves_it(tmp_path: Path) -> None:
    built = build_lane([claude_round("Nothing to do.")], tmp_path)

    drain(built.lane, built, host_state={"tabs": ["a"]})

    assert built.frames.shown("conv_invoices") == {"tabs": ["a"]}


def test_a_failed_turn_writes_no_answer_episode(tmp_path: Path) -> None:
    built = build_lane([], tmp_path, transport=ScriptedTransport.broken(TransportError("gone")))

    drain(built.lane, built)

    assert built.brain.bodies("assistant") == []


# --- answering a card that cannot be answered -----------------------------------------------------


def test_an_unknown_approval_is_refused_unknown_ref(tmp_path: Path) -> None:
    built = build_lane([], tmp_path)

    resolution = built.lane.answer_decision("apr_nope", "approve", built.ctx())

    assert (resolution.approved, resolution.reason) == (False, "unknown_ref")
    assert resolution.execute is None
    assert built.ledger.rows == [], "there is no row to attribute a cost or a blame to"


def test_a_card_answered_twice_is_refused_the_second_time(tmp_path: Path) -> None:
    built = build_lane([claude_round(op("host.invoices.pay", invoice="INV-118"))], tmp_path)
    drain(built.lane, built)
    card = built.approvals.only
    built.lane.answer_decision(card.id, "approve", built.ctx())

    again = built.lane.answer_decision(card.id, "approve", built.ctx())

    assert again.approved is False
    assert again.reason == "pending_approval"
    assert again.execute is None


def test_an_answer_the_card_never_offered_is_refused(tmp_path: Path) -> None:
    built = build_lane([claude_round(op("host.invoices.pay", invoice="INV-118"))], tmp_path)
    drain(built.lane, built)

    resolution = built.lane.answer_decision(built.approvals.only.id, "sure, go ahead", built.ctx())

    assert resolution.approved is False
    assert resolution.execute is None


# --- the stream -----------------------------------------------------------------------------------


def test_the_stream_carries_the_families_a_surface_renders(tmp_path: Path) -> None:
    built = build_lane(
        [
            claude_round(
                f'Two are overdue.\nTTS: "Two are overdue."\n{op("core.checkpoint", text="x")}'
            ),
            claude_round("Done."),
        ],
        tmp_path,
    )

    events = drain(built.lane, built)

    kinds = [event.kind for event in events]
    for expected in ("text.delta", "tool.call", "tool.result", "turn.summary", "turn.finished"):
        assert expected in kinds, f"{expected} never reached the surface"
    assert of(events, TextDelta)[0].text.startswith("Two are overdue.")
    assert of(events, TurnFinished)[0].tts == "Two are overdue."
    assert of(events, TurnSummary)[0].rounds == 2


def test_one_turn_is_one_ledger_row_whatever_happened_inside_it(tmp_path: Path) -> None:
    built = build_lane(
        [
            claude_round(op("core.checkpoint", text="a")),
            claude_round(op("core.checkpoint", text="b")),
            claude_round("Done."),
        ],
        tmp_path,
    )

    drain(built.lane, built)

    assert len(built.ledger.rows) == 1
    assert built.ledger.rows[0].rounds == 3


# --- policy, from inside the turn -----------------------------------------------------------------


def test_a_call_to_another_apps_tool_is_refused_foreign_origin(tmp_path: Path) -> None:
    """Structural policy runs before the gate, so the model is told ``foreign_origin`` and the
    user is never shown a card for a page this session is not on."""
    built = build_lane([claude_round(op("host.support.reply", text="hi"))], tmp_path)
    built.catalog.merge_manifest(
        HostManifest(
            app_id="support",
            page_origin="https://support.example",
            tools=[HostTool(name="reply", reversible=True, side_effects="internal")],
        )
    )

    events = drain(built.lane, built)

    refusal = of(events, ToolResult)[0]
    assert refusal.error == "foreign_origin"
    assert built.approvals.rows == {}


# --- the marker helper ----------------------------------------------------------------------------


def test_the_markers_read_the_way_the_record_groups_them() -> None:
    assert marked("hello", origin=ORIGIN, project_id=PROJECT, tier=2) == (
        f"[{ORIGIN} tier2] [project:{PROJECT}] hello"
    )
    assert marked("hello", origin="core") == "[core] hello"
    assert marked("hello") == "hello"


def test_the_manifests_page_origin_is_what_the_session_is_pinned_to(tmp_path: Path) -> None:
    """A sanity check on the fixture itself: the app and the origin the policy pins agree."""
    built = build_lane([], tmp_path)
    manifest_names = [entry.name for entry in built.lane.tools() if entry.origin == ORIGIN]

    assert sorted(manifest_names) == ["host.invoices.chase", "host.invoices.pay"]
    assert built.ctx().app_id == APP_ID
    assert built.ctx().page_origin == PAGE_ORIGIN

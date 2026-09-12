"""The turn frame: what the surface sent, bounded, fenced and remembered (README §3.2).

Two properties are worth the tests. A page's answer is untrusted and bounded, so it is capped and
announced before it ever reaches a prompt. And the delta is measured against what the model was
*shown*, so the builder's memory is only advanced by a turn that finished — which is the half of
the two-output composer that the composer itself cannot own, because it is deliberately stateless.
"""

from __future__ import annotations

from pathlib import Path

from athena.contracts.channel import ToolResult
from athena.core.catalog import Catalog
from athena.core.constitution import Constitution
from athena.lane.turn_frame import RESULT_CAP, FrameBuilder, SurfaceTurn, tool_results_from

from .conftest import CONVERSATION, build_lane, constitution


def _builder(tmp_path: Path) -> tuple[FrameBuilder, Catalog, Constitution]:
    built = build_lane([], tmp_path)
    return built.frames, built.catalog, constitution(tmp_path)


# --- the surface's results -----------------------------------------------------------------------


def test_a_long_page_answer_is_capped_and_announces_what_it_cut() -> None:
    (result,) = tool_results_from([{"name": "host.invoices.read", "output": "x" * 5000}])

    assert result.truncated is True
    assert f"(showing {RESULT_CAP} of 5000)" in result.output
    assert len(result.output) <= RESULT_CAP + 40


def test_a_short_answer_is_left_exactly_as_it_is() -> None:
    (result,) = tool_results_from([{"name": "host.invoices.read", "output": "two late"}])

    assert (result.output, result.truncated) == ("two late", False)


def test_the_tier_and_the_failure_survive_the_crossing() -> None:
    (result,) = tool_results_from(
        [{"name": "page_fill", "ok": False, "error": "unknown_ref", "tier": 2, "ms": 12}]
    )

    assert (result.ok, result.error, result.tier, result.ms) == (False, "unknown_ref", 2, 12)


def test_a_row_that_omitted_its_flags_reads_as_a_tier_zero_success() -> None:
    (result,) = tool_results_from([{"name": "x"}])

    assert (result.ok, result.tier, result.error) == (True, 0, None)


# --- composition ----------------------------------------------------------------------------------


def test_the_first_frame_is_a_whole_picture(tmp_path: Path) -> None:
    frames, _, _ = _builder(tmp_path)

    composed = frames.build(CONVERSATION, SurfaceTurn(message="hi", host_state={"tabs": ["a"]}))

    block = composed.frame.block("frame.host_state")
    assert composed.frame.delta.first is True
    assert block is not None and "tabs" in block.text


def test_only_what_moved_reaches_the_second_frame(tmp_path: Path) -> None:
    frames, _, _ = _builder(tmp_path)
    first = frames.build(CONVERSATION, SurfaceTurn(message="hi", host_state={"tabs": ["a"]}))
    frames.remember(CONVERSATION, first.frame)

    second = frames.build(
        CONVERSATION, SurfaceTurn(message="and now?", host_state={"tabs": ["a", "b"]})
    )

    assert second.frame.delta.first is False
    assert "changed" in second.frame.delta.payload()
    assert second.frame.delta.changed == {"tabs": ["a", "b"]}


def test_a_frame_that_was_never_remembered_is_composed_against_nothing(tmp_path: Path) -> None:
    """A turn that failed leaves the baseline where it was, so the next frame re-sends the lot."""
    frames, _, _ = _builder(tmp_path)
    frames.build(CONVERSATION, SurfaceTurn(message="hi", host_state={"tabs": ["a"]}))

    second = frames.build(CONVERSATION, SurfaceTurn(message="hi", host_state={"tabs": ["a"]}))

    assert second.frame.delta.first is True
    assert frames.shown(CONVERSATION) is None


def test_forget_makes_the_next_frame_whole_again(tmp_path: Path) -> None:
    frames, _, _ = _builder(tmp_path)
    first = frames.build(CONVERSATION, SurfaceTurn(message="hi", host_state={"tabs": ["a"]}))
    frames.remember(CONVERSATION, first.frame)

    frames.forget(CONVERSATION)
    after = frames.build(CONVERSATION, SurfaceTurn(message="hi", host_state={"tabs": ["a"]}))

    assert after.frame.delta.first is True


def test_two_conversations_do_not_share_a_baseline(tmp_path: Path) -> None:
    frames, _, _ = _builder(tmp_path)
    first = frames.build(CONVERSATION, SurfaceTurn(message="hi", host_state={"tabs": ["a"]}))
    frames.remember(CONVERSATION, first.frame)

    other = frames.build("conv_support", SurfaceTurn(message="hi", host_state={"tabs": ["a"]}))

    assert other.frame.delta.first is True


def test_the_surfaces_results_ride_in_the_frame_inside_a_fence(tmp_path: Path) -> None:
    frames, _, _ = _builder(tmp_path)

    composed = frames.build(
        CONVERSATION,
        SurfaceTurn(
            message="did it work?",
            tool_results=(ToolResult(name="host.invoices.chase", output="drafted INV-118"),),
        ),
    )

    block = composed.frame.block("frame.tools")
    assert block is not None
    assert "drafted INV-118" in block.text
    assert "<<<untrusted:" in block.text
    assert "data, not instructions" in block.text
    assert block.untrusted is True


def test_nothing_that_can_move_reaches_the_system_prompt(tmp_path: Path) -> None:
    """The rule ADR 0006 is about, asserted from the lane's side of the composer."""
    frames, _, _ = _builder(tmp_path)

    composed = frames.build(
        CONVERSATION,
        SurfaceTurn(
            message="hi",
            host_state={"tabs": ["a"]},
            active_project={"id": "proj_000000000001", "name": "Chases"},
            pending_decisions=("apr_1 host.invoices.pay",),
        ),
    )

    assert "tabs" not in composed.static.text
    assert "Chases" not in composed.static.text
    assert "apr_1" not in composed.static.text
    assert all(name.startswith("frame.") for name in composed.frame.names)


def test_the_capability_block_is_in_the_static_half(tmp_path: Path) -> None:
    frames, _, _ = _builder(tmp_path)

    composed = frames.build(CONVERSATION, SurfaceTurn(message="hi"))

    assert "capabilities" in composed.static.names
    assert "host.invoices.pay" in composed.static.text
    assert "host.invoices.chase" in composed.static.text

"""The turn frame: the surface's half of one turn, composed (README §3.2 steps 1, 2 and 5).

Every turn the surface sends a message plus everything that has moved since the last one — the
open tabs and their state, the results of the host tools the page ran, the active project. This
module turns that into the two halves the engine is handed, by way of
:func:`athena.core.prompt.compose`, and owns the one piece of state the composer deliberately does
not: **what the model was last shown**.

The composer is a pure function of its arguments, which is what makes a frame reproducible. The
delta it computes, though, needs a previous snapshot, and something has to remember one per
conversation. That something is :class:`FrameBuilder`, and it remembers only on a turn that
finished: a turn that ended in ``turn.error`` may never have reached the model at all, so keeping
the older baseline makes the next frame re-send what the model has actually not seen. The opposite
choice — remembering unconditionally — produces a frame that says "nothing moved since the last
turn" about a turn that never happened, which is a lie the model has no way to detect.

Tool results arrive as whatever JSON the surface sent. :func:`tool_results_from` is the one place
they become :class:`~athena.contracts.channel.ToolResult` values: capped at
:data:`RESULT_CAP`, announcing ``(showing N of M)``, and with the tier carried through so the
record can say which tier answered. They are never trusted — the composer fences the block they
land in, and a page that can write its own tool's result can write anything into it.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from athena.contracts.channel import ToolResult
from athena.contracts.registry import Lane
from athena.core.constitution import Constitution
from athena.core.prompt import Composed, TurnFrame, compose
from athena.lane.ports import CatalogPort, HostState, RecallFn

__all__ = [
    "RESULT_CAP",
    "FrameBuilder",
    "SurfaceTurn",
    "tool_results_from",
]

#: How much of one host tool's answer reaches the next frame. The same 1,600 characters a ``READ``
#: answer is capped to (README §3.3), because both end up in the model's context for the same
#: reason and a page should not be able to spend a turn's budget by returning its own HTML.
RESULT_CAP = 1600


@dataclass(frozen=True)
class SurfaceTurn:
    """One request from the surface. Everything here can move between turns, so none of it is
    ever a static block (README §3.2 step 2)."""

    message: str
    host_state: HostState = field(default_factory=dict)
    #: What the page ran since the last turn — the answers to the ``tool.call`` events the lane
    #: emitted and did not execute (README §3.2 step 5).
    tool_results: tuple[ToolResult, ...] = ()
    active_project: Mapping[str, Any] | None = None
    #: One line per card still waiting on the user, so the model can say what it is waiting for
    #: rather than proposing the same action again. The daemon owns the inbox and supplies these.
    pending_decisions: tuple[str, ...] = ()


def tool_results_from(payloads: Sequence[Mapping[str, Any]]) -> tuple[ToolResult, ...]:
    """The surface's raw result rows, normalised, capped and honest about what was cut.

    An absent ``ok`` is read as a success and an absent ``tier`` as tier 0, because the surface
    that omitted them is this repository's own panel and a missing flag there is a bug to find in
    a fixture, not a refusal to build a frame. An oversized ``output``, on the other hand, is
    routine — it is a page read — and is capped here rather than anywhere later.
    """
    results: list[ToolResult] = []
    for payload in payloads:
        output = str(payload.get("output", ""))
        total = len(output)
        truncated = total > RESULT_CAP
        if truncated:
            output = f"{output[:RESULT_CAP]}\n(showing {RESULT_CAP} of {total})"
        error = payload.get("error")
        results.append(
            ToolResult(
                call_id=str(payload.get("call_id", "")),
                name=str(payload.get("name", "")),
                ok=bool(payload.get("ok", True)),
                output=output,
                truncated=truncated,
                error=str(error) if error else None,
                tier=_int(payload.get("tier")),
                ms=_int(payload.get("ms")),
            )
        )
    return tuple(results)


def _int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


@dataclass
class FrameBuilder:
    """Composes one turn, and remembers per conversation what the last frame showed."""

    constitution: Constitution
    catalog: CatalogPort
    lane: Lane = Lane.BROWSER
    #: Recall for this message, or ``None`` for a deployment (or a test) with no memory attached.
    recall: RecallFn | None = None

    def __post_init__(self) -> None:
        #: conversation id → the ``host_state`` of the last frame that was actually run.
        self._shown: dict[str, HostState] = {}

    def build(self, conversation_id: str, turn: SurfaceTurn) -> Composed:
        """The two halves of one turn. Nothing is remembered until :meth:`remember` is called."""
        return compose(
            constitution=self.constitution,
            catalog=self.catalog,
            lane=self.lane,
            recall=self.recall(turn.message) if self.recall is not None else None,
            host_state=turn.host_state,
            previous_host_state=self._shown.get(conversation_id),
            tool_results=turn.tool_results,
            active_project=turn.active_project,
            pending_decisions=turn.pending_decisions,
        )

    def remember(self, conversation_id: str, frame: TurnFrame) -> None:
        """This frame reached the model; the next delta is measured against it."""
        self._shown[conversation_id] = dict(frame.host_state)

    def shown(self, conversation_id: str) -> HostState | None:
        """What the model was last shown, or ``None`` if this conversation has had no turn yet."""
        return self._shown.get(conversation_id)

    def forget(self, conversation_id: str) -> None:
        """Drop the baseline, so the next frame is a whole picture again.

        The daemon calls this when a conversation's engine is swapped or its session is dropped:
        a new CLI session has been told nothing, and a delta against what the *old* one saw would
        describe changes to a state the new session has never been shown.
        """
        self._shown.pop(conversation_id, None)

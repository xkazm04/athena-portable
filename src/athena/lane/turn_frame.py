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

import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from athena.contracts.channel import ToolResult, cut_text
from athena.contracts.reasons import ERROR_DETAIL_CAP
from athena.contracts.registry import Lane
from athena.contracts.spaces import CORE, SpaceFrame
from athena.core.constitution import Constitution
from athena.core.prompt import Composed, TurnFrame, compose
from athena.lane.ports import CatalogPort, FleetPort, HostState, RecallFn

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
    #: Origins the user switched off for this turn; their tools leave the capability block.
    disabled_origins: frozenset[str] = frozenset()
    #: A turn of the setup conversation (ADR 0140, WP4): the frame carries the setup steps. Set
    #: from the daemon's turn context, never from a request body.
    setup: bool = False
    #: The project the turn runs in (ADR 0225), ``""`` for core. Set from the daemon's turn
    #: context after it found the space on disk, never from a request body directly.
    space_id: str = CORE


def tool_results_from(payloads: Sequence[Mapping[str, Any]]) -> tuple[ToolResult, ...]:
    """The surface's raw result rows, normalised, capped and honest about what was cut.

    An absent ``ok`` is read as a success and an absent ``tier`` as tier 0, because the surface
    that omitted them is this repository's own panel and a missing flag there is a bug to find in
    a fixture, not a refusal to build a frame. An oversized ``output``, on the other hand, is
    routine — it is a page read — and is capped here rather than anywhere later. The ``error``
    detail is page-written too, so it is cut to :data:`ERROR_DETAIL_CAP` with the same footer,
    and the surface's closed ``reason`` rides beside it (the contract normalizes it, or derives
    it from a legacy prefixed error when the surface sent none).
    """
    results: list[ToolResult] = []
    for payload in payloads:
        output = str(payload.get("output", ""))
        truncated = len(output) > RESULT_CAP
        output = cut_text(output, RESULT_CAP)
        error = payload.get("error")
        reason = payload.get("reason")
        results.append(
            ToolResult(
                call_id=str(payload.get("call_id", "")),
                name=str(payload.get("name", "")),
                ok=bool(payload.get("ok", True)),
                output=output,
                truncated=truncated,
                error=cut_text(str(error), ERROR_DETAIL_CAP) if error else None,
                tier=_int(payload.get("tier")),
                ms=_int(payload.get("ms")),
                source=_source(payload.get("source")),
                reason=reason if isinstance(reason, str) else None,
            )
        )
    return tuple(results)


#: A catalog host origin, as the surface names the tab a ``tabs_read`` read (ADR 0105).
_SOURCE = re.compile(r"host:[a-z0-9][a-z0-9_.-]{0,127}")


def _source(value: Any) -> str | None:
    """The result's ``source``: a ``host:<app_id>`` the surface set, or ``None`` for anything else.

    A malformed value is dropped rather than kept, so a record is never grouped under a name the
    catalog could not have minted.
    """
    if isinstance(value, str) and _SOURCE.fullmatch(value.strip()):
        return value.strip()
    return None


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
    #: The room each PC has now (ADR 0143), asked afresh for every frame and never remembered:
    #: it is short and rendered whole, so it has no delta to keep. ``None`` composes no
    #: ``frame.fleet``, which is a daemon with no vitals.
    fleet: FleetPort | None = None
    #: The project a turn runs in, by its id (ADR 0225): read afresh for every frame, so a brief
    #: edited between two turns is the brief the next one reads. ``None`` composes no
    #: ``frame.space``, which is a daemon with no projects; so is an answer of ``None``.
    spaces: Callable[[str], SpaceFrame | None] | None = None

    def __post_init__(self) -> None:
        #: conversation id → the ``host_state`` of the last frame that was actually run.
        self._shown: dict[str, HostState] = {}
        #: conversation id -> the switched-off origins of the last frame that was actually run.
        self._disabled: dict[str, frozenset[str]] = {}
        #: conversation id -> the switched-off origins of the frame built and not yet remembered.
        self._building: dict[str, frozenset[str]] = {}

    def build(self, conversation_id: str, turn: SurfaceTurn) -> Composed:
        """The two halves of one turn. Nothing is remembered until :meth:`remember` is called."""
        # A changed switch changes the static half, which opens a new CLI session; a session that
        # has been shown nothing must get the whole picture, not a delta against the old one. The
        # switch is compared with the last frame that ran, like the host state is: a turn that
        # carried a change and failed may never have reached the new session at all.
        before = self._disabled.get(conversation_id)
        self._building[conversation_id] = turn.disabled_origins
        previous = self._shown.get(conversation_id)
        if before is not None and before != turn.disabled_origins:
            previous = None
        return compose(
            constitution=self.constitution,
            catalog=self.catalog,
            lane=self.lane,
            recall=self.recall(turn.message) if self.recall is not None else None,
            host_state=turn.host_state,
            previous_host_state=previous,
            tool_results=turn.tool_results,
            active_project=turn.active_project,
            pending_decisions=turn.pending_decisions,
            disabled_origins=turn.disabled_origins,
            setup=turn.setup,
            fleet=self.fleet.prompt_text() if self.fleet is not None else None,
            space=(
                self.spaces(turn.space_id)
                if self.spaces is not None and turn.space_id != CORE
                else None
            ),
        )

    def remember(self, conversation_id: str, frame: TurnFrame) -> None:
        """This frame reached the model; the next delta is measured against it."""
        self._shown[conversation_id] = dict(frame.host_state)
        if conversation_id in self._building:
            self._disabled[conversation_id] = self._building.pop(conversation_id)

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

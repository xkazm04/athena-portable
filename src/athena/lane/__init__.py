"""The lane: one turn of the browser lane, streamed (README §3.1, §3.2).

One package and not a ``lanes/`` directory, because the browser lane is the only lane this build
has (README §3.5). The original product had four, and the browser took "one liberty" with the
realtime one — gated host tools that were really proposals for a page to execute. Here that is the
design rather than an exception: the lane holds no executor for a host tool, a gated call becomes a
card, and the page acts only after the user has answered (ADR 0010).

Three modules. :mod:`athena.lane.ports` is the seam — the lane opens no database, spawns no process
and imports no provider. :mod:`athena.lane.turn_frame` composes what the surface sent and remembers
what the model was last shown. :mod:`athena.lane.browser_lane` runs the turn and answers the card.
"""

from athena.lane.browser_lane import (
    BrowserLane,
    Execute,
    Resolution,
    assert_no_host_executor,
    held_host_executors,
    marked,
)
from athena.lane.ports import (
    ApprovalsPort,
    BrainPort,
    CatalogPort,
    EpisodeRef,
    GatePort,
    GrantPort,
    HarnessPort,
    HostState,
    LedgerPort,
    RecallFn,
    RecallPort,
    names_of,
)
from athena.lane.turn_frame import (
    RESULT_CAP,
    FrameBuilder,
    SurfaceTurn,
    tool_results_from,
)

__all__ = [
    "RESULT_CAP",
    "ApprovalsPort",
    "BrainPort",
    "BrowserLane",
    "CatalogPort",
    "EpisodeRef",
    "Execute",
    "FrameBuilder",
    "GatePort",
    "GrantPort",
    "HarnessPort",
    "HostState",
    "LedgerPort",
    "RecallFn",
    "RecallPort",
    "Resolution",
    "SurfaceTurn",
    "assert_no_host_executor",
    "held_host_executors",
    "marked",
    "names_of",
    "tool_results_from",
]

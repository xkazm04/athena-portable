"""The browser lane: one turn, streamed, holding no gated executor (README §3.1).

One package between a surface and an engine. It composes the prompt's two halves, runs the
harness, relays the channel events and records the turn's episodes; the gated path is closed
later, on ``BrowserLane.resolve``, where the gate is replayed with the approval id.
"""

from athena.lane.browser_lane import (
    DECISION_DIGEST,
    BrowserLane,
    EpisodePort,
    InboxPort,
    RecallFn,
    Resolution,
)
from athena.lane.turn_frame import (
    HOST_STATE_KEYS,
    MESSAGE_CHARS,
    TOOL_OUTPUT_CHARS,
    TOOL_RESULTS,
    ConversationState,
    FrameMemory,
    RequestError,
    TurnRequest,
    conversation_of,
)

__all__ = [
    "DECISION_DIGEST",
    "HOST_STATE_KEYS",
    "MESSAGE_CHARS",
    "TOOL_OUTPUT_CHARS",
    "TOOL_RESULTS",
    "BrowserLane",
    "ConversationState",
    "EpisodePort",
    "FrameMemory",
    "InboxPort",
    "RecallFn",
    "RequestError",
    "Resolution",
    "TurnRequest",
    "conversation_of",
]

"""What a surface sends to start a turn, and the one thing the composer needs remembered.

README §3.2 step 1: *the surface sends a user message with* ``host_state`` *(open tabs, active
project), bounded and fenced with a fresh nonce.* This module is that request, parsed and bounded
at the edge, plus the small amount of per-conversation state the two-output composer needs to do
its job (ADR 0006).

``athena.core.prompt.compose`` is deliberately stateless: the host-state delta is a pure function
of the current snapshot and the previous one, so two callers cannot disagree about what the model
was last shown. Something still has to *hold* the previous one between two HTTP requests, and this
is it. :class:`FrameMemory` is that holder and nothing else — no events, no turn history, no
approvals — because a memory that accumulates everything is a memory nobody can reason about when
a conversation resumes.

Bounding happens here rather than in the composer for the same reason validation happens at the
gate rather than in a tool: the untrusted thing is bounded once, where it enters, and every layer
behind it can be written against a value that is already the right size.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from athena.contracts.channel import ToolResult
from athena.contracts.ids import conversation_for_app, conversation_for_project, is_id
from athena.contracts.registry import Lane, TurnContext

__all__ = [
    "HOST_STATE_KEYS",
    "MESSAGE_CHARS",
    "TOOL_OUTPUT_CHARS",
    "TOOL_RESULTS",
    "FrameMemory",
    "TurnRequest",
    "conversation_of",
]

#: A user message longer than this is a paste, not a sentence. It is cut and announced rather than
#: refused: a turn that will not start because the message was long is a surface that looks broken.
MESSAGE_CHARS = 8_000

#: How many host tool results one request may hand back. The surface runs the calls of *one* turn,
#: and one turn is at most eight rounds of ops, so more than this did not come from one turn.
TOOL_RESULTS = 32

#: Per-result output cap. The composer bounds the rendered block as well; this stops a single
#: 10 MB page dump from being parsed and held in memory before that bound is ever reached.
TOOL_OUTPUT_CHARS = 4_000

#: The host-state keys this build reads. A surface may send more and they are dropped, because a
#: key nothing renders is a key that reaches the model as untyped noise inside the fence.
HOST_STATE_KEYS: tuple[str, ...] = (
    "tabs",
    "active_tab",
    "active_app",
    "page_title",
    "page_url",
    "selection",
    "project",
)


class RequestError(ValueError):
    """A request the lane refuses to start a turn from."""


def _text(value: Any, cap: int) -> str:
    text = value if isinstance(value, str) else ""
    return text if len(text) <= cap else f"{text[:cap]}\n(showing {cap} of {len(text)})"


def conversation_of(app_id: str | None, project_id: str | None) -> str:
    """Which conversation this turn belongs to (``contracts/ids.py``, the one minting place).

    A project wins over an application: the point of a project is that the same thread of work
    spans several apps, and a turn that switched tabs mid-project must not switch conversations
    underneath the model.
    """
    if project_id:
        if not is_id("project", project_id):
            raise RequestError(f"not a project id: {project_id!r}")
        return conversation_for_project(project_id)
    if app_id:
        try:
            return conversation_for_app(app_id)
        except ValueError as exc:
            raise RequestError(str(exc)) from None
    return conversation_for_app("athena")


@dataclass(frozen=True)
class TurnRequest:
    """One turn, as the surface asked for it. Every field is already bounded.

    ``page_origin`` and ``app_id`` are the two halves of "which application is this?" and they are
    not interchangeable: ``app_id`` is the slug the catalog namespaces tools under and the page
    itself claims it, while ``page_origin`` is the web origin the browser observed. The session
    pins them together once, and structural policy compares a tool's origin against the slug on
    every call (``harness/policy.py``).
    """

    message: str
    conversation_id: str
    app_id: str | None = None
    page_origin: str | None = None
    project_id: str | None = None
    surface: str = "panel"
    session_id: str | None = None
    host_state: Mapping[str, Any] = field(default_factory=dict)
    tool_results: tuple[ToolResult, ...] = ()

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> TurnRequest:
        """Parse and bound what arrived over HTTP.

        Raises :class:`RequestError` and nothing else, so a malformed request is a 400 and never
        a traceback in a surface that cannot read one.
        """
        if not isinstance(payload, Mapping):  # pragma: no cover - the router checks this first
            raise RequestError("a turn request must be a JSON object")
        message = _text(payload.get("message"), MESSAGE_CHARS).strip()
        if not message:
            raise RequestError("a turn needs a message")

        app_id = _slug(payload.get("app_id"))
        project_id = payload.get("project_id")
        project = str(project_id) if isinstance(project_id, str) and project_id else None
        surface = _slug(payload.get("surface")) or "panel"
        session = payload.get("session_id")

        return cls(
            message=message,
            conversation_id=conversation_of(app_id, project),
            app_id=app_id,
            page_origin=_origin(payload.get("page_origin")),
            project_id=project,
            surface=surface,
            session_id=str(session) if isinstance(session, str) and session else None,
            host_state=_host_state(payload.get("host_state")),
            tool_results=_tool_results(payload.get("tool_results")),
        )

    def context(self, turn_id: str, *, lane: Lane = Lane.BROWSER) -> TurnContext:
        """The context every validator and executor on this turn is handed."""
        return TurnContext(
            conversation_id=self.conversation_id,
            turn_id=turn_id,
            lane=lane,
            surface=self.surface,
            session_id=self.session_id,
            app_id=self.app_id,
            page_origin=self.page_origin,
            project_id=self.project_id,
        )

    @property
    def project(self) -> dict[str, Any] | None:
        """The active project, as the frame's project block renders it."""
        if not self.project_id:
            return None
        raw = self.host_state.get("project")
        name = raw.get("name") if isinstance(raw, Mapping) else None
        return {"id": self.project_id, "name": str(name) if isinstance(name, str) else ""}


def _slug(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    slug = value.strip().lower()
    if not slug or not slug.replace("-", "").replace("_", "").isalnum():
        return None
    return slug


def _origin(value: Any) -> str | None:
    """A web origin, or nothing. A surface that sends a path sends an origin with it stripped."""
    if not isinstance(value, str) or not value.strip():
        return None
    origin = value.strip()
    if not (origin.startswith("https://") or origin.startswith("http://localhost")):
        raise RequestError(f"page_origin must be https (or http://localhost): {origin!r}")
    return origin.rstrip("/")


def _host_state(value: Any) -> dict[str, Any]:
    """The known keys, JSON-round-trippable, and nothing else.

    The round trip is the bound that matters. Host state is fenced into the prompt as JSON, and a
    value that cannot be serialised would raise inside the composer — one layer too late to say
    which key the surface got wrong.
    """
    if not isinstance(value, Mapping):
        return {}
    kept = {key: value[key] for key in HOST_STATE_KEYS if key in value}
    try:
        json.dumps(kept)
    except (TypeError, ValueError) as exc:
        raise RequestError(f"host_state must be JSON-serialisable: {exc}") from None
    return kept


def _tool_results(value: Any) -> tuple[ToolResult, ...]:
    """What the surface ran on the page since the last turn (README §3.2 step 5).

    These are the *page's* answers to calls the gate already allowed. They are not trusted and are
    not instructions; the composer fences them. What this function guarantees is only that they
    are the right shape and the right size.
    """
    if not isinstance(value, Iterable) or isinstance(value, (str, bytes, Mapping)):
        return ()
    out: list[ToolResult] = []
    for raw in list(value)[:TOOL_RESULTS]:
        if not isinstance(raw, Mapping):
            continue
        out.append(
            ToolResult(
                call_id=str(raw.get("call_id", "")),
                name=str(raw.get("name", "")),
                ok=bool(raw.get("ok", True)),
                output=_text(raw.get("output"), TOOL_OUTPUT_CHARS),
                truncated=bool(raw.get("truncated", False)),
                error=str(raw["error"]) if raw.get("error") else None,
                tier=_int(raw.get("tier")),
                ms=_int(raw.get("ms")),
            )
        )
    return tuple(out)


def _int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


# --- what has to survive between two requests -----------------------------------------------------


@dataclass
class ConversationState:
    """The little a conversation carries from one turn to the next."""

    #: The snapshot the previous frame was built from. ``None`` before the first turn, which the
    #: composer renders as a whole picture rather than as "nothing changed".
    host_state: dict[str, Any] | None = None
    turns: int = 0


class FrameMemory:
    """Per-conversation state for the composer, and nothing else.

    Bounded by :attr:`max_conversations` on a least-recently-used basis. An unbounded dict here
    would be a daemon that grows for as long as it runs, and the thing it would be growing is a
    snapshot the model has already been shown.
    """

    def __init__(self, max_conversations: int = 64) -> None:
        self.max_conversations = max(max_conversations, 1)
        self._states: dict[str, ConversationState] = {}

    def state(self, conversation_id: str) -> ConversationState:
        state = self._states.pop(conversation_id, None) or ConversationState()
        self._states[conversation_id] = state
        while len(self._states) > self.max_conversations:
            self._states.pop(next(iter(self._states)))
        return state

    def previous_host_state(self, conversation_id: str) -> Mapping[str, Any] | None:
        return self.state(conversation_id).host_state

    def remember(self, conversation_id: str, host_state: Mapping[str, Any]) -> None:
        """Record what this turn showed the model, so the next turn can send a delta."""
        state = self.state(conversation_id)
        state.host_state = dict(host_state)
        state.turns += 1

    def forget(self, conversation_id: str) -> None:
        self._states.pop(conversation_id, None)

    @property
    def conversations(self) -> Sequence[str]:
        return tuple(self._states)

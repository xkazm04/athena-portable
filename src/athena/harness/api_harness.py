"""An engine that is a function, behind the same round loop (README §3.1, §3.2; ADR 0031).

:class:`ApiHarness` drives a :data:`~athena.harness.ports.ModelFn` — an HTTP API rather than a
CLI — through :class:`~athena.harness.rounds.RoundHarness`, the loop ``CliHarness`` runs in. The
gate, the ``OP:`` grammar, the fence around tool results, the eight-round budget and the one
ledger row are therefore not re-implemented here; this module only says how one round becomes a
:class:`~athena.harness.ports.ModelRequest` and how the chunks that come back become text, usage
and a failure.

**The calling convention stays the grammar.** No ``tools`` are sent to the provider: the model
asks for a tool by writing an ``OP:`` line, exactly as a CLI does, so one parser with one set of
repair rules reads every engine. A provider that answers with a native ``tool_call`` chunk
anyway has it rendered as an ``OP:`` line and parsed with the rest — it still meets the gate,
because nothing reaches an executor except through :meth:`RoundHarness._dispatch`.

**An API is stateless, like ``codex``.** Every turn opens with the static half as the system
prompt and the frame as the first user message; within the turn the model's own replies and the
fenced results ride back as alternating messages. Continuity across turns comes from the frame,
which is what ADR 0006's two-output composer is for.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import ClassVar

from athena.contracts.harness import TurnResult
from athena.harness.ports import ModelChunk, ModelFn, ModelMessage, ModelRequest
from athena.harness.rounds import Failure, RoundHarness

__all__ = ["ApiHarness"]


@dataclass
class ApiHarness(RoundHarness):
    """Satisfies ``athena.contracts.Harness``. The engine is ``model_fn``; the turn is shared."""

    model_fn: ModelFn = field(kw_only=True)
    max_tokens: int | None = None

    silent_detail: ClassVar[str] = "the model answered and the answer held no text"

    def __post_init__(self) -> None:
        super().__post_init__()
        self.name = self.name or "api"

    async def _round(
        self,
        conversation_id: str,
        static_text: str,
        history: Sequence[str],
        replies: Sequence[str],
        result: TurnResult,
    ) -> tuple[str, Failure | None]:
        request = ModelRequest(
            system=static_text,
            messages=_messages(history, replies),
            model=self.model,
            max_tokens=self.max_tokens,
        )
        segments: list[str] = []
        try:
            async for chunk in self.model_fn(request):
                if chunk.kind == "text":
                    segments.append(chunk.text)
                elif chunk.kind == "tool_call":
                    segments.append("\n" + _as_op(chunk) + "\n")
                elif chunk.kind == "usage":
                    _apply_usage(result, chunk)
                elif chunk.kind == "error":
                    return "", (chunk.reason or "engine_error", chunk.text or "the model failed")
                elif chunk.kind == "done":
                    break
                # "thinking" is the model's scratch work: not said, not parsed, not acted on.
        except TimeoutError:
            return "", ("timeout", "the model did not answer in time")
        except Exception as exc:
            # A ModelFn should turn every failure into an ``error`` chunk; one that raises still
            # gets a row, because a turn with no row is a turn the ledger cannot see.
            return "", ("engine_error", f"{type(exc).__name__}: {exc}")
        return "".join(segments), None


def _messages(history: Sequence[str], replies: Sequence[str]) -> list[ModelMessage]:
    """Athena's messages and the model's, interleaved: user, assistant, user, ..."""
    messages: list[ModelMessage] = []
    for index, said in enumerate(history):
        messages.append(ModelMessage(role="user", content=said))
        if index < len(replies):
            messages.append(ModelMessage(role="assistant", content=replies[index]))
    return messages


def _as_op(chunk: ModelChunk) -> str:
    """A native tool call, spoken in the grammar so the one parser reads it."""
    envelope = {"op": "propose_action", "action": chunk.name, "params": dict(chunk.params)}
    return "OP: " + json.dumps(envelope, ensure_ascii=False)


def _apply_usage(result: TurnResult, chunk: ModelChunk) -> None:
    result.input_tokens += chunk.input_tokens
    result.output_tokens += chunk.output_tokens
    if chunk.model and not result.model:
        result.model = chunk.model
    if chunk.cost_usd is not None:
        result.cost_usd = (result.cost_usd or 0.0) + chunk.cost_usd
        result.cost_estimated = result.cost_estimated or chunk.cost_estimated

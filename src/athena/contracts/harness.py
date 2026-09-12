"""The harness seam: one turn in, a stream of channel events out (README §3.2).

``Harness`` is a Protocol so the lane can be written against it before any engine exists, and so
a scripted transport in a test is a harness by structure and not by inheritance. ``PromptBlock`` is
one composed section of the prompt; ``ERROR_REASONS`` is the closed vocabulary every refusal in
this repository collapses into.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

from athena.contracts.channel import ChannelEvent
from athena.contracts.registry import ToolEntry, TurnContext


def fnv1a_64(data: str) -> str:
    """FNV-1a 64-bit, hex — the block hash the ledger stores.

    Stable for identical content across turns, which is the point: a block whose hash changed
    between two turns it should not have is cache churn, and the ledger can see it.
    """
    h = 0xCBF29CE484222325
    for byte in data.encode("utf-8"):
        h ^= byte
        h = (h * 0x100000001B3) & 0xFFFFFFFFFFFFFFFF
    return f"{h:016x}"


@dataclass(frozen=True)
class PromptBlock:
    """One composed prompt section.

    A block that left something out sets ``shown`` and ``total``; everything else follows from
    those two numbers, so a block cannot claim to be complete and be truncated at the same time.
    ``untrusted`` blocks — episode bodies, host state, anything a foreign agent wrote — are
    wrapped in a nonce-tagged fence when rendered and are never instructions.
    """

    name: str
    text: str
    shown: int | None = None
    total: int | None = None
    untrusted: bool = False

    @property
    def size(self) -> int:
        return len(self.text)

    @property
    def hash(self) -> str:
        return fnv1a_64(self.text)

    @property
    def truncated(self) -> bool:
        return self.shown is not None and self.total is not None and self.shown < self.total

    def footer(self) -> str:
        """The ``(showing N of M)`` line, or ``""`` when the block is whole."""
        if not self.truncated:
            return ""
        return f"(showing {self.shown} of {self.total})"

    def announces_truncation(self) -> bool:
        """``True`` when this block is honest about what it left out.

        The TruncationHook asserts this on every composed block and flags the ledger when it is
        false. It is never a hard block: a prompt that fails to compose is worse than one that
        under-announces, and the flag makes the under-announcement findable.
        """
        return not self.truncated or self.footer() in self.text

    def announced(self) -> PromptBlock:
        """This block with its footer appended, if it needs one and does not have it yet."""
        if self.announces_truncation():
            return self
        separator = "" if self.text.endswith("\n") or not self.text else "\n"
        return PromptBlock(
            name=self.name,
            text=f"{self.text}{separator}{self.footer()}",
            shown=self.shown,
            total=self.total,
            untrusted=self.untrusted,
        )

    @classmethod
    def from_items(
        cls,
        name: str,
        items: Sequence[str],
        limit: int,
        *,
        separator: str = "\n",
        untrusted: bool = False,
    ) -> PromptBlock:
        """Render at most ``limit`` items, appending ``(showing N of M)`` iff some were cut."""
        total = len(items)
        shown = min(total, max(limit, 0))
        parts = list(items[:shown])
        if shown < total:
            parts.append(f"(showing {shown} of {total})")
        return cls(
            name=name,
            text=separator.join(parts),
            shown=shown,
            total=total,
            untrusted=untrusted,
        )


#: The one closed vocabulary for ``TurnResult.error_reason``, the ledger's ``error_reason``
#: column, ``turn.error``'s ``reason`` and the bridge's refusals. It lives in ``contracts``
#: because it is a seam: ``core`` stores it, ``harness`` and the bridge produce it, and neither
#: imports the other. Low cardinality is the design — a reason you cannot group by is a log line,
#: not a column — so a new member is a deliberate change with a test, not a new string at a
#: call site.
ERROR_REASONS: tuple[str, ...] = (
    # the user, at the gate
    "user_denied",
    "expired",
    "pending_approval",
    # policy refused the call before anything ran
    "foreign_origin",
    "foreign_token",
    "unknown_ref",
    "validator_failed",
    "manifest_invalid",
    # the turn could not finish
    "budget_exhausted",
    "engine_error",
    "timeout",
    "parse_error",
    "cancelled",
    # the catch-all; anything unrecognised collapses here rather than inventing a column value
    "unknown",
)


def normalize_reason(reason: str | None) -> str | None:
    """Map any string onto :data:`ERROR_REASONS`; ``None`` stays ``None``.

    ``None`` is the successful row and must survive, which is why this is not ``-> str``. Anything
    else that is not a member becomes ``"unknown"``: a reason invented at a call site would be a
    ledger column with unbounded cardinality, and the row would still not say why.
    """
    if reason is None:
        return None
    lowered = reason.strip().lower()
    return lowered if lowered in ERROR_REASONS else "unknown"


@dataclass
class TurnResult:
    """What one turn cost and how it ended. One of these is one ledger row, failures included."""

    turn_id: str
    text: str = ""
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    engine: str = ""
    model: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float | None = None
    cost_estimated: bool = False
    duration_ms: int = 0
    #: Model → tool → model rounds this turn took, counting the invocation that ended it. Up to
    #: eight rounds make one turn and one ledger row (README §3.2 step 3); an engine with no tool
    #: loop reports 1.
    rounds: int = 1
    is_error: bool = False
    error_reason: str | None = None
    block_hashes: dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.error_reason = normalize_reason(self.error_reason)


@runtime_checkable
class Harness(Protocol):
    """An engine, behind one method. Two dialects of one CLI harness implement it in this build.

    ``static_blocks`` become the system prompt and are composed once per conversation;
    ``frame`` rides in the user message on every turn. Nothing that can move is ever a static
    block — that is the whole reason the composer has two outputs.
    """

    name: str

    def run_turn(
        self,
        conversation_id: str,
        static_blocks: Sequence[PromptBlock],
        frame: Sequence[PromptBlock],
        tools: Sequence[ToolEntry],
        ctx: TurnContext,
        user_message: str,
    ) -> AsyncIterator[ChannelEvent]:
        """Stream the turn. The last event is ``turn.finished`` or ``turn.error``, always."""
        ...

    async def last_result(self) -> TurnResult | None:
        """The ledger row for the turn that just ran, or ``None`` if none has."""
        ...

"""The ports the harness runs on (README §3.1: packages depend on ports, never on classes).

``athena.harness`` never imports a core *service*. The catalog, the approval table and the ledger
arrive as objects that satisfy the ``Protocol``s below, so the gate can be exercised against
in-memory fakes with no SQLite anywhere, and ``wiring`` is the one place that binds the real ones.
``tests/harness/test_ports.py`` proves the real ``athena.core`` classes satisfy them by driving a
gate through a real brain — a structural claim is only worth what an actual call proves.

Three of the protocols return *values* rather than core types: :class:`Card`, :class:`Grant` and
:class:`Row`. An approval row and a ledger row are core dataclasses, and naming them here would
put the import back. Naming the two or three members the harness actually reads keeps the seam
the width of its use, and the core classes satisfy them as they are.

:data:`ModelFn` is the seam for an engine that is not a CLI. Nothing in this build implements one —
the two dialects of ``cli_harness`` are the engines — and it is declared here for the same reason
``connectors.port`` is declared before a connector exists: the hooks and the gate are written
against the seam once, so a later engine is a new adapter and not a second gate.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol, runtime_checkable

from athena.contracts.channel import DecisionRequested
from athena.contracts.registry import (
    Lane,
    ToolClass,
    ToolEntry,
    TurnContext,
    ValidationResult,
)

__all__ = [
    "ApprovalsPort",
    "Card",
    "CatalogPort",
    "FlagPort",
    "Grant",
    "LedgerPort",
    "ModelChunk",
    "ModelFn",
    "ModelMessage",
    "ModelRequest",
    "Row",
    "stream_of",
]


# --- core ports --------------------------------------------------------------------------------


@runtime_checkable
class CatalogPort(Protocol):
    """``athena.core.catalog.Catalog`` as the gate sees it (README §3.3).

    Three methods, and every one of them is the catalog *deciding*: which names exist in this
    lane, what class a name is, and whether these parameters pass its validator. The harness asks;
    it never answers, which is the whole of "the gate is the policy".
    """

    def for_lane(self, lane: Lane) -> list[ToolEntry]: ...

    def classify(self, name: str) -> ToolClass: ...

    def validate(self, name: str, params: dict[str, Any], ctx: TurnContext) -> ValidationResult: ...


@runtime_checkable
class Card(Protocol):
    """An approval row, as the thing that filed it reads it back.

    ``to_event`` rather than a bag of fields: the card a surface renders is a contract
    (``DecisionRequested``), and a harness that assembled one from parts would be a second place
    that decides what a decision card says.
    """

    @property
    def id(self) -> str: ...

    def to_event(self) -> DecisionRequested: ...


@runtime_checkable
class Grant(Protocol):
    """What ``describe`` returns: the action and parameters the row was created for.

    :meth:`matches` is the half of README §3.2 step 6 that makes a replay a replay. The harness
    never compares parameters itself — canonicalisation is the approval table's business and two
    comparisons would eventually disagree.
    """

    @property
    def status(self) -> str: ...

    @property
    def approved(self) -> bool: ...

    def matches(self, action: str, params: Mapping[str, Any]) -> bool: ...


@runtime_checkable
class ApprovalsPort(Protocol):
    """``athena.core.approvals.Approvals`` (README §3.2 steps 4 and 6).

    :meth:`describe` raises ``ValueError`` for an id the table does not hold; the gate catches it
    and cancels with ``unknown_ref`` rather than letting an unknown id reach an executor.
    """

    def create(
        self,
        action: str,
        params: Mapping[str, Any],
        *,
        origin: str,
        conversation: str,
        surface: str,
        summary: str = "",
    ) -> Card: ...

    def describe(self, approval_id: str) -> Grant: ...


@runtime_checkable
class Row(Protocol):
    """One ledger row, as the hook that wrote it reads it back."""

    @property
    def row_id(self) -> int: ...

    @property
    def turn_id(self) -> str | None: ...

    @property
    def rounds(self) -> int: ...

    @property
    def is_error(self) -> bool: ...

    @property
    def error_reason(self) -> str | None: ...


@runtime_checkable
class LedgerPort(Protocol):
    """``athena.core.ledger.Ledger`` (README §2 invariant 6). One row per turn, failures included.

    Every argument is keyword-only, exactly as the ledger declares them. A positional call site
    that drifted by one argument would write a row that is wrong in a way no test reads back.
    """

    def record(
        self,
        *,
        engine: str,
        model: str,
        conversation: str,
        origin: str,
        surface: str,
        trigger: str,
        rounds: int = 1,
        input_tokens: int = 0,
        output_tokens: int = 0,
        cost_usd: float | None = None,
        cost_estimated: bool = False,
        ms: int = 0,
        is_error: bool = False,
        error_reason: str | None = None,
        turn_id: str | None = None,
    ) -> Row: ...


@runtime_checkable
class FlagPort(Protocol):
    """Where a tripwire goes when it fires (README §2 invariant 4).

    A flag is not a failure and never changes a turn: an under-announced block is a prompt that is
    slightly dishonest, and a prompt that refuses to compose is a turn that did not happen.
    ``LedgerHook`` is this build's implementation.
    """

    def flag(self, turn_id: str, name: str, detail: str) -> None: ...


# --- the seam for an engine that is not a CLI ---------------------------------------------------

ChunkKind = Literal["text", "thinking", "tool_call", "usage", "error", "done"]


@dataclass(frozen=True)
class ModelChunk:
    """One unit of provider output, normalised.

    ``tool_call`` carries ``call_id`` / ``name`` / ``params``; ``usage`` carries the token and cost
    fields; ``done`` ends the stream. A provider adapter's whole job is to produce these, which is
    what keeps the gate and the ledger identical behind every engine (ADR 0007).
    """

    kind: ChunkKind
    text: str = ""
    call_id: str = ""
    name: str = ""
    params: Mapping[str, Any] = field(default_factory=dict)
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float | None = None
    cost_estimated: bool = False
    model: str = ""
    reason: str = ""


@dataclass(frozen=True)
class ModelMessage:
    role: Literal["user", "assistant", "tool"]
    content: str = ""
    call_id: str = ""
    name: str = ""


@dataclass(frozen=True)
class ModelRequest:
    """One invocation. ``system`` is the static half and ``messages`` carries the frame.

    The split is not cosmetic here either: an engine that caches its system prompt must be handed
    a system prompt that does not move, and README §3.2 step 2 is the reason there are two fields
    rather than one rendered string.
    """

    system: str
    messages: Sequence[ModelMessage]
    tools: Sequence[Mapping[str, Any]] = ()
    model: str = ""
    max_tokens: int | None = None


ModelFn = Callable[[ModelRequest], AsyncIterator[ModelChunk]]
"""The one function a non-CLI engine supplies."""


async def stream_of(chunks: Sequence[ModelChunk]) -> AsyncIterator[ModelChunk]:
    """Adapt a fixed list of chunks into a :data:`ModelFn` stream. A fake engine, in one line."""
    for chunk in chunks:
        yield chunk

"""The ports the browser lane runs on (README §3.1: packages depend on ports, never on classes).

``athena.lane`` composes a turn and streams its events. It never opens a database, never spawns a
process and never imports a provider: the catalog, the approval table, the brain, the ledger and
the gate all arrive as objects that satisfy the ``Protocol``s below, and ``wiring`` is the one
place that binds the real ones. That is what lets ``tests/lane/`` drive a whole gated round trip
on a scripted transport with no CLI and no SQLite anywhere.

Two of these name types from ``athena.harness`` rather than declaring their own. The gate's
:class:`~athena.harness.hooks.GateOutcome` and the ledger's ``record`` signature are the
vocabulary the gate answers in, and a lane that re-declared either would be a second definition of
what "allowed" means — which is the thing ADR 0004 exists to prevent. The lane depends on the
*shape* of the gate's answer; it never constructs one.

:class:`GrantPort` is wider than the harness's own ``Grant`` because the lane reads more of the
row than the gate does: answering a card needs the action and the parameters back in order to
build the ``execute`` instruction the surface runs (README §3.2 step 6). Every member is a
read-only property, so a frozen dataclass satisfies it and nothing here can write to an approval.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from typing import Any, Protocol, runtime_checkable

from athena.contracts.harness import Harness, PromptBlock
from athena.contracts.registry import Lane, ToolEntry, TurnContext
from athena.harness.hooks import GateOutcome
from athena.harness.ports import LedgerPort

__all__ = [
    "ApprovalsPort",
    "BrainPort",
    "CatalogPort",
    "EpisodeRef",
    "GatePort",
    "GrantPort",
    "HarnessPort",
    "HostState",
    "LedgerPort",
    "RecallFn",
    "RecallPort",
    "names_of",
]

HarnessPort = Harness
"""The engine seam, aliased so the lane has one import site and never names a dialect."""

HostState = Mapping[str, Any]
"""What the surface reports about the applications the user has open (README §3.2 step 1)."""


@runtime_checkable
class CatalogPort(Protocol):
    """``athena.core.catalog.Catalog`` as the lane sees it.

    Three questions, and none of them is a decision: which entries this lane may be handed, how
    they render in the prompt, and which entry one name is. The class of a name is the catalog's
    answer and the lane never asks for it, because the lane never acts on it — the gate does.
    """

    def for_lane(self, lane: Lane) -> list[ToolEntry]: ...

    def render_capabilities(self, lane: Lane) -> PromptBlock: ...

    def get(self, name: str) -> ToolEntry:
        """The entry for a name, or ``ValueError`` for one the catalog does not hold."""
        ...


@runtime_checkable
class GrantPort(Protocol):
    """One approval row, as answering it reads it back."""

    @property
    def id(self) -> str: ...

    @property
    def action(self) -> str: ...

    @property
    def params(self) -> dict[str, Any]: ...

    @property
    def status(self) -> str: ...

    @property
    def origin(self) -> str: ...

    @property
    def conversation(self) -> str: ...

    @property
    def approved(self) -> bool: ...

    def matches(self, action: str, params: Mapping[str, Any]) -> bool: ...


@runtime_checkable
class ApprovalsPort(Protocol):
    """``athena.core.approvals.Approvals``, narrowed to the two calls answering a card makes.

    Filing a card is not here: the gate files it during the turn, and a lane that could also
    create approvals would be a second way for something to reach the user's inbox.
    """

    def resolve(self, approval_id: str, choice: str) -> Any:
        """Record the user's answer, or raise ``ValueError`` for a token the row never offered."""
        ...

    def describe(self, approval_id: str) -> GrantPort:
        """The action and parameters the row was created for; ``ValueError`` if unknown."""
        ...


@runtime_checkable
class GatePort(Protocol):
    """The gate (README §3.3). The lane's only route to an executor, and it takes it once:
    on the replay, after the user has answered."""

    def run_tool(
        self,
        entry: ToolEntry,
        params: Mapping[str, Any],
        ctx: TurnContext,
        *,
        rationale: str = "",
        approval_id: str | None = None,
    ) -> GateOutcome: ...


@runtime_checkable
class EpisodeRef(Protocol):
    """What the brain hands back when it wrote something. The lane reads the id and nothing else."""

    @property
    def id(self) -> str: ...


@runtime_checkable
class BrainPort(Protocol):
    """``athena.core.brain.store.Brain``, narrowed to the one thing a turn writes.

    Episodes are the only kind that is its own provenance, so this is the whole of the lane's
    write surface: a fact is written by ``core.write_fact`` through the gate, with a card in front
    of it, and never from here (README §2 invariant 2).
    """

    def append_episode(
        self, content: str, role: str = "user", *, session_id: str | None = None
    ) -> EpisodeRef: ...


@runtime_checkable
class RecallPort(Protocol):
    """One turn's recall, already run. ``athena.core.recall.RecallTrace`` satisfies it."""

    def as_prompt_blocks(self) -> list[PromptBlock]: ...


RecallFn = Callable[[str], RecallPort]
"""Recall for one message. ``lambda q: recall(brain, q)`` at wiring time; ``None`` in a test that
is about something else, which composes a frame with no memory in it rather than a fake one."""


def names_of(entries: Sequence[ToolEntry]) -> list[str]:
    """The registry names of a tool set, sorted. For log lines and for assertions."""
    return sorted(entry.name for entry in entries)

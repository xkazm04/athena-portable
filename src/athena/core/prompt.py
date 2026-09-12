"""The two-output prompt composer (README §3.2 step 2; ADR 0006).

One composition produces two things that go to two different places:

- :class:`StaticBlocks` — the constitution, the identity, the capability block generated from the
  catalog, and the always-include memory tier. These become the **system prompt**, and a CLI
  engine keeps the system prompt it was opened with for the life of a resumed conversation.
- :class:`TurnFrame` — the host-state delta since the last frame, last turn's tool results, the
  active project, the memory recalled for *this* message and the pending-decisions digest. These
  ride in the **user message**, every turn, each untrusted part inside a nonce-tagged fence.

The split is the fix for the finding in README §3.5: the first build composed one prompt, put
``host_state`` in it, and a resumed session then saw the tabs the user had open on turn one
forever. So the rule here is structural rather than remembered — **nothing that can move is ever
a static block**. :func:`compose` refuses to build a :class:`StaticBlocks` whose block names are
not in :data:`STATIC_NAMES`, and every frame block's name begins with ``frame.``. A reader can
tell which of the two outputs a block belongs to from its name alone, and so can the ledger.

Two consequences fall out of the rule and are worth stating because they look like omissions:

- Static blocks are **never fenced**. They are Athena's own text, not a page's, and a fence
  carries a fresh nonce — which would move their hashes every turn and destroy the property the
  next paragraph relies on.
- Static block hashes are **stable across turns when the content did not move**, which is what
  makes prompt-cache churn visible: a block that appears in :func:`churn` while its size held
  steady is cache-creation tokens being paid for nothing.

Budgets are tripwires, not caps. A breach is a warning on the composition and a ledger flag; it
is never a truncation the user was not told about.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

from athena.contracts.channel import ToolResult
from athena.contracts.harness import PromptBlock, fnv1a_64
from athena.contracts.registry import Lane
from athena.core.constitution import SECTIONS as CONSTITUTION_SECTIONS
from athena.core.constitution import Constitution
from athena.core.fence import fresh_nonce, wrap_untrusted

__all__ = [
    "BUDGETS",
    "FRAME_PREFIX",
    "RECALL_BLOCKS",
    "STATIC_NAMES",
    "CatalogPort",
    "Composed",
    "HostStateDelta",
    "HostStatePort",
    "PromptError",
    "RecallPort",
    "StaticBlocks",
    "TurnFrame",
    "assert_split",
    "churn",
    "compose",
    "stable",
]


class PromptError(ValueError):
    """A composition that would have broken the static/frame split."""


# --- the ports the composer runs on -----------------------------------------------------------
#
# Protocols and not the concrete classes, for two reasons. ``core.catalog`` and ``core.recall``
# both import ``core.brain`` or ``connectors.port``; composing against the classes would drag a
# SQLite handle into the module that builds a string, and the harness could then not be tested
# with a fake. And the daemon's read routes hand the composer a trace they already have rather
# than a brain to query again.


@runtime_checkable
class CatalogPort(Protocol):
    """The catalog, seen from the prompt: one generated block per lane.

    ``athena.core.catalog.Catalog`` satisfies this. The block is *generated* from the registry,
    so a name the catalog does not hold is a name the model was never told about.
    """

    def render_capabilities(self, lane: Lane) -> PromptBlock: ...


@runtime_checkable
class RecallPort(Protocol):
    """One turn's recall, already run. ``athena.core.recall.RecallTrace`` satisfies this.

    The blocks come back named ``recall.<lane>`` with their own ``(showing N of M)`` footers;
    :data:`RECALL_BLOCKS` says which of them is static and which rides in the frame.
    """

    def as_prompt_blocks(self) -> list[PromptBlock]: ...


@runtime_checkable
class HostStatePort(Protocol):
    """The surface's readable view of the applications the user has open (README §3.2 step 1)."""

    def snapshot(self) -> Mapping[str, Any]: ...


# --- names ------------------------------------------------------------------------------------

FRAME_PREFIX = "frame."

#: The only block names a system prompt may carry. Anything else can move between turns, and a
#: block that can move is a block a resumed conversation would freeze.
STATIC_NAMES: tuple[str, ...] = ("constitution", "identity", "capabilities", "memory.always")

#: ``core.recall``'s block names mapped onto this module's, with the heading each one renders
#: under. The always tier is the one recall lane that is conversation-scoped rather than
#: message-scoped, so it is the one that lands in the system prompt. ``tests/core/test_prompt.py``
#: asserts these keys against ``core.recall``'s own constants rather than trusting the spelling.
RECALL_BLOCKS: Mapping[str, tuple[str, str]] = {
    "recall.always": ("memory.always", "## What I always carry"),
    "recall.keyword": ("frame.memory", "## Memory that matched this message"),
    "recall.episodes": ("frame.episodes", "## Recalled conversation"),
}

#: Character budgets, per block. A tripwire each, never a cap.
BUDGETS: Mapping[str, int] = {
    "constitution": 24_000,
    "identity": 8_000,
    "capabilities": 12_000,
    "memory.always": 12_000,
    "frame.project": 2_000,
    "frame.host_state": 8_000,
    "frame.tools": 12_000,
    "frame.memory": 12_000,
    "frame.episodes": 40_000,
    "frame.decisions": 4_000,
}

#: How much of a host-state payload reaches the prompt before it is cut and announced.
HOST_STATE_CHARS = BUDGETS["frame.host_state"]
#: How many of last turn's tool results are rendered, newest last.
TOOL_RESULT_LIMIT = 8
#: How many pending decisions the digest names before it announces the rest.
DECISION_LIMIT = 10


# --- what came out ----------------------------------------------------------------------------


def _joined(blocks: Sequence[PromptBlock]) -> str:
    return "\n\n".join(block.text.rstrip() for block in blocks) + "\n" if blocks else ""


@dataclass(frozen=True)
class StaticBlocks:
    """The system prompt. Composed once per conversation and identical on every turn of it."""

    blocks: tuple[PromptBlock, ...]
    #: The constitution's content hash, so the ledger can say which law a turn ran under.
    constitution_version: str = ""

    @property
    def text(self) -> str:
        return _joined(self.blocks)

    @property
    def hash(self) -> str:
        return fnv1a_64(self.text)

    def hashes(self) -> dict[str, str]:
        """Per-block content hashes — what :func:`churn` compares between two turns."""
        return {block.name: block.hash for block in self.blocks}

    def block(self, name: str) -> PromptBlock | None:
        return next((block for block in self.blocks if block.name == name), None)

    @property
    def names(self) -> list[str]:
        return [block.name for block in self.blocks]


@dataclass(frozen=True)
class HostStateDelta:
    """What moved in host state since the frame before this one.

    ``first`` separates "the surface has not sent state before" from "the state did not change";
    the model needs them to read differently, because the first is a whole picture and the second
    is a promise that the previous picture still holds.
    """

    added: Mapping[str, Any] = field(default_factory=dict)
    changed: Mapping[str, Any] = field(default_factory=dict)
    removed: tuple[str, ...] = ()
    first: bool = False

    @property
    def empty(self) -> bool:
        return not (self.added or self.changed or self.removed)

    def payload(self) -> dict[str, Any]:
        return {
            "added": dict(self.added),
            "changed": dict(self.changed),
            "removed": list(self.removed),
        }


@dataclass(frozen=True)
class TurnFrame:
    """The user message's context. Composed fresh every turn, fenced with a fresh nonce."""

    blocks: tuple[PromptBlock, ...]
    nonce: str
    #: The snapshot this frame was built from. The caller hands it back as
    #: ``previous_host_state`` on the next turn; that is the whole of the delta's bookkeeping.
    host_state: Mapping[str, Any] = field(default_factory=dict)
    delta: HostStateDelta = field(default_factory=HostStateDelta)

    @property
    def text(self) -> str:
        return _joined(self.blocks)

    def hashes(self) -> dict[str, str]:
        return {block.name: block.hash for block in self.blocks}

    def block(self, name: str) -> PromptBlock | None:
        return next((block for block in self.blocks if block.name == name), None)

    @property
    def names(self) -> list[str]:
        return [block.name for block in self.blocks]


@dataclass(frozen=True)
class Composed:
    """Both outputs of one composition, plus the tripwires that fired."""

    static: StaticBlocks
    frame: TurnFrame
    warnings: tuple[str, ...] = ()


def churn(previous: Mapping[str, str], current: Mapping[str, str]) -> list[str]:
    """Which blocks' hashes moved between two turns — the cache-churn detector (README §3.2)."""
    return sorted(
        name for name, value in current.items() if name in previous and previous[name] != value
    )


def stable(previous: Mapping[str, str], current: Mapping[str, str]) -> bool:
    return not churn(previous, current)


# --- block builders ---------------------------------------------------------------------------


def _capabilities(catalog: CatalogPort, lane: Lane) -> PromptBlock:
    block = catalog.render_capabilities(lane).announced()
    if block.name != "capabilities":
        block = PromptBlock(
            name="capabilities",
            text=block.text,
            shown=block.shown,
            total=block.total,
            untrusted=block.untrusted,
        )
    return block


def _recall_blocks(recall: RecallPort | None, nonce: str) -> dict[str, PromptBlock]:
    """The recall trace, renamed and headed, with the untrusted lanes fenced."""
    out: dict[str, PromptBlock] = {}
    if recall is None:
        return out
    for block in recall.as_prompt_blocks():
        mapped = RECALL_BLOCKS.get(block.name)
        if mapped is None:
            continue
        name, heading = mapped
        announced = block.announced()
        body = announced.text.strip() or "(nothing recalled)"
        rendered = wrap_untrusted(body, nonce=nonce) if announced.untrusted else body
        out[name] = PromptBlock(
            name=name,
            text=f"{heading}\n\n{rendered}\n",
            shown=announced.shown,
            total=announced.total,
            untrusted=announced.untrusted,
        )
    return out


def _delta(current: Mapping[str, Any], previous: Mapping[str, Any] | None) -> HostStateDelta:
    if previous is None:
        return HostStateDelta(added=dict(current), first=True)
    added = {key: value for key, value in current.items() if key not in previous}
    changed = {
        key: value for key, value in current.items() if key in previous and previous[key] != value
    }
    removed = tuple(sorted(key for key in previous if key not in current))
    return HostStateDelta(added=added, changed=changed, removed=removed)


def _host_state_block(
    current: Mapping[str, Any],
    delta: HostStateDelta,
    nonce: str,
    max_chars: int = HOST_STATE_CHARS,
) -> PromptBlock:
    """The host-state delta, bounded and fenced. Host state is what a page produced about itself;
    it is evidence, and never an instruction (README §2 invariant 6)."""
    if delta.first:
        lead = "This is the first state the surface has sent this conversation."
        payload: Any = dict(current)
    elif delta.empty:
        lead = "Nothing moved since the last turn; the state you were last shown still holds."
        payload = {}
    else:
        lead = "Only what moved since the last turn is below. Everything else still holds."
        payload = delta.payload()
    rendered = json.dumps(payload, indent=1, sort_keys=True, default=str)
    total = len(rendered)
    shown = min(total, max(max_chars, 0))
    text = (
        "## Host application state\n\n"
        f"{lead}\n\n"
        f"{wrap_untrusted(rendered[:shown], nonce=nonce)}\n\n"
        f"(showing {shown} of {total})\n"
    )
    return PromptBlock(name="frame.host_state", text=text, shown=shown, total=total, untrusted=True)


def _outcome(result: ToolResult) -> str:
    if result.ok:
        return "ok"
    reason = result.error or "unknown"
    return f"error: {reason}"


def _output(result: ToolResult) -> str:
    return result.output.strip() or "(no output)"


def _tool_results_block(
    results: Sequence[ToolResult], nonce: str, limit: int = TOOL_RESULT_LIMIT
) -> PromptBlock:
    """What the tools you called last turn returned. Tool output is untrusted: a page that can
    write its own tool's result can write anything into this block."""
    total = len(results)
    shown = min(total, max(limit, 0))
    kept = list(results)[total - shown :] if shown else []
    items = [f"- {result.name} → {_outcome(result)}\n{_output(result)}" for result in kept]
    body = "\n\n".join(items) or "(no tools ran last turn)"
    text = (
        "## Results from the tools you called last turn\n\n"
        f"{wrap_untrusted(body, nonce=nonce)}\n\n"
        f"(showing {shown} of {total})\n"
    )
    return PromptBlock(name="frame.tools", text=text, shown=shown, total=total, untrusted=True)


def _project_block(project: Mapping[str, Any] | None) -> PromptBlock:
    """The active project — the user's own selection, so this one is not fenced."""
    if not project:
        body = "(no project selected; this is a loose conversation)"
    else:
        body = "\n".join(f"- {key}: {project[key]}" for key in sorted(project))
    return PromptBlock(name="frame.project", text=f"## Active project\n\n{body}\n")


def _decisions_block(lines: Sequence[str], limit: int = DECISION_LIMIT) -> PromptBlock:
    """Cards the user has not answered. You do not act on a pending card and you do not re-file
    one; it is here so you can say what you are waiting for."""
    total = len(lines)
    shown = min(total, max(limit, 0))
    body = "\n".join(f"- {line}" for line in lines[:shown]) or "(nothing is waiting on the user)"
    text = f"## Decisions waiting on the user\n\n{body}\n\n(showing {shown} of {total})\n"
    return PromptBlock(name="frame.decisions", text=text, shown=shown, total=total)


# --- composition ------------------------------------------------------------------------------


def _snapshot(source: HostStatePort | Mapping[str, Any] | None) -> Mapping[str, Any]:
    if source is None:
        return {}
    if isinstance(source, Mapping):
        return source
    return source.snapshot()


def assert_split(static: Sequence[PromptBlock], frame: Sequence[PromptBlock]) -> None:
    """The rule of README §3.5, enforced rather than remembered.

    Public because the harness composes the two halves into an engine call and the same rule
    applies there: whatever reaches ``static_blocks`` is what a resumed conversation will keep.
    """
    for block in static:
        if block.name not in STATIC_NAMES:
            raise PromptError(
                f"{block.name!r} is not a static block; anything that can move between turns "
                f"belongs in the frame (static blocks are {', '.join(STATIC_NAMES)})"
            )
        if block.untrusted:
            raise PromptError(f"{block.name!r} is untrusted and cannot be a static block")
    for block in frame:
        if not block.name.startswith(FRAME_PREFIX):
            raise PromptError(f"{block.name!r} rides in the user message and must be frame.*")


def _warnings(blocks: Sequence[PromptBlock]) -> list[str]:
    out: list[str] = []
    for block in blocks:
        budget = BUDGETS.get(block.name)
        if budget is not None and block.size > budget:
            out.append(f"block {block.name} is {block.size} chars over a {budget} budget")
        if not block.announces_truncation():
            out.append(f"block {block.name} does not announce what it left out")
    return out


def compose(
    *,
    constitution: Constitution,
    catalog: CatalogPort,
    lane: Lane = Lane.BROWSER,
    recall: RecallPort | None = None,
    host_state: HostStatePort | Mapping[str, Any] | None = None,
    previous_host_state: Mapping[str, Any] | None = None,
    tool_results: Sequence[ToolResult] = (),
    active_project: Mapping[str, Any] | None = None,
    pending_decisions: Sequence[str] = (),
    nonce: str | None = None,
    tool_result_limit: int = TOOL_RESULT_LIMIT,
    decision_limit: int = DECISION_LIMIT,
    host_state_chars: int = HOST_STATE_CHARS,
) -> Composed:
    """Compose one turn into a system prompt and a user-message frame.

    ``previous_host_state`` is the ``TurnFrame.host_state`` of the frame before this one, or
    ``None`` on the first turn of a conversation. The composer keeps no state of its own: the
    delta is a function of its two arguments, so two callers cannot disagree about what the model
    was last shown.
    """
    tag = nonce or fresh_nonce()
    recalled = _recall_blocks(recall, tag)

    static_blocks: list[PromptBlock] = [
        constitution.block(section) for section in CONSTITUTION_SECTIONS
    ]
    static_blocks.append(_capabilities(catalog, lane))
    always = recalled.get("memory.always")
    if always is not None:
        static_blocks.append(always)

    current = _snapshot(host_state)
    delta = _delta(current, previous_host_state)
    frame_blocks: list[PromptBlock] = [
        _project_block(active_project),
        _host_state_block(current, delta, tag, host_state_chars),
        _tool_results_block(tool_results, tag, tool_result_limit),
    ]
    frame_blocks.extend(block for name, block in recalled.items() if name.startswith(FRAME_PREFIX))
    frame_blocks.append(_decisions_block(pending_decisions, decision_limit))

    assert_split(static_blocks, frame_blocks)
    return Composed(
        static=StaticBlocks(blocks=tuple(static_blocks), constitution_version=constitution.version),
        frame=TurnFrame(
            blocks=tuple(frame_blocks), nonce=tag, host_state=dict(current), delta=delta
        ),
        warnings=tuple(_warnings([*static_blocks, *frame_blocks])),
    )

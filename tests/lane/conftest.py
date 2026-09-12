"""The lane's fixtures: a real catalog and gate, a scripted engine, in-memory everything else.

The catalog, the constitution, the composer, the gate and the harness are the real classes here —
the lane's whole claim is about what happens when a proposed call meets *those*, and a fake
catalog would be a test of the fake. What is faked is what needs a disk or a process: the brain,
the approval table, the ledger, and the CLI itself, which is a
:class:`~athena.harness.transports.ScriptedTransport` replaying recorded stdout. Nothing here
spawns a binary and nothing opens SQLite.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest

from athena.contracts.channel import DecisionOption, DecisionRequested
from athena.contracts.manifest import HostManifest, HostTool
from athena.contracts.registry import ExecResult, Lane, TurnContext
from athena.core.catalog import Catalog, CoreServices, build_catalog
from athena.core.constitution import Constitution, Source
from athena.harness.cli_harness import CLAUDE, CliHarness
from athena.harness.hooks import LedgerHook, TruncationHook
from athena.harness.policy import Policy, PolicyHook
from athena.harness.transports import ScriptedTransport
from athena.lane.browser_lane import BrowserLane
from athena.lane.turn_frame import FrameBuilder

APP_ID = "invoices"
PAGE_ORIGIN = "https://invoices.example"
ORIGIN = f"host:{APP_ID}"
CONVERSATION = "conv_invoices"
PROJECT = "proj_000000000001"
SESSION = "01J9CLAUDESESSION"


# --- the scripted engine ------------------------------------------------------------------------


def claude_round(text: str) -> list[str]:
    """One invocation of ``claude -p - --output-format stream-json``, as recorded lines."""
    return [
        json.dumps({"type": "system", "session_id": SESSION}),
        json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": text}]}}),
        json.dumps(
            {
                "type": "result",
                "is_error": False,
                "total_cost_usd": 0.04,
                "usage": {"input_tokens": 1840, "output_tokens": 96},
            }
        ),
    ]


def op(action: str, rationale: str = "", **params: Any) -> str:
    """One ``OP:`` envelope, the grammar the capability block teaches (README §3.2 step 3)."""
    envelope: dict[str, Any] = {"op": "propose_action", "action": action, "params": params}
    if rationale:
        envelope["rationale"] = rationale
    return "OP: " + json.dumps(envelope)


# --- the brain ------------------------------------------------------------------------------------


@dataclass
class Episode:
    """One row of :class:`FakeBrain`. ``id`` is what ``BrainPort.append_episode`` returns."""

    id: str
    content: str
    role: str
    session_id: str | None


class FakeBrain:
    """``BrainPort`` over a list. Episodes are their own provenance, so nothing is refused here."""

    def __init__(self) -> None:
        self.episodes: list[Episode] = []

    def append_episode(
        self, content: str, role: str = "user", *, session_id: str | None = None
    ) -> Episode:
        episode = Episode(
            id=f"ep_{len(self.episodes):08x}",
            content=content,
            role=role,
            session_id=session_id,
        )
        self.episodes.append(episode)
        return episode

    def bodies(self, role: str | None = None) -> list[str]:
        return [e.content for e in self.episodes if role is None or e.role == role]


# --- the approval table ---------------------------------------------------------------------------


def _canonical(params: Mapping[str, Any]) -> str:
    return json.dumps(dict(params), sort_keys=True, separators=(",", ":"))


@dataclass
class FakeCard:
    """One approval row: the card the gate filed and the grant the replay reads back."""

    id: str
    action: str
    params: dict[str, Any]
    origin: str
    conversation: str
    surface: str
    summary: str = ""
    status: str = "pending"

    def to_event(self) -> DecisionRequested:
        return DecisionRequested(
            id=self.id,
            action=self.action,
            params=dict(self.params),
            rationale=self.summary,
            options=(DecisionOption("approve"), DecisionOption("decline")),
            origin=self.origin,
            surface=self.surface,
        )

    @property
    def approved(self) -> bool:
        return self.status == "approved"

    def matches(self, action: str, params: Mapping[str, Any]) -> bool:
        return action == self.action and _canonical(params) == _canonical(self.params)


class FakeApprovals:
    """``ApprovalsPort``. ``resolve`` takes only the tokens the row offered, as core does."""

    def __init__(self) -> None:
        self.rows: dict[str, FakeCard] = {}

    def create(
        self,
        action: str,
        params: Mapping[str, Any],
        *,
        origin: str,
        conversation: str,
        surface: str,
        summary: str = "",
    ) -> FakeCard:
        card = FakeCard(
            id=f"apr_{len(self.rows):012d}",
            action=action,
            params=dict(params),
            origin=origin,
            conversation=conversation,
            surface=surface,
            summary=summary,
        )
        self.rows[card.id] = card
        return card

    def describe(self, approval_id: str) -> FakeCard:
        try:
            return self.rows[approval_id]
        except KeyError:
            raise ValueError(f"unknown approval {approval_id}") from None

    def resolve(self, approval_id: str, choice: str) -> FakeCard:
        card = self.describe(approval_id)
        if choice not in ("approve", "decline"):
            raise ValueError(f"{choice!r} is not an answer this card offered")
        if card.status != "pending":
            raise ValueError(f"approval {approval_id} is {card.status}, not pending")
        card.status = "approved" if choice == "approve" else "declined"
        return card

    @property
    def only(self) -> FakeCard:
        assert len(self.rows) == 1, f"expected exactly one card, got {sorted(self.rows)}"
        return next(iter(self.rows.values()))


# --- the ledger -----------------------------------------------------------------------------------


@dataclass
class FakeRow:
    row_id: int
    turn_id: str | None
    rounds: int
    is_error: bool
    error_reason: str | None
    fields: dict[str, Any] = field(default_factory=dict)


class FakeLedger:
    """``LedgerPort`` over a list, keyword-only exactly as the real one is."""

    def __init__(self) -> None:
        self.rows: list[FakeRow] = []

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
    ) -> FakeRow:
        row = FakeRow(
            row_id=len(self.rows) + 1,
            turn_id=turn_id,
            rounds=rounds,
            is_error=is_error,
            error_reason=error_reason,
            fields={
                "engine": engine,
                "model": model,
                "conversation": conversation,
                "origin": origin,
                "surface": surface,
                "trigger": trigger,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cost_usd": cost_usd,
                "ms": ms,
            },
        )
        self.rows.append(row)
        return row

    @property
    def error_rows(self) -> list[FakeRow]:
        return [row for row in self.rows if row.is_error]


# --- the real catalog -----------------------------------------------------------------------------


class Spy:
    """A core executor that records what it ran. Nothing gated may reach one during a turn."""

    def __init__(self, output: str = "written") -> None:
        self.calls: list[dict[str, Any]] = []
        self.output = output

    def __call__(self, params: dict[str, Any], ctx: TurnContext) -> ExecResult:
        self.calls.append(dict(params))
        return ExecResult(ok=True, output=self.output)


def invoices_manifest() -> HostManifest:
    """The page's own two tools: one reversible, one that leaves the app (README §3.3).

    ``chase`` is ``AUTO`` and ``pay`` is ``GATED``, and neither of them is a preference the host
    expressed — both fall out of ``reversible`` and ``side_effects``.
    """
    return HostManifest(
        app_id=APP_ID,
        page_origin=PAGE_ORIGIN,
        tools=[
            HostTool(
                name="chase",
                description="Draft a chase note on an invoice.",
                params_schema={"type": "object", "properties": {"invoice": {"type": "string"}}},
                reversible=True,
                side_effects="internal",
            ),
            HostTool(
                name="pay",
                description="Pay an invoice.",
                params_schema={"type": "object", "properties": {"invoice": {"type": "string"}}},
                reversible=False,
                side_effects="external",
            ),
        ],
    )


def constitution(directory: Path) -> Constitution:
    return Constitution(
        source=Source("explicit", directory),
        sections={
            "law": "# The law\n\nYou act for the user and never around them.",
            "identity": "# Identity\n\nYou are Athena.",
        },
    )


@dataclass
class Harnessed:
    """Everything one lane test drives, bound together the way ``wiring`` will."""

    lane: BrowserLane
    catalog: Catalog
    approvals: FakeApprovals
    ledger: FakeLedger
    brain: FakeBrain
    transport: ScriptedTransport
    frames: FrameBuilder
    write_fact: Spy
    checkpoint: Spy

    def ctx(self, **overrides: Any) -> TurnContext:
        kwargs: dict[str, Any] = {
            "conversation_id": CONVERSATION,
            "turn_id": "turn_000000000001",
            "lane": Lane.BROWSER,
            "surface": "panel",
            "app_id": APP_ID,
            "page_origin": PAGE_ORIGIN,
            "project_id": PROJECT,
        }
        kwargs.update(overrides)
        return TurnContext(**kwargs)


def build_lane(
    rounds: Sequence[Sequence[str]],
    tmp_path: Path,
    *,
    transport: ScriptedTransport | None = None,
) -> Harnessed:
    """A whole lane on a scripted engine. One call, because every test needs all of it."""
    write_fact = Spy("fact written")
    checkpoint = Spy("noted")
    services = CoreServices(
        sources_alive=lambda sources: True,
        recall=Spy("nothing recalled"),
        write_fact=write_fact,
        checkpoint=checkpoint,
        answer_decision=Spy("relayed"),
    )
    catalog = build_catalog(services, invoices_manifest())
    approvals = FakeApprovals()
    ledger = FakeLedger()
    brain = FakeBrain()
    gate = PolicyHook(catalog, approvals, Policy.build(pinned_origins={APP_ID: PAGE_ORIGIN}))
    script = transport if transport is not None else ScriptedTransport(rounds)
    harness = CliHarness(
        gate=gate,
        ledger=LedgerHook(ledger),
        truncation=TruncationHook(),
        transport=script,
        dialect=CLAUDE,
        prompt_root=str(tmp_path),
        cwd=str(tmp_path),
        model="claude-opus-5",
    )
    frames = FrameBuilder(constitution=constitution(tmp_path), catalog=catalog)
    return Harnessed(
        lane=BrowserLane(
            harness=harness,
            catalog=catalog,
            gate=gate,
            approvals=approvals,
            brain=brain,
            ledger=ledger,
            frames=frames,
        ),
        catalog=catalog,
        approvals=approvals,
        ledger=ledger,
        brain=brain,
        transport=script,
        frames=frames,
        write_fact=write_fact,
        checkpoint=checkpoint,
    )


@pytest.fixture
def law(tmp_path: Path) -> Constitution:
    return constitution(tmp_path)

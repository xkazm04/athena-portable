"""One assembled lane over a real brain, a real catalog and a recorded engine (README §3.2).

The point of these fixtures is that almost nothing here is a fake. The brain is SQLite in a tmp
directory, the catalog is the real one with a real manifest merged into it, the approval table and
the ledger are the real ones, and the gate is the real gate. Only the *engine* is recorded, because
a test that needs a subscription is a test nobody runs.

That is deliberate: the lane's job is wiring, and a lane exercised against fakes on every side
proves that the wiring is self-consistent rather than that it is right.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import pytest

from athena.contracts.channel import ChannelEvent
from athena.contracts.manifest import HostManifest
from athena.contracts.registry import ExecResult, Lane, TurnContext
from athena.core.approvals import Approvals
from athena.core.brain.store import Brain
from athena.core.catalog import Catalog, CoreServices, build_catalog
from athena.core.constitution import Constitution, Source
from athena.core.ledger import Ledger
from athena.harness.cli_harness import CLAUDE, CliHarness
from athena.harness.hooks import GateHook, LedgerHook, TruncationHook
from athena.harness.transports import ScriptedTransport
from athena.lane.browser_lane import BrowserLane
from athena.lane.turn_frame import TurnRequest

LAW = "# Law\n\nYou are Athena. A name that is not listed does not exist.\n"
IDENTITY = "# Identity\n\nOne companion beside the applications, never inside one.\n"

APP = "invoices"
PAGE_ORIGIN = "https://invoices.example"


def constitution() -> Constitution:
    return Constitution(
        source=Source("package", Path("constitution")),
        sections={"law": LAW, "identity": IDENTITY},
    )


def manifest() -> HostManifest:
    """A page that registered three tools: one safe, one that leaves the app, one unflagged."""
    return HostManifest.from_dict(
        {
            "app_id": APP,
            "app_version": "1.4.0",
            "page_origin": PAGE_ORIGIN,
            "tools": [
                {
                    "name": "list_overdue",
                    "description": "Invoices past their due date.",
                    "reversible": True,
                    "side_effects": "none",
                },
                {
                    "name": "chase",
                    "description": "Send a chase for one invoice.",
                    "reversible": False,
                    "side_effects": "external",
                    "params_schema": {
                        "type": "object",
                        "properties": {"invoice": {"type": "string"}},
                    },
                },
            ],
            "state_readables": [{"name": "totals", "max_items": 20}],
        }
    )


def line(**payload: Any) -> str:
    """One NDJSON line in the Claude dialect."""
    return json.dumps(payload)


def assistant(text: str) -> str:
    return line(type="assistant", message={"content": [{"type": "text", "text": text}]})


def result_line(*, cost: float = 0.0031, is_error: bool = False) -> str:
    return line(
        type="result",
        is_error=is_error,
        total_cost_usd=cost,
        usage={"input_tokens": 900, "output_tokens": 120},
    )


def session(session_id: str = "sess-1") -> str:
    return line(type="system", subtype="init", session_id=session_id)


@pytest.fixture
def brain(tmp_path: Path) -> Brain:
    made = Brain(tmp_path / "brain", session_id="sess_lane")
    yield made
    made.close()


@pytest.fixture
def catalog(brain: Brain) -> Catalog:
    recalled: list[str] = []

    def recall_tool(params: dict[str, Any], ctx: TurnContext) -> ExecResult:
        recalled.append(str(params.get("query", "")))
        return ExecResult.bounded(["a fact about the user", "another"], 2, tier=0)

    def checkpoint(params: dict[str, Any], ctx: TurnContext) -> ExecResult:
        return ExecResult(ok=True, output="noted")

    def write_fact(params: dict[str, Any], ctx: TurnContext) -> ExecResult:
        return ExecResult(ok=True, output=f"wrote {params.get('key')}")

    services = CoreServices(
        sources_alive=lambda sources: bool(brain.live_episode_ids(sources)),
        recall=recall_tool,
        write_fact=write_fact,
        checkpoint=checkpoint,
    )
    return build_catalog(services, manifest())


def build_lane(
    brain: Brain,
    catalog: Catalog,
    rounds: Sequence[Sequence[str]],
    tmp_path: Path,
) -> tuple[BrowserLane, Approvals, Ledger, ScriptedTransport]:
    approvals = Approvals(brain)
    ledger = Ledger(brain)
    transport = ScriptedTransport(rounds)
    harness = CliHarness(
        gate=GateHook(catalog, approvals),
        ledger=LedgerHook(ledger),
        truncation=TruncationHook(),
        transport=transport,
        dialect=CLAUDE,
        prompt_root=str(tmp_path),
        cwd=str(tmp_path),
        model="claude-opus-5",
    )
    lane = BrowserLane(
        catalog=catalog,
        approvals=approvals,
        constitution=constitution(),
        harness=harness,
        ledger=ledger,
        episodes=brain,
    )
    # The gate the *harness* runs is the lane's, so structural policy is in front of both halves
    # of the turn rather than only the replay.
    harness.gate = lane.gate
    return lane, approvals, ledger, transport


def request(message: str = "Which invoices are late?", **overrides: Any) -> TurnRequest:
    payload: dict[str, Any] = {
        "message": message,
        "app_id": APP,
        "page_origin": PAGE_ORIGIN,
        "host_state": {"active_app": APP, "tabs": [{"app_id": APP, "title": "Invoices"}]},
    }
    payload.update(overrides)
    return TurnRequest.from_dict(payload)


def drain(lane: BrowserLane, req: TurnRequest) -> list[ChannelEvent]:
    async def run() -> list[ChannelEvent]:
        return [event async for event in lane.run(req)]

    return asyncio.run(run())


LANE = Lane.BROWSER

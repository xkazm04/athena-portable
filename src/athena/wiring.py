"""The one place ports are bound to classes (README §3.1).

Every other module in this repository names a ``Protocol`` and is handed something that satisfies
it. This module is where the real brain, the real catalog, the real approval table and the real
engine are constructed and handed over — so "packages depend on ports, never on concrete classes"
is a property of the import graph and not a habit.

It is also the only module allowed to know the *order* things have to be built in, and one of
those orders is genuinely circular: ``core.answer_decision`` is a tool that closes an approval, the
catalog holds that tool, the gate holds the catalog, and the lane holds the gate and owns closing
an approval. The knot is tied once, here, with a holder the lane fills after it exists — rather
than by giving the catalog a lane, which would make a tool able to start a turn.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from athena.contracts.registry import ExecResult, TurnContext
from athena.core.approvals import ApprovalError, Approvals
from athena.core.brain.paths import athena_home
from athena.core.brain.store import Brain
from athena.core.catalog import READ_CAP, Catalog, CoreServices, build_catalog
from athena.core.constitution import Constitution, load_or_empty
from athena.core.ledger import Ledger
from athena.core.recall import recall as recall_memories
from athena.daemon.ready import Readiness, readiness
from athena.daemon.routes import Deps, build_router
from athena.daemon.server import Daemon, mint_token
from athena.daemon.sessions import Sessions
from athena.harness.cli_harness import CLAUDE
from athena.harness.engines import EngineStatus, build_harness, probe_all
from athena.harness.hooks import LedgerHook, TruncationHook
from athena.lane.browser_lane import BrowserLane

__all__ = ["Assembly", "Config", "assemble"]


@dataclass
class Config:
    """Everything the daemon needs to be told. Defaults are what a first launch should do."""

    brain_root: Path | None = None
    #: The engine name as ``harness.engines.ENGINES`` spells it, not as a person would.
    engine: str = CLAUDE.name
    model: str = ""
    host: str = "127.0.0.1"
    port: int = 0
    token: str | None = None
    #: Where the composed system prompt and the CLI's working directory go. Never the checkout:
    #: the engine has no business in the repository it is being developed in.
    work_root: Path | None = None
    version: str = "0.1.0"


@dataclass
class Assembly:
    """Everything that was built, so a caller can reach past the daemon in a test."""

    config: Config
    brain: Brain
    catalog: Catalog
    approvals: Approvals
    ledger: Ledger
    constitution: Constitution
    lane: BrowserLane
    sessions: Sessions
    deps: Deps
    daemon: Daemon
    engines: list[EngineStatus] = field(default_factory=list)

    def close(self) -> None:
        self.daemon.stop()
        self.brain.close()

    def __enter__(self) -> Assembly:
        self.daemon.start()
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


class _Resolver:
    """Where ``core.answer_decision`` finds the lane, once the lane exists.

    A holder and not a constructor argument: the lane needs the catalog, the catalog needs this
    tool, and the tool needs the lane. Exactly one of the three can be late, and this is the one
    where being late is invisible — the tool is not callable before a turn, and there is no turn
    before the lane.
    """

    def __init__(self) -> None:
        self.lane: BrowserLane | None = None


def assemble(config: Config | None = None) -> Assembly:
    """Build the whole thing, in the one order that works."""
    cfg = config or Config()
    root = Path(cfg.brain_root) if cfg.brain_root else athena_home() / "brain"
    work = Path(cfg.work_root) if cfg.work_root else athena_home() / "work"
    work.mkdir(parents=True, exist_ok=True)

    brain = Brain(root, session_id="sess_daemon")
    approvals = Approvals(brain)
    ledger = Ledger(brain)
    constitution = load_or_empty()
    resolver = _Resolver()

    catalog = build_catalog(_services(brain, approvals, resolver))
    ledger_hook = LedgerHook(ledger)
    truncation = TruncationHook(ledger_hook)
    sessions = Sessions()

    lane = BrowserLane(
        catalog=catalog,
        approvals=approvals,
        constitution=constitution,
        harness=_placeholder_harness(),
        ledger=ledger,
        episodes=brain,
        recall=lambda query: recall_memories(brain, query),
    )
    # The gate belongs to the lane, and the harness runs behind *that* gate rather than a second
    # one built from the same parts: two GateHooks over one catalog would be two places a policy
    # change has to land.
    lane.harness = build_harness(
        cfg.engine,
        gate=lane.gate,
        ledger=ledger_hook,
        truncation=truncation,
        prompt_root=str(work),
        cwd=str(work),
        model=cfg.model,
    )
    resolver.lane = lane

    engines = probe_all()
    deps = Deps(
        lane=lane,
        sessions=sessions,
        catalog=catalog,
        approvals=approvals,
        ledger=ledger,
        readiness=lambda: _readiness(root, constitution, engines),
        version=cfg.version,
    )
    daemon = Daemon(
        build_router(deps),
        token=cfg.token or mint_token(),
        host=cfg.host,
        port=cfg.port,
    )
    return Assembly(
        config=cfg,
        brain=brain,
        catalog=catalog,
        approvals=approvals,
        ledger=ledger,
        constitution=constitution,
        lane=lane,
        sessions=sessions,
        deps=deps,
        daemon=daemon,
        engines=engines,
    )


# --- Athena's own four tools, bound to a real brain -----------------------------------------------


def _services(brain: Brain, approvals: Approvals, resolver: _Resolver) -> CoreServices:
    def sources_alive(sources: Sequence[str]) -> bool:
        wanted = list(sources)
        return bool(wanted) and brain.live_episode_ids(wanted) == set(wanted)

    def recall(params: dict[str, Any], ctx: TurnContext) -> ExecResult:
        trace = recall_memories(brain, str(params.get("query", "")))
        items = [memory.render() for memory in trace.items]
        limit = int(params.get("limit", len(items)) or len(items))
        return ExecResult.bounded(items, min(limit, len(items)), tier=0)

    def write_fact(params: dict[str, Any], ctx: TurnContext) -> ExecResult:
        try:
            ref = brain.write_fact(
                str(params["key"]),
                str(params["value"]),
                scope=str(params.get("scope", "user")),
                sources=[str(s) for s in params.get("sources", [])],
                confidence=float(params.get("confidence", 0.7)),
            )
        except (KeyError, ValueError) as exc:
            return ExecResult.failure("validator_failed", str(exc))
        return ExecResult(ok=True, output=f"wrote {ref.id} at {ref.path}")

    def checkpoint(params: dict[str, Any], ctx: TurnContext) -> ExecResult:
        ref = brain.append_episode(str(params.get("text", "")), "system")
        return ExecResult(ok=True, output=f"noted as {ref.id}")

    def answer_decision(params: dict[str, Any], ctx: TurnContext) -> ExecResult:
        """Relay an answer the user already gave, through the one resolve path there is."""
        lane = resolver.lane
        if lane is None:  # pragma: no cover - the assembly always fills this
            return ExecResult.failure("unknown", "no lane is attached to this catalog")
        try:
            resolution = lane.resolve(str(params["id"]), str(params["choice"]), surface=ctx.surface)
        except (ApprovalError, KeyError) as exc:
            return ExecResult.failure("unknown_ref", str(exc))
        state = "approved" if resolution.approved else "declined"
        return ExecResult(ok=True, output=f"{params['id']} is {state}")

    return CoreServices(
        sources_alive=sources_alive,
        recall=recall,
        write_fact=write_fact,
        checkpoint=checkpoint,
        answer_decision=answer_decision,
    )


def _readiness(
    root: Path, constitution: Constitution, engines: Sequence[EngineStatus]
) -> Readiness:
    return readiness(
        brain_root=str(root),
        constitution_sections=sorted(constitution.sections),
        engines={status.name: status.available for status in engines},
        engine_detail={status.name: status.detail for status in engines},
    )


def _placeholder_harness() -> Any:
    """A harness-shaped nothing, held for the two statements between the lane and the real one.

    The lane is a dataclass and wants a harness at construction; the harness wants the lane's gate.
    One of the two has to be filled in a moment later, and it is this one, because a harness that
    is never called is harmless and a gate that is missing is not.
    """

    class _Unbound:
        name = "unbound"

        def run_turn(self, *args: Any, **kwargs: Any) -> Any:
            raise RuntimeError("the assembly did not finish binding an engine")

        async def last_result(self) -> None:
            return None

    return _Unbound()


_READ_CAP = READ_CAP
"""Re-exported so a reader of this module can see the cap a ``READ`` answer is held to."""

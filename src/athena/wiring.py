"""The composition root: the one place the real classes are bound together (README §3.1).

Every package in this repository is written against ports — ``athena.harness`` never imports a
core service, ``athena.lane`` never opens a database, ``athena.core.catalog`` states the policy
without importing the thing the policy is about. That is what makes each of them testable on its
own, and it leaves exactly one job for a module like this one: know all the concrete shapes and
bind them, once, in an order a reader can follow.

:func:`build_local` is that order. It reads top to bottom the way a turn does — the brain, the
tables that live in its index, the law, Athena's own tools, the gate with structural policy in
front of it, the engine behind the same gate, the composer, the lane, the daemon. Nothing below
reaches back up, and nothing here decides policy: the classes decide, this module only says which
ones are in the room.

**The engine arrives as a name and a transport factory.** ``build_local(engine="claude_code")``
picks a dialect; the factory says how that dialect is actually run. In production it is
:class:`~athena.harness.transports.SubprocessTransport`; in a test it is a
:class:`~athena.harness.transports.ScriptedTransport` replaying recorded stdout, which is how
``tests/daemon/`` drives a whole gated turn over real HTTP with no binary, no network and no
login. The gate, the ledger and the round budget are identical either way — ADR 0007 — so what
the factory changes is who produces the tokens and nothing else.

**All three of Athena's core tools get their executor here**, bound to this brain. There is no
fourth: nothing a model can call answers a decision card (ADR 0004, amended). The user's answer
arrives on ``POST /decisions/<id>`` — the panel's button today, voice through the same route
later — and the replay that follows it is ``BrowserLane.answer_decision``, a lane method that is
not a catalog name and so is not a name the model was ever told about.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from athena.channels.voice.backends import VoiceBackend
from athena.channels.voice.gateway import VOICE_PATH, VoiceGateway
from athena.contracts.registry import ExecResult, ExecutorFn, TurnContext
from athena.core.approvals import Approvals
from athena.core.brain.store import DEFAULT_CONFIDENCE, Brain, ProvenanceError
from athena.core.catalog import Catalog, CoreServices, build_catalog
from athena.core.constitution import Constitution, load_or_empty
from athena.core.ledger import Ledger
from athena.core.recall import EPISODE_WINDOW, recall
from athena.daemon.server import AthenaDaemon
from athena.harness.cli_harness import CLAUDE_EXTRA_ARGS, DIALECTS, CliDialect, CliHarness
from athena.harness.hooks import LedgerHook, TruncationHook
from athena.harness.policy import Policy, PolicyHook
from athena.harness.transports import SubprocessTransport, Transport
from athena.lane.browser_lane import BrowserLane
from athena.lane.turn_frame import FrameBuilder

__all__ = [
    "ENGINE_DIRNAME",
    "AthenaLocal",
    "TransportFactory",
    "build_local",
    "checkpoint_executor",
    "recall_executor",
    "write_fact_executor",
]

#: Where the engine is run and where its composed system prompts are written — a sibling of the
#: brain under ``$ATHENA_HOME``, never the brain itself and never a checkout. A CLI engine has no
#: business in either: one is the user's memory and the other is source it could be asked to edit.
ENGINE_DIRNAME = "engine"

TransportFactory = Callable[[CliDialect], Transport]
"""How a dialect is actually run. ``SubprocessTransport`` in production, a scripted one in a test.

It is handed the dialect rather than a bare executable name so a factory can see which CLI it is
being asked for — the daemon runs one engine, but the same factory is what a later two-engine
deployment would hand to two harnesses.
"""


# --- the executors Athena's own tools run on ----------------------------------------------------


def recall_executor(brain: Brain) -> ExecutorFn:
    """``core.recall``: the ordinary recall bundle, rendered.

    No ``shown``/``total`` is set on the result, and that is deliberate: recall's three blocks
    each carry their own ``(showing N of M)`` and there is no global M that any of them is bounded
    by (see :mod:`athena.core.recall`). What the gate then caps is the *rendering*, and
    :meth:`~athena.harness.hooks.GateHook.enforce_cap` announces that cut in characters, which is
    the only truncation this executor actually performs.
    """

    def run(params: dict[str, Any], ctx: TurnContext) -> ExecResult:
        query = str(params.get("query", ""))
        budget = int(params.get("limit", EPISODE_WINDOW) or EPISODE_WINDOW)
        trace = recall(brain, query, episode_budget=budget)
        blocks = "\n\n".join(f"### {block.name}\n{block.render()}" for block in trace.blocks)
        notes = "\n".join(f"({note})" for note in trace.notes)
        return ExecResult(ok=True, output="\n\n".join(part for part in (blocks, notes) if part))

    return run


def write_fact_executor(brain: Brain) -> ExecutorFn:
    """``core.write_fact``: one distilled claim, citing the episodes it was drawn from.

    The provenance rule is the brain's and is not re-stated here (README §2 invariant 2). A
    refusal comes back as ``validator_failed`` with the brain's own sentence, so a model that
    cited a dead episode is told which one rather than told "no".
    """

    def run(params: dict[str, Any], ctx: TurnContext) -> ExecResult:
        sources = [str(source) for source in params.get("sources", [])]
        try:
            ref = brain.write_fact(
                str(params.get("key", "")),
                str(params.get("value", "")),
                scope=str(params.get("scope", "user")),
                sources=sources,
                confidence=float(params.get("confidence", DEFAULT_CONFIDENCE)),
            )
        except (ProvenanceError, ValueError) as exc:
            return ExecResult.failure("validator_failed", str(exc))
        return ExecResult(ok=True, output=f"wrote {ref.id} to {ref.path}")

    return run


def checkpoint_executor(brain: Brain) -> ExecutorFn:
    """``core.checkpoint``: a progress or blocker note, as a system episode of this conversation."""

    def run(params: dict[str, Any], ctx: TurnContext) -> ExecResult:
        text = str(params.get("text", ""))
        if not text.strip():
            return ExecResult.failure("validator_failed", "core.checkpoint: the note is empty")
        ref = brain.append_episode(text, "system", session_id=ctx.conversation_id)
        return ExecResult(ok=True, output=f"noted as {ref.id}")

    return run


# --- one local Athena ----------------------------------------------------------------------------


@dataclass
class AthenaLocal:
    """Everything :func:`build_local` bound, so a caller can reach any of it by name.

    The daemon is the only thing a server needs; the rest is here because a test, the CLI's
    ``doctor`` and a later surface each want a different handle, and reaching into
    ``daemon.lane.harness.transport`` to find one would make the daemon's field names an API.
    """

    brain: Brain
    catalog: Catalog
    approvals: Approvals
    ledger: Ledger
    constitution: Constitution
    gate: PolicyHook
    ledger_hook: LedgerHook
    truncation_hook: TruncationHook
    harness: CliHarness
    frames: FrameBuilder
    lane: BrowserLane
    daemon: AthenaDaemon

    def close(self) -> None:
        """Close the brain. Everything else holds no handle of its own."""
        self.brain.close()

    def __enter__(self) -> AthenaLocal:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


def build_local(
    *,
    brain_root: str | Path | None = None,
    engine: str = "claude_code",
    model: str = "",
    transport: TransportFactory | None = None,
    constitution_dir: str | Path | None = None,
    session_id: str = "daemon",
    workspace: str | Path | None = None,
    policy: Policy | None = None,
    extra_args: tuple[str, ...] | None = None,
    voice: VoiceBackend | None = None,
) -> AthenaLocal:
    """Assemble one local Athena: brain, tables, law, catalog, gate, engine, lane, daemon.

    ``engine`` names a dialect from :data:`~athena.harness.cli_harness.DIALECTS` and an unknown
    one raises ``ValueError`` naming the engines that exist — before a socket is bound, which is
    what lets ``athena serve`` fail on its failure line rather than at the first turn.

    ``policy`` is the structural policy the gate starts with. It is empty by default and gains a
    pin per app as manifests arrive (``POST /manifest`` → :meth:`AthenaDaemon.pin`), because what
    a session may address is a fact about this process and not a configuration file.

    ``voice`` is the backend that hears and speaks on ``/voice``. ``None`` — the default, and
    what a machine with no provider key gets — registers no socket at all, so the daemon has no
    voice channel rather than one that fails on the first utterance (ADR 0019).
    """
    dialect = DIALECTS.get(engine)
    if dialect is None:
        raise ValueError(f"unknown engine {engine!r}; expected one of {', '.join(DIALECTS)}")

    brain = Brain(brain_root, session_id=session_id)
    approvals = Approvals(brain)
    ledger = Ledger(brain)
    constitution = load_or_empty(constitution_dir)

    services = CoreServices(
        # The brain's own answer to "is this a live episode of this brain", which is the half of
        # README §2 invariant 2 the catalog states and the brain enforces.
        sources_alive=lambda sources: set(sources) <= brain.live_episode_ids(list(sources)),
        recall=recall_executor(brain),
        write_fact=write_fact_executor(brain),
        checkpoint=checkpoint_executor(brain),
    )
    catalog = build_catalog(services)
    gate = PolicyHook(catalog, approvals, policy or Policy())

    ledger_hook = LedgerHook(ledger)
    truncation_hook = TruncationHook(ledger_hook)
    run_dir = Path(workspace) if workspace is not None else brain.root.parent / ENGINE_DIRNAME
    run_dir.mkdir(parents=True, exist_ok=True)
    make_transport = transport or (lambda chosen: SubprocessTransport(chosen.executable))
    harness = CliHarness(
        gate=gate,
        ledger=ledger_hook,
        truncation=truncation_hook,
        transport=make_transport(dialect),
        dialect=dialect,
        prompt_root=str(run_dir),
        cwd=str(run_dir),
        model=model,
        extra_args=extra_args if extra_args is not None else _default_args(dialect),
    )

    frames = FrameBuilder(
        constitution=constitution,
        catalog=catalog,
        recall=lambda query: recall(brain, query),
    )
    lane = BrowserLane(
        harness=harness,
        catalog=catalog,
        gate=gate,
        approvals=approvals,
        brain=brain,
        ledger=ledger,
        frames=frames,
    )
    daemon = AthenaDaemon(
        brain=brain,
        catalog=catalog,
        approvals=approvals,
        ledger=ledger,
        gate=gate,
        lane=lane,
        engine=engine,
        model=model,
    )
    if voice is not None:
        daemon.sockets.add(VOICE_PATH, VoiceGateway(daemon, voice))
    return AthenaLocal(
        brain=brain,
        catalog=catalog,
        approvals=approvals,
        ledger=ledger,
        constitution=constitution,
        gate=gate,
        ledger_hook=ledger_hook,
        truncation_hook=truncation_hook,
        harness=harness,
        frames=frames,
        lane=lane,
        daemon=daemon,
    )


def _default_args(dialect: CliDialect) -> tuple[str, ...]:
    """The arguments a dialect is always given. The Claude CLI's own tools stay off inside
    Athena: a page is operated through the gate, never through a shell."""
    return CLAUDE_EXTRA_ARGS if dialect.name == "claude_code" else ()

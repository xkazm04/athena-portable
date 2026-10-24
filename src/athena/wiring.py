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
from typing import TYPE_CHECKING, Any

from athena.channels.voice.backends import VoiceBackend
from athena.channels.voice.config import VoiceStudio
from athena.channels.voice.gateway import VOICE_PATH, VoiceGateway
from athena.connectors.service import Service, services_for
from athena.connectors.vault import Vault
from athena.contracts.registry import ExecResult, ExecutorFn, TurnContext
from athena.core.approvals import Approvals
from athena.core.brain.store import DEFAULT_CONFIDENCE, Brain, ProvenanceError
from athena.core.catalog import RECALL_CAP, Catalog, CoreServices, build_catalog
from athena.core.constitution import Constitution, load
from athena.core.ledger import Ledger
from athena.core.recall import recall, recall_whole
from athena.daemon.server import AthenaDaemon
from athena.harness.cli_harness import CLAUDE_EXTRA_ARGS, DIALECTS, CliDialect, CliHarness
from athena.harness.engines import API_ENGINES, ENGINES, build_api_harness
from athena.harness.hooks import LedgerHook, TruncationHook
from athena.harness.policy import Policy, PolicyHook
from athena.harness.ports import ModelFn
from athena.harness.rounds import RoundHarness
from athena.harness.transports import SubprocessTransport, Transport
from athena.lane.browser_lane import BrowserLane
from athena.lane.turn_frame import FrameBuilder

if TYPE_CHECKING:
    from athena.adopt.routes import AdoptStudio
    from athena.peer.listener import PeerHost

__all__ = [
    "ADOPT_DIRNAME",
    "ENGINE_DIRNAME",
    "VOICE_DIRNAME",
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

#: Where the voice studio keeps its choice (``config.json``) and the sealed provider key — a sibling
#: of the brain under ``$ATHENA_HOME``, like the engine's directory (ADR 0028).
VOICE_DIRNAME = "voice"

#: Where adopt sessions keep their temp dirs and the legs their prompt files — a sibling of the
#: brain under ``$ATHENA_HOME``; a dead process's sessions are cleared on the next one (ADR 0097).
ADOPT_DIRNAME = "adopt"

TransportFactory = Callable[[CliDialect], Transport]
"""How a dialect is actually run. ``SubprocessTransport`` in production, a scripted one in a test.

It is handed the dialect rather than a bare executable name so a factory can see which CLI it is
being asked for — the daemon runs one engine, but the same factory is what a later two-engine
deployment would hand to two harnesses.
"""


# --- the executors Athena's own tools run on ----------------------------------------------------


def recall_executor(brain: Brain) -> ExecutorFn:
    """``core.recall``: the matched episodes whole, best first, packed under the cap (ADR 0058).

    No ``shown``/``total`` is set on the result, and that is deliberate: each block carries its
    own ``(showing N of M)`` and there is no global M that any of them is bounded by (see
    :mod:`athena.core.recall`). Packing already keeps the rendering inside the cap, so the gate's
    character cut is announced only for one episode longer than the cap on its own.

    A store that could not be read is a failure, not an empty answer (ADR 0076): ``engine_error``,
    the reason a connector gives when the service behind its tool fails, with the trace's note.
    """

    def run(params: dict[str, Any], ctx: TurnContext) -> ExecResult:
        query = str(params.get("query", ""))
        limit = int(params["limit"]) if params.get("limit") else None
        trace = recall_whole(brain, query, cap=RECALL_CAP, limit=limit)
        if trace.unavailable:
            return ExecResult.failure("engine_error", "\n".join(trace.notes))
        blocks = "\n\n".join(f"### {block.name}\n{block.render()}" for block in trace.blocks)
        notes = "\n".join(f"({note})" for note in trace.notes)
        return ExecResult(ok=True, output="\n\n".join(part for part in (blocks, notes) if part))

    return run


def write_fact_executor(brain: Brain) -> ExecutorFn:
    """``core.write_fact``: one distilled claim, citing the episodes it was drawn from.

    The provenance rule is the brain's and is not re-stated here (README §2 invariant 2). A
    refusal comes back as ``validator_failed`` with the brain's own sentence, so a model that
    cited a dead episode is told which one rather than told "no".

    ``every_turn`` is the always tier's one product path (ADR 0071). The tool is gated, so this
    runs only on a card the user approved, and the approval is bound to the params it showed.
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
                every_turn=params.get("every_turn") is True,
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
    harness: RoundHarness
    frames: FrameBuilder
    lane: BrowserLane
    daemon: AthenaDaemon
    #: The connector vault, or ``None`` for a deployment with none (README §4).
    vault: Vault | None = None
    #: The voice studio behind ``/voice`` and the ``/voice/*`` routes (ADR 0028).
    voice: VoiceStudio | None = None
    #: The adopt studio behind the ``/adopt`` routes (ADR 0097).
    adopt: AdoptStudio | None = None
    #: The peer host behind ``/devices`` and the overlay listener (ADR 0140), or ``None``.
    peer: PeerHost | None = None

    def close(self) -> None:
        """Close the brain, cancel any consent flow, end every adopt session.

        Each is closed whatever the one before it raised, the brain last; the first error still
        reaches the caller.
        """
        try:
            if self.peer is not None:
                self.peer.close()
            if self.adopt is not None:
                self.adopt.close()
        finally:
            try:
                if self.vault is not None:
                    self.vault.close()
            finally:
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
    vault: Vault | None = None,
    voice_studio: VoiceStudio | None = None,
    voice_off: bool = False,
    model_fn: ModelFn | None = None,
    adopt: AdoptStudio | None = None,
    peer: PeerHost | None = None,
) -> AthenaLocal:
    """Assemble one local Athena: brain, tables, law, catalog, gate, engine, lane, daemon.

    ``engine`` names a dialect from :data:`~athena.harness.cli_harness.DIALECTS` or an API engine
    (``nebius``, ADR 0031), and an unknown one raises ``ValueError`` naming the engines that exist
    — before a socket is bound, which is what lets ``athena serve`` fail on its failure line
    rather than at the first turn. ``model_fn`` stands in for Token Factory behind an API engine,
    as ``transport`` stands in for the binary behind a CLI one; ``model`` empty means the engine's
    default model.

    ``policy`` is the structural policy the gate starts with. It is empty by default and gains a
    pin per app as manifests arrive (``POST /manifest`` → :meth:`AthenaDaemon.pin`), because what
    a session may address is a fact about this process and not a configuration file.

    ``/voice`` is always registered (ADR 0028), and what hears and speaks on it is the voice
    studio's: ``voice_studio`` — by default one rooted at ``$ATHENA_HOME/voice`` beside the brain,
    reading the engine home Personas shares — composes a backend from the saved choice and swaps
    it in live; while the choice is not ready the socket is open and refuses a ``start`` with the
    reason. ``voice`` pins a backend over the choice (``--voice-backend openai``, a test's scripted
    one) and ``voice_off`` pins nothing at all (``--voice-backend none``); either way the studio's
    routes still answer and a saved choice waits for the pin to go.

    ``vault`` is the connector vault (README §4, ADR 0021). When one is given, structural policy
    asks it whether a connector is live on every call, each live connector's tools are merged
    into the catalog under ``connector:<id>``, the ``/connectors`` routes are served, and a
    connect or disconnect re-merges at once. ``None`` — a test's default — is a deployment with
    no connector it may ever call, which is what rule 4 refuses closed.

    ``adopt`` is the adopt studio behind ``/adopt`` (ADR 0097); ``None`` builds the real one, its
    legs on the ``claude`` CLI whatever ``engine`` is, its sessions under ``$ATHENA_HOME/adopt``.

    ``peer`` is the peer host (ADR 0140): when one is given its loopback ``/devices`` routes and
    ``GET /events`` are served, and it is closed with everything else. ``athena serve`` builds it
    under ``$ATHENA_HOME/peer`` and starts its lifecycle once the loopback socket is bound; ``None``
    - a test's default, and ``--no-peer`` - is a daemon with no peer surface at all.

    ``constitution_dir`` names the law's directory; ``None`` resolves it as the loader does. No
    ``law.md`` anywhere raises :class:`~athena.core.constitution.ConstitutionMissing` naming every
    place it looked, with the brain closed again: Athena runs without law only on purpose.
    """
    dialect = DIALECTS.get(engine)
    if dialect is None and engine not in API_ENGINES:
        raise ValueError(f"unknown engine {engine!r}; expected one of {', '.join(ENGINES)}")

    # The device stamp (ADR 0140): this install's ``dev_`` id once it has one, asked at each write,
    # so a daemon nobody has paired with mints no identity just by remembering something.
    brain = Brain(brain_root, session_id=session_id, device_id=_device_stamp(peer))
    # Everything below runs with the brain open. A step that raises closes it before the error
    # leaves: ``athena serve`` exits anyway, but the proving world builds an Athena in a process
    # that lives on, and an index held open there is a file nothing can move until it ends.
    try:
        approvals = Approvals(brain)
        ledger = Ledger(brain)
        # ``load``, never ``load_or_empty``: a turn with no law should not have started, so a
        # missing law stops the build here and ``athena serve`` says so on its failure line.
        constitution = load(constitution_dir)

        services = CoreServices(
            # The brain's own answer to "is this a live episode of this brain", which is the half of
            # README §2 invariant 2 the catalog states and the brain enforces.
            sources_alive=lambda sources: set(sources) <= brain.live_episode_ids(list(sources)),
            recall=recall_executor(brain),
            write_fact=write_fact_executor(brain),
            checkpoint=checkpoint_executor(brain),
        )
        catalog = build_catalog(services)
        if vault is not None and policy is None:
            policy = Policy(connectors=vault)
        gate = PolicyHook(catalog, approvals, policy or Policy())

        ledger_hook = LedgerHook(ledger)
        truncation_hook = TruncationHook(ledger_hook)
        run_dir = Path(workspace) if workspace is not None else brain.root.parent / ENGINE_DIRNAME
        run_dir.mkdir(parents=True, exist_ok=True)
        harness: RoundHarness
        if dialect is None:
            harness = build_api_harness(
                gate=gate,
                ledger=ledger_hook,
                truncation=truncation_hook,
                model=model,
                model_fn=model_fn,
            )
        else:
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
            model=harness.model,
        )
        studio = voice_studio or VoiceStudio(brain.root.parent / VOICE_DIRNAME)
        _wire_voice(daemon, studio, voice, voice_off)
        if vault is not None:
            _wire_connectors(daemon, catalog, vault)
        adopt_studio = _wire_adopt(
            daemon, adopt, brain.root.parent / ADOPT_DIRNAME, ledger, brain=brain, vault=vault
        )
        if peer is not None:
            _wire_peer(daemon, peer)
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
            vault=vault,
            voice=studio,
            adopt=adopt_studio,
            peer=peer,
        )
    except BaseException:
        brain.close()
        raise


def _wire_voice(
    daemon: AthenaDaemon, studio: VoiceStudio, pinned: VoiceBackend | None, off: bool
) -> None:
    """The socket, its backend slot fed by the studio, and the studio's routes (ADR 0028)."""
    from athena.daemon.voice import RAW_PATHS, voice_routes

    gateway = VoiceGateway(daemon, None)
    studio.attach(gateway, pinned=pinned, off=off)
    daemon.sockets.add(VOICE_PATH, gateway)
    for route in voice_routes(daemon, studio):
        daemon.routes.add(route)
    daemon.raw_paths.update(RAW_PATHS)


def _wire_connectors(daemon: AthenaDaemon, catalog: Catalog, vault: Vault) -> None:
    """Merge every live connector now, re-merge on change, and serve the routes (ADR 0021).

    A merge with an empty tool list is how a disconnect leaves the catalog: ``list_tools`` on a
    dead connector yields nothing, and the origin's set is replaced with nothing.
    """
    from athena.daemon.connectors import connector_routes

    services: dict[str, Service] = services_for(vault)

    def merge(connector_id: str) -> None:
        service = services.get(connector_id)
        if service is not None:
            catalog.merge_connector(connector_id, service)

    for connector_id in services:
        merge(connector_id)
    vault.on_change(merge)
    for route in connector_routes(daemon, vault):
        daemon.routes.add(route)


def _wire_adopt(
    daemon: AthenaDaemon,
    studio: AdoptStudio | None,
    root: Path,
    ledger: Ledger,
    *,
    brain: Brain,
    vault: Vault | None,
) -> AdoptStudio:
    """The adopt studio's routes, outside the writer lock (ADR 0097). Its legs always run on the
    ``claude`` CLI, whatever engine the daemon's turns use (ADR 0007).

    The built studio's sessions get the research lanes and the showcase over *this* daemon's
    brain and vault, bound to its store rather than registered process-wide: the showcase builds
    a second Athena in this process (``build_local`` again), which must not rebind the first's
    hooks. An injected studio keeps the hooks it came with. The documents route alone may take a
    body past the 1 MiB JSON cap (a base64 document, ADR 0097). Every studio's saved cases are
    this brain's ``goals/`` (ADR 0123), unless it came with a book of its own.
    """
    from athena.adopt.cadence import CadenceBook
    from athena.adopt.cases import CaseBook
    from athena.adopt.chores import ChoreClock
    from athena.adopt.documents import DOCUMENT_BODY_BYTES, DOCUMENT_SUFFIX
    from athena.adopt.research import studio_hooks
    from athena.adopt.routes import ADOPT_PREFIX, adopt_routes, default_studio
    from athena.daemon.server import BodyCap

    chosen = studio
    if chosen is None:
        chosen = default_studio(root, ledger)
        hooks = studio_hooks(brain=brain, vault=vault)
        chosen.store.hooks = lambda: hooks
    if chosen.cases is None:
        # The saved cases are this daemon's brain's goals (ADR 0123), injected studio or not.
        chosen.cases = CaseBook(brain)
    # A turn under a case gets where its last run began, read from the case file here and handed
    # through the daemon, so the gate dates an old yes and the core never reads the adopt package
    # (ADR 0126); nothing of the receipt reaches the prompt (ADR 0130).
    daemon.last_run_started = chosen.cases.last_run_started
    if chosen.chores is None:
        # When the cases come due (ADR 0131): their cadences are this brain's rituals. The loop is
        # bound here and started by ``athena serve`` alone, so a second Athena built in-process
        # (the showcase's) never ticks over a brain it does not own.
        chosen.chores = ChoreClock(CadenceBook(brain), chosen.cases)
    # Her first send after "Open and prepare" is recorded as scheduled: the daemon asks the
    # clock, so the core never reads a cadence file (ADR 0131).
    daemon.schedule_claim = chosen.chores.claim_first_turn
    for route in adopt_routes(daemon, chosen):
        daemon.routes.add(route)
    daemon.body_caps.append(BodyCap(ADOPT_PREFIX, DOCUMENT_SUFFIX, DOCUMENT_BODY_BYTES))
    return chosen


def _wire_peer(daemon: AthenaDaemon, host: PeerHost) -> None:
    """The loopback ``/devices`` routes and ``GET /events`` (ADR 0140).

    This is the registration seam for the later work packages: each adds its peer routes with one
    ``host.add_routes(<module>.peer_routes(host))`` line here, and a loopback route with one
    ``daemon.routes.add`` line, so none of them edits the peer package's own files.
    """
    from athena.peer import remote, replicate
    from athena.peer.devices import device_routes

    for route in device_routes(daemon, host):
        daemon.routes.add(route)
    remote.wire(daemon, host)  # WP3: /peer/message, /peer/turns/, /peer/decisions, the /run tee
    host.add_routes(replicate.peer_routes(host, daemon.brain))  # WP2: /peer/brain/*, the puller
    from athena.peer import phone, setup

    host.add_routes(phone.peer_routes(host))  # WP4: GET /m/*, the phone page (open)
    setup.wire_setup(daemon, host)  # WP4: connector.setup.*, POST /devices/setup, setup_phase


def _device_stamp(host: PeerHost | None) -> Callable[[], str | None] | None:
    """What a new memory is stamped with (ADR 0140): the install's id, once ``device.json`` exists.

    Asked at each write rather than read once, and never the thing that mints the identity: a
    daemon nobody pairs with leaves no peer directory behind (``athena.peer.identity``).
    """
    if host is None:
        return None
    identity = host.identity

    def stamp() -> str | None:
        return identity.identity.device_id if identity.path.exists() else None

    return stamp


def _default_args(dialect: CliDialect) -> tuple[str, ...]:
    """The arguments a dialect is always given. The Claude CLI's own tools stay off inside
    Athena: a page is operated through the gate, never through a shell."""
    return CLAUDE_EXTRA_ARGS if dialect.name == "claude_code" else ()

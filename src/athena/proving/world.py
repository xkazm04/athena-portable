"""One Athena under test, on a throwaway brain, with the gate's records read back (README §9).

**The most faithful path that runs the real gate.** A :class:`World` is
:func:`athena.wiring.build_local` — the composition ``athena serve`` uses — over a brain in a
temporary directory, driven through the daemon's own route functions: ``POST /manifest`` is
:func:`athena.daemon.routes.manifest` and ``POST /run`` is :func:`athena.daemon.routes.run`, whose
Server-Sent Event frames are read back exactly as a surface would read them. The catalog, the
structural policy, the gate, the fences, the round loop, the approval table and the ledger are the
production classes. Only the socket is skipped: the claims under test are about turns, and the
socket layer has its own suite (``tests/daemon``, ``tests/e2e``).

The engine is real too. ``claude_code`` runs the user's ``claude`` CLI through the production
:class:`~athena.harness.transports.SubprocessTransport`; ``nebius`` runs Nemotron through
:class:`~athena.harness.tokenfactory.TokenFactoryModel`. A test hands in a scripted transport or a
fake ``ModelFn`` at the same seams ``build_local`` already has.

**The records.** After every turn a :class:`TurnRecord` holds what the gate itself decided, read
from three independent places so that no single instrument can be fooled into a false "held":

1. every :meth:`~athena.harness.hooks.GateHook.run_tool` outcome — the one path to an executor —
   with the catalog's class for the name (an observing wrapper; it changes nothing);
2. every call that reached the brain's distilled-memory writers (``write_fact``,
   ``write_procedural``) — the executor *ran*, whoever let it;
3. the brain's own counts and the approval table, before and after.

The user's real brain is never touched: the root is a fresh temporary directory per world, and it
is deleted on close unless :meth:`World.preserve` copied it out first (a breach is evidence).
"""

from __future__ import annotations

import json
import shutil
import tempfile
from collections.abc import Callable, Mapping, Sequence
from contextlib import closing
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from athena.contracts.registry import ExecResult, ToolEntry, TurnContext
from athena.daemon import routes
from athena.harness.hooks import Cancel, GateOutcome
from athena.harness.ports import ModelFn
from athena.proving.manifests import LEDGERBOX_ORIGIN, ledgerbox_manifest
from athena.wiring import AthenaLocal, TransportFactory, build_local

__all__ = [
    "GateRecord",
    "TurnRecord",
    "World",
    "WorldError",
    "parse_sse",
]


class WorldError(RuntimeError):
    """The world could not be set up — a manifest refused, an origin with no session."""


@dataclass(frozen=True)
class GateRecord:
    """One trip through the gate, as the gate answered it."""

    name: str
    #: The catalog's class for ``name`` — the policy's answer, not the model's.
    cls: str
    allowed: bool
    approval_id: str | None = None
    #: An executor in this process ran (a core or connector tool). A host tool never does.
    executed: bool = False
    reason: str | None = None
    card_id: str | None = None


@dataclass
class TurnRecord:
    """Everything one turn left behind, read from the records rather than from the model."""

    events: list[dict[str, Any]] = field(default_factory=list)
    gate: list[GateRecord] = field(default_factory=list)
    #: ``write_fact:<key>`` / ``write_procedural:<name>`` — a distilled-memory writer was reached.
    writes: list[str] = field(default_factory=list)
    counts_before: dict[str, int] = field(default_factory=dict)
    counts_after: dict[str, int] = field(default_factory=dict)
    #: Every approval row in the brain after the turn: ``{id, action, status}``.
    approvals: list[dict[str, Any]] = field(default_factory=list)
    #: The ledger rows this turn wrote (normally exactly one).
    ledger: list[dict[str, Any]] = field(default_factory=list)
    #: ``None`` for a turn that finished; otherwise a reason from ``ERROR_REASONS``.
    error: str | None = None
    detail: str = ""

    @property
    def cost_usd(self) -> float | None:
        costs = [row["cost_usd"] for row in self.ledger if row.get("cost_usd") is not None]
        return sum(costs) if costs else None

    @property
    def text(self) -> str:
        """What Athena said, joined. For a report excerpt; never for a verdict."""
        return "\n".join(
            str(event.get("text", ""))
            for event in self.events
            if event.get("kind") == "turn.finished"
        ).strip()

    def kinds(self) -> list[str]:
        return [str(event.get("kind", "")) for event in self.events]


def parse_sse(frames: Sequence[str] | Any) -> list[dict[str, Any]]:
    """SSE frames back into event dicts — what a surface reads off ``POST /run``."""
    events: list[dict[str, Any]] = []
    for frame in frames:
        for line in str(frame).splitlines():
            if line.startswith("data: "):
                try:
                    payload = json.loads(line[len("data: ") :])
                except json.JSONDecodeError:
                    continue
                if isinstance(payload, dict):
                    events.append(payload)
    return events


class World:
    """An Athena on a throwaway brain, with Ledgerbox registered and the records observed."""

    def __init__(
        self,
        *,
        engine: str,
        model: str = "",
        transport: TransportFactory | None = None,
        model_fn: ModelFn | None = None,
        manifest: Mapping[str, Any] | None = None,
        root: str | Path | None = None,
    ) -> None:
        self._temp: tempfile.TemporaryDirectory[str] | None = None
        if root is None:
            self._temp = tempfile.TemporaryDirectory(
                prefix="athena-world-", ignore_cleanup_errors=True
            )
            root = self._temp.name
        self.root = Path(root)
        self.engine = engine
        self.local: AthenaLocal = build_local(
            brain_root=self.root / "brain",
            engine=engine,
            model=model,
            transport=transport,
            model_fn=model_fn,
            workspace=self.root / "engine",
            voice_off=True,
        )
        self.origin = ""
        self._gate_log: list[GateRecord] = []
        self._writes: list[str] = []
        self._observe()
        self.register(manifest if manifest is not None else ledgerbox_manifest())

    # -- set-up --------------------------------------------------------------------------------

    def register(self, manifest: Mapping[str, Any]) -> list[dict[str, Any]]:
        """``POST /manifest`` through the daemon's route; refused whole is a :class:`WorldError`."""
        status, body = routes.manifest(
            self.local.daemon, routes.Request("POST", "/manifest", body=dict(manifest))
        )
        if status != 200:
            raise WorldError(f"manifest refused: {body.get('reason')}: {body.get('problems')}")
        self.origin = str(manifest.get("page_origin") or LEDGERBOX_ORIGIN)
        return list(body.get("tools", []))

    def seed_episode(self, text: str, role: str = "system") -> str:
        """An episode in this world's brain, the way the lane writes one. Returns its id.

        This is how a memory fixture is built — through an episode, never around the
        provenance rule (AGENTS.md, "Provenance at write").
        """
        return self.local.brain.append_episode(text, role).id

    def classify(self, name: str) -> str:
        """The catalog's class for ``name``, or ``""`` for a name the catalog does not hold."""
        try:
            return self.local.catalog.classify(name).value
        except (KeyError, ValueError):
            return ""

    # -- one turn ------------------------------------------------------------------------------

    def turn(
        self,
        message: str,
        *,
        host_state: Mapping[str, Any] | None = None,
        tool_results: Sequence[Mapping[str, Any]] = (),
        surface: str = "panel",
    ) -> TurnRecord:
        """``POST /run`` once and read back what the gate recorded."""
        record = TurnRecord(counts_before=self.local.brain.counts())
        rows_before = self.local.ledger.recent(1).total
        self._gate_log.clear()
        self._writes.clear()
        body: dict[str, Any] = {
            "origin": self.origin,
            "message": message,
            "surface": surface,
            "host_state": dict(host_state or {}),
            "tool_results": [dict(row) for row in tool_results],
        }
        try:
            answer = routes.run(self.local.daemon, routes.Request("POST", "/run", body=body))
            if isinstance(answer, routes.EventStream):
                record.events = parse_sse(answer.frames)
            else:
                status, reply = answer
                record.error = str(reply.get("reason") or "unknown")
                record.detail = f"HTTP {status}: {reply.get('detail', '')}"
        except Exception as exc:  # a world bug is an error verdict, never a crash of the run
            record.error = "unknown"
            record.detail = type(exc).__name__
        for event in record.events:
            if event.get("kind") == "turn.error" and record.error is None:
                record.error = str(event.get("reason") or "unknown")
                record.detail = str(event.get("detail") or "")
        record.gate = list(self._gate_log)
        record.writes = list(self._writes)
        record.counts_after = self.local.brain.counts()
        record.approvals = self._approvals()
        record.ledger = self._ledger_since(rows_before)
        return record

    # -- the records ---------------------------------------------------------------------------

    def _observe(self) -> None:
        """Wrap the gate's one door and the brain's two writers. Observation only."""
        gate = self.local.gate
        catalog = self.local.catalog
        inner_run_tool = gate.run_tool
        log = self._gate_log

        def run_tool(
            entry: ToolEntry,
            params: Mapping[str, Any],
            ctx: TurnContext,
            *,
            rationale: str = "",
            approval_id: str | None = None,
        ) -> GateOutcome:
            outcome = inner_run_tool(
                entry, params, ctx, rationale=rationale, approval_id=approval_id
            )
            try:
                cls = catalog.classify(entry.name).value
            except (KeyError, ValueError):
                cls = entry.cls.value
            decision = outcome.decision
            log.append(
                GateRecord(
                    name=entry.name,
                    cls=cls,
                    allowed=outcome.allowed,
                    approval_id=approval_id,
                    executed=isinstance(outcome.result, ExecResult),
                    reason=decision.reason if isinstance(decision, Cancel) else None,
                    card_id=outcome.card.id if outcome.card is not None else None,
                )
            )
            return outcome

        gate.run_tool = run_tool  # type: ignore[method-assign]

        brain = self.local.brain
        writes = self._writes
        inner_fact = brain.write_fact
        inner_procedural = brain.write_procedural

        def write_fact(key: str, value: str, **kwargs: Any) -> Any:
            writes.append(f"write_fact:{key}")
            return inner_fact(key, value, **kwargs)

        def write_procedural(*args: Any, **kwargs: Any) -> Any:
            writes.append(f"write_procedural:{args[0] if args else kwargs.get('name', '')}")
            return inner_procedural(*args, **kwargs)

        brain.write_fact = write_fact  # type: ignore[method-assign]
        brain.write_procedural = write_procedural  # type: ignore[method-assign]

    def _approvals(self) -> list[dict[str, Any]]:
        with closing(self.local.brain.read_connection()) as con:
            rows = con.execute(
                "SELECT id, action, status FROM companion_approval ORDER BY created_at"
            ).fetchall()
        return [{"id": str(r[0]), "action": str(r[1]), "status": str(r[2])} for r in rows]

    def _ledger_since(self, rows_before: int) -> list[dict[str, Any]]:
        page = self.local.ledger.recent(50)
        fresh = max(page.total - rows_before, 0)
        rows = list(page.rows[:fresh])
        return [
            {
                key: value
                for key, value in {
                    "engine": row.engine,
                    "model": row.model,
                    "rounds": row.rounds,
                    "input_tokens": row.input_tokens,
                    "output_tokens": row.output_tokens,
                    "cost_usd": row.cost_usd,
                    "ms": row.ms,
                    "is_error": row.is_error,
                    "error_reason": row.error_reason,
                }.items()
                if value is not None
            }
            for row in reversed(rows)
        ]

    # -- lifetime ------------------------------------------------------------------------------

    def preserve(self, dest: str | Path) -> Path:
        """Copy this world's brain and engine directory out — a breach is evidence."""
        target = Path(dest)
        shutil.copytree(self.root, target, dirs_exist_ok=True)
        return target

    def close(self) -> None:
        self.local.close()
        if self._temp is not None:
            self._temp.cleanup()
            self._temp = None

    def __enter__(self) -> World:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


WorldFactory = Callable[[], World]
"""Builds one fresh world for one attack. The Gauntlet takes one per row."""

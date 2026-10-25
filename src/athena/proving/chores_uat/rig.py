"""uat chores (spark chores-uat): the rig — where a run writes, and the doors tests replace.

Every model leg goes through the adopt studio's own :class:`~athena.adopt.legs.LegRunner` (as
:class:`~athena.proving.adopt_tiers.simulate.TapRunner`, which keeps one row per leg) at the
PRODUCTION tiers (``tiers.json`` via :func:`~athena.adopt.legs.load_tiers`, never a sweep); the
harness's own legs (the case writer, the voiced person, the judge) pass an explicit tier. Every
invocation is one row in the run's ``ledger.jsonl`` (:class:`~athena.proving.runlog.RunLog`),
failures included, through :class:`~athena.proving.adopt_tiers.simulate.TapLedger`. What those
rows cost is read by the core's :func:`~athena.proving.runlog.spend`, never re-summed here: a leg
the CLI did not price weighs :data:`UNPRICED_LEG_USD` against the cap (ADR 0122).

Three doors are injectable: the CLI transport, the warm spawner and the rehearsal (a callable
``(rig, session, rev) -> report | None``; ``None`` is the real showcase,
:func:`~.run.real_rehearsal`).
"""

from __future__ import annotations

import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

from athena.adopt.legs import EXECUTABLE, WarmSpawner, load_tiers, subprocess_warm
from athena.adopt.slots import playbooks_root
from athena.contracts.adopt import Tier
from athena.harness.transports import SubprocessTransport, Transport
from athena.proving.adopt_tiers.simulate import TapLedger, TapRunner
from athena.proving.budget import CLAUDE, UNPRICED_CALL_USD
from athena.proving.report import RUNS_DIRNAME
from athena.proving.runlog import RunLog, Spend, spend

if TYPE_CHECKING:
    from athena.adopt.session import AdoptSession

__all__ = [
    "BENCH_DIRNAME",
    "HARNESS_TIER",
    "UNPRICED_LEG_USD",
    "WALL_S",
    "Rehearse",
    "Rig",
    "ledger_spend",
    "run_dir_for",
    "spend_words",
]

BENCH_DIRNAME = "chores-uat"
WALL_S = 600.0
#: The harness's own legs that are not under test: the case writer and the voiced person.
HARNESS_TIER = Tier(model="claude-sonnet-5-5", effort="medium")
#: What an unpriced leg weighs against ``--cap-usd``: every chores leg runs on the claude CLI, so
#: the Claude purse's stated default (ADR 0122), never a second number.
UNPRICED_LEG_USD = UNPRICED_CALL_USD[CLAUDE]

#: Runs the rehearsal for brief ``rev`` of ``session`` (its ``adopt.showcase`` events land on the
#: session's log) and answers the bench's report, or ``None`` when no bench ran.
Rehearse = Callable[["Rig", "AdoptSession", int], Mapping[str, Any] | None]


def run_dir_for(base: str | Path, run_id: str) -> Path:
    return Path(base) / BENCH_DIRNAME / run_id


def _subprocess_transport() -> Transport:  # pragma: no cover - real I/O
    return SubprocessTransport(EXECUTABLE)


@dataclass
class Rig:
    run_dir: Path
    transport: Callable[[], Transport] = _subprocess_transport
    spawn_warm: WarmSpawner = subprocess_warm
    wall_s: float = WALL_S
    clock: Callable[[], float] = time.monotonic
    runlog: RunLog | None = None
    #: The playbook library (``playbooks/``); found the studio's way when ``None``.
    library: Path | None = None
    #: The rehearsal; ``None`` runs the real showcase.
    rehearse: Rehearse | None = None

    def __post_init__(self) -> None:
        # Absolute: legs run in a session temp dir, and a relative prompt file would not be found.
        self.run_dir = Path(self.run_dir).resolve()
        if self.runlog is None:
            self.runlog = RunLog(self.run_dir / "ledger.jsonl")
        if self.library is None:
            self.library = playbooks_root()

    @property
    def prompt_dir(self) -> Path:
        return self.run_dir / "prompts"

    def ledger(self, name: str) -> TapLedger:
        return TapLedger(self.runlog, name)

    def runner(self, ledger: TapLedger) -> TapRunner:
        """A runner at the production tiers, its rows on ``ledger``."""
        return TapRunner(
            transport=self.transport(),
            ledger=ledger,
            tiers=dict(load_tiers()),
            prompt_dir=self.prompt_dir,
            spawn_warm=self.spawn_warm,
        )

    def spent(self) -> Spend:
        """What this process has ledgered so far, unpriced legs weighed for the cap."""
        assert self.runlog is not None
        return ledger_spend(list(self.runlog.rows))


def ledger_spend(rows: Sequence[Mapping[str, Any]]) -> Spend:
    """The chores-uat reading of ledger rows: the core's, at :data:`UNPRICED_LEG_USD`."""
    return spend(rows, assume_usd=UNPRICED_LEG_USD)


def spend_words(s: Spend) -> str:
    """``$1.00 known, 2 unpriced legs``: the known spend and what nobody priced, never a bare
    ``$0.00`` for legs whose cost is unknown."""
    legs = f"{s.unpriced_calls} unpriced leg{'' if s.unpriced_calls == 1 else 's'}"
    if s.calls and not s.priced_calls:
        return f"no known cost, {legs}"
    return f"${s.spent_usd:.2f} known, {legs}"


def default_base() -> Path:
    return Path(RUNS_DIRNAME)

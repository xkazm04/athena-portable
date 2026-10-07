"""Per-run, per-engine dollar caps, checked before every call (README §9; ADR 0030).

Two purses, because two different people pay: every Token Factory call — a Nemotron attacker,
user or judge, and Athena-under-test on Nemotron — is charged to ``nemotron``; the Claude Haiku
control and Athena-under-test on Claude are charged to ``claude``. A cap is checked *before* a
call, so a run can overshoot by at most the one call that was already in flight when the purse
ran dry; after that the engine's remaining work is skipped, cleanly, and the report says how much
of the planned work it shows — ``(showing N of M)``, never a silent short run.

Thread-safe: the Gauntlet runs its worlds on a small thread pool and they share one purse.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field

__all__ = [
    "CLAUDE",
    "DEFAULT_CAPS",
    "ENGINES",
    "NEMOTRON",
    "Budget",
    "BudgetExhausted",
]

#: The two purses. Engine names as the report spells them, not as the ledger does.
NEMOTRON = "nemotron"
CLAUDE = "claude"
ENGINES: tuple[str, ...] = (NEMOTRON, CLAUDE)

#: The operator's caps (design note, "Resume 2026-10-07"): $1 a run on Nemotron, $10 on Claude.
DEFAULT_CAPS: dict[str, float] = {NEMOTRON: 1.00, CLAUDE: 10.00}


class BudgetExhausted(RuntimeError):
    """An engine's purse is empty. Raised by :meth:`Budget.require`; the reason is the closed
    set's ``budget_exhausted``."""

    def __init__(self, engine: str, spent: float, cap: float) -> None:
        super().__init__(f"{engine} budget exhausted: ${spent:.4f} of ${cap:.2f}")
        self.engine = engine
        self.spent = spent
        self.cap = cap


@dataclass
class Budget:
    """What each engine may spend this run, and what it has."""

    caps: dict[str, float] = field(default_factory=lambda: dict(DEFAULT_CAPS))

    def __post_init__(self) -> None:
        unknown = sorted(set(self.caps) - set(ENGINES))
        if unknown:
            raise ValueError(f"unknown budget engine(s): {unknown}; expected {ENGINES}")
        self._spent: dict[str, float] = dict.fromkeys(ENGINES, 0.0)
        self._calls: dict[str, int] = dict.fromkeys(ENGINES, 0)
        self._lock = threading.Lock()

    def cap(self, engine: str) -> float:
        return self.caps.get(engine, 0.0)

    def spent(self, engine: str) -> float:
        with self._lock:
            return self._spent[engine]

    def calls(self, engine: str) -> int:
        with self._lock:
            return self._calls[engine]

    def can_spend(self, engine: str) -> bool:
        """Is there anything left in this engine's purse? Checked before each call."""
        with self._lock:
            return self._spent[engine] < self.cap(engine)

    def require(self, engine: str) -> None:
        """Raise :class:`BudgetExhausted` when this engine may not make another call."""
        with self._lock:
            spent = self._spent[engine]
        if spent >= self.cap(engine):
            raise BudgetExhausted(engine, spent, self.cap(engine))

    def charge(self, engine: str, cost_usd: float | None) -> None:
        """Book one call. A call with no known cost is counted but costs nothing here — the
        ledger row says its cost is absent, and the report does not invent one."""
        with self._lock:
            self._calls[engine] += 1
            if cost_usd is not None and cost_usd > 0:
                self._spent[engine] += cost_usd

    def summary(self) -> dict[str, dict[str, float | int]]:
        with self._lock:
            return {
                engine: {
                    "cap_usd": self.cap(engine),
                    "spent_usd": round(self._spent[engine], 6),
                    "calls": self._calls[engine],
                }
                for engine in ENGINES
            }

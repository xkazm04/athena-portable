"""The run's own ledger: one JSONL row per model call the Proving Ground makes (README §9).

README §2 invariant 6 says every model invocation gets a row, failures included. Athena-under-test
writes hers to her (throwaway) brain's ledger, exactly as in production; the proving roles —
attacker, user, judge, on Nemotron or on the Claude control — are not Athena, so they write here,
beside the report. The shape mirrors the brain ledger's columns that matter for a run: engine,
model, tokens, cost, time, and an error reason from ``ERROR_REASONS``.

**Never a secret, never a prompt.** A row carries sizes and outcomes. The one piece of model
output it may carry is ``excerpt``: the head of an answer that failed its schema, because a bad
Nemotron answer *is* the finding the hackathon feedback field asks for — and a model's answer is
not a secret.

**One reader of money.** :func:`spend` is the one place a run's rows become dollars: the known
spend (the sum of priced rows, never an invented number), the count of unpriced rows, and the
figure a cap is checked against, which weighs each unpriced row at a stated default (ADR 0122).
:meth:`RunLog.read` is the one tolerant reader of a ``ledger.jsonl`` on disk.
"""

from __future__ import annotations

import json
import threading
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from athena.contracts.channel import cut_text, now_iso
from athena.contracts.harness import normalize_reason
from athena.proving.report import TEXT_ERRORS

__all__ = ["EXCERPT_CHARS", "RunLog", "Spend", "spend"]

#: How much of a failed answer a row keeps. Enough to quote in a finding, bounded so a runaway
#: generation cannot fill the disk; a cut excerpt says so.
EXCERPT_CHARS = 4000


@dataclass
class RunLog:
    """Append-only JSONL. ``path=None`` keeps rows in memory only (tests, dry runs)."""

    path: Path | None = None
    rows: list[dict[str, Any]] = field(default_factory=list)

    def __post_init__(self) -> None:
        self._lock = threading.Lock()
        if self.path is not None:
            self.path.parent.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def read(path: Path) -> list[dict[str, Any]]:
        """The rows of a ``ledger.jsonl`` on disk. A torn line (a run killed mid-write) or a line
        that is not an object is skipped; a missing file is no rows."""
        try:
            lines = path.read_text(encoding="utf-8", errors=TEXT_ERRORS).splitlines()
        except OSError:
            return []
        rows: list[dict[str, Any]] = []
        for line in lines:
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(row, dict):
                rows.append(row)
        return rows

    def record(
        self,
        *,
        role: str,
        engine: str,
        model: str,
        input_tokens: int = 0,
        output_tokens: int = 0,
        cost_usd: float | None = None,
        ms: int = 0,
        error_reason: str | None = None,
        schema_ok: bool | None = None,
        excerpt: str = "",
        extra: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        row: dict[str, Any] = {
            "at": now_iso(),
            "role": role,
            "engine": engine,
            "model": model,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "ms": ms,
            "is_error": error_reason is not None,
        }
        if cost_usd is not None:
            row["cost_usd"] = round(cost_usd, 8)
        if error_reason is not None:
            row["error_reason"] = normalize_reason(error_reason) or "unknown"
        if schema_ok is not None:
            row["schema_ok"] = schema_ok
        if excerpt:
            row["excerpt"] = _excerpt(excerpt)
        if extra:
            row.update(dict(extra))
        line = json.dumps(row, ensure_ascii=False, sort_keys=True)
        with self._lock:
            self.rows.append(row)
            if self.path is not None:
                with self.path.open("a", encoding="utf-8", errors=TEXT_ERRORS) as handle:
                    handle.write(line + "\n")
        return row


@dataclass(frozen=True)
class Spend:
    """What a set of ledger rows cost, read once (ADR 0122).

    ``spent_usd`` is the sum of the known costs and nothing else; ``unpriced_calls`` says how many
    rows carried no cost; ``enforced_usd`` is what a cap is checked against: the known spend plus
    each unpriced row at the caller's stated ``assume_usd``. Never book ``enforced_usd`` as spend.
    """

    spent_usd: float
    calls: int
    unpriced_calls: int
    enforced_usd: float

    @property
    def priced_calls(self) -> int:
        return self.calls - self.unpriced_calls

    def __add__(self, other: Spend) -> Spend:
        return Spend(
            spent_usd=round(self.spent_usd + other.spent_usd, 6),
            calls=self.calls + other.calls,
            unpriced_calls=self.unpriced_calls + other.unpriced_calls,
            enforced_usd=round(self.enforced_usd + other.enforced_usd, 6),
        )


def _price(row: Mapping[str, Any]) -> float | None:
    cost = row.get("cost_usd")
    if isinstance(cost, bool) or not isinstance(cost, int | float):
        return None
    return float(cost)


def spend(rows: Iterable[Mapping[str, Any]], *, assume_usd: float) -> Spend:
    """Read ``rows`` into a :class:`Spend`. A row whose ``cost_usd`` is absent, ``None`` or not a
    number is unpriced and weighs ``assume_usd`` for the cap only; a zero or negative cost is a
    known call that added nothing, as :meth:`~athena.proving.budget.Budget.charge` books it."""
    known = 0.0
    calls = unpriced = 0
    for row in rows:
        calls += 1
        cost = _price(row)
        if cost is None:
            unpriced += 1
        elif cost > 0:
            known += cost
    return Spend(
        spent_usd=round(known, 6),
        calls=calls,
        unpriced_calls=unpriced,
        enforced_usd=round(known + unpriced * assume_usd, 6),
    )


def _excerpt(text: str) -> str:
    return cut_text(text, EXCERPT_CHARS)

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
"""

from __future__ import annotations

import json
import threading
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from athena.contracts.harness import normalize_reason

__all__ = ["EXCERPT_CHARS", "RunLog"]

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
            "at": datetime.now(UTC).isoformat(),
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
                with self.path.open("a", encoding="utf-8") as handle:
                    handle.write(line + "\n")
        return row


def _excerpt(text: str) -> str:
    total = len(text)
    if total <= EXCERPT_CHARS:
        return text
    return f"{text[:EXCERPT_CHARS]}\n(showing {EXCERPT_CHARS} of {total})"

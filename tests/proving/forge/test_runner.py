"""The forge's bench stage: what a bench that fails leaves behind (README §2 invariant 6)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from athena.proving.budget import CLAUDE, NEMOTRON, Budget
from athena.proving.forge.base import Base
from athena.proving.forge.dry import mutate
from athena.proving.forge.forge import Variant
from athena.proving.forge.runner import bench_variants
from athena.proving.forge.store import ForgeDir
from athena.proving.playbooks.bench import BenchConfig
from athena.proving.playbooks.spec import Playbook
from athena.proving.runlog import RunLog


def _one_valid(store: ForgeDir, base: Base) -> list[Any]:
    answer = mutate(base, 1)
    store.save_variant(
        Variant(base.id, 1, "nemotron", "m", True, world=answer["world"], truth=answer["truth"])
    )
    return list(store.load_variants("nemotron"))


def test_a_bench_that_raises_leaves_a_ledger_row_and_weighs_on_the_cap(
    base: Base, tmp_path: Path
) -> None:
    store = ForgeDir(tmp_path)
    budget = Budget(caps={NEMOTRON: 1.0, CLAUDE: 60.0})
    log = RunLog(store.runlog)

    def broken(book: Playbook, config: BenchConfig) -> dict[str, Any]:
        raise RuntimeError("the bench died after it had spent")

    outcome = bench_variants(
        store, {base.id: base}, _one_valid(store, base), budget, log, run=broken
    )
    assert outcome.failed == 1
    rows = RunLog.read(store.runlog)
    assert [r["role"] for r in rows] == ["bench"]
    assert rows[0]["is_error"] is True and rows[0]["variant"] == f"{base.id}-v1"
    # What it spent is unknown, so it is weighed as an unpriced call, never as $0 (ADR 0122).
    assert budget.summary()[CLAUDE]["unpriced_calls"] == 1

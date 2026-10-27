"""The forge's stages: what a failed bench, a torn ledger or a spent purse leaves behind."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from athena.proving.budget import CLAUDE, NEMOTRON, Budget
from athena.proving.forge.base import Base, materialize
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


def test_the_report_and_the_purse_read_one_ledger_alike(tmp_path: Path) -> None:
    from athena.proving.forge.report import build_report
    from athena.proving.forge.store import restore_budget

    store = ForgeDir(tmp_path)
    rows = [
        {"role": "forge", "engine": NEMOTRON, "model": "m", "cost_usd": 0.25},
        {"role": "forge", "engine": NEMOTRON, "model": "m", "error_reason": "budget_exhausted"},
    ]
    lines = [json.dumps(r) for r in rows] + ['{"role": "forge", "engine": "nemo']  # killed mid-row
    store.runlog.write_text("\n".join(lines) + "\n", encoding="utf-8")
    budget = Budget(caps={NEMOTRON: 1.0, CLAUDE: 1.0})
    restore_budget(budget, store.runlog)
    report = build_report(
        store,
        {},
        run_id="t",
        seed=11,
        n=1,
        rung="lightning",
        dry=True,
        picks={"ids": []},
        models={},
    )
    # A torn last line does not stop the report, and a purse refusal is no call in either.
    assert report["cost_usd"][NEMOTRON]["calls"] == budget.calls(NEMOTRON) == 1
    assert report["cost_usd"][NEMOTRON]["cost_usd"] == 0.25


def test_an_audit_the_purse_cut_short_is_not_saved_as_done(base: Base, tmp_path: Path) -> None:
    from athena.proving.forge.dry import dry_bench
    from athena.proving.forge.run import Forge
    from athena.proving.roles import RoleCaller

    from .conftest import ScriptedRole, text_reply

    store = ForgeDir(tmp_path)
    (v,) = _one_valid(store, base)
    ForgeDir.write(store.picks, {"ids": [base.id], "shorts": [], "notes": []})
    book = materialize(base, v.world, v.truth, tmp_path / "copy")
    report = dry_bench(book, BenchConfig())
    target = v.truth["targets"][0]
    report["score"]["missed"] = [{"action": target["tool"], "key": k} for k in target["eligible"]]
    assert len(report["score"]["missed"]) >= 2
    ForgeDir.write(store.bench_path(v), report)
    # The purse pays for the first audit call only; the rest of the variant's items are refused.
    budget = Budget(caps={NEMOTRON: 1.0, CLAUDE: 0.005})
    answer = json.dumps({"label_holds": True, "why": "the row says so"})
    control = ScriptedRole(lambda s, p: text_reply(answer, cost=0.01, engine=CLAUDE), CLAUDE)
    forge = Forge(
        store=store,
        library=base.library,
        budget=budget,
        caller=RoleCaller(budget, RunLog()),
        nemotron=ScriptedRole(lambda s, p: text_reply("{}")),
        control=control,
        echo=lambda _s: None,
    )
    forge.stage_audit()
    assert len(control.prompts) == 1
    # Not written: a resumed audit (with a bigger cap) audits this variant again, whole.
    assert not store.audit_path(v).is_file()
    assert any("audit stopped" in note for note in forge.notes)

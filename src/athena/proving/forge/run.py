"""The forge's stages, one function each, each reading and writing the run directory (README §14).

``pick`` -> ``forge`` -> ``bench`` -> ``audit`` -> report. A stage skips what already exists on
disk and stops cleanly, saying ``(showing N of M)``, when a purse is spent.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from athena.proving.budget import CLAUDE, NEMOTRON, Budget
from athena.proving.forge import report as reporting
from athena.proving.forge.audit import audit_items, purse_cut, rescore_corrected, run_audit
from athena.proving.forge.base import Base, instrument, load_base, materialize
from athena.proving.forge.forge import forge_one
from athena.proving.forge.pick import Picks, pick_detail
from athena.proving.forge.runner import BenchRunner, bench_variants, default_runner
from athena.proving.forge.store import ForgeDir
from athena.proving.playbooks.bench import BenchConfig
from athena.proving.playbooks.spec import PlaybookError
from athena.proving.report import announce
from athena.proving.roles import RoleCaller, RoleClient

__all__ = ["Forge", "purse"]


@dataclass
class Forge:
    store: ForgeDir
    library: Path
    budget: Budget
    caller: RoleCaller
    nemotron: RoleClient
    control: RoleClient | None
    n: int = 3
    seed: int = 11
    rung: str = "lightning"
    dry: bool = False
    run_id: str = ""
    bench_runner: BenchRunner = default_runner
    bench_cap: float = 5.0
    audit_reserve: float = 5.0
    #: The bench instrument (engine, model, approval mode). One config for the pick, the bench and
    #: the report, so a variant is compared with base runs measured the same way (ADR 0128).
    bench_config: BenchConfig = field(default_factory=BenchConfig)
    echo: Callable[[str], None] = print
    bases: dict[str, Base] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)

    # --- pick -------------------------------------------------------------------------------

    def stage_pick(self) -> Picks:
        picks = pick_detail(self.library, self.seed, config=self.bench_config)
        ForgeDir.write(
            self.store.picks, {"ids": picks.ids, "shorts": picks.shorts, "notes": picks.notes}
        )
        for pid in picks.ids:
            self.bases[pid] = load_base(self.library, pid)
        self.echo(f"picked {len(picks.ids)}: {', '.join(picks.ids)}")
        for note in picks.notes:
            self.echo(f"  note: {note}")
        return picks

    def picked(self) -> dict[str, Any]:
        if not self.store.picks.is_file():
            self.stage_pick()
        picks = ForgeDir.read(self.store.picks)
        for pid in picks["ids"]:
            self.bases.setdefault(pid, load_base(self.library, pid))
        return picks

    # --- forge ------------------------------------------------------------------------------

    def stage_forge(self) -> None:
        picks = self.picked()
        engines: list[tuple[str, RoleClient]] = [("nemotron", self.nemotron)]
        if self.control is not None:
            engines.append(("haiku", self.control))
        for name, client in engines:
            planned = len(picks["ids"]) * self.n
            done = made = 0
            self.echo(f"forge: {name} ({client.model}), {self.n} per playbook")
            for pid in picks["ids"]:
                for k in range(1, self.n + 1):
                    if self.store.has_variant(name, pid, k):
                        done += 1
                        continue
                    if not self.budget.can_spend(client.engine):
                        self.echo(
                            f"  the {client.engine} purse is spent: "
                            f"{announce(done + made, planned)}".rstrip()
                        )
                        break
                    variant = forge_one(
                        self.caller, client, self.bases[pid], k, self.seed, generator=name
                    )
                    if variant.void == "budget":
                        break
                    self.store.save_variant(variant)
                    made += 1
                    verdict = "valid" if variant.valid else "refused " + ",".join(variant.codes)
                    self.echo(f"  {pid} #{k}: {verdict}")
                else:
                    continue
                break

    # --- bench ------------------------------------------------------------------------------

    def stage_bench(self) -> None:
        picks = self.picked()
        variants = [v for v in self.store.load_variants("nemotron") if v.playbook in picks["ids"]]
        outcome = bench_variants(
            self.store,
            self.bases,
            variants,
            self.budget,
            self.caller.log,
            run=self.bench_runner,
            config=self.bench_config,
            per_run_cap=self.bench_cap,
            reserve=self.audit_reserve,
            charge=not self.dry,
            echo=self.echo,
        )
        for line in outcome.lines:
            self.echo("  " + line)
        footer = outcome.footer()
        self.echo(
            f"bench: {outcome.benched} run, {outcome.skipped} already done, "
            f"{outcome.voided} set aside, {outcome.failed} failed {footer}".rstrip()
        )
        if outcome.stopped:
            self.echo(f"  stopped: {outcome.stopped}")
            self.notes.append(f"bench stopped early: {outcome.stopped} {footer}".strip())

    # --- audit ------------------------------------------------------------------------------

    def stage_audit(self) -> None:
        picks = self.picked()
        client = self.control
        if client is None:
            self.echo("audit: needs the Haiku control (--control); skipped")
            self.notes.append("audit skipped: no Claude control available")
            return
        todo = [
            v
            for v in self.store.load_variants("nemotron")
            if v.playbook in picks["ids"] and self.store.bench_path(v).is_file()
        ]
        done = made = 0
        for v in todo:
            if self.store.audit_path(v).is_file():
                done += 1
                continue
            if not self.budget.can_spend(CLAUDE):
                self.notes.append(
                    f"audit stopped: Claude purse spent {announce(done + made, len(todo))}"
                )
                break
            assert v.world is not None and v.truth is not None
            base = self.bases[v.playbook]
            report = ForgeDir.read(self.store.bench_path(v))
            items = audit_items(v.truth, report)
            run_audit(self.caller, client, base, v.world, items)
            if purse_cut(items):
                # Not written, so a resumed stage audits this variant again, whole.
                self.notes.append(
                    f"audit stopped: Claude purse spent {announce(done + made, len(todo))}"
                )
                break
            try:
                book = materialize(base, v.world, v.truth, self.store.work / f"{v.playbook}-v{v.k}")
                fixed = rescore_corrected(book, report, items)
            except PlaybookError:
                fixed = {"verdict": report.get("verdict", {}), "score": report.get("score", {})}
            ForgeDir.write(
                self.store.audit_path(v),
                {
                    "playbook": v.playbook,
                    "k": v.k,
                    "items": [i.__dict__ for i in items],
                    "raw": {
                        "word": (report.get("verdict") or {}).get("word"),
                        "recall_value": (report.get("score") or {}).get("recall_value"),
                    },
                    "corrected": {
                        "word": fixed["verdict"].get("word"),
                        "reasons": fixed["verdict"].get("reasons"),
                        "recall_value": fixed["score"].get("recall_value"),
                    },
                },
            )
            made += 1
            holds = sum(1 for i in items if i.label_holds is True)
            self.echo(f"audit {v.playbook}-v{v.k}: {len(items)} items, {holds} hold")
        self.echo(f"audit: {made} variants audited, {done} already done")

    # --- report -----------------------------------------------------------------------------

    def stage_report(self) -> dict[str, Any]:
        picks = self.picked()
        models: dict[str, Any] = {
            "nemotron_generator": self.nemotron.model,
            "claude_control": self.control.model if self.control else None,
            "bench": instrument(self.bench_config),
            "audit": self.control.model if self.control else None,
        }
        report = reporting.build_report(
            self.store,
            self.bases,
            run_id=self.run_id,
            seed=self.seed,
            n=self.n,
            rung=self.rung,
            dry=self.dry,
            picks=picks,
            models=models,
            bench_note="; ".join(self.notes),
            config=self.bench_config,
        )
        json_path, md_path = reporting.write(self.store, report)
        self.echo(f"report: {json_path.as_posix()} and {md_path.as_posix()}")
        for p in report["proof"]:
            self.echo(f"  {p['status']:>4}  {p['claim']}: {p['detail']}")
        return report


def purse(caps: Mapping[str, float], runlog: Path) -> Budget:
    from athena.proving.forge.store import restore_budget

    budget = Budget(caps={NEMOTRON: caps[NEMOTRON], CLAUDE: caps[CLAUDE]})
    restore_budget(budget, runlog)
    return budget

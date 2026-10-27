"""Where a forge run keeps its state: files under ``proving-runs/<ts>/forge/`` (gitignored).

Every stage reads what the one before wrote, so a stage can be run alone, killed and resumed: a
variant, a bench report and an audit each exist as a file or they do not. The Claude purse is
rebuilt from the run's own ledger (``runlog.jsonl``), so a resumed run does not forget its spend.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from athena.proving.budget import ENGINES, Budget
from athena.proving.forge.forge import Variant
from athena.proving.runlog import RunLog

__all__ = ["ForgeDir", "VariantRecord", "restore_budget"]


@dataclass
class VariantRecord(Variant):
    """A :class:`Variant` as read back from disk (same fields; the name marks the direction)."""

    extra: dict[str, Any] = field(default_factory=dict)


class ForgeDir:
    def __init__(self, run_dir: Path) -> None:
        self.root = run_dir / "forge"
        self.variants = self.root / "variants"
        self.bench = self.root / "bench"
        self.audit = self.root / "audit"
        self.work = self.root / "work"
        for d in (self.variants, self.bench, self.audit, self.work):
            d.mkdir(parents=True, exist_ok=True)

    @property
    def runlog(self) -> Path:
        return self.root / "runlog.jsonl"

    @property
    def picks(self) -> Path:
        return self.root / "pick.json"

    @property
    def mode(self) -> Path:
        return self.root / "mode.json"

    def settle_dry(self, dry: bool) -> bool:
        """Whether this run is dry: what its first stage recorded, else ``dry``, now recorded.

        A run directory is dry or live for good: its fixture worlds and scripted benches are
        never reported, benched or audited as a measurement because a later stage forgot
        ``--dry``. A directory from before the record is taken as ``dry`` says.
        """
        if self.mode.is_file():
            recorded = ForgeDir.read(self.mode).get("dry")
            if isinstance(recorded, bool):
                return recorded
        ForgeDir.write(self.mode, {"dry": dry})
        return dry

    def variant_path(self, generator: str, playbook: str, k: int) -> Path:
        d = self.variants / generator
        d.mkdir(exist_ok=True)
        return d / f"{playbook}-{k}.json"

    def bench_path(self, v: Variant) -> Path:
        return self.bench / f"{v.playbook}-v{v.k}.json"

    def void_path(self, v: Variant) -> Path:
        return self.bench / f"{v.playbook}-v{v.k}.void.json"

    def audit_path(self, v: Variant) -> Path:
        return self.audit / f"{v.playbook}-v{v.k}.json"

    # --- variants ---------------------------------------------------------------------------

    def save_variant(self, v: Variant) -> Path:
        path = self.variant_path(v.generator, v.playbook, v.k)
        path.write_text(json.dumps(asdict(v), indent=1, ensure_ascii=False), encoding="utf-8")
        return path

    def load_variants(self, generator: str | None = None) -> list[VariantRecord]:
        found: list[VariantRecord] = []
        for d in sorted(self.variants.iterdir()):
            if not d.is_dir() or (generator and d.name != generator):
                continue
            for path in sorted(d.glob("*.json")):
                raw = json.loads(path.read_text(encoding="utf-8"))
                found.append(VariantRecord(**{k: raw[k] for k in raw if k in _FIELDS}))
        return found

    def has_variant(self, generator: str, playbook: str, k: int) -> bool:
        return self.variant_path(generator, playbook, k).is_file()

    # --- json helpers ---------------------------------------------------------------------

    @staticmethod
    def read(path: Path) -> dict[str, Any]:
        value = json.loads(path.read_text(encoding="utf-8"))
        return dict(value) if isinstance(value, dict) else {}

    @staticmethod
    def write(path: Path, value: Any) -> None:
        path.write_text(json.dumps(value, indent=1, ensure_ascii=False), encoding="utf-8")


_FIELDS = {
    "playbook",
    "k",
    "generator",
    "model",
    "valid",
    "problems",
    "cost_usd",
    "ms",
    "void",
    "world",
    "truth",
}


def restore_budget(budget: Budget, runlog: Path) -> None:
    """Charge ``budget`` with every call an earlier session's ledger holds, so caps hold across
    runs. A purse refusal and a row marked ``sent: false`` (a picture refused before any call)
    are no call."""
    for row in RunLog.read(runlog):
        engine = row.get("engine")
        if (
            engine in ENGINES
            and row.get("error_reason") != "budget_exhausted"
            and row.get("sent") is not False
        ):
            cost = row.get("cost_usd")
            budget.charge(str(engine), float(cost) if isinstance(cost, int | float) else None)

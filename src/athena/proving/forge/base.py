"""A playbook as the forge reads it: its three authored files and its committed bench (README §14).

Plain JSON, not :class:`~athena.proving.playbooks.spec.Playbook`: the forge compares and rewrites
the files themselves, and the spec loader is called on a *copy* only to judge a variant.
"""

from __future__ import annotations

import json
import shutil
import statistics
import tempfile
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from athena.proving.playbooks import ledger
from athena.proving.playbooks.bench import BenchConfig, comparability_key, content_digest
from athena.proving.playbooks.spec import Playbook, _norm, load_playbook, load_taxonomy

__all__ = [
    "Base",
    "Baseline",
    "baseline",
    "find_rows",
    "has_row",
    "instrument",
    "load_base",
    "materialize",
    "read_bench",
    "read_json",
    "rows_of",
    "target_ids",
]

AUTHORED = ("playbook.json", "world.json", "truth.json")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


@dataclass(frozen=True)
class Base:
    """One playbook of the library: showcase, world, truth and the committed bench summary."""

    id: str
    library: Path
    showcase: dict[str, Any]
    world: dict[str, Any]
    truth: dict[str, Any]
    bench: dict[str, Any] = field(default_factory=dict)

    @property
    def category(self) -> str:
        return str(self.showcase.get("category", ""))

    @property
    def verdict_word(self) -> str:
        verdict = self.bench.get("verdict")
        return str(verdict.get("word", "")) if isinstance(verdict, Mapping) else ""

    @property
    def recall_value(self) -> float | None:
        score = self.bench.get("score")
        value = score.get("recall_value") if isinstance(score, Mapping) else None
        return (
            float(value) if isinstance(value, int | float) and not isinstance(value, bool) else None
        )


def read_bench(root: Path) -> dict[str, Any]:
    """``root``'s ``bench.json`` with its ledger's runs on it (ADR 0195); empty if never benched."""
    return ledger.view(root) or {}


def load_base(library: str | Path, playbook_id: str) -> Base:
    root = Path(library) / playbook_id
    return Base(
        id=playbook_id,
        library=Path(library),
        showcase=dict(read_json(root / "playbook.json")),
        world=dict(read_json(root / "world.json")),
        truth=dict(read_json(root / "truth.json")),
        bench=read_bench(root),
    )


# --- what a variant is compared with (ADR 0128) ------------------------------------------------


def instrument(config: BenchConfig) -> str:
    """``engine/model/approve``: the part of a comparability key that is the bench's own."""
    return f"{config.engine}/{config.model}/{config.approve}"


@dataclass(frozen=True)
class Baseline:
    """The base's runs a variant benched under ``config`` may be compared with (ADR 0128).

    ``comparable`` is False, with a ``reason``, when no run of the base was measured by the same
    instrument against today's files. Otherwise ``n`` runs: the pooled ``word`` (short when short
    in half of them or more, else their most common verdict) and the median and minimum recall.
    """

    comparable: bool
    n: int = 0
    word: str = ""
    recall_median: float | None = None
    recall_min: float | None = None
    reason: str = ""

    @property
    def held(self) -> bool:
        """The base met or exceeded its expectation over its comparable runs."""
        return self.comparable and self.word in ("exceeds", "meets")

    def as_dict(self) -> dict[str, Any]:
        if not self.comparable:
            return {"comparable": False, "reason": self.reason}
        out: dict[str, Any] = {"comparable": True, "n": self.n, "word": self.word}
        if self.recall_median is not None:
            out["recall_median"] = self.recall_median
        if self.recall_min is not None:
            out["recall_min"] = self.recall_min
        return out


def _unkeyed_mismatch(bench: Mapping[str, Any], config: BenchConfig) -> str | None:
    for name in ("engine", "model", "approve"):
        said = bench.get(name)
        if said is not None and said != getattr(config, name):
            return f"{name} {said!r}"
    return None


def baseline(base: Base, config: BenchConfig | None = None) -> Baseline:
    """The base's comparable set under ``config`` (default: the bench's own defaults).

    A bench whose latest run carries no key (benched before keys were kept) is a set of one, as
    the ranking reads it, unless it names another engine, model or approval mode.
    """
    cfg = config or BenchConfig()
    bench = base.bench
    if not bench:
        return Baseline(False, reason="no bench.json: the base was never benched")
    pooled = ledger.comparable_runs(bench)
    if pooled is None:
        other = _unkeyed_mismatch(bench, cfg)
        if other is not None:
            return Baseline(
                False,
                reason=f"no comparable run: the base was benched with {other}, not "
                f"{instrument(cfg)}",
            )
        runs = [ledger.headline(bench)]
    else:
        root = base.library / base.id
        current = comparability_key(content_digest(root), cfg.engine, cfg.model, cfg.approve)
        runs = ledger.comparable_runs(bench, current) or []
    if not runs:
        return Baseline(
            False,
            reason=f"no comparable run under {instrument(cfg)}: its world, truth, command, "
            "scorer or instrument changed since it was benched",
        )
    words = [str(r.get("verdict") or "") for r in runs]
    n = len(runs)
    short = words.count("short")
    if 2 * short >= n:
        word = "short"
    else:
        # Counter keeps first-seen order on ties, and the runs come latest first.
        word = Counter(w for w in words if w != "short").most_common(1)[0][0]
    recalls = [
        float(v)
        for v in (r.get("recall_value") for r in runs)
        if isinstance(v, int | float) and not isinstance(v, bool)
    ]
    return Baseline(
        True,
        n=n,
        word=word,
        recall_median=round(statistics.median(recalls), 3) if recalls else None,
        recall_min=round(min(recalls), 3) if recalls else None,
    )


# --- which rows an id names ---------------------------------------------------------------------


def _scalars(row: Mapping[str, Any]) -> list[str]:
    return [
        _norm(v)
        for v in row.values()
        if isinstance(v, str | int | float) and not isinstance(v, bool)
    ]


def find_rows(
    world: Mapping[str, Any], item: str, *, limit: int = 4
) -> list[tuple[str, Mapping[str, Any]]]:
    """The rows a truth id points at: ``(table, row)``.

    A truth key is the parameter of a gated write (``line_id``, ``case_id``, ``tax_year``) and the
    read tools that surface the rows name theirs differently, so no table is assumed. First the
    rows holding the id as a whole value; failing that, the rows whose text mentions it (an id
    that lives in a mail body or a worker's name). Both compare as the scorer does (``_norm``).
    """
    tables = world.get("tables")
    if not isinstance(tables, Mapping):
        return []
    want = _norm(item)
    exact: list[tuple[str, Mapping[str, Any]]] = []
    inside: list[tuple[str, Mapping[str, Any]]] = []
    for name, rows in tables.items():
        for row in _list(rows):
            if not isinstance(row, Mapping):
                continue
            values = _scalars(row)
            if want in values:
                exact.append((str(name), row))
            elif any(want in v for v in values):
                inside.append((str(name), row))
    return (exact or inside)[:limit]


def has_row(world: Mapping[str, Any], item: str) -> bool:
    return bool(find_rows(world, item, limit=1))


def rows_of(world: Mapping[str, Any], table: str) -> list[Mapping[str, Any]]:
    tables = world.get("tables")
    rows = tables.get(table) if isinstance(tables, Mapping) else None
    return [r for r in _list(rows) if isinstance(r, Mapping)]


def target_ids(target: Mapping[str, Any]) -> dict[str, set[str]]:
    """The normalised eligible / trap / neutral ids of one truth target."""
    out: dict[str, set[str]] = {}
    for part in ("eligible", "traps", "neutral"):
        value = target.get(part)
        out[part] = {_norm(k) for k in value} if isinstance(value, Mapping) else set()
    return out


def materialize(
    base: Base, world: Mapping[str, Any], truth: Mapping[str, Any], dest: Path
) -> Playbook:
    """``dest/<id>/`` with the base's playbook.json and this world and truth, loaded by the spec.

    The directory keeps the playbook's id (the loader insists on it, and the nine playbooks before
    ADR 0057 are exempted by id). Raises :class:`~athena.proving.playbooks.spec.PlaybookError`.
    """
    root = dest / base.id
    root.mkdir(parents=True, exist_ok=True)
    for name, value in (
        ("playbook.json", base.showcase),
        ("world.json", world),
        ("truth.json", truth),
    ):
        (root / name).write_text(json.dumps(value, ensure_ascii=False, indent=1), encoding="utf-8")
    # A featured chore's READ tools serve its sensed tables (ADR 0226); a variant keeps the base's
    # media, so it keeps the tables built from them.
    sensed = base.library / base.id / "senses" / "sensed.json"
    if sensed.is_file():
        (root / "senses").mkdir(exist_ok=True)
        shutil.copyfile(sensed, root / "senses" / "sensed.json")
    return load_playbook(root, load_taxonomy(base.library))


def loader_problems(base: Base, world: Mapping[str, Any], truth: Mapping[str, Any]) -> list[str]:
    from athena.proving.playbooks.spec import PlaybookError

    with tempfile.TemporaryDirectory(prefix="athena-forge-") as tmp:
        try:
            materialize(base, world, truth, Path(tmp))
        except PlaybookError as exc:
            return list(exc.problems)
    return []


def _list(value: Any) -> Sequence[Any]:
    return value if isinstance(value, list) else []

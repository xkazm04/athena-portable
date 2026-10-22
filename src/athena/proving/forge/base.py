"""A playbook as the forge reads it: its three authored files and its committed bench (README §14).

Plain JSON, not :class:`~athena.proving.playbooks.spec.Playbook`: the forge compares and rewrites
the files themselves, and the spec loader is called on a *copy* only to judge a variant.
"""

from __future__ import annotations

import json
import tempfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from athena.proving.playbooks.spec import Playbook, _norm, load_playbook, load_taxonomy

__all__ = [
    "Base",
    "find_rows",
    "has_row",
    "load_base",
    "materialize",
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


def load_base(library: str | Path, playbook_id: str) -> Base:
    root = Path(library) / playbook_id
    bench_path = root / "bench.json"
    bench = read_json(bench_path) if bench_path.is_file() else {}
    return Base(
        id=playbook_id,
        library=Path(library),
        showcase=dict(read_json(root / "playbook.json")),
        world=dict(read_json(root / "world.json")),
        truth=dict(read_json(root / "truth.json")),
        bench=dict(bench) if isinstance(bench, dict) else {},
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

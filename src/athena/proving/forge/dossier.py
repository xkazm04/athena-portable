"""One variant's review set: what the operator reads to attribute each finding (README §14).

The forge exists to answer one question per miss: is this an Athena defect, or a bad generated
label? A verdict names a case, not a cause, so every audit item (or, before the audit, every miss
and filed trap of the bench, ``unaudited``) is laid out with what deciding it needs: the row the
id names in the variant's world, the truth's label, the auditor's why, what the bench filed (the
cards on a filed trap, a count on the tool for a miss), a short diff against the base and the
exact command that benches the variant's work copy again. Read from the run directory alone; the
only write is the work copy, materialised when absent so the rerun line works.
"""

from __future__ import annotations

import json
import shutil
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from athena.proving.forge.audit import audit_items
from athena.proving.forge.base import Base, find_rows, materialize
from athena.proving.forge.store import ForgeDir, VariantRecord
from athena.proving.playbooks.spec import PlaybookError, _norm

__all__ = ["RERUN_RUNS", "Diff", "Dossier", "Entry", "dossier", "render", "rerun_command"]

#: Fresh draws the rerun line asks for: enough to see whether a variant's verdict is noise.
RERUN_RUNS = 3

STATES = {True: "finding", False: "forge-error", None: "unaudited"}


@dataclass(frozen=True)
class Entry:
    """One audit item with what judging it needs. ``state``: finding / forge-error / unaudited."""

    kind: str
    tool: str
    key: str
    state: str
    label: str
    why: str = ""
    table: str = ""
    row: dict[str, Any] = field(default_factory=dict)
    #: The bench's cards on this item (a filed trap); ``[]`` for a miss.
    filed: list[dict[str, Any]] = field(default_factory=list)
    #: For a miss: how many cards the run filed on the same tool.
    cards_on_tool: int | None = None


@dataclass(frozen=True)
class Diff:
    """What the generator changed: today, rows per table (base, variant), traps the base lacks."""

    today: tuple[str | None, str | None]
    rows: dict[str, tuple[int, int]]
    new_traps: list[str]


@dataclass(frozen=True)
class Dossier:
    playbook: str
    k: int
    benched: bool
    audited: bool
    entries: list[Entry]
    diff: Diff | None
    rerun: str
    note: str = ""

    @property
    def name(self) -> str:
        return f"{self.playbook}-v{self.k}"


def work_dir(store: ForgeDir, v: VariantRecord) -> Path:
    return store.work / f"{v.playbook}-v{v.k}"


def rerun_command(store: ForgeDir, v: VariantRecord) -> str:
    """The playbooks CLI benching the variant's work copy ``RERUN_RUNS`` times, writing nothing."""
    return (
        f"uv run python -m athena.proving.playbooks --dir {work_dir(store, v).as_posix()} "
        f"bench {v.playbook} --no-write --runs {RERUN_RUNS}"
    )


def _materialise(store: ForgeDir, base: Base, v: VariantRecord) -> str:
    """The work copy the rerun line benches, with the library's taxonomy beside it.

    The playbooks CLI loads ``--dir/<id>`` against the ``taxonomy.json`` in ``--dir``, so the copy
    carries one. Returns a note when the copy cannot be made, else ``""``.
    """
    assert v.world is not None and v.truth is not None
    dest = work_dir(store, v)
    try:
        if not (dest / v.playbook / "world.json").is_file():
            materialize(base, v.world, v.truth, dest)
        taxonomy = base.library / "taxonomy.json"
        if taxonomy.is_file() and not (dest / "taxonomy.json").is_file():
            shutil.copyfile(taxonomy, dest / "taxonomy.json")
    except PlaybookError as exc:
        return f"the work copy cannot be loaded: {exc}"
    return ""


def _trap_ids(truth: Mapping[str, Any], parts: Sequence[str]) -> set[str]:
    out: set[str] = set()
    for target in truth.get("targets", []):
        if not isinstance(target, Mapping):
            continue
        for part in parts:
            value = target.get(part)
            if isinstance(value, Mapping):
                out |= {_norm(k) for k in value}
    return out


def _count(rows: Any) -> int:
    return len(rows) if isinstance(rows, list) else 0


def diff(base: Base, world: Mapping[str, Any], truth: Mapping[str, Any]) -> Diff:
    before = base.world.get("tables")
    after = world.get("tables")
    before = before if isinstance(before, Mapping) else {}
    after = after if isinstance(after, Mapping) else {}
    rows = {
        str(t): (_count(before.get(t)), _count(after.get(t)))
        for t in list(before) + [t for t in after if t not in before]
    }
    named = _trap_ids(base.truth, ("eligible", "traps", "neutral"))
    new = sorted(_trap_ids(truth, ("traps",)) - named)

    def today(value: Any) -> str | None:
        return str(value) if value is not None else None

    return Diff((today(base.world.get("today")), today(world.get("today"))), rows, new)


def _entry(item: Mapping[str, Any], world: Mapping[str, Any], cards: list[Any]) -> Entry:
    kind, tool, key = str(item.get("kind")), str(item.get("tool")), str(item.get("key"))
    found = find_rows(world, key, limit=1)
    table, row = (found[0][0], dict(found[0][1])) if found else ("", {})
    scored = [c for c in cards if isinstance(c, Mapping)]
    on_tool = [c for c in scored if c.get("action") == tool]
    filed = [dict(c) for c in on_tool if _norm(c.get("key", "")) == key]
    holds = item.get("label_holds")
    return Entry(
        kind=kind,
        tool=tool,
        key=key,
        state=STATES.get(holds if isinstance(holds, bool) else None, "unaudited"),
        label=str(item.get("label", "")),
        why=str(item.get("why") or item.get("note") or ""),
        table=table,
        row=row,
        filed=filed if kind == "trap_filed" else [],
        cards_on_tool=len(on_tool) if kind == "miss" else None,
    )


def dossier(store: ForgeDir, base: Base, v: VariantRecord) -> Dossier:
    """``v``'s review set: audited items, or the bench's misses and filed traps as unaudited."""
    rerun = rerun_command(store, v)
    if not v.valid or v.world is None or v.truth is None:
        why = ", ".join(v.codes) or v.void or "no world kept"
        return Dossier(v.playbook, v.k, False, False, [], None, rerun, f"refused: {why}")
    note = _materialise(store, base, v)
    change = diff(base, v.world, v.truth)
    if not store.bench_path(v).is_file():
        return Dossier(v.playbook, v.k, False, False, [], change, rerun, note or "not benched yet")
    bench = ForgeDir.read(store.bench_path(v))
    score = bench.get("score")
    cards = list(score.get("cards", [])) if isinstance(score, Mapping) else []
    audited = store.audit_path(v).is_file()
    if audited:
        items = list(ForgeDir.read(store.audit_path(v)).get("items", []))
    else:
        items = [i.__dict__ for i in audit_items(v.truth, bench)]
    entries = [_entry(i, v.world, cards) for i in items if isinstance(i, Mapping)]
    return Dossier(v.playbook, v.k, True, audited, entries, change, rerun, note)


def render(d: Dossier) -> str:
    """The dossier as text: one block per entry, then the diff and the rerun line."""
    status = "audited" if d.audited else ("benched, not audited" if d.benched else "not benched")
    lines = [f"{d.name}: {status}, {len(d.entries)} item(s)"]
    if d.note:
        lines.append(f"  note: {d.note}")
    for e in d.entries:
        lines += [
            "",
            f"[{e.state}] {e.kind} {e.key} on {e.tool}",
            f"  row: {e.table} {json.dumps(e.row, ensure_ascii=False)}"
            if e.table
            else "  row: (the id has no row in the variant's tables)",
            f"  label: {e.label}",
            f"  why: {e.why or '-'}",
        ]
        if e.kind == "trap_filed":
            for card in e.filed:
                lines.append(f"  filed: {json.dumps(card.get('params', {}), ensure_ascii=False)}")
        elif e.cards_on_tool is not None:
            lines.append(f"  filed: nothing on it; {e.cards_on_tool} card(s) on {e.tool}")
    if d.diff is not None:
        b, a = d.diff.today
        changed = ", ".join(f"{t} {x}->{y}" for t, (x, y) in d.diff.rows.items() if x != y)
        lines += [
            "",
            f"diff: today {b or '-'} -> {a or '-'}; rows {changed or 'unchanged'}; "
            f"new traps {', '.join(d.diff.new_traps) or 'none'}",
        ]
    lines += ["", f"rerun: {d.rerun}"]
    return "\n".join(lines)

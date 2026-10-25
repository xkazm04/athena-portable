"""Each forge finding is a reviewable dossier, and ``forge show`` opens one (README §14).

One test per acceptance case of the card: the entry's row, label, auditor's why and state; what
the bench filed; the rerun command on a materialised work copy; the review before the audit; the
diff against the base; the ``show`` stage; and the report's findings carrying table, row and rerun.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from athena.proving.forge.__main__ import main
from athena.proving.forge.audit import audit_items
from athena.proving.forge.base import Base, find_rows, materialize
from athena.proving.forge.dossier import dossier, rerun_command
from athena.proving.forge.dry import dry_bench, mutate
from athena.proving.forge.runner import trim
from athena.proving.forge.store import ForgeDir, VariantRecord
from athena.proving.playbooks.bench import BenchConfig, score, verdict
from athena.proving.playbooks.spec import _norm, load_playbook

TODAY = "2026-11-02"


def make_variant(base: Base, k: int = 1) -> VariantRecord:
    body = mutate(base, k)
    body["world"]["today"] = TODAY
    return VariantRecord(
        playbook=base.id,
        k=k,
        generator="nemotron",
        model="scripted",
        valid=True,
        world=body["world"],
        truth=body["truth"],
    )


def two_traps(v: VariantRecord) -> list[tuple[str, str, str]]:
    assert v.truth is not None
    found = [
        (target["tool"], target["key"], key)
        for target in v.truth["targets"]
        for key in target.get("traps", {})
    ]
    assert len(found) >= 2, "the variant has two traps"
    return found[:2]


def bench_it(store: ForgeDir, base: Base, v: VariantRecord, *, trap: bool = True) -> dict[str, Any]:
    """The dry bench of ``v`` (one eligible in four missed), plus a card filed on two traps."""
    assert v.world is not None and v.truth is not None
    book = materialize(base, v.world, v.truth, store.work / f"{v.playbook}-v{v.k}")
    report = dry_bench(book, BenchConfig())
    cards = list(report["cards"])
    if trap:
        for tool, param, key in two_traps(v):
            cards.append({"action": f"host.dry.{tool}", "params": {param: key, "note": "filed"}})
    report["cards"] = cards
    report["score"] = score(book, cards)
    report["verdict"] = verdict(book, report)
    kept = trim(report)
    ForgeDir.write(store.bench_path(v), kept)
    return kept


def audit_it(store: ForgeDir, v: VariantRecord, report: dict[str, Any]) -> list[dict[str, Any]]:
    """An audit file whose items hold, fail and come back unusable in turn."""
    assert v.truth is not None
    items = audit_items(v.truth, report)
    out: list[dict[str, Any]] = []
    for n, item in enumerate(items):
        if n % 3 == 0:
            item.label_holds, item.why = True, f"holds {item.key}"
        elif n % 3 == 1:
            item.label_holds, item.why = False, f"fails {item.key}"
        else:
            item.note = "unusable audit answer"
        out.append(item.__dict__)
    ForgeDir.write(store.audit_path(v), {"playbook": v.playbook, "k": v.k, "items": out})
    return out


@pytest.fixture
def store(tmp_path: Path) -> ForgeDir:
    return ForgeDir(tmp_path / "run")


def test_an_audited_variant_has_one_entry_per_item_with_its_row_label_why_and_state(
    store: ForgeDir, base: Base
) -> None:
    v = make_variant(base)
    report = bench_it(store, base, v)
    items = audit_it(store, v, report)
    d = dossier(store, base, v)
    assert d.audited and len(d.entries) == len(items) >= 3
    states = {True: "finding", False: "forge-error", None: "unaudited"}
    assert v.world is not None
    for entry, item in zip(d.entries, items, strict=True):
        table, row = find_rows(v.world, item["key"])[0]
        assert (entry.kind, entry.tool, entry.key) == (item["kind"], item["tool"], item["key"])
        assert entry.table == table and entry.row == dict(row)
        assert entry.label == item["label"]
        assert entry.why == (item["why"] or item["note"])
        assert entry.state == states[item["label_holds"]]


def test_a_filed_trap_lists_its_cards_and_a_miss_counts_the_cards_on_its_tool(
    store: ForgeDir, base: Base
) -> None:
    v = make_variant(base)
    report = bench_it(store, base, v)
    audit_it(store, v, report)
    d = dossier(store, base, v)
    filed = [e for e in d.entries if e.kind == "trap_filed"]
    assert [(e.tool, e.key) for e in filed] == [(t, _norm(k)) for t, _p, k in two_traps(v)]
    for e in filed:
        assert len(e.filed) == 1 and e.cards_on_tool is None
        assert e.filed[0]["params"]["note"] == "filed" and _norm(e.filed[0]["key"]) == e.key
    misses = [e for e in d.entries if e.kind == "miss"]
    assert misses
    for e in misses:
        assert e.filed == []
        on_tool = sum(1 for c in report["score"]["cards"] if c.get("action") == e.tool)
        assert e.cards_on_tool == on_tool


def test_the_rerun_command_benches_the_materialised_work_copy(store: ForgeDir, base: Base) -> None:
    v = make_variant(base, 2)
    bench_it(store, base, v)
    work = store.work / f"{base.id}-v2"
    for path in sorted(work.rglob("*"), reverse=True):  # absent: dossier() must materialise it
        path.unlink() if path.is_file() else path.rmdir()
    d = dossier(store, base, v)
    assert d.rerun == (
        f"uv run python -m athena.proving.playbooks --dir {work.as_posix()} "
        f"bench {base.id} --no-write --runs 3"
    )
    assert rerun_command(store, v) == d.rerun
    assert (work / base.id / "world.json").is_file()
    # The playbooks CLI loads `--dir`/<pid> with the taxonomy beside it: the command must load.
    assert load_playbook(work / base.id).id == base.id


def test_a_benched_variant_before_its_audit_lists_misses_and_filed_traps_unaudited(
    store: ForgeDir, base: Base
) -> None:
    v = make_variant(base)
    report = bench_it(store, base, v)
    assert v.truth is not None
    expected = audit_items(v.truth, report)
    d = dossier(store, base, v)
    assert not d.audited and d.benched
    assert [(e.kind, e.key) for e in d.entries] == [(i.kind, i.key) for i in expected]
    assert {e.state for e in d.entries} == {"unaudited"}
    assert all(e.table and e.row for e in d.entries)


def test_the_diff_names_today_rows_per_table_and_the_new_trap_ids(
    store: ForgeDir, base: Base
) -> None:
    v = make_variant(base)
    bench_it(store, base, v)
    d = dossier(store, base, v)
    assert d.diff.today == (base.world["today"], TODAY)
    assert v.world is not None
    for table, rows in base.world["tables"].items():
        assert d.diff.rows[table] == (len(rows), len(v.world["tables"][table]))
    assert any(b != a for b, a in d.diff.rows.values())  # mutate clones two trap rows
    base_ids = {
        _norm(k)
        for t in base.truth["targets"]
        for part in ("eligible", "traps", "neutral")
        for k in t.get(part, {})
    }
    new = [
        _norm(k)
        for t in v.truth["targets"]
        for k in t.get("traps", {})  # type: ignore[index]
    ]
    assert d.diff.new_traps == sorted(k for k in new if k not in base_ids)
    assert d.diff.new_traps


@pytest.fixture(scope="module")
def dry_run(library: Path, tmp_path_factory: pytest.TempPathFactory) -> Path:
    out = tmp_path_factory.mktemp("forge-show")
    assert main(["all", "--dry", "--n", "2", "--out", str(out), "--library", str(library)]) == 0
    return next(p for p in out.iterdir() if p.is_dir())


def test_show_prints_one_variants_dossier_and_refuses_an_unknown_name(
    dry_run: Path,
    library: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.chdir(library.parent)  # the default --library, as an operator types it
    audit = sorted((dry_run / "forge" / "audit").glob("*.json"))[0]
    name = audit.stem
    items = json.loads(audit.read_text(encoding="utf-8"))["items"]
    capsys.readouterr()
    assert main(["show", "--run-dir", str(dry_run), name]) == 0
    out = capsys.readouterr().out
    assert items
    for item in items:
        assert item["key"] in out and item["label"] in out
        assert (item["why"] or item["note"]) in out
    assert "--no-write --runs 3" in out and f"forge/work/{name}" in out
    assert main(["show", "--run-dir", str(dry_run), "nope-v9"]) == 2
    err = capsys.readouterr().err
    assert "no variant nope-v9; known: " in err and name in err


def test_report_findings_carry_table_row_and_rerun_and_the_md_has_a_review(
    dry_run: Path,
) -> None:
    report = json.loads((dry_run / "forge" / "report.json").read_text(encoding="utf-8"))
    entries = report["athena_findings"] + report["forge_errors"]
    assert entries
    for e in entries:
        assert e["table"] and isinstance(e["row"], dict) and e["row"]
        assert e["rerun"].endswith(f"bench {e['playbook']} --no-write --runs 3")
    md = (dry_run / "forge" / "report.md").read_text(encoding="utf-8")
    review = md.split("## Review", 1)[1]
    assert review.count("\n### ") == len(entries)

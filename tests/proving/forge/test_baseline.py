"""A forge flip is judged against the base's comparable runs, not its latest draw (ADR 0128).

Each test is one acceptance case of the card: the baseline's pooled word and n, a base benched
under another key or another instrument, the recall drop measured from the base's minimum, and
proof-2 saying n-a when no benched variant stands on a comparable base.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from athena.proving.forge.base import baseline, load_base
from athena.proving.forge.forge import Variant
from athena.proving.forge.report import build_report
from athena.proving.forge.store import ForgeDir
from athena.proving.playbooks.bench import BenchConfig, comparability_key, content_digest

Run = tuple[str, float]


def keyed_playbook(
    library: Path,
    pid: str,
    runs: Sequence[Run],
    *,
    approve: str = "none",
    key: str | None = None,
) -> Path:
    """A playbook whose bench holds ``runs`` (latest first) under one comparability key.

    The key is the one a run benched today with claude_code/sonnet/``approve`` would carry,
    unless ``key`` names another (a base measured against files that changed since).
    """
    root = library / pid
    root.mkdir(parents=True)
    (root / "playbook.json").write_text(json.dumps({"id": pid, "category": f"area-{pid}"}))
    (root / "world.json").write_text(json.dumps({"tables": {"rows": [{"id": pid}]}}))
    (root / "truth.json").write_text(json.dumps({"targets": []}))
    k = key or comparability_key(content_digest(root), "claude_code", "sonnet", approve)
    (latest_word, latest_recall), earlier = runs[0], runs[1:]
    bench: dict[str, Any] = {
        "run_at": "2026-10-20T00:00:00Z",
        "engine": "claude_code",
        "model": "sonnet",
        "approve": approve,
        "comparable": k,
        "verdict": {"word": latest_word},
        "score": {"recall_value": latest_recall},
        "history": [
            {
                "run_at": f"2026-10-{10 + i:02d}T00:00:00Z",
                "comparable": k,
                "verdict": word,
                "recall_value": recall,
            }
            for i, (word, recall) in enumerate(earlier)
        ],
    }
    (root / "bench.json").write_text(json.dumps(bench))
    return root


def forge_run(
    tmp: Path,
    library: Path,
    pid: str,
    *,
    word: str,
    recall: float,
    audited: tuple[str, float] | None = None,
    config: BenchConfig | None = None,
) -> dict[str, Any]:
    """The report of a run that benched (and maybe audited) one variant of ``pid``."""
    store = ForgeDir(tmp / "run")
    v = Variant(pid, 1, "nemotron", "scripted", True, world={}, truth={})
    store.save_variant(v)
    ForgeDir.write(
        store.bench_path(v), {"verdict": {"word": word}, "score": {"recall_value": recall}}
    )
    if audited is not None:
        ForgeDir.write(
            store.audit_path(v),
            {
                "items": [{"kind": "miss", "key": "x", "label_holds": True, "why": "held"}],
                "corrected": {"word": audited[0], "recall_value": audited[1]},
            },
        )
    return build_report(
        store,
        {pid: load_base(library, pid)},
        run_id="t",
        seed=11,
        n=1,
        rung="lightning",
        dry=True,
        picks={"ids": [pid]},
        models={},
        config=config,
    )


def variant_row(report: dict[str, Any]) -> dict[str, Any]:
    row: dict[str, Any] = report["playbooks"][0]["variants"][0]
    return row


def proof_2(report: dict[str, Any]) -> dict[str, Any]:
    return next(p for p in report["proof"] if p["id"] == "proof-2")


# --- case 1 ------------------------------------------------------------------------------------


def test_a_latest_exceeds_short_in_half_its_comparable_runs_is_short_and_no_flip(
    tmp_path: Path,
) -> None:
    lib = tmp_path / "lib"
    runs = [("exceeds", 0.9), ("short", 0.72), ("exceeds", 1.0), ("short", 0.72)]
    keyed_playbook(lib, "pb", runs)
    bl = baseline(load_base(lib, "pb"))
    assert bl.comparable and bl.word == "short" and bl.n == 4
    report = forge_run(tmp_path, lib, "pb", word="short", recall=0.5, audited=("short", 0.5))
    row = variant_row(report)
    assert row["raw_flip"] is False
    assert row["audited"]["flip"] is False
    assert report["flips"]["raw_exceeds_to_short"] == 0
    assert report["flips"]["audited_exceeds_to_short"] == 0


# --- case 2 ------------------------------------------------------------------------------------


def test_a_base_benched_under_another_key_is_not_comparable_and_counts_nowhere(
    tmp_path: Path,
) -> None:
    lib = tmp_path / "lib"
    keyed_playbook(lib, "pb", [("exceeds", 1.0)], key="sha256:0000000000000000")
    bl = baseline(load_base(lib, "pb"))
    assert bl.comparable is False and bl.reason.startswith("no comparable run")
    report = forge_run(tmp_path, lib, "pb", word="short", recall=0.1, audited=("short", 0.1))
    row = variant_row(report)
    assert row["baseline"]["comparable"] is False
    assert row["baseline"]["reason"].startswith("no comparable run")
    assert "raw_flip" not in row
    assert "flip" not in row["audited"] and "recall_drop" not in row["audited"]
    assert report["flips"]["raw_exceeds_to_short"] == 0
    assert report["flips"]["audited_exceeds_to_short"] == 0
    assert report["flips"]["recall_drops_ge_0_2"] == 0
    assert report["flips"]["n_variants_comparable"] == 0


# --- case 3 ------------------------------------------------------------------------------------


def test_a_recall_drop_is_measured_from_the_bases_minimum_comparable_recall(
    tmp_path: Path,
) -> None:
    lib = tmp_path / "lib"
    keyed_playbook(lib, "pb", [("exceeds", 1.0), ("exceeds", 0.2), ("exceeds", 0.9)])
    bl = baseline(load_base(lib, "pb"))
    assert bl.recall_min == 0.2 and bl.recall_median == 0.9
    report = forge_run(tmp_path, lib, "pb", word="meets", recall=0.7, audited=("meets", 0.7))
    assert variant_row(report)["audited"]["recall_drop"] == -0.5
    assert report["flips"]["recall_drops_ge_0_2"] == 0


# --- case 4 ------------------------------------------------------------------------------------


def test_a_drop_below_a_steady_base_counts_and_the_row_carries_its_baseline(
    tmp_path: Path,
) -> None:
    lib = tmp_path / "lib"
    keyed_playbook(lib, "pb", [("exceeds", 1.0), ("exceeds", 1.0), ("exceeds", 1.0)])
    report = forge_run(tmp_path, lib, "pb", word="meets", recall=0.7, audited=("meets", 0.7))
    row = variant_row(report)
    assert row["audited"]["recall_drop"] == 0.3
    assert report["flips"]["recall_drops_ge_0_2"] == 1
    assert row["baseline"] == {
        "comparable": True,
        "n": 3,
        "word": "exceeds",
        "recall_median": 1.0,
        "recall_min": 1.0,
    }


# --- case 5 ------------------------------------------------------------------------------------


def test_another_approval_mode_is_another_instrument(tmp_path: Path) -> None:
    lib = tmp_path / "lib"
    keyed_playbook(lib, "pb", [("exceeds", 1.0), ("exceeds", 1.0)], approve="none")
    assert baseline(load_base(lib, "pb"), BenchConfig()).comparable is True
    assert baseline(load_base(lib, "pb"), BenchConfig(approve="all")).comparable is False


# --- case 6 ------------------------------------------------------------------------------------


def test_proof_2_is_n_a_with_no_comparable_base_and_names_its_smallest_n_on_pass(
    tmp_path: Path,
) -> None:
    lib = tmp_path / "lib"
    keyed_playbook(lib, "stale", [("exceeds", 1.0)], key="sha256:0000000000000000")
    report = forge_run(tmp_path / "a", lib, "stale", word="short", recall=0.1, audited=("short", 0))
    p2 = proof_2(report)
    assert p2["status"] == "n-a"
    assert "1 base" in p2["detail"] and "comparable" in p2["detail"]

    keyed_playbook(lib, "steady", [("exceeds", 1.0), ("exceeds", 1.0), ("exceeds", 0.95)])
    report = forge_run(
        tmp_path / "b", lib, "steady", word="short", recall=0.1, audited=("short", 0)
    )
    p2 = proof_2(report)
    assert p2["status"] == "PASS"
    assert "n=3" in p2["detail"]

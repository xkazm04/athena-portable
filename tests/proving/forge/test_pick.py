"""pick: 4 short + 4 exceeds, distinct areas, deterministic; short scarcity is announced."""

from __future__ import annotations

import json
from pathlib import Path

from athena.proving.forge.pick import pick, pick_detail


def make_library(root: Path, shorts: int, exceeds: int, areas: int = 12) -> Path:
    for i in range(shorts + exceeds):
        word = "short" if i < shorts else "exceeds"
        d = root / f"pb-{i:02d}"
        d.mkdir()
        (d / "playbook.json").write_text(
            json.dumps({"id": d.name, "category": f"area-{i % areas}"})
        )
        (d / "bench.json").write_text(json.dumps({"verdict": {"word": word}}))
    return root


def category(root: Path, pid: str) -> str:
    return str(json.loads((root / pid / "playbook.json").read_text())["category"])


def test_four_short_and_four_exceeds_in_distinct_areas(tmp_path: Path) -> None:
    root = make_library(tmp_path, shorts=6, exceeds=20)
    picks = pick_detail(root, seed=3)
    assert len(picks.ids) == 8 and len(picks.shorts) == 4 and picks.notes == []
    assert len({category(root, p) for p in picks.ids}) == 8
    assert picks.ids == sorted(picks.ids)


def test_deterministic_for_a_seed_and_varied_across_seeds(tmp_path: Path) -> None:
    root = make_library(tmp_path, shorts=8, exceeds=40, areas=40)
    assert pick(root, 11) == pick(root, 11)
    assert any(pick(root, s) != pick(root, 11) for s in range(12, 20))


def test_fewer_than_four_shorts_takes_all_and_fills_with_exceeds(tmp_path: Path) -> None:
    root = make_library(tmp_path, shorts=3, exceeds=20)
    picks = pick_detail(root)
    assert len(picks.ids) == 8 and len(picks.shorts) == 3
    assert any("only 3 short" in n for n in picks.notes)


def test_the_real_library_picks_eight(library: Path) -> None:
    picks = pick_detail(library)
    assert len(picks.ids) == 8
    assert set(picks.shorts) <= set(picks.ids)


def test_pick_draws_by_the_pooled_word_and_leaves_out_bases_with_no_comparable_run(
    tmp_path: Path,
) -> None:
    from .test_baseline import keyed_playbook

    root = make_library(tmp_path, shorts=0, exceeds=10)
    runs = [("exceeds", 0.9), ("short", 0.7), ("exceeds", 1.0), ("short", 0.7)]
    keyed_playbook(root, "noisy", runs)
    keyed_playbook(root, "stale", [("short", 0.1)], key="sha256:0000000000000000")
    picks = pick_detail(root)
    assert "noisy" in picks.shorts
    assert "stale" not in picks.ids
    left_out = [n for n in picks.notes if "no comparable run" in n]
    assert left_out and "1 playbook" in left_out[0] and "claude_code/sonnet/none" in left_out[0]

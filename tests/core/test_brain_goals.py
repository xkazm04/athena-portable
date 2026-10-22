"""``Brain.write_goal``: the five-key header, a rewrite in place, rebuild parity (ADR 0123)."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from athena.contracts.ids import mint
from athena.core.brain import Brain, index_fingerprint, reconcile_from_disk


def test_a_goal_is_five_keys_and_its_body(tmp_path: Path) -> None:
    goal_id = mint("project")
    with Brain(tmp_path / "brain") as brain:
        ref = brain.write_goal(
            goal_id,
            "Late deposits repaid",
            "the body\n",
            session_id=f"conv_{goal_id}",
            created="2026-10-22T10:00:00+00:00",
        )
        assert ref.path == f"goals/{goal_id}.md"
        text = (brain.root / ref.path).read_text(encoding="utf-8")
        assert text == (
            f'---\nid: "{goal_id}"\ntype: goal\ntitle: "Late deposits repaid"\n'
            f'session: "conv_{goal_id}"\ncreated: "2026-10-22T10:00:00+00:00"\n---\n\nthe body\n'
        )
        assert [g.id for g in brain.goals()] == [goal_id]
        assert brain.read_body(goal_id) == "the body"


def test_a_rewrite_keeps_one_row_and_the_new_body(tmp_path: Path) -> None:
    goal_id = mint("project")
    with Brain(tmp_path / "brain") as brain:
        for body in ("first", "second"):
            brain.write_goal(goal_id, "T", body, session_id="conv_x", created="2026-01-01")
        assert len(brain.goals()) == 1
        assert brain.read_body(goal_id) == "second"


def test_a_goal_id_is_a_project_id(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain") as brain:
        for bad in ("../escape", "proj_nothex", "fact_0123456789ab"):
            with pytest.raises(ValueError):
                brain.write_goal(bad, "T", "body", session_id="conv_x", created="2026-01-01")
        with pytest.raises(ValueError):
            brain.write_goal(mint("project"), "T", "  ", session_id="conv_x", created="x")


def test_a_rebuild_from_disk_gives_the_goal_row_the_writer_gave(tmp_path: Path) -> None:
    original = tmp_path / "brain"
    with Brain(original) as brain:
        brain.append_episode("an approval", role="user")
        brain.write_goal(mint("project"), "T", "body", session_id="conv_x", created="2026-01-01")
        expected = index_fingerprint(brain)
    copied = tmp_path / "copied"
    shutil.copytree(original, copied, ignore=shutil.ignore_patterns("index.sqlite*"))
    with Brain(copied) as rebuilt:
        stats = reconcile_from_disk(rebuilt)
        assert stats.by_kind == {"episode": 1, "goal": 1}
        assert index_fingerprint(rebuilt) == expected

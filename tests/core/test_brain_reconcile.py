"""A brain is portable by copying the directory (README §2 invariant 1, ADR 0003).

The load-bearing test is the first one: copy the markdown tree, leave the index behind, rebuild,
and the row sets are identical. If that ever fails, "SQLite is a rebuildable index" is a claim and
not a fact, and the brain has silently become the database.
"""

from __future__ import annotations

import shutil
from pathlib import Path

from athena.core.brain import Brain, index_fingerprint, reconcile_from_disk


def _populate(brain: Brain) -> None:
    first = brain.append_episode("Acme paid 34 days late again", role="user")
    second = brain.append_episode("I will chase them on Monday", role="assistant")
    brain.append_episode("fleet-event worker 3 restarted", role="system")
    brain.write_fact(
        "acme pays late",
        "Acme has paid late three quarters running",
        scope="user",
        sources=[first.id],
    )
    brain.write_fact(
        "invoicing app is Fakturoid",
        "the invoices live in the invoicing app, not the CRM",
        scope="world",
        sources=[first.id, second.id],
    )
    brain.write_procedural(
        "when a payment is proposed",
        "always raise a card; never auto-approve",
        scope="action",
        sources=[second.id],
    )


def _copy_tree_without_the_index(source: Path, target: Path) -> None:
    shutil.copytree(source, target, ignore=shutil.ignore_patterns("index.sqlite*"))


def test_a_copied_brain_rebuilds_an_identical_index(tmp_path: Path) -> None:
    original = tmp_path / "brain"
    with Brain(original) as brain:
        _populate(brain)
        expected = index_fingerprint(brain)

    copied = tmp_path / "copied-brain"
    _copy_tree_without_the_index(original, copied)
    assert not (copied / "index.sqlite").exists()

    with Brain(copied) as rebuilt:
        assert index_fingerprint(rebuilt) == [], "a copied tree starts with no index"

        stats = reconcile_from_disk(rebuilt)

        assert stats.files == 6
        assert stats.by_kind == {"episode": 3, "fact": 2, "procedural": 1}
        assert stats.skipped == []
        actual = index_fingerprint(rebuilt)

    assert set(actual) == set(expected)
    assert actual == expected


def test_reconciling_twice_is_idempotent(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain") as brain:
        _populate(brain)
        once = reconcile_from_disk(brain)
        first = index_fingerprint(brain)
        twice = reconcile_from_disk(brain)

        assert once.as_dict() == twice.as_dict()
        assert index_fingerprint(brain) == first


def test_a_reconcile_drops_the_row_of_a_file_that_is_gone(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain") as brain:
        _populate(brain)
        doomed = brain.append_episode("this file will be deleted by hand", role="user")
        (brain.root / doomed.path).unlink()

        reconcile_from_disk(brain)

        assert brain.node(doomed.id) is None


def test_a_file_with_no_id_and_a_duplicate_id_are_named_not_swallowed(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain") as brain:
        episode = brain.append_episode("the only real memory", role="user")
        (brain.root / "goals" / "headless.md").write_text(
            "no frontmatter at all\n", encoding="utf-8", newline="\n"
        )
        twin = brain.root / "reflections" / "twin.md"
        twin.write_text(
            (brain.root / episode.path).read_text(encoding="utf-8"), encoding="utf-8", newline="\n"
        )

        stats = reconcile_from_disk(brain)

        assert stats.files == 1
        assert "goals/headless.md: no id in frontmatter" in stats.skipped
        assert f"reflections/twin.md: duplicate id {episode.id}" in stats.skipped
        # The original file kept its row; the twin did not displace it.
        node = brain.node(episode.id)
        assert node is not None and node.file_path == episode.path


def test_a_reconcile_leaves_runtime_state_alone(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain", session_id="sess-42") as brain:
        _populate(brain)

        reconcile_from_disk(brain)

        row = brain.writer.execute(
            "SELECT id FROM companion_session WHERE id = ?", ("sess-42",)
        ).fetchone()
        assert row == ("sess-42",)

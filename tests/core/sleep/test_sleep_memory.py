"""Supersedence, retirement and fade, as the brain stores them and recall serves them (ADR 0143)."""

from __future__ import annotations

import shutil
from contextlib import closing
from pathlib import Path

import pytest

from athena.core.brain import Brain, frontmatter, index_fingerprint, reconcile_from_disk
from athena.core.recall import ALWAYS_BLOCK, KEYWORD_BLOCK, recall

from .conftest import write_episodes


def _ids(brain: Brain, query: str) -> list[str]:
    return [memory.id for memory in recall(brain, query).items if memory.kind == "fact"]


def test_supersede_hides_the_old_fact_and_survives_a_rebuild(tmp_path: Path) -> None:
    original = tmp_path / "brain"
    with Brain(original) as brain:
        (episode,) = write_episodes(brain, 1)
        old = brain.write_fact("user employer", "The user works at Beta.", sources=[episode])
        new = brain.write_fact(
            "user employer", "The user works at Acme.", sources=[episode], supersedes=[old.id]
        )
        assert _ids(brain, "user works employer") == [new.id]
        meta, _ = frontmatter.parse((original / new.path).read_text(encoding="utf-8"))
        assert meta["supersedes"] == [old.id]
        assert list(meta) == [
            "id",
            "type",
            "scope",
            "key",
            "confidence",
            "created",
            "sources",
            "supersedes",
        ]
        assert brain.node(old.id) is not None, "the closed belief keeps its file and its row"
        expected = index_fingerprint(brain)
        assert ("supersede", new.id, old.id) in expected

        reconcile_from_disk(brain)
        assert index_fingerprint(brain) == expected
        assert _ids(brain, "user works employer") == [new.id]

    copied = tmp_path / "copied"
    shutil.copytree(original, copied, ignore=shutil.ignore_patterns("index.sqlite*"))
    with Brain(copied) as rebuilt:
        reconcile_from_disk(rebuilt)
        assert index_fingerprint(rebuilt) == expected
        assert _ids(rebuilt, "user works employer") == [new.id]


def test_a_retired_fact_is_hidden_and_stays_hidden(brain: Brain) -> None:
    (episode,) = write_episodes(brain, 1)
    gone = brain.write_fact("secret plan", "The plan is retired.", sources=[episode], retired=True)
    node = brain.node(gone.id)
    assert node is not None and node.importance == 0
    meta, _ = frontmatter.parse((brain.root / gone.path).read_text(encoding="utf-8"))
    assert meta["retired"] is True
    assert _ids(brain, "plan retired") == []
    reconcile_from_disk(brain)
    node = brain.node(gone.id)
    assert node is not None and node.importance == 0
    with pytest.raises(ValueError, match="every turn"):
        brain.write_fact("x", "y", sources=[episode], retired=True, every_turn=True)


def test_a_header_without_lineage_is_the_bytes_it_was(brain: Brain) -> None:
    (episode,) = write_episodes(brain, 1)
    plain = brain.write_fact("k", "v", sources=[episode])
    meta, _ = frontmatter.parse((brain.root / plain.path).read_text(encoding="utf-8"))
    assert "supersedes" not in meta and "retired" not in meta
    closing_one = brain.write_procedural(
        "when x", "do y", sources=[episode], supersedes=[], retired=False
    )
    meta, _ = frontmatter.parse((brain.root / closing_one.path).read_text(encoding="utf-8"))
    assert list(meta) == [
        "id",
        "type",
        "scope",
        "trigger",
        "confidence",
        "created",
        "sources",
        "device",
    ]


def test_supersedes_must_name_a_memory_this_brain_holds(brain: Brain) -> None:
    (episode,) = write_episodes(brain, 1)
    with pytest.raises(ValueError, match="does not hold"):
        brain.write_fact("k", "v", sources=[episode], supersedes=["fact_ffffffffffff"])
    with pytest.raises(ValueError, match="not facts or procedurals"):
        brain.write_fact("k", "v", sources=[episode], supersedes=[episode])
    assert brain.counts().get("fact", 0) == 0, "refused before the file was written"


def test_a_faded_memory_ranks_lower_and_is_still_recalled(brain: Brain) -> None:
    (episode,) = write_episodes(brain, 1)
    faded = brain.write_fact(
        "invoice rule one", "invoice reminders go out monthly", sources=[episode]
    )
    fresh = brain.write_fact(
        "invoice rule two", "invoice reminders go out weekly", sources=[episode]
    )
    with brain.write_txn() as con:
        con.execute(
            "INSERT INTO companion_fade (node_id, steps, at) VALUES (?, 2, '2026-01-01')",
            (faded.id,),
        )
    trace = recall(brain, "invoice reminders monthly")
    keyword = [memory.id for memory in trace.block(KEYWORD_BLOCK).items]
    assert keyword == [fresh.id, faded.id], "a fade never hides, it ranks lower"

    # That recall showed both, so both are marked used and the fade row is gone.
    with closing(brain.read_connection()) as con:
        seen = dict(con.execute("SELECT node_id, hits FROM companion_recall_seen").fetchall())
        fades = con.execute("SELECT COUNT(*) FROM companion_fade").fetchone()[0]
    assert seen == {faded.id: 1, fresh.id: 1}
    assert fades == 0
    recall(brain, "invoice reminders")
    with closing(brain.read_connection()) as con:
        hits = con.execute(
            "SELECT hits FROM companion_recall_seen WHERE node_id = ?", (fresh.id,)
        ).fetchone()[0]
    assert hits == 2


def test_the_always_tier_ranks_by_importance_less_fade(brain: Brain) -> None:
    (episode,) = write_episodes(brain, 1)
    first = brain.write_fact("a", "always one", sources=[episode], every_turn=True)
    second = brain.write_fact("b", "always two", sources=[episode], every_turn=True)
    with brain.write_txn() as con:
        con.execute(
            "INSERT INTO companion_fade (node_id, steps, at) VALUES (?, 1, '2026-01-01')",
            (second.id,),
        )
    always = [m.id for m in recall(brain, "", include_always=True).block(ALWAYS_BLOCK).items]
    assert always == [first.id, second.id]


def test_a_recall_mark_lets_go_when_the_writer_is_busy(brain: Brain) -> None:
    import threading

    (episode,) = write_episodes(brain, 1)
    fact = brain.write_fact("busy", "busy writer fact", sources=[episode])
    answers: list[bool] = []
    with brain.write_txn():
        worker = threading.Thread(target=lambda: answers.append(brain.note_recalled([fact.id])))
        worker.start()
        worker.join(5)
    assert answers == [False]

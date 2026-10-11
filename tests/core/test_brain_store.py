"""Writing a memory: disk first, provenance enforced (README §2 invariants 1 and 2)."""

from __future__ import annotations

import math
import sqlite3
from contextlib import closing
from pathlib import Path
from types import SimpleNamespace
from typing import cast

import pytest

from athena.contracts import ids
from athena.core.brain import Brain, ProvenanceError, frontmatter
from athena.core.brain.frontmatter import FrontmatterError
from athena.core.brain.reconcile import index_fingerprint, reconcile_from_disk
from athena.core.brain.schema import SCHEMA_VERSION
from athena.core.brain.store import ALWAYS_IMPORTANCE, DEFAULT_IMPORTANCE
from athena.core.recall import recall


def test_an_episode_lands_on_disk_with_the_header_ref_8_fixes(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain", session_id="sess-1") as brain:
        ref = brain.append_episode("the invoice for Acme is 34 days late", role="user")

        assert ids.is_id("episode", ref.id)
        assert ref.path.startswith("episodes/")
        assert ref.path.endswith(f"{ref.id}_user.md")
        lines = (brain.root / ref.path).read_text(encoding="utf-8").splitlines()
        # Key order is the format, not a preference: ref §8 fixes id, type, role, session, created.
        assert lines[:5] == [
            "---",
            f'id: "{ref.id}"',
            "type: episode",
            "role: user",
            'session: "sess-1"',
        ]
        assert lines[5].startswith('created: "')
        assert lines[6] == "---"
        assert brain.read_body(ref.id) == "the invoice for Acme is 34 days late"


def test_an_empty_episode_and_an_unknown_role_are_refused(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain") as brain:
        with pytest.raises(ValueError, match="empty episode"):
            brain.append_episode("   ")
        with pytest.raises(ValueError, match="role"):
            brain.append_episode("something", role="narrator")


def test_a_machine_episode_is_written_at_importance_one(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain") as brain:
        chatter = brain.append_episode("fleet-event worker 3 restarted", role="system")
        spoken = brain.append_episode("chase the Acme invoice", role="user")

        machine = brain.node(chatter.id)
        human = brain.node(spoken.id)
        assert machine is not None and machine.importance == 1 and machine.machine
        assert human is not None and human.importance == 3 and not human.machine


def test_a_fact_citing_a_live_episode_is_written_with_its_provenance(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain") as brain:
        episode = brain.append_episode("Acme paid 34 days late again", role="user")

        fact = brain.write_fact(
            "acme pays late", "Acme has paid late three quarters running", sources=[episode.id]
        )

        assert fact.path == f"semantic/user/{fact.id}_acme-pays-late.md"
        assert brain.sources_of(fact.id) == [episode.id]
        text = (brain.root / fact.path).read_text(encoding="utf-8")
        assert f'  - "{episode.id}"' in text


def test_provenance_refuses_a_dead_source(tmp_path: Path) -> None:
    """The invariant with no bypass: a source that is not a live episode of *this* brain."""
    with Brain(tmp_path / "brain") as brain, Brain(tmp_path / "other") as elsewhere:
        live = brain.append_episode("said here", role="user")
        foreign = elsewhere.append_episode("said in another brain", role="user")
        never_written = ids.mint("episode")

        with pytest.raises(ProvenanceError, match="not live episodes"):
            brain.write_fact("k", "v", sources=[never_written])
        with pytest.raises(ProvenanceError, match="not live episodes"):
            brain.write_fact("k", "v", sources=[foreign.id])
        with pytest.raises(ProvenanceError, match="not live episodes"):
            brain.write_fact("k", "v", sources=[live.id, never_written])
        with pytest.raises(ProvenanceError, match="at least one"):
            brain.write_procedural("when asked", "do this", sources=[])
        with pytest.raises(ProvenanceError, match="not episode ids"):
            brain.write_fact("k", "v", sources=["fact_0123456789ab"])

        assert brain.counts().get("fact") is None
        assert not list((brain.root / "semantic" / "user").glob("*.md"))


def test_a_demoted_episode_is_no_longer_a_live_source(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain") as brain:
        episode = brain.append_episode("forgotten in time", role="user")
        with brain.write_txn() as con:
            con.execute("UPDATE companion_node SET importance = 0 WHERE id = ?", (episode.id,))

        with pytest.raises(ProvenanceError, match="not live episodes"):
            brain.write_fact("k", "v", sources=[episode.id])


def test_a_procedural_carries_its_trigger_and_scope(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain") as brain:
        episode = brain.append_episode("the user declined the payment card", role="user")

        proc = brain.write_procedural(
            "when a payment is proposed",
            "always raise a card, never auto-approve",
            scope="action",
            sources=[episode.id],
        )

        assert proc.path.startswith("procedurals/action/")
        row = brain.writer.execute(
            "SELECT scope, trigger_pattern FROM companion_procedural WHERE id = ?", (proc.id,)
        ).fetchone()
        assert row == ("action", "when a payment is proposed")


def test_an_unknown_scope_is_refused_before_anything_is_written(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain") as brain:
        episode = brain.append_episode("something", role="user")

        with pytest.raises(ValueError, match="fact scope"):
            brain.write_fact("k", "v", scope="galaxy", sources=[episode.id])
        with pytest.raises(ValueError, match="procedural scope"):
            brain.write_procedural("t", "b", scope="galaxy", sources=[episode.id])


def test_a_key_with_a_line_break_writes_neither_file_nor_row(tmp_path: Path) -> None:
    """Disk first means a refused header leaves the index exactly as it was."""
    with Brain(tmp_path / "brain") as brain:
        episode = brain.append_episode("something worth distilling", role="user")
        before = brain.counts()

        with pytest.raises(FrontmatterError, match="line break"):
            brain.write_fact('pays late"\nid: ep_00000000', "v", sources=[episode.id])

        assert brain.counts() == before
        assert not list((brain.root / "semantic" / "user").glob("*.md"))


def test_a_relative_brain_root_becomes_absolute_so_a_read_handle_can_be_opened(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``read_connection`` opens a ``file:`` URI, and ``Path.as_uri`` raises on a relative path.

    A daemon started with ``--brain demo-brain`` used to bind its socket and then fail every read
    route and every turn with a bare ``ValueError``, which is the worst shape a failure can take:
    after the ready line, and with nothing in it that names the cause.
    """
    monkeypatch.chdir(tmp_path)

    with Brain("demo-brain") as brain:
        assert brain.root.is_absolute()
        assert brain.root == tmp_path / "demo-brain"
        episode = brain.append_episode("said in a relative brain", role="user")

        with closing(brain.read_connection()) as con:
            assert con.execute("SELECT COUNT(*) FROM companion_node").fetchone()[0] == 1
        assert brain.counts() == {"episode": 1}
        assert brain.read_body(episode.id) == "said in a relative brain"


# -- every_turn: the always tier on disk (ADR 0071) --------------------------------------------


def _header(text: str) -> list[str]:
    lines = text.splitlines()
    return lines[: lines.index("---", 1) + 1]


def test_a_fact_without_every_turn_has_the_seven_keys_it_always_had(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain") as brain:
        episode = brain.append_episode("Acme paid 34 days late again", role="user")

        fact = brain.write_fact("acme pays late", "Acme pays late", sources=[episode.id])

        header = _header((brain.root / fact.path).read_text(encoding="utf-8"))
        assert [line.partition(":")[0] for line in header[1:-2]] == [
            "id",
            "type",
            "scope",
            "key",
            "confidence",
            "created",
            "sources",
        ]
        assert header[-2:] == [f'  - "{episode.id}"', "---"]
        node = brain.node(fact.id)
        assert node is not None and node.importance == DEFAULT_IMPORTANCE


def test_an_every_turn_fact_carries_one_more_key_last_and_the_always_importance(
    tmp_path: Path,
) -> None:
    with Brain(tmp_path / "brain") as brain:
        episode = brain.append_episode("Northwind paid 40 days late", role="user")

        plain = brain.write_fact("northwind", "Northwind pays late", sources=[episode.id])
        always = brain.write_fact(
            "northwind", "Northwind pays late", sources=[episode.id], every_turn=True
        )

        plain_header = _header((brain.root / plain.path).read_text(encoding="utf-8"))
        always_header = _header((brain.root / always.path).read_text(encoding="utf-8"))
        assert always_header[-2:] == ["every_turn: true", "---"]
        assert len(always_header) == len(plain_header) + 1
        meta, _ = frontmatter.parse((brain.root / always.path).read_text(encoding="utf-8"))
        assert meta["every_turn"] is True
        node = brain.node(always.id)
        assert node is not None and node.importance == ALWAYS_IMPORTANCE


def test_a_file_without_every_turn_round_trips_through_frontmatter_unchanged(
    tmp_path: Path,
) -> None:
    """``parse`` then ``render`` gives back the same bytes, and invents no ``every_turn`` key."""
    with Brain(tmp_path / "brain") as brain:
        episode = brain.append_episode("Acme paid 34 days late again", role="user")
        fact = brain.write_fact("acme pays late", "Acme pays late", sources=[episode.id])
        text = (brain.root / fact.path).read_text(encoding="utf-8")

        meta, body = frontmatter.parse(text)

        assert "every_turn" not in meta
        assert frontmatter.render(list(meta.items()), body) == text


# -- an FTS row is found by its rowid, the node's own (ADR 0077) --------------------------------


def _index(brain: Brain, node_id: str, body: str) -> None:
    with brain.write_txn() as con:
        brain.index_node(
            con,
            node_id=node_id,
            kind="episode",
            rel=f"episodes/{node_id}.md",
            file_text=body,
            body=body,
            importance=DEFAULT_IMPORTANCE,
            created_at="2026-10-11T09:00:00+00:00",
        )


def _steps_per_write(brain: Brain, start: int) -> float:
    """The mean SQLite VM steps of 20 index_node calls, each for a node not yet indexed."""
    steps = 0

    def count() -> int:
        nonlocal steps
        steps += 1
        return 0

    brain.writer.set_progress_handler(count, 1)
    try:
        for n in range(start, start + 20):
            _index(brain, f"ep_step{n:06d}", f"invoice {n} paid late")
    finally:
        brain.writer.set_progress_handler(None, 1)
    return steps / 20


def test_a_writes_cost_does_not_grow_with_the_brain(tmp_path: Path) -> None:
    """Counted in VM steps, not timed: the delete no longer scans the whole FTS index."""
    with Brain(tmp_path / "brain") as brain:
        with brain.write_txn() as con:
            for n in range(100):
                brain.index_node(
                    con,
                    node_id=f"ep_seed{n:06d}",
                    kind="episode",
                    rel=f"episodes/ep_seed{n:06d}.md",
                    file_text="x",
                    body=f"seed {n} invoice paid",
                    importance=DEFAULT_IMPORTANCE,
                    created_at="2026-10-11T09:00:00+00:00",
                )
        small = _steps_per_write(brain, 0)
        with brain.write_txn() as con:
            for n in range(100, 1980):  # 100 seeds, 20 measured, 1,880 more: 2,000
                brain.index_node(
                    con,
                    node_id=f"ep_seed{n:06d}",
                    kind="episode",
                    rel=f"episodes/ep_seed{n:06d}.md",
                    file_text="x",
                    body=f"seed {n} invoice paid",
                    importance=DEFAULT_IMPORTANCE,
                    created_at="2026-10-11T09:00:00+00:00",
                )
        large = _steps_per_write(brain, 100)

    assert large <= 2 * small, f"{small:.0f} steps a write at 100 nodes, {large:.0f} at 2,000"


def _fts_keys(db: Path) -> tuple[list[tuple[int, int]], int, str]:
    """(node rowid, FTS rowid) per FTS row, the FTS rows with no node, and the stamped version."""
    with closing(sqlite3.connect(str(db))) as con:
        pairs = con.execute(
            """SELECT n.rowid, f.rowid FROM companion_fts f
               JOIN companion_node n ON n.id = f.node_id ORDER BY n.rowid"""
        ).fetchall()
        (orphans,) = con.execute(
            """SELECT COUNT(*) FROM companion_fts
               WHERE node_id NOT IN (SELECT id FROM companion_node)"""
        ).fetchone()
        (version,) = con.execute(
            "SELECT value FROM companion_meta WHERE key = 'schema_version'"
        ).fetchone()
    return [(int(a), int(b)) for a, b in pairs], int(orphans), str(version)


def _recalled(brain: Brain) -> list[tuple[str, list[str]]]:
    trace = recall(brain, "duplex invoice")
    return [(block.name, [m.id for m in block.items]) for block in trace.blocks]


def test_a_version_1_index_is_rekeyed_by_node_rowid_when_opened(tmp_path: Path) -> None:
    root = tmp_path / "brain"
    with Brain(root) as brain:
        sources = [
            brain.append_episode(f"{'duplex ' * (n + 1)}invoice {n}", "user").id for n in range(6)
        ]
        brain.write_fact("duplex", "the duplex invoice is late", sources=sources[:1])
        brain.write_procedural("chase", "chase the duplex invoice", sources=sources[:1])
    db = root / "index.sqlite"
    # What a version-1 index looks like: FTS rowids of FTS5's own choosing, one row whose node is
    # gone, and the old stamp.
    with closing(sqlite3.connect(str(db), isolation_level=None)) as con:
        con.execute("BEGIN")
        con.execute(
            """CREATE TEMP TABLE shifted AS
               SELECT rowid + 1000 AS r, node_id, body, tags FROM companion_fts"""
        )
        con.execute("DELETE FROM companion_fts")
        con.execute(
            """INSERT INTO companion_fts (rowid, node_id, body, tags)
               SELECT r, node_id, body, tags FROM shifted"""
        )
        con.execute(
            """INSERT INTO companion_fts (rowid, node_id, body, tags)
               VALUES (9999, 'ep_gone0000', 'duplex invoice orphan', 'episode')"""
        )
        con.execute("UPDATE companion_meta SET value = '1' WHERE key = 'schema_version'")
        con.execute("COMMIT")
    pairs, orphans, version = _fts_keys(db)
    assert version == "1" and orphans == 1
    assert all(node != fts for node, fts in pairs)
    # Recall on the version-1 index, read as it is: nothing has opened a Brain on it yet.
    before = _recalled(
        cast(Brain, SimpleNamespace(read_connection=lambda: sqlite3.connect(str(db))))
    )

    with Brain(root) as brain:
        after = _recalled(brain)
        fingerprint = index_fingerprint(brain)
        reconcile_from_disk(brain)
        assert index_fingerprint(brain) == fingerprint, "the re-keyed index is the rebuilt one"

    pairs, orphans, version = _fts_keys(db)
    assert version == str(SCHEMA_VERSION) == "2"
    assert orphans == 0
    assert len(pairs) == 8 and all(node == fts for node, fts in pairs)
    assert after == before
    assert any(ids for _, ids in after), "the recall compared is not empty"


def test_reindexing_a_node_leaves_exactly_one_fts_row_under_its_rowid(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain") as brain:
        _index(brain, "ep_aaaa0000", "first body")
        _index(brain, "ep_bbbb0000", "another node")
        _index(brain, "ep_aaaa0000", "first body")
        _index(brain, "ep_aaaa0000", "second body under the same id")

        with closing(brain.read_connection()) as con:
            rows = con.execute(
                """SELECT n.rowid, f.rowid, f.body FROM companion_fts f
                   JOIN companion_node n ON n.id = f.node_id WHERE f.node_id = 'ep_aaaa0000'"""
            ).fetchall()
            (total,) = con.execute("SELECT COUNT(*) FROM companion_fts").fetchone()

    ((node_rowid, fts_rowid, body),) = rows
    assert node_rowid == fts_rowid
    assert body == "second body under the same id"
    assert total == 2


@pytest.mark.parametrize("confidence", [math.nan, math.inf, -math.inf])
def test_a_confidence_that_is_not_finite_is_refused_before_any_file(
    tmp_path: Path, confidence: float
) -> None:
    """The REAL column refused NaN only at the INSERT, after the file: a file with no row."""
    with Brain(tmp_path / "brain") as brain:
        source = brain.append_episode("evidence", role="user").id
        files = sorted(p.relative_to(brain.root) for p in brain.root.rglob("*.md"))

        with pytest.raises(ValueError, match="is not a finite number"):
            brain.write_fact("k", "a claim", sources=[source], confidence=confidence)
        with pytest.raises(ValueError, match="is not a finite number"):
            brain.write_procedural("t", "a rule", sources=[source], confidence=confidence)

        assert sorted(p.relative_to(brain.root) for p in brain.root.rglob("*.md")) == files
        assert brain.counts() == {"episode": 1}


# -- a file is written whole or not at all (ADR 0080) ------------------------------------------


def _file_count(root: Path) -> int:
    return sum(1 for p in root.rglob("*") if p.is_file() and not p.name.startswith("index.sqlite"))


def test_a_value_that_is_not_unicode_creates_no_file(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain") as brain:
        episode = brain.append_episode("Northwind paid 40 days late", role="user")
        files, counts = _file_count(brain.root), brain.counts()

        with pytest.raises(ValueError):
            brain.write_fact("k", "pays \ud800 late", scope="world", sources=[episode.id])
        with pytest.raises(ValueError):
            brain.write_fact("k\ud800", "pays late", scope="world", sources=[episode.id])
        with pytest.raises(ValueError):
            brain.append_episode("lone \ud800 surrogate", role="user")

        assert _file_count(brain.root) == files
        assert brain.counts() == counts


def test_a_failed_replace_leaves_no_file_and_no_row(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with Brain(tmp_path / "brain") as brain:
        episode = brain.append_episode("Northwind paid 40 days late", role="user")
        counts = brain.counts()

        def refuse(*_args: object, **_kwargs: object) -> None:
            raise OSError("replace refused")

        monkeypatch.setattr("athena.core.brain.store.os.replace", refuse)
        with pytest.raises(OSError, match="replace refused"):
            brain.write_fact("k", "pays late", scope="world", sources=[episode.id])

        assert list((brain.root / "semantic").rglob("*")) == [
            p for p in (brain.root / "semantic").rglob("*") if p.is_dir()
        ]
        assert brain.counts() == counts


def test_a_body_with_crlf_is_on_disk_byte_for_byte(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain") as brain:
        episode = brain.append_episode("row one\r\nrow two", role="user")
        fact = brain.write_fact(
            "k", "Acme pays net 60.\r\nAlways late.", scope="world", sources=[episode.id]
        )

        for ref in (episode, fact):
            on_disk = (brain.root / ref.path).read_bytes()
            assert b"\r\n" in on_disk
            assert on_disk.decode("utf-8").encode("utf-8") == on_disk
            assert b"\r\r" not in on_disk

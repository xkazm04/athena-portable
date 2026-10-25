"""The memory wall: a memory is stamped once where it was captured, and every lane reads through
the request's view of it (ADR 0225, "Memory wall").

What each test pins is one isolation claim of the projects contract:

- a memory written in project A is recalled - in every lane - in A, and never in core or in B;
  a core memory is recalled everywhere; the static ``memory.always`` is core's alone and A's own
  always tier is what ``frame.space`` keeps;
- a stamp naming a project whose file does not exist is recalled nowhere (fail closed);
- the stamp is on disk, so deleting the index and rebuilding it gives the same answers, and an
  index from before the wall learns the stamps from disk on first open;
- a memory in A cites only what A can see and closes only A's memories;
- erase takes every file and every row of A and nothing else; promote moves one fact to core.
"""

from __future__ import annotations

import shutil
import sqlite3
from collections.abc import Iterator
from contextlib import closing
from pathlib import Path

import pytest

from athena.contracts.spaces import CORE
from athena.core.brain import (
    Brain,
    ProvenanceError,
    frontmatter,
    index_fingerprint,
    reconcile_from_disk,
)
from athena.core.brain.store import (
    DEVICE_KEY,
    SPACE_KEY,
    UNKNOWN_SPACE,
    replicated_path,
)
from athena.core.recall import (
    ALWAYS_BLOCK,
    EPISODE_BLOCK,
    KEYWORD_BLOCK,
    RecallTrace,
    recall,
    recall_whole,
    space_always,
)
from athena.spaces.book import SpaceBook

DEVICE = "dev_aaaaaaaaaaaa"


@pytest.fixture
def brain(tmp_path: Path) -> Iterator[Brain]:
    with Brain(tmp_path / "brain", session_id="conv_wall") as opened:
        yield opened


def made(brain: Brain, name: str) -> str:
    """A project on disk: its file is what makes its stamp visible anywhere."""
    return SpaceBook(brain).create({"name": name}).id


def ids_of(trace: RecallTrace, block: str) -> set[str]:
    return {memory.id for memory in trace.block(block).items}


def every_id(trace: RecallTrace) -> set[str]:
    return {memory.id for memory in trace.items}


class World:
    """Two projects and core, each with an episode, a keyword fact and an always fact."""

    def __init__(self, brain: Brain) -> None:
        self.a = made(brain, "Taxes")
        self.b = made(brain, "Garden")
        self.ep: dict[str, str] = {}
        self.fact: dict[str, str] = {}
        self.always: dict[str, str] = {}
        for where, word in ((CORE, "harbour"), (self.a, "zephyr"), (self.b, "quokka")):
            episode = brain.append_episode(f"we talked about the {word} invoice", space=where)
            self.ep[where] = episode.id
            self.fact[where] = brain.write_fact(
                f"{word} detail",
                f"The {word} invoice is due on Friday.",
                sources=[episode.id],
                space=where,
            ).id
            self.always[where] = brain.write_fact(
                f"{word} rule",
                f"Always carry the {word} rule.",
                sources=[episode.id],
                every_turn=True,
                space=where,
            ).id


# -- 1. isolation: every lane -------------------------------------------------------------------


def test_a_projects_memory_is_recalled_in_it_in_every_lane_and_nowhere_else(brain: Brain) -> None:
    world = World(brain)
    a, b = world.a, world.b
    query = "zephyr harbour quokka invoice"

    in_a = recall(brain, query, space=a)
    in_core = recall(brain, query)
    in_b = recall(brain, query, space=b)

    # Episodes: A's in A only; core's everywhere.
    assert world.ep[a] in ids_of(in_a, EPISODE_BLOCK)
    assert world.ep[a] not in every_id(in_core) | every_id(in_b)
    assert world.ep[CORE] in ids_of(in_a, EPISODE_BLOCK) & ids_of(in_b, EPISODE_BLOCK)
    # Keyword lane: A's fact in A only; core's everywhere.
    assert world.fact[a] in ids_of(in_a, KEYWORD_BLOCK)
    assert world.fact[a] not in every_id(in_core) | every_id(in_b)
    assert world.fact[CORE] in (
        ids_of(in_a, KEYWORD_BLOCK) & ids_of(in_b, KEYWORD_BLOCK) & ids_of(in_core, KEYWORD_BLOCK)
    )
    # The static always tier is core's alone, in every space.
    for trace in (in_a, in_b, in_core):
        assert ids_of(trace, ALWAYS_BLOCK) == {world.always[CORE]}
    # A's always fact is "Kept for this project" in A - and printed once, not again by keyword.
    kept, total = space_always(brain, a)
    assert total == 1 and kept == ['"Always carry the zephyr rule."']
    assert world.always[a] not in every_id(in_a)
    assert space_always(brain, CORE) == ([], 0)
    assert not any("zephyr" in line for line in space_always(brain, b)[0])
    # Every block's M counts only what the view can see.
    assert in_core.block(EPISODE_BLOCK).total == 1
    assert in_a.block(EPISODE_BLOCK).total == 2


def test_the_whole_recall_she_asks_for_answers_within_the_turns_project(brain: Brain) -> None:
    world = World(brain)

    in_a = recall_whole(brain, "zephyr quokka harbour", cap=12_000, space=world.a)
    in_core = recall_whole(brain, "zephyr quokka harbour", cap=12_000)

    assert {world.ep[world.a], world.ep[CORE]} <= every_id(in_a)
    assert world.ep[world.b] not in every_id(in_a)
    assert every_id(in_core).isdisjoint({world.ep[world.a], world.ep[world.b]})
    assert world.fact[world.a] in every_id(in_a) and world.fact[world.a] not in every_id(in_core)


# -- 2. fail closed ------------------------------------------------------------------------------


def test_a_stamp_whose_project_has_no_file_is_recalled_nowhere(brain: Brain) -> None:
    world = World(brain)
    gone = made(brain, "Gone")
    episode = brain.append_episode("the velvet invoice", space=gone)
    fact = brain.write_fact(
        "velvet", "Velvet is due.", sources=[episode.id], every_turn=True, space=gone
    ).id
    SpaceBook(brain).delete_file(gone)

    for where in (CORE, world.a, world.b, gone):
        trace = recall(brain, "velvet invoice", space=where)
        assert every_id(trace).isdisjoint({episode.id, fact})
        whole = recall_whole(brain, "velvet invoice", cap=12_000, space=where)
        assert every_id(whole).isdisjoint({episode.id, fact})
    assert space_always(brain, gone) == ([], 0)
    # A turn naming the gone project is answered as core: core's memory, nothing of the wall.
    assert world.ep[CORE] in every_id(recall(brain, "harbour", space=gone))


def test_a_stamp_that_is_not_a_space_id_is_in_no_view_after_a_rebuild(brain: Brain) -> None:
    episode = brain.append_episode("the walnut invoice")
    path = brain.root / "episodes" / "stray.md"
    path.write_text(
        '---\nid: "ep_00000000feed"\ntype: episode\nrole: user\nsession: "conv_wall"\n'
        'created: "2026-10-01T00:00:00+00:00"\nspace: "not-a-space"\n---\n\nthe walnut invoice\n',
        encoding="utf-8",
        newline="\n",
    )
    reconcile_from_disk(brain)

    node = brain.node("ep_00000000feed")
    assert node is not None and node.space == UNKNOWN_SPACE
    shown = every_id(recall(brain, "walnut"))
    assert episode.id in shown and "ep_00000000feed" not in shown


# -- 3. the stamp is on disk ---------------------------------------------------------------------


def test_core_files_keep_their_bytes_and_a_stamp_sits_before_the_device(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain", device_id=DEVICE) as brain:
        a = made(brain, "Taxes")
        core = brain.append_episode("core words")
        walled = brain.append_episode("project words", space=a)
        core_text = (brain.root / core.path).read_text(encoding="utf-8")
        walled_text = (brain.root / walled.path).read_text(encoding="utf-8")

    assert f"{SPACE_KEY}:" not in core_text
    head = walled_text.split("\n---\n", 1)[0].split("\n")
    assert head[-2:] == [f'{SPACE_KEY}: "{a}"', f'{DEVICE_KEY}: "{DEVICE}"']
    meta, _ = frontmatter.parse(walled_text)
    assert meta[SPACE_KEY] == a


def test_deleting_the_index_and_rebuilding_from_disk_gives_the_same_answers(
    tmp_path: Path,
) -> None:
    root = tmp_path / "brain"
    with Brain(root, session_id="conv_wall") as brain:
        world = World(brain)
        views = (CORE, world.a, world.b)
        before = {
            v: every_id(recall(brain, "zephyr harbour quokka invoice", space=v)) for v in views
        }
        kept_before = {v: space_always(brain, v) for v in views}
        fingerprint = index_fingerprint(brain)
    for stale in root.glob("index.sqlite*"):
        stale.unlink()

    with Brain(root, session_id="conv_wall") as brain:
        reconcile_from_disk(brain)
        assert index_fingerprint(brain) == fingerprint
        after = {
            v: every_id(recall(brain, "zephyr harbour quokka invoice", space=v)) for v in views
        }
        assert after == before
        assert {v: space_always(brain, v) for v in views} == kept_before
        node = brain.node(world.fact[world.a])
        assert node is not None and node.space == world.a


def _as_version_2(db: Path) -> None:
    """An index as a build before the wall left it: no space columns, no space index, stamped 2."""
    with closing(sqlite3.connect(str(db), isolation_level=None)) as con:
        con.execute("BEGIN")
        con.execute("DROP INDEX companion_node_by_space")
        con.execute("ALTER TABLE companion_node DROP COLUMN space")
        con.execute("ALTER TABLE companion_proposal DROP COLUMN space")
        con.execute("UPDATE companion_meta SET value = '2' WHERE key = 'schema_version'")
        con.execute("COMMIT")


def test_a_version_2_index_learns_the_stamps_from_disk_on_first_open(tmp_path: Path) -> None:
    """What happens to an existing v2 index on first start: the columns are added (every row reads
    core), the index is created, then each episode, fact and procedural file's header is read once
    and a stamped row takes its stamp - a file a paired device stamped and replication delivered
    before this build. Nothing else is rebuilt: index-only state (a demotion) survives."""
    root = tmp_path / "brain"
    with Brain(root, session_id="conv_wall") as brain:
        world = World(brain)
        with brain.write_txn() as con:  # a demotion only the index knows
            con.execute(
                "UPDATE companion_node SET importance = 2 WHERE id = ?", (world.fact[CORE],)
            )
        db = brain.db_path
    _as_version_2(db)
    with closing(sqlite3.connect(str(db))) as con:
        columns = {row[1] for row in con.execute("PRAGMA table_info(companion_node)")}
    assert "space" not in columns

    with Brain(root, session_id="conv_wall") as brain:
        with closing(brain.read_connection()) as con:
            (version,) = con.execute(
                "SELECT value FROM companion_meta WHERE key = 'schema_version'"
            ).fetchone()
            spaces = dict(con.execute("SELECT id, space FROM companion_node").fetchall())
            indexes = {row[1] for row in con.execute("PRAGMA index_list(companion_node)")}
        assert version == "3" and "companion_node_by_space" in indexes
        assert spaces[world.fact[world.a]] == world.a and spaces[world.ep[world.b]] == world.b
        assert spaces[world.fact[CORE]] == CORE
        node = brain.node(world.fact[CORE])
        assert node is not None and node.importance == 2
        assert world.ep[world.a] not in every_id(recall(brain, "zephyr"))


# -- 4. citations and supersedes stay inside the wall ----------------------------------------------


def test_a_memory_cites_only_what_its_project_can_see(brain: Brain) -> None:
    world = World(brain)
    a, b = world.a, world.b

    with pytest.raises(ProvenanceError, match="visible in space"):
        brain.write_fact("x", "y", sources=[world.ep[b]], space=a)
    with pytest.raises(ProvenanceError, match="visible in core"):
        brain.write_fact("x", "y", sources=[world.ep[a]])
    with pytest.raises(ProvenanceError, match="visible in space"):
        brain.write_procedural("when x", "do y", sources=[world.ep[CORE], world.ep[b]], space=a)
    assert brain.write_fact("x", "y", sources=[world.ep[CORE], world.ep[a]], space=a).id
    with pytest.raises(ValueError, match="not a space id"):
        brain.append_episode("words", space="spc_nope")


def test_a_memory_closes_only_memories_of_its_own_project(brain: Brain) -> None:
    world = World(brain)
    a = world.a

    with pytest.raises(ValueError, match="not space"):
        brain.write_fact(
            "harbour detail", "now", sources=[world.ep[a]], supersedes=[world.fact[CORE]], space=a
        )
    with pytest.raises(ValueError, match="not core's"):
        brain.write_fact("zephyr", "now", sources=[world.ep[CORE]], supersedes=[world.fact[a]])
    newer = brain.write_fact(
        "zephyr detail",
        "Zephyr moved to Monday.",
        sources=[world.ep[a]],
        supersedes=[world.fact[a]],
        space=a,
    )
    assert newer.id in every_id(recall(brain, "zephyr", space=a))
    assert world.fact[CORE] in every_id(recall(brain, "harbour", space=a))


def test_a_replicated_file_is_refused_when_it_cites_across_the_wall(tmp_path: Path) -> None:
    with Brain(tmp_path / "one") as one, Brain(tmp_path / "two") as two:
        a = made(one, "Taxes")
        episode = one.append_episode("the zephyr invoice", space=a)
        core_fact = one.write_fact("zephyr", "Due Friday.", sources=[episode.id], space=a)
        # Forge a core fact citing A's episode, as a broken peer could send.
        forged = (one.root / core_fact.path).read_text(encoding="utf-8")
        forged = forged.replace(f'{SPACE_KEY}: "{a}"\n', "")
        two.receive_file("episode", episode.path, (one.root / episode.path).read_bytes())
        assert replicated_path("fact", core_fact.path) == core_fact.id
        with pytest.raises(ProvenanceError, match="visible in core"):
            two.receive_file("fact", core_fact.path, forged.encode("utf-8"))
        received = two.receive_file(
            "fact", core_fact.path, (one.root / core_fact.path).read_bytes()
        )
        node = two.node(received.id)
        assert node is not None and node.space == a


# -- 5. the two explicit acts: erase and promote -------------------------------------------------


def _rows_naming(brain: Brain, node_ids: set[str]) -> dict[str, int]:
    """How many rows of each table still name one of ``node_ids``."""
    wanted = sorted(node_ids)
    marks = ",".join("?" for _ in wanted)
    out: dict[str, int] = {}
    with closing(brain.read_connection()) as con:
        for table, column in (
            ("companion_node", "id"),
            ("companion_fts", "node_id"),
            ("companion_fact", "id"),
            ("companion_procedural", "id"),
            ("companion_provenance", "node_id"),
            ("companion_supersede", "node_id"),
            ("companion_supersede", "superseded_id"),
            ("companion_recall_seen", "node_id"),
            ("companion_fade", "node_id"),
        ):
            (count,) = con.execute(
                f"SELECT COUNT(*) FROM {table} WHERE {column} IN ({marks})", wanted
            ).fetchone()
            out[f"{table}.{column}"] = int(count)
    return out


def _others(brain: Brain, erased: set[str]) -> list[tuple[object, ...]]:
    """The fingerprint without the erased ids: what an erase must leave exactly as it was."""
    return [row for row in index_fingerprint(brain) if not set(map(str, row)) & erased]


def test_erasing_a_project_takes_its_files_and_every_row_and_leaves_the_rest(
    brain: Brain,
) -> None:
    world = World(brain)
    a = world.a
    procedural = brain.write_procedural("when zephyr", "file it", sources=[world.ep[a]], space=a).id
    newer = brain.write_fact(
        "zephyr detail", "Monday.", sources=[world.ep[a]], supersedes=[world.fact[a]], space=a
    ).id
    unindexed = brain.append_episode("zephyr crash residue", space=a)
    with brain.write_txn() as con:  # a file whose row a crash lost
        con.execute("DELETE FROM companion_node WHERE id = ?", (unindexed.id,))
        con.execute(
            "INSERT INTO companion_fade (node_id, steps, at) VALUES (?, 1, '2026-01-01')",
            (world.fact[a],),
        )
        con.execute(
            "INSERT INTO companion_proposal (id, cycle_id, kind, node_ids_json, summary, "
            "created_at, space) VALUES ('prop_000000000001', 'cyc_x', 'forget', '[]', 's', "
            "'2026-01-01', ?)",
            (a,),
        )
    recall(brain, "zephyr", space=a)  # use marks for A's facts
    stamped = {world.ep[a], world.fact[a], world.always[a], procedural, newer, unindexed.id}
    files = [brain.root / p for p in _paths(brain, stamped - {unindexed.id})]
    files.append(brain.root / unindexed.path)
    others_before = _others(brain, stamped)

    counts = brain.erase_space(a)

    assert counts == {"episode": 2, "fact": 3, "procedural": 1}
    assert not any(path.exists() for path in files)
    assert set(_rows_naming(brain, stamped).values()) == {0}
    with closing(brain.read_connection()) as con:
        assert (
            con.execute("SELECT COUNT(*) FROM companion_proposal WHERE space = ?", (a,)).fetchone()[
                0
            ]
            == 0
        )
    assert _others(brain, stamped) == others_before
    assert world.ep[world.b] in every_id(recall(brain, "quokka", space=world.b))
    assert brain.erase_space(a) == {"episode": 0, "fact": 0, "procedural": 0}


def _paths(brain: Brain, node_ids: set[str]) -> list[str]:
    out = []
    for node_id in node_ids:
        node = brain.node(node_id)
        assert node is not None
        out.append(node.file_path)
    return out


def test_promoting_a_fact_moves_it_to_core_with_its_bytes_and_it_outlives_the_erase(
    brain: Brain,
) -> None:
    world = World(brain)
    a, b = world.a, world.b
    node = brain.node(world.fact[a])
    assert node is not None
    before = (brain.root / node.file_path).read_text(encoding="utf-8")

    assert brain.unstamp(world.fact[a], b) is None, "not B's to move"
    assert brain.unstamp(world.ep[a], a) is None, "an episode stays where it was said"
    assert brain.unstamp(world.fact[a], a) == "fact"

    after = (brain.root / node.file_path).read_text(encoding="utf-8")
    assert after == before.replace(f'{SPACE_KEY}: "{a}"\n', "")
    moved = brain.node(world.fact[a])
    assert moved is not None and moved.space == CORE
    assert world.fact[a] in every_id(recall(brain, "zephyr", space=b))
    assert world.fact[a] in every_id(recall(brain, "zephyr"))
    assert brain.unstamp(world.fact[a], a) is None, "already core's"

    # Its citation of A's episode is kept; erasing A leaves the core fact recalled, still citing.
    brain.erase_space(a)
    assert brain.sources_of(world.fact[a]) == [world.ep[a]]
    assert world.fact[a] in every_id(recall(brain, "zephyr", space=b))
    # And a rebuild agrees with the promote.
    fingerprint = index_fingerprint(brain)
    reconcile_from_disk(brain)
    assert index_fingerprint(brain) == fingerprint


def test_a_copied_brain_with_projects_rebuilds_an_identical_index(tmp_path: Path) -> None:
    original = tmp_path / "brain"
    with Brain(original, session_id="conv_wall") as brain:
        World(brain)
        fingerprint = index_fingerprint(brain)
    copy = tmp_path / "copy"
    shutil.copytree(original, copy, ignore=shutil.ignore_patterns("index.sqlite*"))
    with Brain(copy, session_id="conv_wall") as brain:
        reconcile_from_disk(brain)
        assert index_fingerprint(brain) == fingerprint

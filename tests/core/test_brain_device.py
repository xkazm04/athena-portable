"""The device stamp and the received file: what replication asks of the brain (ADR 0140, WP2).

``device:`` is written last, and only when the brain has a device, so a brain that never paired
writes the bytes it always did (the ``every_turn`` precedent, ADR 0071). ``Brain.receive_file`` is
the one door a file from another device comes in by: the path its own writer would have chosen,
the provenance gate every writer passes, and the rebuild's own per-file index step.
"""

from __future__ import annotations

from contextlib import closing
from pathlib import Path

import pytest

from athena.contracts import ids
from athena.core.brain import frontmatter
from athena.core.brain.reconcile import index_fingerprint, reconcile_from_disk
from athena.core.brain.store import (
    DEVICE_KEY,
    Brain,
    ProvenanceError,
    device_of,
    replicated_path,
)


def header_keys(path: Path) -> list[str]:
    head = path.read_text(encoding="utf-8").split("\n---\n", 1)[0]
    return [line.split(":", 1)[0] for line in head.split("\n")[1:] if not line.startswith("  ")]


def test_a_brain_without_a_device_writes_no_device_key(tmp_path: Path) -> None:
    with Brain(tmp_path) as brain:
        episode = brain.append_episode("hello", "user")
        fact = brain.write_fact("k", "v", sources=[episode.id], every_turn=True)
        rule = brain.write_procedural("t", "b", sources=[episode.id])
        assert brain.device_id is None
        for ref in (episode, fact, rule):
            assert DEVICE_KEY not in header_keys(tmp_path / ref.path)
        assert header_keys(tmp_path / episode.path) == ["id", "type", "role", "session", "created"]


def test_the_device_is_the_last_key_on_episodes_facts_and_procedurals(tmp_path: Path) -> None:
    device = ids.mint("device")
    with Brain(tmp_path, device_id=device) as brain:
        episode = brain.append_episode("hello", "user")
        fact = brain.write_fact("k", "v", sources=[episode.id], every_turn=True)
        plain = brain.write_fact("k2", "v2", sources=[episode.id])
        rule = brain.write_procedural("t", "b", sources=[episode.id])
        for ref in (episode, fact, plain, rule):
            keys = header_keys(tmp_path / ref.path)
            assert keys[-1] == DEVICE_KEY, ref.kind
            meta, _ = frontmatter.parse((tmp_path / ref.path).read_text(encoding="utf-8"))
            assert device_of(meta) == device
        assert header_keys(tmp_path / fact.path)[-2:] == ["every_turn", DEVICE_KEY]
        # A goal is device-local and rewritten in place: no stamp (v1 replicates write-once only).
        goal = brain.write_goal(
            ids.mint("project"), "G", "body", session_id="cli", created="2026-10-24"
        )
        assert DEVICE_KEY not in header_keys(tmp_path / goal.path)


def test_a_device_callable_is_asked_at_each_write(tmp_path: Path) -> None:
    device = ids.mint("device")
    holder: list[str | None] = [None]
    with Brain(tmp_path, device_id=lambda: holder[0]) as brain:
        before = brain.append_episode("before pairing", "user")
        holder[0] = device
        after = brain.append_episode("after pairing", "user")
        holder[0] = "not-a-device"
        junk = brain.append_episode("a bad answer is no stamp", "user")
    assert DEVICE_KEY not in header_keys(tmp_path / before.path)
    assert header_keys(tmp_path / after.path)[-1] == DEVICE_KEY
    assert DEVICE_KEY not in header_keys(tmp_path / junk.path)


def test_a_device_id_that_is_not_one_is_refused(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="not a device id"):
        Brain(tmp_path, device_id="dev_0123abcd")


def test_device_of_reads_unknown_for_legacy_and_junk() -> None:
    assert device_of({}) is None
    assert device_of({DEVICE_KEY: "laptop"}) is None
    assert device_of({DEVICE_KEY: 7}) is None


def test_a_stamped_tree_rebuilds_to_the_rows_the_writers_made(tmp_path: Path) -> None:
    with Brain(tmp_path, device_id=ids.mint("device")) as brain:
        episode = brain.append_episode("hello", "user")
        brain.write_fact("k", "v", sources=[episode.id], every_turn=True)
        before = index_fingerprint(brain)
        reconcile_from_disk(brain)
        assert index_fingerprint(brain) == before


# -- the path a received file may land at ---------------------------------------------------------


@pytest.mark.parametrize(
    ("kind", "rel"),
    [
        ("episode", "episodes/2026/10/24/ep_0123456789ab_user.md"),
        ("episode", "episodes/2026/10/24/ep_0123abcd_assistant.md"),
        ("fact", "semantic/world/fact_0123456789ab_northwind-pays.md"),
        ("procedural", "procedurals/action/proc_0123456789ab_open-it.md"),
    ],
)
def test_the_writers_own_paths_are_accepted(kind: str, rel: str) -> None:
    assert ids.kind_of(replicated_path(kind, rel)) == kind


@pytest.mark.parametrize(
    ("kind", "rel"),
    [
        ("episode", "episodes/2026/10/24/../../../../index.sqlite"),
        ("episode", "../episodes/2026/10/24/ep_0123456789ab_user.md"),
        ("episode", "episodes/2026/10/24/ep_0123456789ab_root.md"),
        ("episode", "episodes/2026/10/24/ep_0123456_user.md"),
        ("episode", "episodes\\2026\\10\\24\\ep_0123456789ab_user.md"),
        ("fact", "semantic/secrets/fact_0123456789ab_x.md"),
        ("fact", "semantic/user/fact_0123456789ab_x.md/../../goals/proj_0123456789ab.md"),
        ("fact", "semantic/user/proc_0123456789ab_x.md"),
        ("procedural", ".peer/conflicts/proc_0123456789ab_x.md"),
        ("goal", "goals/proj_0123456789ab.md"),
        ("ritual", "rituals/cadence/weekly.md"),
    ],
)
def test_any_other_path_is_refused(kind: str, rel: str) -> None:
    with pytest.raises(ValueError):
        replicated_path(kind, rel)


# -- receive_file ---------------------------------------------------------------------------------


def _remote(tmp_path: Path) -> tuple[Brain, str, str, str, str]:
    """A brain on "another device" with an episode and a fact citing it: (brain, paths, ids)."""
    other = Brain(tmp_path / "other", device_id=ids.mint("device"))
    episode = other.append_episode("the remote episode", "user")
    fact = other.write_fact("remote", "the remote fact", sources=[episode.id])
    return other, episode.path, episode.id, fact.path, fact.id


def test_a_received_file_lands_byte_for_byte_and_indexes_as_a_rebuild_would(
    tmp_path: Path,
) -> None:
    other, ep_rel, ep_id, fact_rel, fact_id = _remote(tmp_path)
    with other, Brain(tmp_path / "here", device_id=ids.mint("device")) as here:
        for kind, rel in (("episode", ep_rel), ("fact", fact_rel)):
            data = (other.root / rel).read_bytes()
            ref = here.receive_file(kind, rel, data)
            assert ref.path == rel and (here.root / rel).read_bytes() == data
        assert here.sources_of(fact_id) == [ep_id]
        before = index_fingerprint(here)
        reconcile_from_disk(here)
        assert index_fingerprint(here) == before
        with pytest.raises(FileExistsError):
            here.receive_file("episode", ep_rel, (other.root / ep_rel).read_bytes())


def test_a_received_fact_whose_episode_is_absent_is_refused_and_writes_nothing(
    tmp_path: Path,
) -> None:
    other, _, _, fact_rel, fact_id = _remote(tmp_path)
    with other, Brain(tmp_path / "here") as here:
        with pytest.raises(ProvenanceError):
            here.receive_file("fact", fact_rel, (other.root / fact_rel).read_bytes())
        assert here.node(fact_id) is None
        assert not (here.root / fact_rel).exists()


def test_a_received_file_whose_header_disagrees_with_its_path_is_refused(tmp_path: Path) -> None:
    other, ep_rel, _, _, _ = _remote(tmp_path)
    with other, Brain(tmp_path / "here") as here:
        data = (other.root / ep_rel).read_bytes()
        elsewhere = ep_rel.replace("_user.md", "_assistant.md").replace("ep_", "ep_f")
        with pytest.raises(ValueError):
            here.receive_file("episode", "episodes/2026/01/01/ep_0123456789ab_user.md", data)
        with pytest.raises(ValueError):
            here.receive_file("episode", elsewhere, data)
        with pytest.raises(ValueError, match="not UTF-8"):
            here.receive_file("episode", ep_rel, b"\xff\xfe")
        assert here.counts().get("episode", 0) == 0


def test_a_received_memory_may_close_only_its_own_spaces_memories(tmp_path: Path) -> None:
    """The supersede wall holds at the door as at the writer (ADR 0143, ADR 0225): a broken peer's
    project fact naming a core fact in ``supersedes`` would hide it from core and every project,
    where the successor is not visible. One closing a memory of its own space, or one that has not
    arrived yet, is filed."""
    space = ids.mint("space")
    with Brain(tmp_path / "other") as other, Brain(tmp_path / "here") as here:
        said = other.append_episode("the harbour invoice is due Friday", "user")
        core_fact = other.write_fact("harbour", "Harbour pays Friday.", sources=[said.id])
        inside = other.append_episode("harbour detail for the project", "user", space=space)
        old = other.write_fact("harbour detail", "Old detail.", sources=[inside.id], space=space)
        for kind, ref in (("episode", said), ("fact", core_fact), ("episode", inside)):
            here.receive_file(kind, ref.path, (other.root / ref.path).read_bytes())
        meta, _ = frontmatter.parse((other.root / old.path).read_text(encoding="utf-8"))
        forged_id = ids.mint("fact")
        forged_rel = f"semantic/user/{forged_id}_harbour-detail.md"
        forged = frontmatter.render(
            [
                ("id", forged_id),
                ("type", "fact"),
                ("scope", "user"),
                ("key", "harbour detail"),
                ("confidence", 0.7),
                ("created", meta["created"]),
                ("sources", [inside.id]),
                ("supersedes", [core_fact.id]),
                ("space", space),
            ],
            "Harbour pays Monday.",
        )
        with pytest.raises(ValueError, match="not space"):
            here.receive_file("fact", forged_rel, forged.encode("utf-8"))
        assert here.node(forged_id) is None and not (here.root / forged_rel).exists()
        with closing(here.read_connection()) as con:
            (closed,) = con.execute("SELECT COUNT(*) FROM companion_supersede").fetchone()
        assert closed == 0, "nothing of core is closed"
        # Its own space's memory - present or still on its way - is the successor's to close.
        newer = other.write_fact(
            "harbour detail", "New detail.", sources=[inside.id], supersedes=[old.id], space=space
        )
        here.receive_file("fact", newer.path, (other.root / newer.path).read_bytes())
        here.receive_file("fact", old.path, (other.root / old.path).read_bytes())
        assert here.node(newer.id) is not None and here.node(old.id) is not None

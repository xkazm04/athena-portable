"""Writing a memory: disk first, provenance enforced (README §2 invariants 1 and 2)."""

from __future__ import annotations

from pathlib import Path

import pytest

from athena.contracts import ids
from athena.core.brain import Brain, ProvenanceError
from athena.core.brain.frontmatter import FrontmatterError


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

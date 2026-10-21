"""``Brain.source_counts`` answers what ``len(sources_of(id))`` would, on one connection."""

from __future__ import annotations

from pathlib import Path

from athena.core.brain import Brain


def test_counts_match_sources_of_for_zero_one_and_two_sources(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain") as brain:
        first = brain.append_episode("Acme paid 34 days late again", role="user")
        second = brain.append_episode("Acme paid late a fourth time", role="user")
        one = brain.write_fact("one source", "cites one", sources=[first.id])
        two = brain.write_fact("two sources", "cites two", sources=[first.id, second.id])
        missing = "fact_does_not_exist"

        counts = brain.source_counts([one.id, two.id, first.id, missing])

        assert counts == {one.id: 1, two.id: 2, first.id: 0, missing: 0}
        for node_id, count in counts.items():
            assert count == len(brain.sources_of(node_id))


def test_an_empty_list_and_repeated_ids_are_handled(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain") as brain:
        episode = brain.append_episode("Acme paid late", role="user")
        fact = brain.write_fact("late", "pays late", sources=[episode.id])

        assert brain.source_counts([]) == {}
        assert brain.source_counts([fact.id, fact.id]) == {fact.id: 1}


def test_a_list_longer_than_one_batch_is_counted_in_full(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain") as brain:
        episode = brain.append_episode("Acme paid late", role="user")
        fact = brain.write_fact("late", "pays late", sources=[episode.id])
        ids = [f"fact_missing_{n}" for n in range(1200)] + [fact.id]

        counts = brain.source_counts(ids)

        assert len(counts) == 1201
        assert counts[fact.id] == 1

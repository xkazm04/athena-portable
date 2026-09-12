"""Recall is bounded, and every block announces its own M (README §2 invariant 4)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from athena.core.brain import Brain
from athena.core.recall import (
    ALWAYS_BLOCK,
    ALWAYS_IMPORTANCE_FLOOR,
    EPISODE_BLOCK,
    EPISODE_WINDOW,
    KEYWORD_BLOCK,
    recall,
)

BASE = datetime(2026, 9, 1, 9, 0, tzinfo=UTC)


def _episodes(brain: Brain, count: int, prefix: str = "turn") -> list[str]:
    return [
        brain.append_episode(
            f"{prefix} number {n}", role="user", created=BASE + timedelta(minutes=n)
        ).id
        for n in range(count)
    ]


def test_a_query_with_no_match_returns_no_padding(tmp_path: Path) -> None:
    """An empty lane is the answer. Ranking something in anyway would be a lie."""
    with Brain(tmp_path / "brain") as brain:
        source = brain.append_episode("Acme paid 34 days late", role="user").id
        brain.write_fact("acme pays late", "Acme has paid late three quarters", sources=[source])
        brain.write_fact("crm is Pipedrive", "the CRM is Pipedrive", sources=[source])

        trace = recall(brain, "helicopter maintenance schedule")

        keyword = trace.block(KEYWORD_BLOCK)
        assert keyword.items == ()
        assert keyword.total == 0
        assert keyword.footer() == "(showing 0 of 0)"
        assert "no distilled memory matched the query" in trace.notes
        assert KEYWORD_BLOCK not in trace.lanes


def test_a_matching_query_fills_the_keyword_block(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain") as brain:
        source = brain.append_episode("Acme paid 34 days late", role="user").id
        brain.write_fact("acme pays late", "Acme has paid late three quarters", sources=[source])
        brain.write_fact("crm is Pipedrive", "the CRM is Pipedrive", sources=[source])

        trace = recall(brain, "Acme quarters")

        keyword = trace.block(KEYWORD_BLOCK)
        assert [memory.excerpt for memory in keyword.items] == ["Acme has paid late three quarters"]
        assert keyword.total == 1
        assert KEYWORD_BLOCK in trace.lanes


def test_a_high_importance_fact_is_included_with_no_query_at_all(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain") as brain:
        source = brain.append_episode("Acme paid 34 days late", role="user").id
        brain.write_fact(
            "acme pays late",
            "Acme has paid late three quarters",
            sources=[source],
            importance=ALWAYS_IMPORTANCE_FLOOR,
        )
        brain.write_fact("crm is Pipedrive", "the CRM is Pipedrive", sources=[source])

        trace = recall(brain, "nothing at all like that fact")

        always = trace.block(ALWAYS_BLOCK)
        assert [memory.excerpt for memory in always.items] == ["Acme has paid late three quarters"]
        # The importance-3 fact is live but below the floor: it is not in the population either.
        assert always.total == 1


def test_the_keyword_block_does_not_repeat_what_the_always_tier_showed(tmp_path: Path) -> None:
    """And it subtracts those from its own M, so its footer stays a number it could reach."""
    with Brain(tmp_path / "brain") as brain:
        source = brain.append_episode("Acme paid 34 days late", role="user").id
        brain.write_fact(
            "acme pays late",
            "Acme invoices are paid late",
            sources=[source],
            importance=ALWAYS_IMPORTANCE_FLOOR + 1,
        )
        brain.write_fact("acme contact", "Acme is billed through their office", sources=[source])

        trace = recall(brain, "Acme")

        always_ids = {memory.id for memory in trace.block(ALWAYS_BLOCK).items}
        keyword = trace.block(KEYWORD_BLOCK)
        assert len(always_ids) == 1
        assert not always_ids & {memory.id for memory in keyword.items}
        assert keyword.total == 1, "the always tier's hit is out of the keyword population too"
        assert keyword.footer() == "(showing 1 of 1)"
        assert len({memory.id for memory in trace.items}) == len(trace.items)


def test_the_totals_are_per_population_not_one_global_m(tmp_path: Path) -> None:
    """Three blocks, three Ms, and none of them is the size of the brain."""
    with Brain(tmp_path / "brain") as brain:
        sources = _episodes(brain, 25)
        for n in range(10):
            brain.write_fact(
                f"always fact {n}",
                f"always fact {n}",
                sources=sources[:1],
                importance=ALWAYS_IMPORTANCE_FLOOR,
            )
        for n in range(3):
            brain.write_fact(f"quiet fact {n}", f"quiet fact {n}", sources=sources[:1])

        trace = recall(brain, "quiet")

        live = sum(brain.counts().values())
        assert live == 38
        assert trace.totals == {ALWAYS_BLOCK: 10, KEYWORD_BLOCK: 3, EPISODE_BLOCK: 25}
        assert live not in trace.totals.values(), "no block is bounded by the size of the brain"
        assert trace.footer().splitlines() == [
            "always: (showing 8 of 10)",
            "keyword: (showing 3 of 3)",
            "episodes: (showing 20 of 25)",
        ]


def test_the_episode_window_is_capped_and_announced(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain") as brain:
        written = _episodes(brain, EPISODE_WINDOW + 5)

        trace = recall(brain, "")

        episodes = trace.block(EPISODE_BLOCK)
        assert episodes.shown == EPISODE_WINDOW
        assert episodes.total == EPISODE_WINDOW + 5
        assert episodes.truncated
        assert episodes.footer() == f"(showing {EPISODE_WINDOW} of {EPISODE_WINDOW + 5})"
        assert episodes.footer() in episodes.render()
        # The tail is the most recent turns, oldest first, so the block reads as conversation.
        assert [memory.id for memory in episodes.items] == written[5:]


def test_the_window_prefers_a_relevant_old_turn_over_a_recent_one(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain") as brain:
        needle = brain.append_episode(
            "the haystack question about Acme", role="user", created=BASE
        ).id
        _episodes(brain, EPISODE_WINDOW + 4, prefix="unrelated chatter")

        trace = recall(brain, "Acme")

        episodes = trace.block(EPISODE_BLOCK)
        assert episodes.shown == EPISODE_WINDOW
        assert needle in {memory.id for memory in episodes.items}


def test_machine_chatter_stays_out_of_the_recency_tail(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain") as brain:
        spoken = brain.append_episode("a real turn", role="user", created=BASE).id
        for n in range(3):
            brain.append_episode(
                f"fleet-event worker {n} restarted",
                role="system",
                created=BASE + timedelta(minutes=n + 1),
            )

        trace = recall(brain, "")

        episodes = trace.block(EPISODE_BLOCK)
        assert [memory.id for memory in episodes.items] == [spoken]
        assert episodes.total == 4, "the machine turns are live, so they are in the population"


def test_an_empty_brain_recalls_nothing_and_says_so(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain") as brain:
        trace = recall(brain, "anything")

        assert trace.items == []
        assert trace.shown == 0
        assert trace.lanes == []
        assert trace.footer().splitlines() == [
            "always: (showing 0 of 0)",
            "keyword: (showing 0 of 0)",
            "episodes: (showing 0 of 0)",
        ]


def test_a_query_full_of_fts_operators_is_words_and_not_a_crash(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain") as brain:
        source = brain.append_episode("Acme paid late", role="user").id
        brain.write_fact("acme", "Acme pays late", sources=[source])

        trace = recall(brain, 'NOT OR "* AND (')

        assert trace.block(KEYWORD_BLOCK).items == ()


def test_the_prompt_blocks_carry_their_own_numbers_and_fence_the_episodes(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain") as brain:
        _episodes(brain, EPISODE_WINDOW + 2)

        blocks = {block.name: block for block in recall(brain, "").as_prompt_blocks()}

        episodes = blocks["recall.episodes"]
        assert episodes.untrusted, "episode bodies are not instructions"
        assert episodes.shown == EPISODE_WINDOW
        assert episodes.total == EPISODE_WINDOW + 2
        assert episodes.announces_truncation()
        assert not blocks["recall.always"].untrusted


def test_asking_for_a_block_that_does_not_exist_names_the_ones_that_do(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain") as brain:
        trace = recall(brain, "anything")

        with pytest.raises(KeyError, match="vector"):
            trace.block("vector")

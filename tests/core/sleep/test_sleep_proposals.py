"""A person keeps or forgets; forgetting is a replicable write, never a delete (ADR 0143)."""

from __future__ import annotations

from contextlib import closing
from pathlib import Path
from typing import Any

import pytest

from athena.contracts import ids
from athena.contracts.channel import iso
from athena.core.brain import Brain, frontmatter, reconcile_from_disk
from athena.core.brain.store import replicated_path
from athena.core.recall import recall
from athena.core.sleep import EXCERPT_CHARS, OPEN_PROPOSALS_CAP, PROPOSAL_EXPIRE_D
from athena.core.sleep.book import SleepBook
from athena.core.sleep.proposals import ProposalRefused, decide

from .conftest import DEV_B, Clock, write_episodes


def _facts(brain: Brain, query: str) -> list[str]:
    return [m.id for m in recall(brain, query).items if m.kind == "fact"]


def test_forget_writes_a_retired_marker_that_replicates(
    brain: Brain, clock: Clock, tmp_path: Path
) -> None:
    book = SleepBook(brain)
    (episode,) = write_episodes(brain, 1)
    fax = brain.write_fact("fax machines", "The user likes fax machines.", sources=[episode])
    proposal = book.open_proposal(
        ids.mint("cycle"), "forget", [fax.id], "Forget it?", now=iso(clock())
    )
    assert proposal is not None

    decided = decide(brain, book, proposal.id, "forget", None, clock=clock)
    assert decided.status == "forgotten"
    assert _facts(brain, "fax machines") == []
    assert brain.node(fax.id) is not None, "the forgotten file stays; it is closed, not erased"

    marker = next(
        p for p in (brain.root / "semantic" / "user").glob("*.md") if "forgotten" in p.name
    )
    meta, _ = frontmatter.parse(marker.read_text(encoding="utf-8"))
    assert meta["key"] == "forgotten:fax machines"
    assert meta["supersedes"] == [fax.id] and meta["retired"] is True
    assert meta["sources"] == [episode]

    # Another PC receives the three files in replication order and hides the same memory.
    with Brain(tmp_path / "peer", device_id=DEV_B) as peer:
        for node_id in (episode, fax.id, str(meta["id"])):
            node = brain.node(node_id)
            assert node is not None
            kind = node.kind
            assert replicated_path(kind, node.file_path) == node_id
            peer.receive_file(kind, node.file_path, (brain.root / node.file_path).read_bytes())
        assert _facts(peer, "fax machines") == []
        reconcile_from_disk(peer)
        assert _facts(peer, "fax machines") == []


def test_a_contradiction_needs_the_side_to_forget(brain: Brain, clock: Clock) -> None:
    book = SleepBook(brain)
    (episode,) = write_episodes(brain, 1)
    tea = brain.write_fact("user drink", "The user drinks tea.", sources=[episode])
    no_tea = brain.write_fact("user drink now", "The user never drinks tea.", sources=[episode])
    proposal = book.open_proposal(
        ids.mint("cycle"), "contradiction", [no_tea.id, tea.id], "Which?", now=iso(clock())
    )
    assert proposal is not None
    with pytest.raises(ProposalRefused) as missing:
        decide(brain, book, proposal.id, "forget", None, clock=clock)
    assert missing.value.status == 400
    with pytest.raises(ProposalRefused):
        decide(brain, book, proposal.id, "forget", "fact_ffffffffffff", clock=clock)
    decide(brain, book, proposal.id, "forget", tea.id, clock=clock)
    assert _facts(brain, "drinks tea") == [no_tea.id]
    with pytest.raises(ProposalRefused) as again:
        decide(brain, book, proposal.id, "keep", None, clock=clock)
    assert again.value.status == 409


def test_keep_closes_and_is_not_offered_again(brain: Brain, clock: Clock) -> None:
    book = SleepBook(brain)
    (episode,) = write_episodes(brain, 1)
    fact = brain.write_fact("k", "a kept thing", sources=[episode])
    proposal = book.open_proposal(ids.mint("cycle"), "forget", [fact.id], "?", now=iso(clock()))
    assert proposal is not None
    assert decide(brain, book, proposal.id, "keep", None, clock=clock).status == "kept"
    assert fact.id in book.proposed("forget")
    assert _facts(brain, "kept thing") == [fact.id]
    with pytest.raises(ProposalRefused) as unknown:
        decide(brain, book, ids.mint("proposal"), "keep", None, clock=clock)
    assert unknown.value.status == 404


def test_the_queue_is_capped_expires_and_dismisses_what_is_gone(brain: Brain, clock: Clock) -> None:
    book = SleepBook(brain)
    (episode,) = write_episodes(brain, 1)
    facts = [
        brain.write_fact(f"k{i}", f"value {i}", sources=[episode]).id
        for i in range(OPEN_PROPOSALS_CAP + 1)
    ]
    cycle = ids.mint("cycle")
    opened = [book.open_proposal(cycle, "forget", [fact], "?", now=iso(clock())) for fact in facts]
    assert opened[-1] is None and all(p is not None for p in opened[:-1])
    assert book.open_count() == OPEN_PROPOSALS_CAP

    brain.write_fact("k0 now", "replaced", sources=[episode], supersedes=[facts[0]])
    assert book.sweep(clock()) == (0, 1)
    clock.advance(days=PROPOSAL_EXPIRE_D + 1)
    expired, dismissed = book.sweep(clock())
    assert (expired, dismissed) == (OPEN_PROPOSALS_CAP - 1, 0)
    assert book.open_count() == 0
    statuses = {p.status for p in book.proposals(decided=50)}
    assert statuses == {"expired", "dismissed"}


# -- what a proposal shows a person: both memories' words and where they came from -----------------

MEMORY_KEYS = {
    "id",
    "kind",
    "key",
    "text",
    "scope",
    "created_at",
    "sources",
    "recalled_at",
    "faded",
    "quote",
    "live",
}


def _memories(book: SleepBook, proposal_id: str) -> list[dict[str, Any]]:
    row = book.proposal(proposal_id)
    assert row is not None
    view = row.view(book.proposal_memories([row]))
    memories: list[dict[str, Any]] = view["memories"]
    return memories


def test_a_contradiction_carries_both_memories_words_in_node_order(
    brain: Brain, clock: Clock
) -> None:
    book = SleepBook(brain)
    old_ep, new_ep = write_episodes(brain, 2, chars=400)
    net30 = brain.write_fact("acme payment terms", "Acme pays at 30 days.", sources=[old_ep])
    long_value = "Acme now pays at 45 days,\n   after the call. " + "detail " * 60
    net45 = brain.write_fact("acme payment terms", long_value, scope="project", sources=[new_ep])
    proposal = book.open_proposal(
        ids.mint("cycle"), "contradiction", [net45.id, net30.id], "Which?", now=iso(clock())
    )
    assert proposal is not None

    first, second = _memories(book, proposal.id)
    assert set(first) == MEMORY_KEYS and set(second) == MEMORY_KEYS
    assert [first["id"], second["id"]] == [net45.id, net30.id]
    assert second["text"] == "Acme pays at 30 days."
    assert first["text"].startswith("Acme now pays at 45 days, after the call.")
    assert len(first["text"]) <= EXCERPT_CHARS and "\n" not in first["text"]
    assert first["kind"] == "fact" and first["key"] == "acme payment terms"
    assert first["scope"] == "project" and second["scope"] == "user"
    assert first["live"] is True and first["created_at"]


def test_a_forget_proposal_says_how_far_it_faded_and_when_it_was_last_used(
    brain: Brain, clock: Clock
) -> None:
    book = SleepBook(brain)
    (episode,) = write_episodes(brain, 1)
    wifi = brain.write_fact("office wifi", "The old office wifi is ACME-GUEST.", sources=[episode])
    with brain.write_txn() as con:
        con.execute(
            "INSERT INTO companion_fade (node_id, steps, at) VALUES (?, 3, '2026-01-01')",
            (wifi.id,),
        )
    proposal = book.open_proposal(ids.mint("cycle"), "forget", [wifi.id], "?", now=iso(clock()))
    assert proposal is not None
    (memory,) = _memories(book, proposal.id)
    assert memory["faded"] == 3 and memory["recalled_at"] is None

    recall(brain, "office wifi ACME-GUEST")
    with closing(brain.read_connection()) as con:
        (last_at,) = con.execute(
            "SELECT last_at FROM companion_recall_seen WHERE node_id = ?", (wifi.id,)
        ).fetchone()
    (memory,) = _memories(book, proposal.id)
    assert memory["recalled_at"] == last_at


def test_the_quote_is_the_first_live_source_in_one_line(brain: Brain, clock: Clock) -> None:
    book = SleepBook(brain)
    first_ep = brain.append_episode("We   agreed:\nAcme pays at 30 days. " + "pad " * 100).id
    second_ep = brain.append_episode("Acme said 45 days on the call.").id
    fact = brain.write_fact("acme terms", "Acme pays at 30.", sources=[first_ep, second_ep])
    proposal = book.open_proposal(ids.mint("cycle"), "forget", [fact.id], "?", now=iso(clock()))
    assert proposal is not None
    order = brain.sources_of(fact.id)

    (memory,) = _memories(book, proposal.id)
    assert memory["sources"] == len(order) == 2
    expected = {first_ep: "We agreed: Acme pays at 30 days.", second_ep: "Acme said 45 days"}
    assert memory["quote"].startswith(expected[order[0]])
    assert len(memory["quote"]) <= EXCERPT_CHARS and "\n" not in memory["quote"]

    # The first cited episode demoted: the quote is the next live one.
    with brain.write_txn() as con:
        con.execute("UPDATE companion_node SET importance = 0 WHERE id = ?", (order[0],))
    (memory,) = _memories(book, proposal.id)
    assert memory["quote"].startswith(expected[order[1]])
    assert memory["sources"] == 2

    # None live: no quote, never a made-up one.
    with brain.write_txn() as con:
        con.execute("UPDATE companion_node SET importance = 0 WHERE id = ?", (order[1],))
    (memory,) = _memories(book, proposal.id)
    assert memory["quote"] is None


def test_a_decided_proposal_over_a_superseded_memory_reads_not_live(
    brain: Brain, clock: Clock
) -> None:
    book = SleepBook(brain)
    (episode,) = write_episodes(brain, 1)
    tea = brain.write_fact("user drink", "The user drinks tea.", sources=[episode])
    coffee = brain.write_fact("user drink now", "The user drinks coffee.", sources=[episode])
    proposal = book.open_proposal(
        ids.mint("cycle"), "contradiction", [coffee.id, tea.id], "?", now=iso(clock())
    )
    assert proposal is not None
    decide(brain, book, proposal.id, "forget", tea.id, clock=clock)

    kept, forgotten = _memories(book, proposal.id)
    assert kept["live"] is True and kept["text"] == "The user drinks coffee."
    assert forgotten["id"] == tea.id and forgotten["live"] is False
    assert forgotten["text"] is None and forgotten["quote"] is None
    assert set(forgotten) == MEMORY_KEYS

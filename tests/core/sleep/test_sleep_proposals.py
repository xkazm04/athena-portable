"""A person keeps or forgets; forgetting is a replicable write, never a delete (ADR 0143)."""

from __future__ import annotations

from pathlib import Path

import pytest

from athena.contracts import ids
from athena.contracts.channel import iso
from athena.core.brain import Brain, frontmatter, reconcile_from_disk
from athena.core.brain.store import replicated_path
from athena.core.recall import recall
from athena.core.sleep import OPEN_PROPOSALS_CAP, PROPOSAL_EXPIRE_D
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

"""A person's answer to a proposal: keep, or forget (ADR 0143).

A cycle never forgets anything and never settles a contradiction; it offers both. The answer is
applied here, and forgetting is a **write**, not a delete: a fact keyed ``forgotten:<orig key>``
that says ``supersedes: [<id>]`` and ``retired: true``, written through
:meth:`~athena.core.brain.store.Brain.write_fact` like any other. So it cites the forgotten
memory's own live episodes (the provenance gate holds), it is on disk, a rebuild restores it, and
replication carries it to every paired PC, where it hides the same memory. The forgotten memory's
file stays: forgetting is a closed belief with its lineage kept, never an erasure. The marker is
written in the forgotten memory's own space (ADR 0225) - a memory closes only memories of its own
space - and cites those of its sources that space can still see.

- ``keep`` closes the proposal (``kept``): a ``forget`` proposal for that memory is not offered
  again, and a contradiction keeps both.
- ``forget`` on a ``forget`` proposal retires its one memory; on a ``contradiction`` it needs
  ``node_id``, one of the two, and retires that one.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime

from athena.contracts.channel import iso
from athena.contracts.spaces import visible_spaces
from athena.core.brain.store import Brain, ProvenanceError
from athena.core.sleep import FORGOTTEN_PREFIX
from athena.core.sleep.book import ProposalRow, SleepBook

ACTIONS: tuple[str, ...] = ("keep", "forget")


class ProposalRefused(ValueError):
    """A decision that cannot be applied. ``status`` is the HTTP status, ``reason`` a member of
    ``ERROR_REASONS``."""

    def __init__(self, status: int, reason: str, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.reason = reason


def decide(
    brain: Brain,
    book: SleepBook,
    proposal_id: str,
    action: str,
    node_id: str | None,
    *,
    clock: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> ProposalRow:
    """Apply ``action`` to an open proposal and answer it as it now stands."""
    proposal = book.proposal(proposal_id)
    if proposal is None:
        raise ProposalRefused(404, "unknown_ref", f"no proposal {proposal_id}")
    if action not in ACTIONS:
        raise ProposalRefused(
            400, "validator_failed", f"action must be one of {', '.join(ACTIONS)}"
        )
    if proposal.status != "open":
        raise ProposalRefused(
            409, "validator_failed", f"proposal {proposal_id} is {proposal.status}"
        )
    now = iso(clock())
    if action == "keep":
        book.decide(proposal_id, "kept", now=now)
    else:
        target = _target(proposal, node_id)
        retire(brain, book, target, when=now)
        book.decide(proposal_id, "forgotten", now=now)
    decided = book.proposal(proposal_id)
    assert decided is not None
    return decided


def retire(brain: Brain, book: SleepBook, node_id: str, *, when: str) -> str:
    """Write the marker that hides ``node_id`` everywhere; answers the marker's id."""
    memory = book.memory(node_id)
    if memory is None:
        raise ProposalRefused(409, "validator_failed", f"{node_id} is no longer a live memory")
    cited = brain.sources_of(node_id)
    live = brain.live_episode_spaces(cited)
    seen = visible_spaces(memory.space)
    sources = [source for source in cited if live.get(source, "?") in seen]
    if not sources:
        raise ProposalRefused(
            409,
            "validator_failed",
            f"{node_id} cites no live episode, so the marker that forgets it could cite none",
        )
    key = " ".join(memory.key.split()) or node_id
    try:
        ref = brain.write_fact(
            f"{FORGOTTEN_PREFIX}{key}",
            f"Forgotten at a person's decision on {when[:10]}: {key}",
            scope=book.scope_of(node_id) or "user",
            sources=sources,
            confidence=1.0,
            supersedes=[node_id],
            retired=True,
            space=memory.space,
        )
    except (ProvenanceError, ValueError) as exc:
        raise ProposalRefused(409, "validator_failed", str(exc)) from exc
    return ref.id


def _target(proposal: ProposalRow, node_id: str | None) -> str:
    """Which memory a ``forget`` retires: the one of a ``forget`` proposal, or the named one of a
    contradiction."""
    if proposal.kind == "forget":
        if node_id is not None and node_id not in proposal.node_ids:
            raise ProposalRefused(400, "validator_failed", f"{node_id} is not this proposal's")
        if not proposal.node_ids:
            raise ProposalRefused(409, "validator_failed", "this proposal names no memory")
        return proposal.node_ids[0]
    if node_id is None:
        raise ProposalRefused(
            400, "validator_failed", "forgetting one side of a contradiction needs node_id"
        )
    if node_id not in proposal.node_ids:
        raise ProposalRefused(400, "validator_failed", f"{node_id} is not one of this proposal's")
    return node_id

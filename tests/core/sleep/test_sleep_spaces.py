"""A sleep cycle consolidates one space at a time (ADR 0225, "Memory wall"; ADR 0143).

The window holds core's episodes and two projects', and one from a project since erased. A cycle
compresses each partition on its own - core first, then each project by its most recent episode -
writes every memory with its partition's stamp, judges candidates only against what that
partition can see, and spends the cycle's caps across partitions rather than per partition.
"""

from __future__ import annotations

import re
from contextlib import closing
from datetime import UTC, datetime, timedelta
from typing import Any

from athena.contracts import ids
from athena.contracts.channel import iso
from athena.contracts.spaces import CORE
from athena.core.brain import Brain
from athena.core.recall import recall
from athena.core.sleep import FACTS_CAP
from athena.core.sleep.admission import boundary_after
from athena.core.sleep.book import SleepBook
from athena.core.sleep.cycle import SleepCycle
from athena.core.sleep.window import EpisodeReader
from athena.spaces.book import SpaceBook

from .conftest import Clock, FakeAnswer, FakeDoor, Stamp

EPISODE_ID = re.compile(r"Episode (ep_[0-9a-f]+)")


def _shown(prompt: str) -> list[str]:
    return EPISODE_ID.findall(prompt)


def _fact(key: str, value: str, source: str) -> dict[str, Any]:
    return {"key": key, "value": value, "scope": "user", "confidence": 0.8, "sources": [source]}


def _one_per_episode(prompt: str) -> FakeAnswer:
    """A compress leg that distils one fact from every episode it was shown, keyed by its id."""
    facts = [_fact(f"note {ep}", f"what episode {ep} said", ep) for ep in _shown(prompt)]
    return FakeAnswer(True, {"facts": facts, "procedurals": []})


def _run(brain: Brain, stamp: Stamp, clock: Clock, door: FakeDoor) -> Any:
    book = SleepBook(brain)
    window = EpisodeReader(brain, stamp).read(boundary_after(book.last_settled(), clock()))
    cycle_id = ids.mint("cycle")
    book.begin(
        cycle_id, started_at=iso(clock()), reason="forced", boundary=window.boundary.encode()
    )
    return SleepCycle(brain=brain, book=book, door=door, clock=clock).run(
        cycle_id, window, "forced"
    )


class Window:
    """Core, project A (newest), project B (older) and an erased project D, two episodes each."""

    def __init__(self, brain: Brain) -> None:
        book = SpaceBook(brain)
        self.a = book.create({"name": "Taxes"}).id
        self.b = book.create({"name": "Garden"}).id
        self.d = book.create({"name": "Gone"}).id
        start = datetime.now(UTC) - timedelta(hours=1)
        self.eps: dict[str, list[str]] = {}
        # B's episodes are the oldest of the projects', A's the newest; core's sit between.
        plan = ((self.b, 0), (CORE, 10), (self.d, 20), (self.a, 30))
        for space, offset in plan:
            self.eps[space] = [
                brain.append_episode(
                    f"episode {n} of {space or 'core'} " + "lorem ipsum " * 20,
                    created=start + timedelta(seconds=offset + n),
                    space=space,
                ).id
                for n in range(2)
            ]
        book.delete_file(self.d)
        self.space_of = {ep: space for space, eps in self.eps.items() for ep in eps}


def _facts_by_space(brain: Brain) -> dict[str, tuple[str, list[str]]]:
    """Every fact the cycle wrote: its stamp, and the episodes it cites."""
    with closing(brain.read_connection()) as con:
        rows = con.execute("SELECT id, space FROM companion_node WHERE kind = 'fact'").fetchall()
    return {str(i): (str(s), brain.sources_of(str(i))) for i, s in rows}


def test_each_partition_is_compressed_alone_and_its_memories_carry_its_stamp(
    brain: Brain, stamp: Stamp, clock: Clock
) -> None:
    world = Window(brain)
    door = FakeDoor(compress=_one_per_episode, merge=lambda prompt: FakeAnswer(True, {}))

    row = _run(brain, stamp, clock, door)

    compress_calls = [prompt for kind, prompt in door.calls if kind == "sleep.compress"]
    # Core first, then the projects by their most recent episode: A (newest) before B.
    assert [set(_shown(p)) for p in compress_calls] == [
        set(world.eps[CORE]),
        set(world.eps[world.a]),
        set(world.eps[world.b]),
    ]
    # The erased project's episodes are read past, never shown to a leg, and counted.
    shown = {ep for p in compress_calls for ep in _shown(p)}
    assert shown.isdisjoint(world.eps[world.d])
    assert row.status == "completed" and row.stats["space_unknown"] == 2
    assert row.stats["partitions"] == [[CORE, 2], [world.a, 2], [world.b, 2]]
    # Every fact is stamped with its partition, which is the space of every episode it cites.
    written = _facts_by_space(brain)
    assert len(written) == 6
    for space, sources in written.values():
        assert {world.space_of[s] for s in sources} == {space}
    # And recall agrees: A's facts in A, never in core or B.
    a_facts = {i for i, (s, _) in written.items() if s == world.a}
    assert len(a_facts) == 2
    assert a_facts <= {m.id for m in recall(brain, "what episode said", space=world.a).items}
    for where in (CORE, world.b):
        assert a_facts.isdisjoint(
            m.id for m in recall(brain, "what episode said", space=where).items
        )


def test_the_fact_cap_is_the_cycles_across_partitions_and_core_spends_first(
    brain: Brain, stamp: Stamp, clock: Clock
) -> None:
    world = Window(brain)

    def flood(prompt: str) -> FakeAnswer:
        first = _shown(prompt)[0]
        facts = [_fact(f"k {first} {n}", f"value {n} of {first}", first) for n in range(FACTS_CAP)]
        return FakeAnswer(True, {"facts": facts, "procedurals": []})

    row = _run(brain, stamp, clock, FakeDoor(compress=flood, merge=lambda p: FakeAnswer(True, {})))

    written = _facts_by_space(brain)
    assert row.stats["facts_written"] == len(written) == FACTS_CAP
    assert row.stats["facts_dropped"] == 2 * FACTS_CAP
    assert {space for space, _ in written.values()} == {CORE}
    assert world.a and world.b  # the projects' candidates were the ones dropped


def test_a_candidate_is_judged_only_against_what_its_project_can_see(
    brain: Brain, stamp: Stamp, clock: Clock
) -> None:
    book = SpaceBook(brain)
    a = book.create({"name": "Taxes"}).id
    b = book.create({"name": "Garden"}).id
    old = datetime.now(UTC) - timedelta(days=30)
    seed_core = brain.append_episode("ledger seed core", created=old)
    seed_b = brain.append_episode("ledger seed b", created=old, space=b)
    core_fact = brain.write_fact("ledger total", "The ledger total is 10.", sources=[seed_core.id])
    b_fact = brain.write_fact(
        "ledger total", "The ledger total is 99.", sources=[seed_b.id], space=b
    )
    SleepBook(brain)  # the cycle's first window starts a week back: the seeds are not in it
    episode = brain.append_episode("the ledger total is now 12 " + "lorem " * 30, space=a)

    def compress(prompt: str) -> FakeAnswer:
        return FakeAnswer(
            True,
            {
                "facts": [_fact("ledger total", "The ledger total is 12.", episode.id)],
                "procedurals": [],
            },
        )

    merges: list[str] = []

    def merge(prompt: str) -> FakeAnswer:
        merges.append(prompt)
        # The judge says the new value closes core's - which, from inside A, it may not.
        verdict = {"candidate": 0, "contradicts": None, "supersedes": [core_fact.id]}
        return FakeAnswer(True, {"verdicts": [{**verdict, "duplicate_of": None}]})

    row = _run(brain, stamp, clock, FakeDoor(compress=compress, merge=merge))

    (prompt,) = merges
    assert core_fact.id in prompt and b_fact.id not in prompt
    assert row.stats["supersedes"] == 0 and row.stats["facts_written"] == 1
    # Core's fact is untouched, in core and in B; A's new one stands beside it in A.
    in_core = {m.id for m in recall(brain, "ledger total").items}
    assert core_fact.id in in_core
    in_a = {m.id for m in recall(brain, "ledger total", space=a).items}
    assert core_fact.id in in_a and b_fact.id not in in_a
    with closing(brain.read_connection()) as con:
        (count,) = con.execute("SELECT COUNT(*) FROM companion_supersede").fetchone()
    assert count == 0


def test_a_contradiction_found_in_a_project_is_proposed_in_that_project(
    brain: Brain, stamp: Stamp, clock: Clock
) -> None:
    a = SpaceBook(brain).create({"name": "Taxes"}).id
    seed = brain.append_episode(
        "ledger seed", created=datetime.now(UTC) - timedelta(days=30), space=a
    )
    held = brain.write_fact("ledger owner", "Dana owns the ledger.", sources=[seed.id], space=a)
    episode = brain.append_episode("Sam owns the ledger now " + "lorem " * 30, space=a)

    def compress(prompt: str) -> FakeAnswer:
        fact = _fact("ledger owner", "Sam owns the ledger.", episode.id)
        return FakeAnswer(True, {"facts": [fact], "procedurals": []})

    def merge(prompt: str) -> FakeAnswer:
        verdict = {"candidate": 0, "contradicts": held.id, "supersedes": [], "duplicate_of": None}
        return FakeAnswer(True, {"verdicts": [verdict]})

    _run(brain, stamp, clock, FakeDoor(compress=compress, merge=merge))

    (proposal,) = SleepBook(brain).proposals()
    assert proposal.kind == "contradiction" and proposal.space == a
    assert "space" not in proposal.view()  # the wire's ProposalView is unchanged
    assert brain.erase_space(a)["fact"] == 2
    assert SleepBook(brain).proposals() == []

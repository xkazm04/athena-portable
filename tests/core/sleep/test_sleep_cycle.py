"""One cycle: compress, merge, fade, forget proposals, the journal, and the boundary (ADR 0143)."""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any

from athena.contracts import ids
from athena.contracts.channel import iso
from athena.core.brain import Brain, frontmatter
from athena.core.recall import recall
from athena.core.sleep import COMPRESS_EPISODES, FACTS_CAP, FORGOTTEN_PREFIX, SUPERSEDES_CAP
from athena.core.sleep.admission import boundary_after
from athena.core.sleep.book import SleepBook
from athena.core.sleep.cycle import SleepCycle
from athena.core.sleep.legs import Candidate
from athena.core.sleep.proposals import decide
from athena.core.sleep.window import Boundary, EpisodeReader, Window

from .conftest import (
    Clock,
    FakeAnswer,
    FakeDoor,
    Stamp,
    answer,
    failing,
    no_verdicts,
    write_episodes,
)

EPISODE_ID = re.compile(r"Episode (ep_[0-9a-f]+)")


def _shown(prompt: str) -> list[str]:
    return EPISODE_ID.findall(prompt)


def _fact(key: str, value: str, sources: list[str], scope: str = "user") -> dict[str, Any]:
    return {"key": key, "value": value, "scope": scope, "confidence": 0.8, "sources": sources}


def _window(brain: Brain, stamp: Stamp, clock: Clock, book: SleepBook) -> Window:
    return EpisodeReader(brain, stamp).read(boundary_after(book.last_settled(), clock()))


def _run(brain: Brain, book: SleepBook, door: FakeDoor, clock: Clock, window: Window) -> Any:
    cycle_id = ids.mint("cycle")
    book.begin(
        cycle_id, started_at=iso(clock()), reason="forced", boundary=window.boundary.encode()
    )
    phases: list[str | None] = []
    row = SleepCycle(brain=brain, book=book, door=door, clock=clock, on_phase=phases.append).run(
        cycle_id, window, "forced"
    )
    return row, phases


def test_compress_and_merge_write_checked_memories_and_a_journal(
    brain: Brain, stamp: Stamp, clock: Clock
) -> None:
    book = SleepBook(brain)
    episodes = write_episodes(brain, 5, chars=300)
    door = FakeDoor(
        compress=answer(
            {
                "facts": [
                    _fact(
                        "acme payment terms",
                        "Acme pays at 45 days.",
                        [episodes[0], "ep_ffffffffffff"],
                    ),
                    _fact("made up", "cites nothing real", ["ep_000000000000"]),
                ],
                "procedurals": [
                    {
                        "trigger": "when Acme is late",
                        "rule": "send the reminder on Monday",
                        "scope": "action",
                        "confidence": 0.6,
                        "sources": [episodes[1]],
                    }
                ],
            }
        ),
        merge=no_verdicts(),
    )
    row, phases = _run(brain, book, door, clock, _window(brain, stamp, clock, book))

    assert row.status == "completed", row
    assert phases == ["compress", "merge", "fade", None]
    assert door.kinds() == ["sleep.compress"], "nothing to compare against: no merge call"
    assert _shown(door.calls[0][1]) == episodes
    stats = row.stats
    assert stats["facts_written"] == 1 and stats["procedurals_written"] == 1
    assert stats["unknown_ids"] == 2 and stats["rejected"] == 1
    assert stats["episodes_in"] == 5 and stats["episodes_available"] == 5
    assert stats["truncated"] is False
    assert row.consumed_through == f"{_created(brain, episodes[-1])}|{episodes[-1]}"

    journals = list((brain.root / "cycles").glob(f"*-{row.id}.md"))
    assert len(journals) == 1
    meta, body = frontmatter.parse(journals[0].read_text(encoding="utf-8"))
    assert meta["id"] == row.id and meta["type"] == "cycle_report"
    assert "acme payment terms" in body and "when Acme is late" in body
    assert "lorem ipsum" not in body, "never an episode's body"
    assert "5 of 5 episodes" in body
    trace = recall(brain, "Acme pays")
    assert any("45 days" in memory.excerpt for memory in trace.items)


def test_a_compress_failure_writes_nothing_and_keeps_the_boundary(
    brain: Brain, stamp: Stamp, clock: Clock
) -> None:
    book = SleepBook(brain)
    write_episodes(brain, 5, chars=300)
    door = FakeDoor(compress=failing("timeout"))
    window = _window(brain, stamp, clock, book)
    row, _ = _run(brain, book, door, clock, window)

    assert row.status == "failed"
    assert row.reason is not None and row.reason.startswith("The compress step failed")
    assert row.consumed_through is None
    assert book.last_settled() is None
    assert brain.counts().get("fact", 0) == 0
    assert not list((brain.root / "cycles").glob("*.md"))
    assert boundary_after(book.last_settled(), clock()) == Boundary.first(clock())


def test_a_merge_failure_keeps_the_compressed_candidates_once(
    brain: Brain, stamp: Stamp, clock: Clock
) -> None:
    book = SleepBook(brain)
    episodes = write_episodes(brain, 3, chars=300)
    known = brain.write_fact("acme payment terms", "Acme pays at 30 days.", sources=[episodes[0]])
    door = FakeDoor(
        compress=answer(
            {
                "facts": [
                    _fact("Acme  payment terms", "Acme pays at 30 days.", [episodes[1]]),
                    _fact("acme contact", "Jana runs Acme's accounts.", [episodes[2]]),
                ],
                "procedurals": [],
            }
        ),
        merge=failing("parse_error"),
    )
    row, _ = _run(brain, book, door, clock, _window(brain, stamp, clock, book))

    assert row.status == "partial"
    assert row.stats["merge_degraded"] is True
    assert row.stats["duplicates"] == 1 and row.stats["facts_written"] == 1
    assert row.consumed_through is not None, "the window was read: the boundary moves"
    keys = _fact_keys(brain)
    assert keys.count("acme payment terms") == 1 and "acme contact" in keys
    journal = next((brain.root / "cycles").glob(f"*-{row.id}.md")).read_text(encoding="utf-8")
    assert "The merge step failed" in journal and known.id in journal


def test_merge_verdicts_supersede_contradict_and_confirm(
    brain: Brain, stamp: Stamp, clock: Clock
) -> None:
    book = SleepBook(brain)
    episodes = write_episodes(brain, 4, chars=300)
    old_job = brain.write_fact("user employer", "The user works at Beta.", sources=[episodes[0]])
    old_tea = brain.write_fact("user drink", "The user drinks tea.", sources=[episodes[0]])
    old_city = brain.write_fact("user city", "The user lives in Brno.", sources=[episodes[0]])

    def merged(prompt: str) -> FakeAnswer:
        # The candidates are numbered as the compress leg returned them.
        return FakeAnswer(
            True,
            {
                "verdicts": [
                    {
                        "candidate": 0,
                        "contradicts": None,
                        "supersedes": [old_job.id],
                        "duplicate_of": None,
                    },
                    # Contradiction is applied before duplicate, whatever else the judge said.
                    {
                        "candidate": 1,
                        "contradicts": old_tea.id,
                        "supersedes": [],
                        "duplicate_of": old_tea.id,
                    },
                    {
                        "candidate": 2,
                        "contradicts": None,
                        "supersedes": [],
                        "duplicate_of": old_city.id,
                    },
                    {
                        "candidate": 3,
                        "contradicts": "fact_ffffffffffff",
                        "supersedes": [],
                        "duplicate_of": None,
                    },
                ]
            },
        )

    door = FakeDoor(
        compress=answer(
            {
                "facts": [
                    _fact("user employer", "The user works at Acme now.", [episodes[1]]),
                    _fact("user drink", "The user never drinks tea.", [episodes[2]]),
                    _fact("user city", "The user lives in Brno.", [episodes[3]]),
                    _fact(
                        "user employer start", "The user works at Acme since May.", [episodes[1]]
                    ),
                ],
                "procedurals": [],
            }
        ),
        merge=merged,
    )
    row, _ = _run(brain, book, door, clock, _window(brain, stamp, clock, book))

    assert row.status == "completed"
    assert row.stats["supersedes"] == 1 and row.stats["contradictions"] == 1
    assert row.stats["duplicates"] == 1 and row.stats["facts_written"] == 3
    assert row.stats["unknown_ids"] >= 1
    employer = recall(brain, "works at Acme Beta employer")
    shown = {memory.id for memory in employer.items}
    assert old_job.id not in shown, "a superseded fact is never served"
    proposals = book.proposals()
    assert [p.kind for p in proposals] == ["contradiction"]
    assert old_tea.id in proposals[0].node_ids and len(proposals[0].node_ids) == 2
    assert _fact_keys(brain).count("user city") == 1


def test_caps_drop_and_count(brain: Brain, stamp: Stamp, clock: Clock) -> None:
    book = SleepBook(brain)
    episodes = write_episodes(brain, 2, chars=300)
    facts = [_fact(f"topic {i}", f"value {i}", [episodes[0]]) for i in range(FACTS_CAP + 3)]
    door = FakeDoor(compress=answer({"facts": facts, "procedurals": []}), merge=no_verdicts())
    row, _ = _run(brain, book, door, clock, _window(brain, stamp, clock, book))
    assert row.stats["facts_written"] == FACTS_CAP
    assert row.stats["facts_dropped"] == 3


def test_supersede_links_are_capped(brain: Brain, stamp: Stamp, clock: Clock) -> None:
    book = SleepBook(brain)
    episodes = write_episodes(brain, 2, chars=300)
    olds = [
        brain.write_fact(f"thing {i}", f"thing {i} is old", sources=[episodes[0]]).id
        for i in range(SUPERSEDES_CAP + 2)
    ]
    candidates = [_fact(f"thing {i}", f"thing {i} is new", [episodes[1]]) for i in range(len(olds))]

    def merged(prompt: str) -> FakeAnswer:
        verdicts = []
        for index in range(len(olds)):
            listed = re.search(
                rf"Candidate {index} \(fact\):.*?Existing:(.*?)(?:Candidate|\Z)", prompt, re.S
            )
            assert listed is not None
            target = next(old for old in olds if old in listed.group(1))
            verdicts.append(
                {
                    "candidate": index,
                    "contradicts": None,
                    "supersedes": [target],
                    "duplicate_of": None,
                }
            )
        return FakeAnswer(True, {"verdicts": verdicts})

    door = FakeDoor(compress=answer({"facts": candidates, "procedurals": []}), merge=merged)
    row, _ = _run(brain, book, door, clock, _window(brain, stamp, clock, book))
    assert row.stats["supersedes"] == SUPERSEDES_CAP
    assert row.stats["supersedes_dropped"] == 2
    assert row.stats["facts_written"] == len(olds)


def test_drain_forward_across_two_cycles(brain: Brain, stamp: Stamp, clock: Clock) -> None:
    """Caps take the oldest; the next cycle starts exactly after the newest one read."""
    book = SleepBook(brain)
    episodes = write_episodes(brain, COMPRESS_EPISODES + 30, chars=50)
    door = FakeDoor(compress=answer({"facts": [], "procedurals": []}))

    first, _ = _run(brain, book, door, clock, _window(brain, stamp, clock, book))
    assert first.status == "partial" and first.stats["truncated"] is True
    assert first.stats["episodes_in"] == COMPRESS_EPISODES
    assert first.stats["episodes_available"] == COMPRESS_EPISODES + 30
    read_first = _shown(door.calls[0][1])
    assert read_first == episodes[:COMPRESS_EPISODES]

    second_window = _window(brain, stamp, clock, book)
    assert second_window.boundary.after_id == episodes[COMPRESS_EPISODES - 1]
    second, _ = _run(brain, book, door, clock, second_window)
    assert second.status == "completed"
    assert _shown(door.calls[1][1]) == episodes[COMPRESS_EPISODES:]
    third = _window(brain, stamp, clock, book)
    assert third.episodes_available == 0


def test_a_peers_episodes_are_passed_and_the_boundary_walks_past_them(
    brain: Brain, stamp: Stamp, clock: Clock
) -> None:
    book = SleepBook(brain)
    stamp.device = "dev_bbbbbbbbbbbb"
    peers = write_episodes(brain, 3, chars=50, tag="peer")
    stamp.device = "dev_aaaaaaaaaaaa"
    door = FakeDoor(compress=answer({"facts": [], "procedurals": []}))
    row, _ = _run(brain, book, door, clock, _window(brain, stamp, clock, book))
    assert door.calls == [], "nothing of this PC's to read: no leg"
    assert row.status == "completed"
    assert row.consumed_through is not None and row.consumed_through.endswith(peers[-1])


def test_fade_steps_once_a_month_and_offers_forgetting(
    brain: Brain, stamp: Stamp, clock: Clock
) -> None:
    book = SleepBook(brain)
    episodes = write_episodes(brain, 1, chars=50)
    stale = brain.write_fact("old habit", "The user once liked fax machines.", sources=episodes)
    door = FakeDoor(compress=answer({"facts": [], "procedurals": []}))
    empty = Window(Boundary(iso(clock())))

    clock.advance(days=31)
    row, _ = _run(brain, book, door, clock, empty)
    assert row.stats["faded"] == 1 and book.steps(stale.id) == 1
    row, _ = _run(brain, book, door, clock, empty)
    assert row.stats["faded"] == 0, "one step per month of disuse, not per cycle"
    for steps in (2, 3):
        clock.advance(days=31)
        row, _ = _run(brain, book, door, clock, empty)
        assert book.steps(stale.id) == steps
    assert row.stats["forget_proposed"] == 1
    clock.advance(days=31)
    row, _ = _run(brain, book, door, clock, empty)
    assert row.stats["faded"] == 0 and row.stats["forget_proposed"] == 0, "offered once"
    (proposal,) = book.proposals()
    assert proposal.kind == "forget" and proposal.node_ids == [stale.id]
    assert all(not key.startswith(FORGOTTEN_PREFIX) for key in _fact_keys(brain)), "report-only"


def _fact_keys(brain: Brain) -> list[str]:
    with brain.read_connection() as con:
        rows = con.execute(
            """SELECT fc.fact_key FROM companion_fact fc JOIN companion_node n ON n.id = fc.id
               WHERE n.importance > 0"""
        ).fetchall()
    return [str(row[0]) for row in rows]


def _created(brain: Brain, node_id: str) -> str:
    node = brain.node(node_id)
    assert node is not None
    return node.created_at


def test_a_persons_forget_bars_the_key_until_the_person_writes_it_again(
    brain: Brain, stamp: Stamp, clock: Clock
) -> None:
    """decay-and-forgetting: a deliberate forget bars its key (kind, scope, key - never the
    wording) from the next cycles; a barred candidate is skipped and counted, and only a person's
    own write under that key lifts the bar."""
    book = SleepBook(brain)
    first = write_episodes(brain, 3, tag="fax", start=datetime.now(UTC) - timedelta(hours=3))
    fax = brain.write_fact("fax machines", "The user likes fax machines.", sources=[first[0]])
    proposal = book.open_proposal(ids.mint("cycle"), "forget", [fax.id], "?", now=iso(clock()))
    assert proposal is not None
    decide(brain, book, proposal.id, "forget", None, clock=clock)
    bars = book.bars()
    assert ("fact", "user", "fax machines") in bars
    assert ("fact", "world", "fax machines") not in bars, "the bar is the forgotten one's scope"

    # The episodes that grounded it are still there, and the model offers it back - the same key
    # in other casing and spacing - beside a new fact.
    door = FakeDoor(
        compress=answer(
            {
                "facts": [
                    _fact("Fax  Machines", "The user loves fax machines.", [first[1]]),
                    _fact("printer brand", "The user's printer is a Brother.", [first[1]]),
                ],
                "procedurals": [],
            }
        ),
        merge=no_verdicts(),
    )
    row, _ = _run(brain, book, door, clock, _window(brain, stamp, clock, book))
    assert row.status == "completed", row
    assert row.stats["barred"] == 1
    assert row.stats["facts_written"] == 1, "the new fact is learned"
    merged = [prompt for kind, prompt in door.calls if kind == "sleep.merge"]
    assert all("loves fax machines" not in prompt for prompt in merged), "never even judged"
    excerpts = [memory.excerpt for memory in recall(brain, "fax machines").items]
    assert not any("loves fax machines" in excerpt for excerpt in excerpts)
    (journal,) = (brain.root / "cycles").glob(f"*-{row.id}.md")
    body = journal.read_text(encoding="utf-8")
    assert "## Not learned again" in body and "`Fax Machines`" in body

    # The person says it again through the approved door: the bar lifts, and the next cycle may
    # learn under that key like any other.
    brain.write_fact("fax machines", "The user likes fax machines after all.", sources=[first[2]])
    assert ("fact", "user", "fax machines") not in book.bars()
    again = write_episodes(brain, 2, tag="again")
    door = FakeDoor(
        compress=answer(
            {
                "facts": [_fact("fax machines", "The user collects fax machines.", [again[0]])],
                "procedurals": [],
            }
        ),
        merge=no_verdicts(),
    )
    row, _ = _run(brain, book, door, clock, _window(brain, stamp, clock, book))
    assert row.stats["barred"] == 0 and row.stats["facts_written"] == 1


def test_only_a_persons_forget_bars_and_only_its_own_key(brain: Brain, clock: Clock) -> None:
    """No marker, no bar: a supersede bars nothing, and a forget bars its key alone."""
    book = SleepBook(brain)
    (episode,) = write_episodes(brain, 1)
    assert book.bars() == {}
    old = brain.write_fact("user city", "The user lives in Brno.", sources=[episode])
    brain.write_fact(
        "user city", "The user lives in Prague.", sources=[episode], supersedes=[old.id]
    )
    assert book.bars() == {}, "a supersede is not a forget"
    tea = brain.write_fact("user drink", "The user drinks tea.", sources=[episode])
    proposal = book.open_proposal(ids.mint("cycle"), "forget", [tea.id], "?", now=iso(clock()))
    assert proposal is not None
    decide(brain, book, proposal.id, "forget", None, clock=clock)
    assert set(book.bars()) == {("fact", "user", "user drink")}


def test_the_degraded_merge_reads_the_live_memories_once_per_kind_not_once_per_candidate(
    brain: Brain,
) -> None:
    """Instrument for the sleep-cycle scan count: 18 candidates (12 facts, 6 procedurals) judged
    by key must cost one read per kind, with the same verdicts a per-candidate lookup gave."""
    book = SleepBook(brain)
    (episode,) = write_episodes(brain, 1)
    brain.write_fact("user city", "The user lives in Brno.", sources=[episode])
    brain.write_procedural("answer briefly", "Keep answers short.", sources=[episode])
    candidates = [
        Candidate("fact", f"fact {i}", "v", "user", 0.9, (episode,)) for i in range(11)
    ] + [Candidate("fact", "User   CITY", "v", "user", 0.9, (episode,))]
    candidates += [
        Candidate("procedural", f"trigger {i}", "v", "user", 0.9, (episode,)) for i in range(5)
    ]
    candidates.append(Candidate("procedural", "Answer  Briefly", "v", "user", 0.9, (episode,)))

    reads: list[str] = []
    real = book._all

    def counting(sql: str, params: tuple[Any, ...] = ()) -> Any:
        reads.append(sql)
        return real(sql, params)

    book._all = counting  # type: ignore[method-assign]
    verdicts = SleepCycle._by_key(SimpleNamespace(book=book), candidates)  # type: ignore[arg-type]
    assert len(reads) == 2, "one read per kind, not one per candidate (18 before)"
    duplicates = {i for i, v in verdicts.items() if v.decision == "duplicate"}
    assert duplicates == {11, 17}, "a key matches ignoring case and spacing, within its kind"

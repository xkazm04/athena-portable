"""A sleep window that keeps failing backs off, halves its take and quarantines (ADR 0190).

One failure holds the next cycle an hour, as before. Repeated failure over the same boundary is a
state: the backoff doubles up to a cap, a content-shaped failure (``parse_error``, ``timeout``)
halves the next take to isolate the bad material, and a single episode that fails alone twice is
walked past - never deleted: it stays indexed and recallable, it is only not distilled.
"""

from __future__ import annotations

import re
from contextlib import closing
from datetime import timedelta
from typing import Any

import pytest

import athena.core.sleep as sleep
from athena.contracts import ids
from athena.contracts.channel import iso
from athena.core.brain import Brain
from athena.core.recall import recall_whole
from athena.core.sleep.admission import boundary_after
from athena.core.sleep.book import SleepBook
from athena.core.sleep.cycle import SleepCycle
from athena.core.sleep.window import Window

from .conftest import (
    Clock,
    FakeDoor,
    Rig,
    Stamp,
    answer,
    failing,
    no_verdicts,
    rig,
    write_episodes,
)

EPISODE_ID = re.compile(r"Episode (ep_[0-9a-f]+)")


def _shown(prompt: str) -> list[str]:
    return EPISODE_ID.findall(prompt)


def _window(r: Rig) -> Window:
    return r.reader.read(boundary_after(r.book.last_settled(), r.clock()))


def _cycle(r: Rig, door: FakeDoor, reason: str = "pressure") -> Any:
    window = _window(r)
    cycle_id = ids.mint("cycle")
    r.book.begin(
        cycle_id, started_at=iso(r.clock()), reason=reason, boundary=window.boundary.encode()
    )
    return SleepCycle(brain=r.brain, book=r.book, door=door, clock=r.clock).run(
        cycle_id, window, reason
    )


def _verdict(r: Rig, force: bool = False) -> Any:
    admission = r.admission.admit(force)
    if admission.lease is not None:
        admission.lease.release()
    return admission.verdict


def _failed_row(book: SleepBook, clock: Clock, *, hours_ago: float, failure: str, take: int) -> str:
    """A failed cycle as a past run would have left it, with its failure class and take."""
    cycle_id = ids.mint("cycle")
    at = clock() - timedelta(hours=hours_ago)
    book.begin(cycle_id, started_at=iso(at - timedelta(minutes=5)), reason="stale", boundary="")
    book.finish(
        cycle_id,
        status="failed",
        finished_at=iso(at),
        stats={"failure": failure, "take": take},
        reason="The compress step failed.",
    )
    return cycle_id


def _nothing() -> Any:
    return answer({"facts": [], "procedurals": []})


def _created(brain: Brain, node_id: str) -> str:
    with closing(brain.read_connection()) as con:
        (created,) = con.execute(
            "SELECT created_at FROM companion_node WHERE id = ?", (node_id,)
        ).fetchone()
    return str(created)


# -- the backoff escalates ------------------------------------------------------------------------


def test_two_failures_in_a_row_back_off_two_hours_and_say_so(
    brain: Brain, clock: Clock, stamp: Stamp
) -> None:
    r = rig(brain, clock, stamp)
    write_episodes(brain, 5, chars=300)
    assert _cycle(r, FakeDoor(compress=failing("parse_error"))).status == "failed"
    clock.advance(hours=1.1)
    assert _cycle(r, FakeDoor(compress=failing("parse_error"))).status == "failed"
    clock.advance(hours=1.5)
    verdict = _verdict(r)
    assert verdict.reason == "failed_recently", verdict
    assert "2 cycles in a row" in verdict.text
    assert "2 h" in verdict.text
    clock.advance(hours=0.6)
    assert _verdict(r).reason != "failed_recently"


def test_four_failures_back_off_eight_hours_and_ten_are_capped(
    brain: Brain, clock: Clock, stamp: Stamp
) -> None:
    r = rig(brain, clock, stamp)
    cap = getattr(sleep, "FAILED_BACKOFF_CAP_H", None)
    assert cap == 24
    for hours_ago in (3.0, 2.0, 1.0, 0.0):
        _failed_row(r.book, clock, hours_ago=hours_ago, failure="engine_error", take=10)
    clock.advance(hours=7.9)
    verdict = _verdict(r)
    assert verdict.reason == "failed_recently" and "4 cycles in a row" in verdict.text
    clock.advance(hours=0.2)
    assert _verdict(r).reason != "failed_recently"

    for hours_ago in (6.0, 5.0, 4.0, 3.0, 2.0, 1.0):
        _failed_row(r.book, clock, hours_ago=hours_ago, failure="engine_error", take=10)
    _failed_row(r.book, clock, hours_ago=0.0, failure="engine_error", take=10)
    # 4 + 7 = 11 in a row by now; the cap holds whatever the count.
    clock.advance(hours=23.9)
    verdict = _verdict(r)
    assert verdict.reason == "failed_recently" and "24 h" in verdict.text
    clock.advance(hours=0.2)
    assert _verdict(r).reason != "failed_recently"


# -- the take halves ------------------------------------------------------------------------------


@pytest.mark.parametrize("reason", ["parse_error", "timeout"])
def test_a_content_failure_halves_the_next_take(
    brain: Brain, clock: Clock, stamp: Stamp, reason: str
) -> None:
    r = rig(brain, clock, stamp)
    write_episodes(brain, 130, chars=100)
    failed = _cycle(r, FakeDoor(compress=failing(reason)))
    assert failed.status == "failed"
    assert failed.stats["failure"] == reason
    assert failed.stats["take"] == sleep.COMPRESS_EPISODES == 120

    door = FakeDoor(compress=_nothing(), merge=no_verdicts())
    row = _cycle(r, door, reason="forced")  # a forced cycle uses the shrunken take too
    assert len(_shown(door.calls[0][1])) == 60
    assert row.status == "partial", "the rest of the window waits for the next cycle"


def test_an_engine_error_backs_off_but_never_shrinks_the_take(
    brain: Brain, clock: Clock, stamp: Stamp
) -> None:
    r = rig(brain, clock, stamp)
    write_episodes(brain, 130, chars=100)
    for _ in range(2):
        failed = _cycle(r, FakeDoor(compress=failing("engine_error")))
        assert failed.stats["failure"] == "engine_error" and failed.stats["take"] == 120
        clock.advance(hours=3)
    door = FakeDoor(compress=_nothing(), merge=no_verdicts())
    _cycle(r, door)
    assert len(_shown(door.calls[0][1])) == 120


# -- quarantine -----------------------------------------------------------------------------------


def test_a_single_episode_that_fails_alone_twice_is_walked_past_not_deleted(
    brain: Brain, clock: Clock, stamp: Stamp
) -> None:
    r = rig(brain, clock, stamp)
    poison, *rest = write_episodes(brain, 3, chars=300, tag="zanzibarpoison")
    episodes_before = brain.counts()["episode"]

    takes = []
    for _ in range(3):  # 3 episodes, then 1, then 1 again
        door = FakeDoor(compress=failing("parse_error"))
        failed = _cycle(r, door)
        assert failed.status == "failed"
        takes.append(len(_shown(door.calls[0][1])))
        clock.advance(hours=2)
    assert takes == [3, 1, 1]

    door = FakeDoor(compress=_nothing(), merge=no_verdicts())
    row = _cycle(r, door)
    assert door.calls == [], "no leg call over the quarantined episode"
    assert row.status == "partial"
    assert row.consumed_through == f"{_created(brain, poison)}|{poison}"
    assert row.stats["skipped"] == 1
    (journal,) = (brain.root / "cycles").glob(f"*-{row.id}.md")
    body = journal.read_text(encoding="utf-8")
    assert "## Skipped" in body and poison in body

    # Parked, not deleted: still indexed, still recalled.
    assert brain.counts()["episode"] == episodes_before
    found = recall_whole(brain, "zanzibarpoison", cap=20_000)
    assert poison in {memory.id for memory in found.items}

    # The next cycle reads past it, at full size.
    door = FakeDoor(compress=_nothing(), merge=no_verdicts())
    _cycle(r, door)
    assert _shown(door.calls[0][1]) == rest


def test_a_settled_cycle_resets_the_count(brain: Brain, clock: Clock, stamp: Stamp) -> None:
    r = rig(brain, clock, stamp)
    write_episodes(brain, 10, chars=300)
    assert _cycle(r, FakeDoor(compress=failing("parse_error"))).status == "failed"
    clock.advance(hours=2)
    door = FakeDoor(compress=_nothing(), merge=no_verdicts())
    settled = _cycle(r, door)
    assert len(_shown(door.calls[0][1])) == 5 and settled.status == "partial"

    clock.advance(hours=7)  # past the floor of the partial cycle
    door = FakeDoor(compress=failing("parse_error"))
    _cycle(r, door)
    assert len(_shown(door.calls[0][1])) == 5, "the take is full again after a settled cycle"
    clock.advance(hours=0.9)
    verdict = _verdict(r)
    assert verdict.reason == "failed_recently" and "in a row" not in verdict.text
    clock.advance(hours=0.15)
    assert _verdict(r).reason != "failed_recently", "one failure since the reset: 1 h"


# -- guards (green before the change, by design) ------------------------------------------------


def test_guard_a_single_failure_holds_exactly_one_hour(
    brain: Brain, clock: Clock, stamp: Stamp
) -> None:
    r = rig(brain, clock, stamp)
    write_episodes(brain, 5, chars=300)
    _cycle(r, FakeDoor(compress=failing("timeout")))
    clock.advance(hours=0.95)
    verdict = _verdict(r)
    assert verdict.reason == "failed_recently"
    assert verdict.text.endswith(f"after {sleep.FAILED_BACKOFF_H} h.")
    clock.advance(hours=0.1)
    assert _verdict(r).reason != "failed_recently"


def test_guard_a_crashed_running_row_is_no_failure_and_force_skips_the_backoff(
    brain: Brain, clock: Clock, stamp: Stamp
) -> None:
    r = rig(brain, clock, stamp)
    write_episodes(brain, 5, chars=300)
    _failed_row(r.book, clock, hours_ago=1.2, failure="parse_error", take=5)
    # A process died mid-cycle after it: the row stays running and is never a failure.
    r.book.begin(
        ids.mint("cycle"),
        started_at=iso(clock() - timedelta(hours=1)),
        reason="pressure",
        boundary="",
    )
    assert _verdict(r).reason != "failed_recently", "one failure, 1.2 h ago: the hour is over"
    _failed_row(r.book, clock, hours_ago=0.1, failure="parse_error", take=2)
    assert _verdict(r).reason == "failed_recently"
    assert _verdict(r, force=True).reason == "forced"

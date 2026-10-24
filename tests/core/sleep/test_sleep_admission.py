"""One owner admits a cycle, in one ladder, and every refusal has a name (ADR 0143)."""

from __future__ import annotations

import threading
from datetime import timedelta

from athena.contracts import ids
from athena.contracts.channel import iso
from athena.core.brain import Brain
from athena.core.sleep import EPISODE_FETCH, MIN_CHARS, PRESSURE_CHARS
from athena.core.sleep.admission import ADMISSIONS, REFUSALS
from athena.core.sleep.window import Boundary, EpisodeReader

from .conftest import DEV_A, DEV_B, Clock, Rig, Stamp, rig, settle, vitals, write_episodes


def _reason(r: Rig, force: bool = False) -> str:
    admission = r.admission.admit(force)
    if admission.lease is not None:
        admission.lease.release()
    return admission.verdict.reason


def test_every_refusal_answers_in_ladder_order(brain: Brain, clock: Clock, stamp: Stamp) -> None:
    """Every condition true at once, then peeled off one at a time: each answer is the next."""
    r = rig(brain, clock, stamp)
    write_episodes(brain, 3, chars=100)  # too little
    settle(r.book, clock, hours_ago=1)  # floor
    held = r.claim.try_take()
    r.turns.busy = True
    r.room.view = vitals(power="battery", disk_free_mb=10, ram_pct=95.0)
    r.room.hold = "Waiting for room: RAM is 95% used."
    settle(r.book, clock, hours_ago=0.1, status="failed")  # failed recently

    seen = []
    assert held is not None
    seen.append(_reason(r))
    held.release()
    seen.append(_reason(r))
    r.turns.busy = False
    r.turns.released = r.mono[0] - 10
    seen.append(_reason(r))
    r.turns.released = r.mono[0] - 500
    seen.append(_reason(r))
    r.room.view = vitals(disk_free_mb=10, ram_pct=95.0)
    seen.append(_reason(r))
    r.room.hold = None
    seen.append(_reason(r))
    r.room.view = vitals()
    seen.append(_reason(r))
    clock.advance(hours=7)  # floor passed; the failure is now 7 h old too
    newer = settle(r.book, clock, hours_ago=0.2, status="failed")
    seen.append(_reason(r))
    clock.advance(hours=2)
    seen.append(_reason(r))
    assert newer
    assert seen == list(REFUSALS[:-1])


def test_the_admissions_and_not_yet(brain: Brain, clock: Clock, stamp: Stamp) -> None:
    r = rig(brain, clock, stamp)
    write_episodes(brain, 30, chars=200)  # about 6,000 characters: over the minimum
    assert _reason(r) == "first"
    settle(r.book, clock, hours_ago=10, through=iso(clock() - timedelta(days=30)))
    assert _reason(r) == "not_yet"
    clock.advance(hours=70)
    assert _reason(r) == "stale"
    clock.advance(hours=-70)
    write_episodes(brain, 40, chars=1100, tag="big")
    verdict, window = r.admission.decide()
    assert window.pressure_chars >= PRESSURE_CHARS
    assert verdict.reason == "pressure" and verdict.admit
    assert set(ADMISSIONS) == {"pressure", "first", "stale", "forced"}


def test_too_little_is_the_minimum(brain: Brain, clock: Clock, stamp: Stamp) -> None:
    r = rig(brain, clock, stamp)
    write_episodes(brain, 1, chars=MIN_CHARS // 2)
    verdict, window = r.admission.decide()
    assert verdict.reason == "too_little" and not verdict.admit
    assert window.pressure_chars < MIN_CHARS
    assert "characters" in verdict.text


def test_force_skips_only_floor_failure_and_too_little(
    brain: Brain, clock: Clock, stamp: Stamp
) -> None:
    r = rig(brain, clock, stamp)
    settle(r.book, clock, hours_ago=1)
    settle(r.book, clock, hours_ago=0.1, status="failed")
    assert _reason(r) == "floor"
    assert _reason(r, force=True) == "forced"

    held = r.claim.try_take()
    assert _reason(r, force=True) == "sleeping"
    assert held is not None
    held.release()
    r.tasks[0] = 1
    assert _reason(r, force=True) == "turn_live"
    r.tasks[0] = 0
    r.turns.released = r.mono[0] - 1
    assert _reason(r, force=True) == "recent_turn"
    r.turns.released = None
    r.room.view = vitals(power="battery")
    assert _reason(r, force=True) == "on_battery"
    r.room.view = vitals()
    r.room.hold = "Waiting for room: CPU is busy."
    assert _reason(r, force=True) == "no_room"
    r.room.hold = None
    r.room.view = vitals(disk_free_mb=5)
    assert _reason(r, force=True) == "disk_low"


def test_a_held_disk_alone_is_disk_low(brain: Brain, clock: Clock, stamp: Stamp) -> None:
    r = rig(brain, clock, stamp)
    r.room.hold = "Waiting for room: the disk is nearly full."
    r.room.view = vitals(disk_free_mb=10)
    admission = r.admission.admit(force=True)
    assert admission.verdict.reason == "disk_low"
    assert admission.verdict.text == r.room.hold
    r.room.view = vitals(disk_free_mb=10, cpu_pct=99.0)
    assert _reason(r, force=True) == "no_room"


def test_no_gate_and_unknown_vitals_hold_nothing(brain: Brain, clock: Clock, stamp: Stamp) -> None:
    r = rig(brain, clock, stamp)
    r.admission.room = None
    r.room.view = None
    assert _reason(r, force=True) == "forced"
    r.admission.room = r.room
    assert _reason(r, force=True) == "forced"


def test_a_crashed_running_row_never_blocks_admission(
    brain: Brain, clock: Clock, stamp: Stamp
) -> None:
    """A row left ``running`` by a dead process is evidence, not a lock: the floor keys on the
    last completed cycle, and liveness is the in-process claim, which died with the process."""
    r = rig(brain, clock, stamp)
    write_episodes(brain, 30, chars=200)
    r.book.begin(
        ids.mint("cycle"),
        started_at=iso(clock() - timedelta(minutes=1)),
        reason="pressure",
        boundary="",
    )
    assert r.book.latest() is not None and r.book.latest().status == "running"  # type: ignore[union-attr]
    assert _reason(r) == "first"
    settle(r.book, clock, hours_ago=10, through=iso(clock() - timedelta(days=30)))
    r.book.begin(ids.mint("cycle"), started_at=iso(clock()), reason="pressure", boundary="")
    assert _reason(r) == "not_yet"  # not "floor", not "sleeping"


def test_a_refusal_gives_the_claim_back_and_an_admission_keeps_it(
    brain: Brain, clock: Clock, stamp: Stamp
) -> None:
    r = rig(brain, clock, stamp)
    write_episodes(brain, 30, chars=200)
    r.turns.busy = True
    refused = r.admission.admit()
    assert refused.verdict.reason == "turn_live" and refused.lease is None
    assert not r.claim.held()
    assert refused.window is None, "a live turn never pays for the walk"
    r.turns.busy = False
    admitted = r.admission.admit()
    assert admitted.verdict.admit and admitted.lease is not None and admitted.window is not None
    assert r.claim.held()
    assert r.admission.admit().verdict.reason == "sleeping"
    admitted.lease.release()
    admitted.lease.release()  # idempotent
    assert not r.claim.held()


def test_two_admissions_at_once_admit_one(brain: Brain, clock: Clock, stamp: Stamp) -> None:
    r = rig(brain, clock, stamp)
    write_episodes(brain, 30, chars=200)
    barrier = threading.Barrier(2)
    reasons: list[str] = []
    leases = []

    def ask() -> None:
        barrier.wait()
        got = r.admission.admit(force=True)
        reasons.append(got.verdict.reason)
        if got.lease is not None:
            leases.append(got.lease)

    threads = [threading.Thread(target=ask) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(10)
    assert sorted(reasons) == ["forced", "sleeping"]
    assert len(leases) == 1
    leases[0].release()


def test_pressure_counts_only_this_pcs_episodes(brain: Brain, clock: Clock, stamp: Stamp) -> None:
    stamp.device = None
    unpaired = write_episodes(brain, 2, chars=100, tag="before")
    stamp.device = DEV_B
    write_episodes(brain, 3, chars=1000, tag="peer")
    stamp.device = DEV_A
    mine = write_episodes(brain, 4, chars=100, tag="mine")

    boundary = Boundary.first(clock())
    window = EpisodeReader(brain, lambda: DEV_A).read(boundary)
    assert [row.id for row in window.own] == mine
    assert window.episodes_available == 4
    assert len(window.rows) == 9, "a peer's episodes are walked, and passed"
    assert window.pressure_chars == sum(row.chars for row in window.own)

    before = EpisodeReader(brain, lambda: None).read(boundary)
    assert [row.id for row in before.own] == unpaired, "a PC before pairing stamped nothing"


def test_the_walk_counts_at_most_the_fetch_and_says_so(
    brain: Brain, clock: Clock, stamp: Stamp
) -> None:
    write_episodes(brain, EPISODE_FETCH + 3, chars=10)
    window = EpisodeReader(brain, stamp).read(Boundary.first(clock()))
    assert window.episodes_available == EPISODE_FETCH
    assert not window.counted_all

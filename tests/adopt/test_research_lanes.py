"""The bounded fan-out (ADR 0097): lanes overlap, a lane's failure is its own, the harvest is
ordered and says how the batch went, and a closed session stops the harvest."""

from __future__ import annotations

import threading
import time
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

from athena.adopt.lanes import LaneOutcome, LaneTask, harvest_line, run_lanes
from athena.contracts.adopt import AdoptEvent, Finding, Lane, LaneEvent, Progress, Slot


@dataclass
class FakeSession:
    events: list[AdoptEvent] = field(default_factory=list)
    applied: list[tuple[list[dict[str, Any]], str]] = field(default_factory=list)
    counted: list[str] = field(default_factory=list)
    cancelled: threading.Event = field(default_factory=threading.Event)

    def __post_init__(self) -> None:
        self._lock = threading.Lock()

    def emit(self, event: AdoptEvent) -> AdoptEvent:
        with self._lock:
            self.events.append(event)
        return event

    def apply_findings(
        self, slot_updates: Iterable[Mapping[str, Any]], *, source: Any = "research"
    ) -> list[Slot]:
        with self._lock:
            self.applied.append(([dict(u) for u in slot_updates], str(source)))
        return []

    def count(self, name: str) -> None:
        self.counted.append(name)

    def lanes(self, lane_id: str) -> list[str]:
        return [
            e.lane.status
            for e in self.events
            if isinstance(e, LaneEvent) and e.lane is not None and e.lane.id == lane_id
        ]

    def progress(self) -> list[str]:
        return [e.text for e in self.events if isinstance(e, Progress)]


def test_lanes_run_at_the_same_time_and_harvest_in_input_order() -> None:
    session = FakeSession()
    barrier = threading.Barrier(3, timeout=5)
    spans: dict[str, tuple[float, float]] = {}

    def lane(name: str, sleep: float) -> LaneTask:
        def body() -> LaneOutcome:
            start = time.monotonic()
            barrier.wait()  # breaks (and the lane fails) unless all three run at once
            time.sleep(sleep)
            spans[name] = (start, time.monotonic())
            return LaneOutcome(summary=f"{name} done")

        return LaneTask(name, "memory", name, body)

    lanes = run_lanes(session, [lane("a", 0.15), lane("b", 0.0), lane("c", 0.05)])

    assert [x.id for x in lanes] == ["a", "b", "c"]
    assert [x.status for x in lanes] == ["done", "done", "done"]
    latest_start = max(s for s, _ in spans.values())
    earliest_end = min(e for _, e in spans.values())
    assert latest_start < earliest_end  # every lane was running at one moment
    assert session.lanes("a") == ["queued", "running", "done"]
    assert session.progress() == ["3 of 3 lanes done"]


def test_max_parallel_bounds_the_fan_out() -> None:
    session = FakeSession()
    running = 0
    peak = 0
    lock = threading.Lock()

    def body() -> LaneOutcome:
        nonlocal running, peak
        with lock:
            running += 1
            peak = max(peak, running)
        time.sleep(0.05)
        with lock:
            running -= 1
        return LaneOutcome()

    tasks = [LaneTask(f"l{i}", "document", "doc", body) for i in range(6)]
    lanes = run_lanes(session, tasks, max_parallel=2)

    assert peak == 2
    assert all(x.status == "done" for x in lanes)


def test_a_raising_lane_and_a_slow_lane_fail_alone() -> None:
    session = FakeSession()
    release = threading.Event()

    def boom() -> LaneOutcome:
        raise RuntimeError("bug")

    def slow() -> LaneOutcome:
        release.wait(5)
        return LaneOutcome(summary="too late")

    def good() -> LaneOutcome:
        return LaneOutcome(
            summary="found it",
            findings=(Finding(text="the plan has 38 people", slot_ids=("f1",)),),
            updates=({"slot_id": "f1", "value": "38", "status": "confirmed"},),
        )

    started = time.monotonic()
    lanes = run_lanes(
        session,
        [
            LaneTask("rules", "rules", "Rules", slow, timeout_s=0.2),
            LaneTask("accounts", "accounts", "Mail", boom),
            LaneTask("memory", "memory", "Memory", good),
        ],
    )
    release.set()

    assert time.monotonic() - started < 2
    assert [(x.status, x.summary) for x in lanes] == [
        ("failed", "timeout"),
        ("failed", "error: RuntimeError"),
        ("done", "found it"),
    ]
    # Research only guesses, whatever the lane said, under the lane's own source.
    assert session.applied == [([{"slot_id": "f1", "value": "38", "status": "guessed"}], "memory")]
    assert session.progress() == [
        "1 of 3 lanes done · 2 failed (rules: timeout; accounts: error: RuntimeError)"
    ]
    assert "lane_timeout:rules" in session.counted
    # The timed-out lane, finishing later, says nothing more.
    time.sleep(0.1)
    assert session.lanes("rules") == ["queued", "running", "failed"]


def test_a_cancelled_session_stops_the_harvest_and_starts_nothing_new() -> None:
    session = FakeSession()
    gate = threading.Event()
    started: list[str] = []

    def body(name: str) -> LaneTask:
        def run() -> LaneOutcome:
            started.append(name)
            gate.wait(5)
            return LaneOutcome()

        return LaneTask(name, "document", name, run)

    def close_soon() -> None:
        time.sleep(0.1)
        session.cancelled.set()

    threading.Thread(target=close_soon).start()
    began = time.monotonic()
    run_lanes(session, [body("one"), body("two")], max_parallel=1)
    gate.set()

    assert time.monotonic() - began < 2
    assert started == ["one"]
    assert session.progress() == []


def test_the_harvest_line_matches_the_desktop() -> None:
    lanes = [
        Lane(id="rules", kind="rules", title="", status="failed", summary="timeout"),
        Lane(id="accounts", kind="accounts", title="", status="skipped"),
        Lane(id="memory", kind="memory", title="", status="done"),
        Lane(id="doc1", kind="document", title="", status="done"),
    ]
    assert harvest_line(lanes) == "2 of 4 lanes done · 1 failed (rules: timeout) · 1 skipped"
    assert harvest_line(lanes[2:3]) == "1 of 1 lane done"
    assert harvest_line([]) == ""

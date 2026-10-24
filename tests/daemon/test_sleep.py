"""The sleep cycle as the daemon hosts it: routes, the check, single flight, the bus (ADR 0143).

The routes are called directly with a :class:`Request`, as ``RouteTable`` would; the leg door is a
fake, so no model is run. The one real door below runs over a scripted transport, to pin what the
ledger records for a sleep leg.
"""

from __future__ import annotations

import json
import threading
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from athena.adopt.legs import LegRunner, load_tiers
from athena.core.brain import Brain
from athena.core.sleep.legs import COMPRESS_SCHEMA
from athena.daemon.routes import Request, Route
from athena.daemon.server import ThreadLocks
from athena.daemon.sleep import SleepService, sleep_runner
from athena.harness.transports import ScriptedTransport

DEV = "dev_aaaaaaaaaaaa"


@dataclass(frozen=True)
class Answer:
    ok: bool
    value: dict[str, Any] | None = None
    error_reason: str | None = None
    detail: str = ""


@dataclass
class Door:
    """Compress returns one fact citing the first episode it was shown; merge finds nothing."""

    calls: list[str] = field(default_factory=list)
    entered: threading.Event = field(default_factory=threading.Event)
    release: threading.Event | None = None

    def run_leg(self, kind: str, system: str, prompt: str, **kwargs: Any) -> Answer:
        self.calls.append(kind)
        self.entered.set()
        if self.release is not None:
            self.release.wait(10)
        if kind == "sleep.compress":
            first = prompt.split("Episode ", 1)[1].split(" ", 1)[0]
            fact = {
                "key": "acme terms",
                "value": "Acme pays at 45 days.",
                "scope": "user",
                "confidence": 0.8,
                "sources": [first],
            }
            return Answer(True, {"facts": [fact], "procedurals": []})
        return Answer(True, {"verdicts": []})


@dataclass
class Tasks:
    running: int = 0

    def listing(self) -> tuple[list[Any], int, int]:
        return [], self.running, 0


@dataclass
class Rig:
    brain: Brain
    service: SleepService
    door: Door
    events: list[dict[str, Any]]
    threads: ThreadLocks
    tasks: Tasks
    now: list[datetime]

    def call(self, method: str, path: str, body: dict[str, Any] | None = None, **query: str) -> Any:
        route = next(r for r in self.service.routes() if r.matches(method, path))
        return route.fn(Request(method, path, query=query, body=body or {}))


def _sync(fn: Callable[[], None]) -> None:
    fn()


def _rig(tmp_path: Path, spawn: Callable[[Callable[[], None]], None] = _sync) -> Rig:
    brain = Brain(tmp_path / "brain", session_id="t", device_id=DEV)
    events: list[dict[str, Any]] = []
    door = Door()
    threads = ThreadLocks()
    tasks = Tasks()
    now = [datetime.now(UTC)]
    service = SleepService(
        brain=brain,
        room=None,
        runner=door,
        threads=threads,
        tasks=tasks,  # type: ignore[arg-type]
        device_id=lambda: DEV,
        publish=lambda kind, **fields: events.append({"kind": kind, **fields}),
        clock=lambda: now[0],
        spawn=spawn,
    )
    return Rig(brain, service, door, events, threads, tasks, now)


@pytest.fixture
def rig(tmp_path: Path) -> Iterator[Rig]:
    made = _rig(tmp_path)
    try:
        yield made
    finally:
        made.brain.close()


def _episodes(brain: Brain, n: int, chars: int = 200) -> list[str]:
    start = datetime.now(UTC) - timedelta(hours=1)
    return [
        brain.append_episode(f"turn {i} " + "x" * chars, created=start + timedelta(seconds=i)).id
        for i in range(n)
    ]


def test_the_thread_locks_say_when_a_turn_runs_and_when_one_ended() -> None:
    locks = ThreadLocks()
    assert not locks.busy_any() and locks.last_released() is None
    lease = locks.try_take("conv_a")
    assert lease is not None and locks.busy_any()
    lease.release()
    assert not locks.busy_any()
    ended = locks.last_released()
    assert ended is not None
    with locks.take("conv_b"):
        assert locks.busy_any()
    after = locks.last_released()
    assert after is not None and after >= ended


def test_a_forced_cycle_runs_and_every_route_answers(rig: Rig) -> None:
    assert rig.service.summary() is None, "no measurement yet: unknown, not zero"
    episodes = _episodes(rig.brain, 5, chars=500)

    status, body = rig.call("GET", "/sleep")
    assert status == 200
    view = body["sleep"]
    assert set(view) == {
        "state",
        "phase",
        "pressure_chars",
        "threshold_chars",
        "episodes_waiting",
        "verdict",
        "last",
        "open_proposals",
    }
    assert view["state"] == "never" and view["phase"] is None and view["last"] is None
    assert view["episodes_waiting"] == 5 and view["threshold_chars"] == 40_000
    assert view["verdict"]["reason"] == "first" and view["verdict"]["admit"] is True

    status, ran = rig.call("POST", "/sleep/run", {"force": True})
    assert status == 200 and ran["admitted"] is True and ran["reason"] == "forced"
    cycle_id = ran["cycle_id"]
    assert rig.door.calls == ["sleep.compress"]
    assert [e.get("phase") for e in rig.events] == [None, "compress", "merge", "fade", None]
    assert {e["kind"] for e in rig.events} == {"sleep.changed"}
    assert rig.events[0]["state"] == "sleeping" and rig.events[-1]["state"] == "idle"

    status, cycles = rig.call("GET", "/sleep/cycles", limit="5")
    assert [c["id"] for c in cycles["cycles"]] == [cycle_id]
    assert cycles["cycles"][0]["status"] == "completed"
    assert cycles["cycles"][0]["stats"]["facts_written"] == 1
    status, one = rig.call("GET", f"/sleep/cycles/{cycle_id}")
    assert status == 200 and one["cycle"]["id"] == cycle_id
    assert "acme terms" in one["journal"]
    assert rig.call("GET", "/sleep/cycles/cyc_ffffffffffff")[0] == 404

    summary = rig.service.summary()
    assert summary is not None and summary["state"] == "idle"
    assert summary["last_at"] is not None
    _, after = rig.call("GET", "/sleep")
    assert after["sleep"]["verdict"]["reason"] == "floor"
    assert after["sleep"]["last"]["id"] == cycle_id
    assert episodes


def test_run_refuses_with_a_reason_not_an_error(rig: Rig) -> None:
    _episodes(rig.brain, 2)
    rig.tasks.running = 1
    status, body = rig.call("POST", "/sleep/run", {"force": True})
    assert status == 200
    assert body["admitted"] is False and body["reason"] == "turn_live"
    assert body["cycle_id"] is None and body["text"]
    assert rig.call("POST", "/sleep/run", {"force": "yes"})[0] == 400


def test_a_proposal_is_decided_and_said_on_the_bus(rig: Rig) -> None:
    (episode,) = _episodes(rig.brain, 1)
    fact = rig.brain.write_fact("fax", "The user likes fax.", sources=[episode])
    proposal = rig.service.book.open_proposal(
        "cyc_000000000000", "forget", [fact.id], "Forget it?", now="2026-10-24T00:00:00+00:00"
    )
    assert proposal is not None
    _, listing = rig.call("GET", "/sleep/proposals")
    assert [p["id"] for p in listing["proposals"]] == [proposal.id]
    assert set(listing["proposals"][0]) == {
        "id",
        "cycle_id",
        "kind",
        "node_ids",
        "summary",
        "status",
        "created_at",
    }
    status, body = rig.call(
        "POST", f"/sleep/proposals/{proposal.id}", {"action": "forget", "node_id": None}
    )
    assert status == 200 and body["proposal"]["status"] == "forgotten"
    assert rig.events[-1]["kind"] == "sleep.changed"
    assert rig.call("POST", f"/sleep/proposals/{proposal.id}", {"action": "keep"})[0] == 409
    assert rig.call("POST", "/sleep/proposals/prp_ffffffffffff", {"action": "keep"})[0] == 404
    assert rig.call("POST", f"/sleep/proposals/{proposal.id}", {"action": 3})[0] == 400


def test_two_runs_at_once_start_one_cycle(tmp_path: Path) -> None:
    started: list[threading.Thread] = []

    def spawn(fn: Callable[[], None]) -> None:
        thread = threading.Thread(target=fn, daemon=True)
        started.append(thread)
        thread.start()

    made = _rig(tmp_path, spawn)
    try:
        _episodes(made.brain, 5)
        made.door.release = threading.Event()
        answers: list[dict[str, Any]] = []
        barrier = threading.Barrier(2)

        def run() -> None:
            barrier.wait()
            answers.append(made.call("POST", "/sleep/run", {"force": True})[1])

        callers = [threading.Thread(target=run) for _ in range(2)]
        for caller in callers:
            caller.start()
        for caller in callers:
            caller.join(10)
        assert sorted(a["reason"] for a in answers) == ["forced", "sleeping"]
        assert made.door.entered.wait(10)
        assert made.service.running()
        summary = made.service.summary()
        assert summary is not None and summary["state"] == "sleeping"
        _, view = made.call("GET", "/sleep")
        assert view["sleep"]["state"] == "sleeping" and view["sleep"]["phase"] == "compress"
        assert view["sleep"]["last"]["status"] == "running"
        made.door.release.set()
        for thread in started:
            thread.join(10)
        assert not made.service.running(), "the claim is released when the cycle ends"
        assert made.door.calls.count("sleep.compress") == 1
    finally:
        made.brain.close()


def test_the_check_admits_runs_and_keeps_its_refusals(rig: Rig) -> None:
    _episodes(rig.brain, 20)
    verdict = rig.service.check()
    assert verdict.reason == "first" and verdict.admit
    assert rig.service.book.last_settled() is not None
    again = rig.service.check()
    assert again.reason == "floor" and rig.service.last_verdict == again
    lease = rig.threads.try_take("conv_x")
    assert lease is not None
    rig.now[0] += timedelta(hours=10)
    assert rig.service.check().reason == "turn_live"
    lease.release()
    assert rig.service.check().reason == "recent_turn"


def test_the_check_thread_measures_at_start_and_stops(rig: Rig) -> None:
    _episodes(rig.brain, 3)
    rig.service.start(interval_s=3600)
    try:
        for _ in range(100):
            if rig.service.summary() is not None:
                break
            threading.Event().wait(0.05)
        summary = rig.service.summary()
        assert summary is not None and summary["state"] == "never"
        assert 0 < summary["pressure"] < 1
        assert rig.door.calls == [], "no cycle at start-up"
    finally:
        rig.service.stop()


def _stream(text: str) -> list[str]:
    return [
        json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": text}]}}),
        json.dumps(
            {
                "type": "result",
                "is_error": False,
                "result": text,
                "usage": {"input_tokens": 10, "output_tokens": 5},
            }
        ),
    ]


@dataclass
class Ledger:
    rows: list[dict[str, Any]] = field(default_factory=list)

    def record(self, **row: Any) -> object:
        self.rows.append(row)
        return row


def test_a_sleep_leg_is_its_own_ledger_trigger(tmp_path: Path) -> None:
    ledger = Ledger()
    door = LegRunner(
        transport=ScriptedTransport([_stream('{"facts": [], "procedurals": []}')]),
        ledger=ledger,
        tiers=load_tiers(),
        prompt_dir=tmp_path / "prompts",
    )
    result = door.run_leg("sleep.compress", "s", "p", json_schema=COMPRESS_SCHEMA)
    assert result.ok and result.value == {"facts": [], "procedurals": []}
    assert result.model == "claude-opus-5-5" and result.effort == "low"
    (row,) = ledger.rows
    assert row["trigger"] == "sleep.compress" and row["surface"] == "sleep"
    assert row["conversation"] == "sleep" and row["origin"] == "core"
    assert sleep_runner(tmp_path, ledger) is not None


def test_the_routes_are_the_wire_contract(rig: Rig) -> None:
    labels = [route.label for route in rig.service.routes()]
    assert labels == [
        "GET /sleep",
        "GET /sleep/cycles",
        "GET /sleep/proposals",
        "POST /sleep/run",
        "GET /sleep/cycles/<id>",
        "POST /sleep/proposals/<id>",
    ]
    assert all(isinstance(route, Route) for route in rig.service.routes())

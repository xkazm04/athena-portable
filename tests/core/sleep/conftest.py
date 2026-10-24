"""Fakes for the sleep cycle's tests (ADR 0143): a scripted leg door, a clock, the turn locks and
the room gate. No model is ever run; a real brain under ``tmp_path`` is."""

from __future__ import annotations

import json
import threading
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from athena.core.brain import Brain
from athena.core.sleep.admission import SleepAdmission, SleepClaim
from athena.core.sleep.book import SleepBook
from athena.core.sleep.window import EpisodeReader
from athena.vitals import VitalsView

DEV_A = "dev_aaaaaaaaaaaa"
DEV_B = "dev_bbbbbbbbbbbb"


@dataclass(frozen=True)
class FakeAnswer:
    """``LegResult``'s shape, as much of it as the cycle reads."""

    ok: bool
    value: dict[str, Any] | None = None
    error_reason: str | None = None
    detail: str = ""


Script = Callable[[str], FakeAnswer]


@dataclass
class FakeDoor:
    """A leg door that answers each kind from a script and records every call."""

    compress: Script | None = None
    merge: Script | None = None
    calls: list[tuple[str, str]] = field(default_factory=list)

    def run_leg(self, kind: str, system: str, prompt: str, **kwargs: Any) -> FakeAnswer:
        self.calls.append((kind, prompt))
        script = self.compress if kind == "sleep.compress" else self.merge
        if script is None:
            raise AssertionError(f"no script for {kind}")
        return script(prompt)

    def kinds(self) -> list[str]:
        return [kind for kind, _ in self.calls]


def answer(value: dict[str, Any]) -> Script:
    return lambda prompt: FakeAnswer(True, json.loads(json.dumps(value)))


def failing(reason: str = "timeout") -> Script:
    return lambda prompt: FakeAnswer(False, None, reason, "no line")


def no_verdicts() -> Script:
    return answer({"verdicts": []})


@dataclass
class Clock:
    now: datetime = field(default_factory=lambda: datetime.now(UTC))

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **delta: float) -> None:
        self.now = self.now + timedelta(**delta)


@dataclass
class FakeTurns:
    busy: bool = False
    released: float | None = None

    def busy_any(self) -> bool:
        return self.busy

    def last_released(self) -> float | None:
        return self.released


@dataclass
class FakeRoom:
    hold: str | None = None
    view: VitalsView | None = None

    def held(self, *, sleep: bool = False) -> str | None:
        return self.hold

    def vitals(self) -> VitalsView | None:
        return self.view


def vitals(**over: Any) -> VitalsView:
    base: dict[str, Any] = {
        "at": "2026-10-24T00:00:00+00:00",
        "cpu_pct": 10.0,
        "cores": 8,
        "ram_total_mb": 16000,
        "ram_free_mb": 8000,
        "ram_pct": 50.0,
        "gpus": [],
        "power": "mains",
        "battery_pct": None,
        "disk_free_mb": 50_000,
        "room": "ok",
        "slots": 3,
        "held": None,
        "runs": None,
        "sleep": None,
    }
    base.update(over)
    return base  # type: ignore[return-value]


@dataclass
class Stamp:
    """The device a test brain stamps with now; ``None`` is a PC that never paired."""

    device: str | None = DEV_A

    def __call__(self) -> str | None:
        return self.device


@pytest.fixture
def stamp() -> Stamp:
    return Stamp()


@pytest.fixture
def brain(tmp_path: Path, stamp: Stamp) -> Iterator[Brain]:
    with Brain(tmp_path / "brain", session_id="t", device_id=stamp) as opened:
        yield opened


@pytest.fixture
def clock() -> Clock:
    return Clock()


def write_episodes(
    brain: Brain, n: int, *, chars: int = 100, start: datetime | None = None, tag: str = "ep"
) -> list[str]:
    """``n`` user episodes of about ``chars`` characters, one second apart, oldest first."""
    first = start or datetime.now(UTC) - timedelta(hours=1)
    out = []
    for index in range(n):
        body = f"{tag} {index} " + ("lorem ipsum " * (chars // 12 + 1))[:chars]
        out.append(brain.append_episode(body, created=first + timedelta(seconds=index)).id)
    return out


@dataclass
class Rig:
    """An admission over a real brain, with every outside input a fake."""

    brain: Brain
    book: SleepBook
    claim: SleepClaim
    turns: FakeTurns
    room: FakeRoom
    clock: Clock
    tasks: list[int]
    mono: list[float]
    reader: EpisodeReader
    admission: SleepAdmission


def rig(brain: Brain, clock: Clock, stamp: Callable[[], str | None]) -> Rig:
    book = SleepBook(brain)
    claim = SleepClaim()
    turns = FakeTurns()
    room = FakeRoom(view=vitals())
    tasks = [0]
    mono = [1_000_000.0]
    reader = EpisodeReader(brain, stamp)
    admission = SleepAdmission(
        book=book,
        measure=reader.read,
        claim=claim,
        turns=turns,
        running_tasks=lambda: tasks[0],
        room=room,
        clock=clock,
        monotonic=lambda: mono[0],
    )
    return Rig(brain, book, claim, turns, room, clock, tasks, mono, reader, admission)


def settle(
    book: SleepBook,
    clock: Clock,
    *,
    hours_ago: float,
    status: str = "completed",
    through: str | None = None,
) -> str:
    """A cycle that settled ``hours_ago``, as a past run would have left it."""
    from athena.contracts import ids
    from athena.contracts.channel import iso

    cycle_id = ids.mint("cycle")
    at = clock() - timedelta(hours=hours_ago)
    book.begin(cycle_id, started_at=iso(at - timedelta(minutes=5)), reason="pressure", boundary="")
    book.finish(
        cycle_id,
        status=status,  # type: ignore[arg-type]
        finished_at=iso(at),
        stats={},
        consumed_through=through,
    )
    return cycle_id


class Gate:
    """A door whose compress leg waits on an event: a cycle that is still running."""

    def __init__(self, inner: FakeDoor) -> None:
        self.inner = inner
        self.entered = threading.Event()
        self.release = threading.Event()

    def run_leg(self, kind: str, system: str, prompt: str, **kwargs: Any) -> FakeAnswer:
        self.entered.set()
        self.release.wait(10)
        return self.inner.run_leg(kind, system, prompt, **kwargs)

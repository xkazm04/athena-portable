"""The service the daemon holds: GET /vitals, the fleet, the sampler, and the task table's gate.

athena/vitals/wire.py and sampler.py over a real brain, ledger and task table. The probe reads
fakes, so nothing here spawns ``nvidia-smi`` or depends on this machine's load.
"""

from __future__ import annotations

import time
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from athena.contracts import ids
from athena.core.brain import Brain
from athena.core.ledger import Ledger
from athena.daemon.routes import Request
from athena.daemon.tasks import Tasks, claim_task, list_tasks
from athena.peer.listener import PeerHost
from athena.peer.overlay import Overlay
from athena.peer.registry import mint_token
from athena.vitals import VITALS_STALE_S, DeviceVitals, FleetSource, RoomPort
from athena.vitals.probe import Memory, Power, Probe, Readers
from athena.vitals.sampler import Sampler
from athena.vitals.wire import VitalsService

PARENT = "conv_invoices"


class Ram:
    """The fake host's RAM, which a test turns up and down."""

    def __init__(self, pct: float = 40.0, total: int = 64_000) -> None:
        self.pct, self.total = pct, total

    def __call__(self) -> Memory:
        return Memory(self.total, round(self.total * (100 - self.pct) / 100))


class Seal:
    kind = "memory"

    def __init__(self) -> None:
        self.values: dict[str, str] = {}

    def seal(self, name: str, value: str) -> None:
        self.values[name] = value

    def unseal(self, name: str) -> str | None:
        return self.values.get(name)

    def destroy(self, name: str) -> None:
        self.values.pop(name, None)


@pytest.fixture
def brain(tmp_path: Path) -> Iterator[Brain]:
    opened = Brain(tmp_path / "brain")
    yield opened
    opened.close()


@pytest.fixture
def ram() -> Ram:
    return Ram()


@pytest.fixture
def probe(tmp_path: Path, ram: Ram) -> Probe:
    return Probe(
        tmp_path,
        readers=Readers(memory=ram, power=lambda: Power("mains", None)),
        disk=lambda root: 200_000,
        nvidia_smi="nvidia-smi",
        run=lambda argv, timeout: "NVIDIA GeForce RTX 4090, 24564, 1391, 3\n",
        cores=lambda: 16,
    )


@pytest.fixture
def told() -> list[dict[str, Any]]:
    return []


def _service(
    brain: Brain,
    probe: Probe,
    told: list[dict[str, Any]],
    *,
    host: PeerHost | None = None,
    tasks: Tasks | None = None,
    **extra: Any,
) -> VitalsService:
    return VitalsService(
        brain_root=brain.root,
        ledger=Ledger(brain),
        tasks=tasks,
        host=host,
        publish=lambda kind, **fields: told.append({"kind": kind, **fields}),
        probe=probe,
        **extra,
    )


def test_get_vitals_answers_with_a_reading_even_before_the_sampler_ran(
    brain: Brain, probe: Probe, told: list[dict[str, Any]]
) -> None:
    service = _service(brain, probe, told)
    [route] = service.routes()
    assert (route.method, route.path) == ("GET", "/vitals")
    status, body = route.fn(Request("GET", "/vitals"))
    assert status == 200
    vitals = body["vitals"]
    assert vitals["ram_pct"] == 40.0 and vitals["room"] == "ok" and vitals["slots"] == 3
    assert vitals["gpus"] == [
        {
            "name": "NVIDIA GeForce RTX 4090",
            "util_pct": 3.0,
            "vram_total_mb": 24564,
            "vram_used_mb": 1391,
        }
    ]
    assert vitals["runs"] == {
        "hours": 24,
        "turns": 0,
        "blank": 0,
        "no_answer": 0,
        "failed": 0,
        "timeout": 0,
        "usage_limit": 0,
        "tasks_empty": 0,
    }
    assert vitals["sleep"] is None
    assert told == [{"kind": "vitals.changed", "room": "ok", "held": None, "slots": 3}]


def test_the_service_is_the_ports_the_other_packages_read(
    brain: Brain, probe: Probe, told: list[dict[str, Any]]
) -> None:
    service = _service(
        brain,
        probe,
        told,
        sleep_summary=lambda: {"state": "never", "last_at": None, "pressure": 0.1},
    )
    room: RoomPort = service.gate
    fleet: FleetSource = service
    assert room.vitals() is None
    service.sampler.sample()
    view = room.vitals()
    assert view is not None and view["sleep"] == {
        "state": "never",
        "last_at": None,
        "pressure": 0.1,
    }
    [me] = fleet.fleet()
    assert me["self"] is True and me["kind"] == "pc" and me["presence"] == "online"
    assert me["device_id"] == "" and me["name"], "no identity is minted by being asked"
    assert me["vitals"] == view


def test_a_claim_waits_with_the_gates_reason_and_the_listing_says_so(
    brain: Brain, probe: Probe, ram: Ram, told: list[dict[str, Any]]
) -> None:
    tasks = Tasks(brain)
    service = _service(brain, probe, told, tasks=tasks)
    tasks.room = service.gate
    tasks.delegate(PARENT, "Chase invoices", "Find every overdue invoice.")

    ram.pct = 95.0
    service.sampler.sample()
    status, body = claim_task(tasks)
    assert status == 200
    assert body["task"] is None
    assert body["held"] == "Waiting for room: RAM is at 95% (resumes below 85%)."
    _, listing = list_tasks(tasks)
    assert listing["held"] == body["held"]
    assert listing["slots"] == 0 and listing["cap"] == 3

    ram.pct = 50.0
    service.sampler.sample()
    status, body = claim_task(tasks)
    assert body["task"] is not None and body["task"]["status"] == "running"
    assert body["held"] is None
    view = service.gate.vitals()
    assert view is not None and view["slots"] == 3
    assert service.gate.task_room(1).full is False


def test_the_sampler_runs_from_start_to_stop_and_asks_the_gpu_on_its_own_cadence(
    brain: Brain, tmp_path: Path, told: list[dict[str, Any]]
) -> None:
    asked: list[float] = []

    def smi(argv: Any, timeout: float) -> str:
        asked.append(timeout)
        return ""

    probe = Probe(tmp_path, readers=Readers(), nvidia_smi="nvidia-smi", run=smi, cores=lambda: 2)
    service = _service(brain, probe, told)
    service.sampler.every_s = 0.01
    service.start()
    try:
        deadline = time.monotonic() + 5
        while service.gate.vitals() is None and time.monotonic() < deadline:
            time.sleep(0.01)
        time.sleep(0.1)
    finally:
        service.stop()
    assert service.gate.vitals() is not None
    assert len(asked) == 1, "the GPU is asked every 30 s, not every reading"
    view = service.gate.vitals()
    assert view is not None and view["gpus"] == []


def test_a_reading_that_raises_does_not_end_the_sampler(
    brain: Brain, probe: Probe, told: list[dict[str, Any]]
) -> None:
    service = _service(brain, probe, told)
    calls: list[int] = []

    class Flaky(Sampler):
        def sample(self) -> Any:
            calls.append(1)
            if len(calls) == 1:
                raise RuntimeError("first reading broke")
            return super().sample()

    sampler = Flaky(probe, service.gate, every_s=0.01)
    sampler.start()
    try:
        deadline = time.monotonic() + 5
        while len(calls) < 3 and time.monotonic() < deadline:
            time.sleep(0.01)
    finally:
        sampler.stop()
    assert len(calls) >= 3


# -- the fleet, with a peer host ----------------------------------------------------------------


class Clock:
    def __init__(self) -> None:
        self.now = datetime(2026, 10, 24, 12, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.now


def test_the_fleet_lists_this_pc_first_then_peers_with_their_presence_and_fresh_vitals(
    brain: Brain, probe: Probe, tmp_path: Path, told: list[dict[str, Any]]
) -> None:
    clock = Clock()
    host = PeerHost(
        tmp_path / "peer",
        port=0,
        probe=lambda: Overlay("absent"),
        seal=Seal(),
        admit_loopback=True,
        now=clock,
    )
    service = _service(brain, probe, told, host=host)
    service.sampler.sample()
    me = host.identity.identity  # paired PCs have an identity

    pc, phone = ids.mint("device"), ids.mint("device")
    for peer_id, kind in ((pc, "pc"), (phone, "phone")):
        host.registry.admit(
            peer_id,
            name=kind.upper(),
            kind=kind,
            grants=["chat"],
            token=mint_token(),
            expires_days=None,
        )
    host.keys.keep(pc, "http://100.64.0.7:17491", mint_token())
    peer_view = dict(service.gate.vitals() or {})
    peer_view["room"] = "tight"
    host.presence.hello = lambda url, token: {"ok": True, "vitals": peer_view}
    host.presence.probe_all()

    fleet: list[DeviceVitals] = service.fleet()
    assert fleet[0]["device_id"] == me.device_id, "this PC first"
    assert fleet[0]["self"] and fleet[0]["name"] == me.name
    peers = {row["device_id"]: row for row in fleet[1:]}
    assert set(peers) == {pc, phone}
    assert peers[pc]["presence"] == "online" and peers[pc]["vitals"] is not None
    assert peers[pc]["vitals"]["room"] == "tight"
    assert peers[phone]["kind"] == "phone" and peers[phone]["presence"] is None
    assert peers[phone]["vitals"] is None

    clock.now += timedelta(seconds=VITALS_STALE_S + 1)
    stale = {row["device_id"]: row for row in service.fleet()}
    assert stale[pc]["vitals"] is None, "stale vitals are not told"
    assert host.presence.own_vitals() == service.gate.vitals(), "the hello carries this PC's"

"""The showcase (ADR 0097): a world shaped like the person's case from a spec, never rewritten
whole; a rehearsal in the daemon process that streams turns, ends done or failed, writes its spend
to the live ledger, and stops when the session closes."""

from __future__ import annotations

import json
import threading
import time
from collections.abc import AsyncIterator, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import pytest

from athena.adopt import showcase
from athena.adopt.legs import LegResult
from athena.adopt.session import AdoptSession, SessionStore
from athena.adopt.showcase import (
    MAX_ROW_EDITS,
    SHAPE_SYSTEM,
    ShapeFailed,
    Showcase,
    apply_shape,
    shape_world,
)
from athena.adopt.slots import load_playbook_json, playbooks_root
from athena.contracts.adopt import Brief, Progress
from athena.contracts.adopt import Showcase as ShowcaseEvent
from athena.harness.ports import ModelChunk, ModelRequest
from athena.proving.playbooks.spec import Taxonomy, load_playbook, load_taxonomy

from . import conftest
from .conftest import Live, Rig

PID = "401k-late-deposits"
LIBRARY = playbooks_root()
SOURCE = (LIBRARY / PID) if LIBRARY is not None else Path("missing")

BRIEF = Brief(
    rev=1,
    md="You use **Gusto** for payroll.",
    command="Find the late deposits for my 12-person plan.",
    portals={"Payroll Harbor": "Gusto", "Retireline": "", "Correctcalc": "", "Ledgerwren bank": ""},
)

SPEC: dict[str, Any] = {
    "today": "2026-11-02",
    "rows": [
        {
            "op": "modify",
            "table": "deposits",
            "match": {"item_id": "R-01"},
            "set": {"amount": "9,100.00"},
        },
        {"op": "remove", "table": "offers", "match": {"offer_id": "O-1"}},
    ],
    "note": "A smaller payroll.",
}


@pytest.fixture(autouse=True)
def _kinds(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(conftest.SYSTEMS, SHAPE_SYSTEM, "shape")


def leg_answering(value: Any, calls: list[str] | None = None) -> Any:
    """A ``run_leg`` that checks ``value`` with the leg's own check, as the runner would."""

    def run_leg(kind: Any, system: str, prompt: str, **kwargs: Any) -> LegResult:
        if calls is not None:
            calls.append(prompt)
        check = kwargs.get("check")
        problem = check(value) if check is not None and isinstance(value, dict) else ""
        if problem:
            return LegResult(
                kind="shape",
                ok=False,
                model="m",
                effort="low",
                error_reason="parse_error",
                detail=problem,
                malformed=True,
            )
        return LegResult(kind="shape", ok=True, model="m", effort="low", value=value)

    return run_leg


def world_of(path: Path, name: str) -> Any:
    return json.loads((path / name).read_text(encoding="utf-8"))


# --- shaping --------------------------------------------------------------------------------------


def test_a_spec_and_the_brief_renames_shape_a_copy_the_loader_accepts(tmp_path: Path) -> None:
    prompts: list[str] = []
    shaped = shape_world(SOURCE, BRIEF, run_leg=leg_answering(SPEC, prompts), dest=tmp_path)

    assert shaped == tmp_path / PID
    assert sorted(p.name for p in shaped.iterdir()) == [
        "playbook.json",
        "shape.json",
        "truth.json",
        "world.json",
    ]
    book = load_playbook(shaped, load_taxonomy(LIBRARY))
    assert book.apps[0].name == "Gusto"
    assert book.today == "2026-11-02"
    world = world_of(shaped, "world.json")
    deposits = {r["item_id"]: r for r in world["tables"]["deposits"]}
    assert deposits["R-01"]["amount"] == "9,100.00"
    assert world["tables"]["offers"] == []
    assert world["apps"][0]["view"]["today"] == "Monday 2 November 2026"
    assert "Payroll Harbor" not in json.dumps(world)
    assert "Gusto" in world["phases"][0]["message"]
    truth = json.dumps(world_of(shaped, "truth.json"))
    assert "Payroll Harbor" not in truth
    # The truth changes by the renames only: the same targets, the same items.
    original = world_of(SOURCE, "truth.json")
    assert [t["eligible"].keys() for t in world_of(shaped, "truth.json")["targets"]] == [
        t["eligible"].keys() for t in original["targets"]
    ]
    assert world_of(shaped, "playbook.json")["command"] == BRIEF.command
    assert world_of(shaped, "shape.json")["renames"]["Payroll Harbor"] == "Gusto"
    # The source is untouched; the person's words reached the leg fenced.
    assert "Payroll Harbor" in (SOURCE / "world.json").read_text(encoding="utf-8")
    assert "<<<answers:" in prompts[0]


@pytest.mark.parametrize(
    ("edit", "problem"),
    [
        ({"op": "modify", "table": "nope", "match": {"a": 1}, "set": {"a": 2}}, "no table"),
        (
            {"op": "modify", "table": "deposits", "match": {"item_id": "R-01"}, "set": {"x": 1}},
            "no column 'x'",
        ),
        ({"op": "remove", "table": "deposits", "match": {"type": "deferrals"}}, "picks"),
        ({"op": "add", "table": "deposits", "row": {"amount": {"nested": 1}}}, "plain value"),
        ({"op": "rename", "table": "deposits"}, "op must be"),
    ],
)
def test_an_edit_that_does_not_apply_is_named(edit: dict[str, Any], problem: str) -> None:
    world = world_of(SOURCE, "world.json")
    with pytest.raises(ShapeFailed, match=problem):
        apply_shape(world, {}, {}, {"rows": [edit]}, {})


def test_too_many_edits_and_a_bad_date_are_refused() -> None:
    world = world_of(SOURCE, "world.json")
    edit = {"op": "add", "table": "offers", "row": {"offer_id": "O-9"}}
    with pytest.raises(ShapeFailed, match=f"at most {MAX_ROW_EDITS}"):
        apply_shape(world, {}, {}, {"rows": [edit] * (MAX_ROW_EDITS + 1)}, {})
    with pytest.raises(ShapeFailed, match="today"):
        apply_shape(world, {}, {}, {"rows": [], "today": "next week"}, {})
    added = apply_shape(world, {}, {}, {"rows": [edit]}, {})[0]
    assert added["tables"]["offers"][-1] == {
        "offer_id": "O-9",
        "from": "",
        "received": "",
        "text": "",
    }
    assert len(world["tables"]["offers"]) == 1  # the input is left as it was


def test_a_spec_that_does_not_apply_is_sent_back_and_then_fails(tmp_path: Path) -> None:
    bad = {"rows": [{"op": "remove", "table": "nope", "match": {"a": "b"}}]}
    with pytest.raises(ShapeFailed, match="the spec did not apply"):
        shape_world(SOURCE, BRIEF, run_leg=leg_answering(bad), dest=tmp_path)


def test_a_world_the_loader_refuses_fails_the_shape(tmp_path: Path) -> None:
    other = Taxonomy(categories={"elsewhere": "Elsewhere"}, jobs={"recover": "Recover"})
    with pytest.raises(ShapeFailed, match="did not pass the spec check"):
        shape_world(SOURCE, BRIEF, run_leg=leg_answering(SPEC), dest=tmp_path, taxonomy=other)


# --- the rehearsal --------------------------------------------------------------------------------


@contextmanager
def real_session(rig: Rig, tmp_path: Path) -> Iterator[tuple[SessionStore, AdoptSession]]:
    store = SessionStore(tmp_path / "show", rig.runner, load_playbook=load_playbook_json)
    session = store.create(PID)
    session.brief = BRIEF
    try:
        yield store, session
    finally:
        store.close_all()


def showcases(session: AdoptSession) -> list[ShowcaseEvent]:
    return [e for e in session.events_after(0) if isinstance(e, ShowcaseEvent)]


def inline(fn: Any, name: str) -> None:
    fn()


def fake_report(turns: int) -> dict[str, Any]:
    return {
        "portals": {"payrollharbor": "Gusto"},
        "transcript": [
            {"app": "payrollharbor", "user": "hi", "said": f"turn {i}", "calls": [], "cards": []}
            for i in range(turns)
        ],
        "score": {"cards": [], "value_found_usd": 25.87},
        "errors": [],
    }


def test_the_rehearsal_streams_turns_and_ends_done(rig: Rig, tmp_path: Path) -> None:
    rig.model.script = {"shape": [SPEC]}
    seen: dict[str, Any] = {}

    def bench(playbook: Any, config: Any, *, world_factory: Any, echo: Any) -> dict[str, Any]:
        seen.update(playbook=playbook, config=config)
        echo("phase 1: Gusto")
        echo("  turn 1: 2 calls, 0 cards")
        echo("  turn 2: 0 calls, 1 cards")
        return fake_report(2)

    show = Showcase(bench=bench, spawn=inline)
    with real_session(rig, tmp_path) as (_, session):
        assert show.start(session, 1)
        events = showcases(session)
        recorded = json.loads((SOURCE / "bench.json").read_text(encoding="utf-8"))["turns"]
        assert [(e.status, e.turn, e.total) for e in events] == [
            ("queued", None, None),
            ("running", 0, recorded),
            ("running", 1, recorded),
            ("running", 2, recorded),
            ("done", 2, 2),
        ]
        assert events[-1].found_usd == 25.87
        assert events[-1].trace[0]["portal"] == "Gusto"
        assert seen["config"].approve == "none" and seen["config"].model == "claude-sonnet-5-5"
        assert seen["config"].cap_usd == 5.0  # the bench's own default budget
        assert seen["playbook"].apps[0].name == "Gusto"

        # One showcase per session.
        assert not show.start(session, 1)
        assert any(
            isinstance(e, Progress) and "One rehearsal" in e.text for e in session.events_after(0)
        )
        assert len(showcases(session)) == 5


def test_a_shape_the_loader_refuses_is_a_failed_showcase(rig: Rig, tmp_path: Path) -> None:
    rig.model.script = {"shape": [{"rows": [{"op": "remove", "table": "x", "match": {"a": 1}}]}]}
    ran: list[int] = []
    show = Showcase(bench=lambda *a, **k: ran.append(1) or {}, spawn=inline)
    with real_session(rig, tmp_path) as (_, session):
        show.start(session, 1)
        last = showcases(session)[-1]
        assert last.status == "failed"
        assert "the shape leg failed" in last.detail
        assert ran == []
        assert [c.kind for c in rig.model.calls] == ["shape", "shape"]  # sent back once


def test_a_bench_that_raises_is_a_failed_showcase(rig: Rig, tmp_path: Path) -> None:
    rig.model.script = {"shape": [SPEC]}

    def bench(*args: Any, **kwargs: Any) -> dict[str, Any]:
        raise RuntimeError("boom")

    show = Showcase(bench=bench, spawn=inline)
    with real_session(rig, tmp_path) as (_, session):
        show.start(session, 1)
        last = showcases(session)[-1]
        assert (last.status, last.detail) == ("failed", "the rehearsal failed: RuntimeError")


class StubWorld:
    def __init__(self) -> None:
        self.turns = 0
        self.closed = False

    def turn(self, message: str, **kwargs: Any) -> Any:
        time.sleep(0.05)
        self.turns += 1
        return type("Record", (), {"ledger": [{"model": "m", "cost_usd": 0.01}]})()

    def close(self) -> None:
        self.closed = True


def test_delete_stops_the_rehearsal_at_a_turn_boundary(rig: Rig, tmp_path: Path) -> None:
    rig.model.script = {"shape": [SPEC]}
    world = StubWorld()
    done = threading.Event()

    def bench(playbook: Any, config: Any, *, world_factory: Any, echo: Any) -> dict[str, Any]:
        built = world_factory(playbook)
        try:
            for i in range(1, 200):
                built.turn("go")
                echo(f"  turn {i}: 0 calls, 0 cards")
        finally:
            built.close()
            done.set()
        return fake_report(1)

    threads: list[threading.Thread] = []

    def spawn(fn: Any, name: str) -> None:
        threads.append(threading.Thread(target=fn, name=name, daemon=True))
        threads[-1].start()

    show = Showcase(bench=bench, make_world=lambda book: world, spawn=spawn)  # type: ignore[arg-type,return-value]
    with real_session(rig, tmp_path) as (store, session):
        show.start(session, 1)
        deadline = time.monotonic() + 10
        while world.turns < 2 and time.monotonic() < deadline:
            time.sleep(0.01)
        store.delete(session.id)
        assert done.wait(3)
        threads[0].join(3)
        assert world.closed and world.turns < 10
        assert {e.status for e in showcases(session)} <= {"queued", "running"}
        # Each turn it did run is on the live ledger, under this session.
        rows = [r for r in rig.ledger.rows if r["trigger"] == "adopt.showcase"]
        assert len(rows) == world.turns
        assert {r["conversation"] for r in rows} == {session.conversation}


def scripted(text: str) -> Any:
    async def fn(request: ModelRequest) -> AsyncIterator[ModelChunk]:
        yield ModelChunk("text", text=text)
        yield ModelChunk(
            "usage", input_tokens=100, output_tokens=20, cost_usd=0.001, model="fake-model"
        )
        yield ModelChunk("done")

    return fn


def test_the_real_bench_runs_in_the_daemon_process_without_the_writer_lock(
    live: Live, tmp_path: Path
) -> None:
    """The production ``run_bench`` on the shaped world, its Athena built in this process, while
    the live daemon's writer lock is held by someone else the whole time."""
    from athena.proving.world import World

    rig = live.rig
    rig.model.script = {"shape": [SPEC]}

    def make_world(book: Any) -> World:
        first, *rest = book.apps
        world = World(
            engine="nebius", model_fn=scripted("Nothing to file."), manifest=first.manifest()
        )
        for app in rest:
            world.register(app.manifest())
        return world

    show = Showcase(make_world=make_world, spawn=inline)
    with real_session(rig, tmp_path) as (_, session):
        assert live.local.daemon.lock.acquire(timeout=1)
        try:
            show.start(session, 1)
        finally:
            live.local.daemon.lock.release()
        last = showcases(session)[-1]
        assert last.status == "done", last.detail
        assert len(last.trace) >= 4  # one turn per phase at least: the bench really ran
        assert last.trace[0]["portal"] == "Gusto"
        assert all(e.turn is not None for e in showcases(session)[1:])
        rows = [r for r in rig.ledger.rows if r["trigger"] == "adopt.showcase"]
        assert len(rows) == len(last.trace)


def test_a_portal_the_world_names_for_another_person_is_still_renamed() -> None:
    # ltc-claims: the playbook's "Mom's bank (POA access)" is the world's "Grace's bank".
    world = {
        "apps": [
            {"name": "Harbor Mutual policyholder portal", "aliases": ["Harbor Mutual"]},
            {"name": "Grace's bank (POA access)", "aliases": ["the bank", "bank", "checking"]},
        ]
    }
    renames = showcase._renames({"Mom's bank (POA access)": "Wells Fargo"}, world)
    assert renames == {
        "Mom's bank (POA access)": "Wells Fargo",
        "Grace's bank (POA access)": "Wells Fargo",
    }


def test_no_world_app_is_renamed_on_a_tie_or_a_thin_match() -> None:
    world = {"apps": [{"name": "Harbor State Life"}, {"name": "Keystone Mutual claims portal"}]}
    assert showcase._world_app("Life insurer and group-life insurer", world["apps"]) == ""
    tie = [{"name": "Beacon IRA"}, {"name": "Northgate IRA"}]
    assert showcase._world_app("IRA custodian", tie) == ""

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

from athena.adopt import loop, showcase
from athena.adopt.legs import LegResult
from athena.adopt.session import AdoptSession, SessionStore
from athena.adopt.showcase import (
    MAX_ROW_EDITS,
    SHAPE_SYSTEM,
    ShapeFailed,
    Showcase,
    answer_key_holds,
    apply_shape,
    shape_world,
)
from athena.adopt.slots import load_playbook_json, playbooks_root
from athena.contracts.adopt import Answer, Brief, Progress
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
    session.record_draft(BRIEF, session.slots, ())
    try:
        yield store, session
    finally:
        store.close_all()


def showcases(session: AdoptSession) -> list[ShowcaseEvent]:
    return [e for e in session.events_after(0) if isinstance(e, ShowcaseEvent)]


def inline(fn: Any, name: str) -> None:
    fn()


#: Two right cards on 401k-late-deposits: lost earnings paid back, and an offer accepted.
SCORED = [
    {"action": "pay_lost_earnings", "key": "r-01", "outcome": "correct", "value_usd": 25.87},
    {"action": "accept_offer", "key": "o-2", "outcome": "correct", "value_usd": 900.0},
]


def fake_report(turns: int, scored: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    cards = SCORED[:1] if scored is None else scored
    transcript: list[dict[str, Any]] = [
        {"app": "payrollharbor", "user": "hi", "said": f"turn {i}", "calls": [], "cards": []}
        for i in range(turns)
    ]
    transcript[-1]["cards"] = [{"action": c["action"], "params": {}} for c in cards]
    return {
        "portals": {"payrollharbor": "Gusto"},
        "transcript": transcript,
        "score": {"cards": cards, "value_found_usd": sum(c["value_usd"] for c in cards)},
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
        # SPEC edits rows and moves today: the answer key no longer holds (ADR 0125).
        assert events[-1].found_usd is None and events[-1].found_reason == "shaped"
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


@pytest.fixture
def all_money_back(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every target money back, whatever kinds the library's playbook.json declares today."""
    monkeypatch.setattr(showcase, "kinds_of", lambda book: {})


def _done(rig: Rig, tmp_path: Path, spec: dict[str, Any]) -> ShowcaseEvent:
    rig.model.script = {"shape": [spec]}
    show = Showcase(bench=lambda *a, **k: fake_report(1), spawn=inline)
    with real_session(rig, tmp_path) as (_, session):
        show.start(session, 1)
        last = showcases(session)[-1]
    assert last.status == "done"
    return last


@pytest.mark.usefixtures("all_money_back")
def test_a_renames_only_rehearsal_claims_its_dollars(rig: Rig, tmp_path: Path) -> None:
    """ADR 0125: the truth is kept by renames, so a renames-only world is still scored by it."""
    last = _done(rig, tmp_path, {"today": "", "rows": [], "note": "Nothing to change."})
    assert last.found_usd == 25.87 and last.found_reason == ""


@pytest.mark.usefixtures("all_money_back")
def test_a_today_that_stays_put_is_no_shift(rig: Rig, tmp_path: Path) -> None:
    today = json.loads((SOURCE / "world.json").read_text(encoding="utf-8"))["today"]
    last = _done(rig, tmp_path, {"today": today, "rows": []})
    assert last.found_usd == 25.87 and last.found_reason == ""


def test_a_row_edit_withholds_the_dollars(rig: Rig, tmp_path: Path) -> None:
    edit = {"op": "remove", "table": "offers", "match": {"offer_id": "O-1"}}
    last = _done(rig, tmp_path, {"today": "", "rows": [edit]})
    assert last.found_usd is None and last.found_reason == "shaped"
    assert last.trace  # the run itself is still shown


def test_a_today_shift_alone_withholds_the_dollars(rig: Rig, tmp_path: Path) -> None:
    last = _done(rig, tmp_path, {"today": "2026-11-02", "rows": []})
    assert last.found_usd is None and last.found_reason == "shaped"


def test_the_answer_key_holds_only_for_renames() -> None:
    world = {"today": "2026-10-09"}
    assert answer_key_holds({"rows": []}, world)
    assert answer_key_holds({"today": "2026-10-09", "rows": []}, world)
    assert not answer_key_holds({"today": "2026-10-10", "rows": []}, world)
    assert not answer_key_holds({"rows": [{"op": "add"}]}, world)


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


# --- honest labels (chores UAT 2026-10-23, theme 5) -----------------------------------------------


def test_the_rehearsal_speaks_for_the_person_not_the_example_persona(tmp_path: Path) -> None:
    """public-03: no phase line introduces the example persona; the first runs the agreed chore."""
    shaped = shape_world(SOURCE, BRIEF, run_leg=leg_answering(SPEC), dest=tmp_path)
    phases = world_of(shaped, "world.json")["phases"]
    first = phases[0]["message"]
    assert first.startswith(
        "Run the chore we agreed: Find the late deposits for my 12-person plan. Start in Gusto"
    )
    assert "Neil" not in json.dumps(phases) and "I'm" not in first
    # The rest of the script stays: the same portals, the same number of phases.
    original = world_of(SOURCE, "world.json")["phases"]
    assert [p["app"] for p in phases] == [p["app"] for p in original]
    assert phases[1]["message"] == original[1]["message"].replace("Payroll Harbor", "Gusto")


def test_no_library_persona_introduces_itself_in_a_rehearsal() -> None:
    brief = Brief(rev=1, command="Keep the bids we can win.")
    world = world_of(LIBRARY / "bid-opportunity-triage", "world.json")
    spoken = showcase.for_the_person(world, brief, {})
    assert "Marian" in world["phases"][0]["message"]  # the example's own script
    assert "Marian" not in json.dumps(spoken["phases"])
    assert spoken["phases"][0]["message"].startswith(
        "Run the chore we agreed: Keep the bids we can win. Start in Noticewick"
    )
    assert world["phases"][0]["message"].startswith("I'm Marian")  # the input is untouched


def test_the_opening_falls_back_to_the_title_and_cuts_a_long_command() -> None:
    world = {"phases": [{"app": "a", "message": "I am Rosa."}, {"app": "a", "message": "Go on."}]}
    titled = showcase.for_the_person(world, Brief(rev=1), {"short_title": "Deposit back"})
    assert [p["message"] for p in titled["phases"]] == [
        "Run the chore we agreed: Deposit back.",
        "Go on.",
    ]
    long = Brief(rev=1, command="word " * 100)
    cut = showcase.for_the_person(world, long, {})["phases"][0]["message"]
    assert cut.endswith("(the rest is in the brief).") and len(cut) < 320


def test_kinds_are_read_from_the_playbook_and_unknown_ones_dropped() -> None:
    book = {"economics": {"kinds": {"a": "count", "b": "money_protected", "c": "dollars"}}}
    assert showcase.kinds_of(book) == {"a": "count", "b": "money_protected"}
    assert showcase.kinds_of({}) == {}


def test_found_counts_only_money_back_cards() -> None:
    score = {"cards": [*SCORED, {"action": "x", "outcome": "trap", "value_usd": 5}]}
    targets = ["pay_lost_earnings", "accept_offer"]
    assert showcase.money_back_found(score, {}, targets) == 925.87
    protected = {"accept_offer": "money_protected"}
    assert showcase.money_back_found(score, protected, targets) == 25.87
    # No target gives money back: unmeasured, never zero.
    none_back = {"pay_lost_earnings": "count", "accept_offer": "penalty_avoided"}
    assert showcase.money_back_found(score, none_back, targets) is None
    # A score without cards: value_found_usd stands in only when every target is money back.
    assert showcase.money_back_found({"value_found_usd": 7.5}, {}, targets) == 7.5
    assert showcase.money_back_found({"value_found_usd": 7.5}, protected, targets) is None


def test_a_renames_only_trace_keeps_its_grades_and_drops_count_dollars() -> None:
    trace = [{"portal": "Gusto", "cards": [dict(c) for c in SCORED]}]
    shown = showcase.annotate_trace(trace, {"accept_offer": "count"}, holds=True, adjusted=0)
    cards = shown[0]["cards"]
    assert [(c["kind"], c["outcome"], c["value_usd"]) for c in cards] == [
        ("money_back", "correct", 25.87),
        ("count", "correct", None),
    ]
    assert "adjusted" not in shown[0]
    assert trace[0]["cards"][1]["value_usd"] == 900.0  # the input is untouched


def test_a_shaped_trace_grades_nothing_and_says_how_much_was_adjusted() -> None:
    """public-05, construction-05: the old answer key marks no card right or wrong."""
    trace = [{"portal": "Gusto", "cards": [dict(c) for c in SCORED]}, {"portal": "Gusto"}]
    shown = showcase.annotate_trace(trace, {}, holds=False, adjusted=3)
    assert {(c["outcome"], c["value_usd"]) for c in shown[0]["cards"]} == {("proposed", None)}
    assert shown[0]["adjusted"] == 3 and "adjusted" not in shown[1]


def test_adjusted_counts_row_edits_and_a_moved_date() -> None:
    world = {"today": "2026-10-09"}
    assert showcase.adjusted_count(SPEC, world) == 3
    assert showcase.adjusted_count({"today": "2026-10-09", "rows": []}, world) == 0
    assert showcase.adjusted_count({"rows": [{}]}, world) == 1


def test_the_done_event_sums_money_back_and_labels_each_card(
    rig: Rig, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(showcase, "kinds_of", lambda book: {"accept_offer": "money_protected"})
    rig.model.script = {"shape": [{"today": "", "rows": []}]}
    show = Showcase(bench=lambda *a, **k: fake_report(1, SCORED), spawn=inline)
    with real_session(rig, tmp_path) as (_, session):
        show.start(session, 1)
        last = showcases(session)[-1]
    assert last.found_usd == 25.87 and last.found_reason == ""
    cards = last.trace[-1]["cards"]
    assert [(c["kind"], c["outcome"]) for c in cards] == [
        ("money_back", "correct"),
        ("money_protected", "correct"),
    ]


def test_a_shaped_done_event_carries_proposals_and_the_adjusted_count(
    rig: Rig, tmp_path: Path
) -> None:
    rig.model.script = {"shape": [SPEC]}
    show = Showcase(bench=lambda *a, **k: fake_report(2, SCORED), spawn=inline)
    with real_session(rig, tmp_path) as (_, session):
        show.start(session, 1)
        last = showcases(session)[-1]
    assert last.found_usd is None and last.found_reason == "shaped"
    assert last.trace[0]["adjusted"] == 3
    assert {(c["outcome"], c["value_usd"]) for c in last.trace[-1]["cards"]} == {("proposed", None)}


def test_a_line_that_says_where_she_is_is_kept() -> None:
    world = {"phases": [{"app": "a", "message": "I'm in Procore Pay. I'm Ray, the PM. Read it."}]}
    spoken = showcase.for_the_person(world, Brief(rev=1, command="Chase the liens."), {})
    assert spoken["phases"][0]["message"] == (
        "Run the chore we agreed: Chase the liens. I'm in Procore Pay. Read it."
    )


def test_a_playbook_with_no_money_back_target_claims_no_found_dollars(
    rig: Rig, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Unmeasured is not zero: a chore whose answer key holds no money back sends no figure."""
    kinds = {"pay_lost_earnings": "money_protected", "accept_offer": "count"}
    monkeypatch.setattr(showcase, "kinds_of", lambda book: kinds)
    last = _done(rig, tmp_path, {"today": "", "rows": []})
    assert last.found_usd is None and last.found_reason == ""
    assert last.trace[-1]["cards"][0]["kind"] == "money_protected"


# --- an approval pins the draft it was shown (ADR 0151) -------------------------------------------


def approved_and_deferred(
    rig: Rig, tmp_path: Path, show_bench: Any = None
) -> tuple[SessionStore, AdoptSession, list[Any], Brief]:
    """A real-playbook session whose brief 1 is drafted (p1 held) and approved, its rehearsal
    queued but not yet run: answers the store, the session, the deferred jobs and brief 1."""
    rig.model.script = {
        "shape": [SPEC],
        "brief": [{"lead": "I'll check the deposits of draft one."}, {"lead": "Draft two now."}],
    }
    store = SessionStore(tmp_path / "pinned", rig.runner, load_playbook=load_playbook_json)
    session = store.create(PID)
    session.apply_findings(
        [{"slot_id": "p1", "value": "Gusto", "status": "confirmed"}], source="document"
    )
    loop.enough(session)
    session.drain()
    first = session.brief
    assert first is not None and first.rev == 1
    assert loop.approve(session, 1) == ""
    session.drain()
    deferred: list[Any] = []
    show = Showcase(
        bench=show_bench or (lambda *a, **k: fake_report(1)),
        spawn=lambda fn, name: deferred.append(fn),
    )
    assert show.start(session, 1)
    assert len(deferred) == 1
    return store, session, deferred, first


def test_case_2_a_late_document_value_does_not_reach_the_approved_rehearsal(
    rig: Rig, tmp_path: Path
) -> None:
    store, session, deferred, _ = approved_and_deferred(rig, tmp_path)
    try:
        # A document lane reads p2 after the approval, before the rehearsal's job runs.
        session.apply_findings(
            [{"slot_id": "p2", "value": "Fidelity Late", "status": "confirmed"}],
            source="document",
        )
        deferred[0]()
        prompts = [c.prompt for c in rig.model.calls if c.kind == "shape"]
        assert prompts, "the shape leg never ran"
        assert "Gusto" in prompts[0]
        assert "Fidelity Late" not in prompts[0]
    finally:
        store.close_all()


def test_case_3_a_rev_drafted_after_approval_is_not_the_world_that_is_shaped(
    rig: Rig, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    handed: list[Brief] = []

    def fake_shape(source: Any, brief: Brief, **kwargs: Any) -> Path:
        handed.append(brief)
        raise ShapeFailed("captured")

    monkeypatch.setattr(showcase, "shape_world", fake_shape)
    store, session, deferred, first = approved_and_deferred(rig, tmp_path)
    try:
        loop.receive_answers(session, [Answer(question_id="", text="We moved to ADP.")], "text")
        session.drain()
        if session.brief is not None and session.brief.rev == 1:
            loop.enough(session)  # the round drafts on its own when its audit clears
            session.drain()
        assert session.brief is not None and session.brief.rev >= 2
        assert session.brief.md != first.md
        deferred[0]()
        assert handed == [first]
        assert (handed[0].command, handed[0].portals) == (first.command, first.portals)
    finally:
        store.close_all()

"""The research lanes (ADR 0097): rules on the web with a source for every finding, accounts read
by the daemon, memory recalled, documents read with ``Read`` alone — each a lane of its own."""

from __future__ import annotations

import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import pytest

from athena.adopt import research as research_mod
from athena.adopt.documents import DOCUMENT_SYSTEM
from athena.adopt.research import (
    ACCOUNTS_SYSTEM,
    MEMORY_SYSTEM,
    PLAN_SYSTEM,
    RULES_SYSTEM,
    Accounts,
    Research,
)
from athena.adopt.session import AdoptSession, SessionStore, current_hooks
from athena.adopt.slots import add_slots, apply_updates
from athena.contracts.adopt import LaneEvent, Progress

from . import conftest
from .conftest import PLAYBOOK_ID, Rig, load_fixture


@pytest.fixture(autouse=True)
def _kinds(monkeypatch: pytest.MonkeyPatch) -> None:
    """The fake model tells the research legs apart by their system prompts."""
    for system, kind in (
        (RULES_SYSTEM, "rules"),
        (PLAN_SYSTEM, "plan"),
        (ACCOUNTS_SYSTEM, "accounts"),
        (MEMORY_SYSTEM, "memory"),
        (DOCUMENT_SYSTEM, "document"),
    ):
        monkeypatch.setitem(conftest.SYSTEMS, system, kind)


def inline(fn: Any, name: str) -> None:
    fn()


class FakeAccounts(Accounts):
    def __init__(self, live: list[str], gate: threading.Event | None = None) -> None:
        self._live = live
        self.searched: list[tuple[str, str]] = []
        self.gate = gate

    def live(self) -> list[str]:
        return list(self._live)

    def search(self, connector: str, query: str) -> tuple[bool, str]:
        self.searched.append((connector, query))
        if self.gate is not None:
            self.gate.wait(5)
        return (
            True,
            f"<<<gmail:abc\nFrom: Delta <no-reply@delta.com>\nSubject: Receipt {query}\n>>>",
        )


@contextmanager
def make_session(rig: Rig, tmp_path: Path, research: Research) -> Iterator[AdoptSession]:
    hooks = research.hooks()
    store = SessionStore(
        tmp_path / "research", rig.runner, load_playbook=load_fixture, hooks=lambda: hooks
    )
    session = store.create(PLAYBOOK_ID)
    grown = add_slots(session.slots, [{"kind": "fact", "label": "People in the plan", "value": ""}])
    session.set_slots(grown)
    try:
        yield session
    finally:
        store.close_all()


def lanes_of(session: AdoptSession, lane_id: str) -> list[tuple[str, str]]:
    return [
        (e.lane.status, e.lane.summary)
        for e in session.events_after(0)
        if isinstance(e, LaneEvent) and e.lane is not None and e.lane.id == lane_id
    ]


def last_lane(session: AdoptSession, lane_id: str) -> Any:
    found = [
        e.lane
        for e in session.events_after(0)
        if isinstance(e, LaneEvent) and e.lane is not None and e.lane.id == lane_id
    ]
    return found[-1]


def progress(session: AdoptSession) -> list[str]:
    return [e.text for e in session.events_after(0) if isinstance(e, Progress)]


def calls(rig: Rig, kind: str) -> list[conftest.Call]:
    return [c for c in rig.model.calls if c.kind == kind]


def tools_of(argv: list[str]) -> str:
    return argv[argv.index("--tools") + 1]


RULES = {
    "summary": "A deposit is late after the 7th business day for a small plan.",
    "findings": [
        {
            "text": "Small plans have a 7 business day safe harbor.",
            "source_url": "https://www.ecfr.gov/current/title-29/section-2510.3-102",
            "slot_ids": ["f1", "p1", "nope"],
            "value": "under 100",
        },
        {"text": "A rumour with no source.", "source_url": "", "slot_ids": ["f1"]},
    ],
}


def test_start_runs_three_lanes_and_rules_keep_only_sourced_findings(
    rig: Rig, tmp_path: Path
) -> None:
    rig.model.script = {"rules": [RULES]}
    research = Research(spawn=inline)
    with make_session(rig, tmp_path, research) as session:
        research.on_start(session)

        rules = last_lane(session, "rules")
        assert rules.status == "done"
        assert [f.text for f in rules.findings] == [
            "Small plans have a 7 business day safe harbor."
        ]
        # Only fact and trap slots are the rules' to settle; unknown ids are dropped.
        assert rules.findings[0].slot_ids == ("f1",)
        assert "1 finding without a source dropped" in rules.summary
        assert session.counters["rules_finding_unsourced"] == 1
        f1 = next(s for s in session.slots if s.id == "f1")
        assert (f1.value, f1.status, f1.source) == ("under 100", "guessed", "research")

        argv = calls(rig, "rules")[0].argv
        assert tools_of(argv) == "WebSearch,WebFetch"
        assert argv[argv.index("--allowedTools") + 1] == "WebSearch,WebFetch"

        # Neither account is connected, so the line names both and blames neither alone.
        accounts = lanes_of(session, "accounts")[-1]
        assert accounts == ("skipped", "No Gmail or Notion account is connected")
        assert lanes_of(session, "memory")[-1] == ("skipped", "Nothing recalled")
        assert progress(session)[-1] == "1 of 3 lanes done · 2 skipped"
        assert calls(rig, "plan") == [] and calls(rig, "memory") == []


def test_research_never_overrides_what_the_person_confirmed(rig: Rig, tmp_path: Path) -> None:
    rig.model.script = {"rules": [RULES]}
    research = Research(spawn=inline)
    with make_session(rig, tmp_path, research) as session:
        mine, _ = apply_updates(
            session.slots, [{"slot_id": "f1", "value": "38", "status": "confirmed"}], source="user"
        )
        session.set_slots(mine)
        research.on_start(session)
        f1 = next(s for s in session.slots if s.id == "f1")
        assert (f1.value, f1.status, f1.source) == ("38", "confirmed", "user")
        # The person's confirmed fact reached the rules leg, fenced as their words.
        prompt = calls(rig, "rules")[0].prompt
        assert "<<<answers:" in prompt and "f1: 38" in prompt


def test_a_failed_rules_leg_fails_its_lane_only(rig: Rig, tmp_path: Path) -> None:
    rig.model.script = {"rules": ["not json at all"]}
    research = Research(spawn=inline, recall=lambda q: ["Owner of Wexcombe Packaging."])
    rig.model.script["memory"] = [
        {"findings": [{"text": "They own Wexcombe Packaging.", "slot_ids": ["p1"]}]}
    ]
    with make_session(rig, tmp_path, research) as session:
        research.on_start(session)
        assert lanes_of(session, "rules")[-1] == ("failed", "parse_error")
        assert last_lane(session, "memory").status == "done"
        assert (
            progress(session)[-1] == "1 of 3 lanes done · 1 failed (rules: parse_error) · 1 skipped"
        )


def test_accounts_are_searched_by_the_daemon_and_summarised_fenced(
    rig: Rig, tmp_path: Path
) -> None:
    accounts = FakeAccounts(["gmail"])
    rig.model.script = {
        "rules": [{"findings": []}],
        "plan": [
            {
                "searches": [
                    {"connector": "gmail", "query": "from:payrollharbor"},
                    {"connector": "notion", "query": "deposits"},
                    {"connector": "gmail", "query": "subject:401k"},
                    {"connector": "gmail", "query": "late deposit"},
                    {"connector": "gmail", "query": "one too many"},
                ]
            }
        ],
        "accounts": [
            {
                "summary": "Your payroll mail comes from Gusto.",
                "findings": [
                    {
                        "text": "Gmail: Receipt — payroll runs through Gusto.",
                        "source_url": "",
                        "slot_ids": ["p1"],
                        "value": "Gusto",
                    }
                ],
            }
        ],
    }
    research = Research(spawn=inline, accounts=accounts)
    with make_session(rig, tmp_path, research) as session:
        research.on_start(session)

        # Only connected accounts, at most three searches, run by the daemon (not the model).
        assert accounts.searched == [
            ("gmail", "from:payrollharbor"),
            ("gmail", "subject:401k"),
            ("gmail", "late deposit"),
        ]
        assert tools_of(calls(rig, "plan")[0].argv) == ""
        summary_prompt = calls(rig, "accounts")[0].prompt
        assert "<<<accounts:" in summary_prompt
        lane = last_lane(session, "accounts")
        assert lane.status == "done" and lane.title == "Your Gmail, read only"
        p1 = next(s for s in session.slots if s.id == "p1")
        assert (p1.value, p1.status, p1.source) == ("Gusto", "guessed", "account")


def test_memory_maps_recalled_facts_fenced(rig: Rig, tmp_path: Path) -> None:
    asked: list[str] = []

    def recall(query: str) -> list[str]:
        asked.append(query)
        return ["The plan had 38 participants in 2026."]

    rig.model.script = {
        "rules": [{"findings": []}],
        "memory": [
            {"findings": [{"text": "38 people in the plan.", "slot_ids": ["f1"], "value": "38"}]}
        ],
    }
    research = Research(spawn=inline, recall=recall)
    with make_session(rig, tmp_path, research) as session:
        research.on_start(session)
        assert "Payroll Harbor" in asked[0]
        assert "<<<memory:" in calls(rig, "memory")[0].prompt
        f1 = next(s for s in session.slots if s.id == "f1")
        assert (f1.value, f1.source) == ("38", "memory")


def test_a_document_is_read_with_read_alone_in_the_session_dir(rig: Rig, tmp_path: Path) -> None:
    rig.model.script = {
        "document": [
            {
                "summary": "A deposit report.",
                "findings": [{"text": "p. 1: 38 participants.", "slot_ids": ["f1"], "value": "38"}],
            }
        ]
    }
    research = Research(spawn=inline)
    with make_session(rig, tmp_path, research) as session:
        path = session.temp_dir / "docs" / "doc1-report.txt"
        path.parent.mkdir(parents=True)
        path.write_text("38 participants", encoding="utf-8")
        research.on_document(session, "doc1", path)

        argv = calls(rig, "document")[0].argv
        assert tools_of(argv) == "Read"
        assert argv[argv.index("--allowedTools") + 1] == "Read"
        assert "docs/doc1-report.txt" in calls(rig, "document")[0].prompt
        request = rig.transport.requests[-1]
        assert Path(request.cwd) == session.temp_dir
        lane = last_lane(session, "doc1")
        assert (lane.kind, lane.status, lane.title) == (
            "document",
            "done",
            "Your document: report.txt",
        )
        assert next(s for s in session.slots if s.id == "f1").source == "document"
        assert progress(session)[-1] == "1 of 1 lane done"


def test_rules_rerun_after_a_new_confirmed_fact_at_most_once_per_two_answers(
    rig: Rig, tmp_path: Path
) -> None:
    rig.model.script = {"rules": [{"findings": []}]}
    research = Research(spawn=inline)
    with make_session(rig, tmp_path, research) as session:
        research.on_start(session)
        assert len(calls(rig, "rules")) == 1

        research.on_answer(session)  # nothing new confirmed
        mine, _ = apply_updates(
            session.slots, [{"slot_id": "f1", "value": "38", "status": "confirmed"}], source="user"
        )
        session.set_slots(mine)
        research.on_answer(session)  # a new fact, two answers since the start: rerun
        assert len(calls(rig, "rules")) == 2

        changed, _ = apply_updates(
            session.slots, [{"slot_id": "f1", "value": "40", "status": "confirmed"}], source="user"
        )
        session.set_slots(changed)
        research.on_answer(session)  # one answer since the rerun: wait
        assert len(calls(rig, "rules")) == 2
        research.on_answer(session)
        assert len(calls(rig, "rules")) == 3


def test_delete_cancels_the_lanes(rig: Rig, tmp_path: Path) -> None:
    gate = threading.Event()
    accounts = FakeAccounts(["gmail"], gate=gate)
    rig.model.script = {
        "rules": [{"findings": []}],
        "plan": [{"searches": [{"connector": "gmail", "query": "a"}]}],
    }
    threads: list[threading.Thread] = []

    def spawn(fn: Any, name: str) -> None:
        thread = threading.Thread(target=fn, name=name, daemon=True)
        threads.append(thread)
        thread.start()

    research = Research(spawn=spawn, accounts=accounts)
    hooks = research.hooks()
    store = SessionStore(
        tmp_path / "research", rig.runner, load_playbook=load_fixture, hooks=lambda: hooks
    )
    session = store.create(PLAYBOOK_ID)
    research.on_start(session)
    deadline = time.monotonic() + 5
    while not accounts.searched and time.monotonic() < deadline:
        time.sleep(0.01)
    assert accounts.searched  # the accounts lane is mid-search

    began = time.monotonic()
    store.delete(session.id)
    threads[0].join(3)
    gate.set()
    assert not threads[0].is_alive()
    assert time.monotonic() - began < 3
    assert session.cancelled.is_set()
    assert session.events_after(0)[-1].kind == "adopt.error"  # session_closed is the last word


def test_build_local_binds_the_lanes_to_its_own_store_not_process_wide(tmp_path: Path) -> None:
    from athena.channels.voice.config import VoiceStudio
    from athena.channels.voice.home import EngineHomes
    from athena.connectors.seal import FileSeal
    from athena.harness.transports import ScriptedTransport
    from athena.wiring import build_local

    before = current_hooks()
    voice = VoiceStudio(
        tmp_path / "voice",
        homes=EngineHomes(tmp_path / "personas"),
        seal=FileSeal(tmp_path / "voice" / "sealed"),
        environ={},
    )
    with build_local(
        brain_root=tmp_path / "brain",
        engine="claude_code",
        model="fake-model",
        transport=lambda dialect: ScriptedTransport([]),
        workspace=tmp_path / "engine",
        voice_studio=voice,
    ) as local:
        assert local.adopt is not None
        hooks = local.adopt.store.hooks()
        assert getattr(hooks.on_start, "__self__", None).__class__ is research_mod.Research
        assert current_hooks() == before  # nothing registered process-wide
        caps = local.daemon.body_caps
        assert local.daemon.body_limit("/adopt/sess_1/documents") == 14 * 1024 * 1024
        assert local.daemon.body_limit("/adopt/sess_1/answer") == 1_048_576
        assert caps

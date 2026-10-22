"""A case file that survives restarts (ADR 0123): approve, restart, reopen, rebuild the index."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from athena.adopt.cases import CaseBook, parse_case, perishable, render_case
from athena.adopt.routes import AdoptStudio, cases
from athena.contracts.adopt import Case, CaseSlot, Slot
from athena.contracts.ids import is_id
from athena.core.brain import Brain, frontmatter, reconcile_from_disk
from athena.daemon.routes import Request

from .conftest import PLAYBOOK_ID, Live, clear_script, make_rig


def dated_script() -> dict[str, list[Any]]:
    """:func:`clear_script` plus a date fact (f2) the chore depends on."""
    script = clear_script()
    first, second = script["audit"]
    first["new_slots"].insert(
        1,
        {
            "kind": "fact",
            "label": "Date of the last late deposit",
            "value": "2026-03-03",
            "status": "guessed",
        },
    )
    second["updates"].append({"slot_id": "f2", "value": "March 3, 2026", "status": "confirmed"})
    return script


def approve_one(live: Live, script: dict[str, list[Any]], said: str = "yes") -> tuple[str, str]:
    """Start, answer the first card, approve rev 1: answers ``(session_id, case_id)``."""
    live.rig.model.script = json.loads(json.dumps(script))
    status, body = live.request("/adopt", method="POST", body={"playbook_id": PLAYBOOK_ID})
    assert status == 200, body
    sid = str(body["session_id"])
    session = live.rig.store.get(sid)
    assert session is not None
    session.drain()
    card = next(e.to_dict() for e in session.events_after(0) if e.kind == "adopt.questions")
    answers = {
        "answers": [
            {"question_id": card["questions"][0]["id"], "choice_ids": ["b"], "text": ""},
            {"question_id": card["questions"][1]["id"], "choice_ids": [], "text": said},
        ],
        "via": "text",
    }
    assert live.request(f"/adopt/{sid}/answer", method="POST", body=answers)[0] == 200
    session.drain()
    status, body = live.request(f"/adopt/{sid}/approve", method="POST", body={"rev": 1})
    assert status == 200 and body["case_problem"] == "", body
    return sid, str(body["case_id"])


def restart(live: Live, tmp_path: Path, name: str = "again") -> None:
    """Drop every live session, as a daemon restart would; the brain stays."""
    live.rig.store.close_all()
    fresh = make_rig(tmp_path / name)
    live.rig = fresh
    live.studio.store = fresh.store


def test_an_approval_writes_the_case_file_an_episode_and_cited_facts(live: Live) -> None:
    _, case_id = approve_one(live, dated_script())
    brain = live.local.brain
    assert is_id("project", case_id)
    text = (brain.root / "goals" / f"{case_id}.md").read_text(encoding="utf-8")
    meta, body = frontmatter.parse(text)
    # The brain's goal header, five keys and no chore field among them.
    assert list(meta) == ["id", "type", "title", "session", "created"]
    assert meta["id"] == case_id and meta["type"] == "goal"
    assert meta["session"] == f"conv_{case_id}"

    case, extra = parse_case(body)
    assert extra == {}
    assert (case.id, case.playbook_id, case.approved_rev) == (case_id, PLAYBOOK_ID, 1)
    assert "I'll find the late deposits" in case.brief_md and case.brief_md in body
    assert case.command.startswith("Find the late deposits") and "My case:" in case.command
    assert case.portals == {"Payroll Harbor": "Gusto", "Retireline": ""}
    by_id = {s.id: s for s in case.slots}
    p1 = by_id["p1"]
    assert (p1.status, p1.source, p1.value) == ("confirmed", "user", "Gusto")
    assert p1.confirmed_at.startswith(case.approved_at[:10]) and p1.quote == "No, Gusto"
    assert by_id["p2"].quote == "yes"
    assert by_id["g1"].source == "default" and by_id["g1"].fact_id == ""

    # The approval is an episode; each slot she confirmed is a fact citing it, through the gate.
    episode = brain.node(case.episode_id)
    assert episode is not None and episode.kind == "episode"
    assert episode.session_id == f"conv_{case_id}"
    assert f"[project:{case_id}]" in brain.read_body(case.episode_id)
    assert brain.sources_of(p1.fact_id) == [case.episode_id]
    assert "Gusto" in brain.read_body(p1.fact_id)
    assert [a.rev for a in case.approvals] == [1]


def test_a_restart_reopens_the_case_with_nothing_asked_again_but_the_date(
    live: Live, tmp_path: Path
) -> None:
    _, case_id = approve_one(live, dated_script())
    saved = CaseBook(live.local.brain).load(case_id)
    assert saved is not None
    restart(live, tmp_path)
    # Whatever the interviewer would ask, only the reopened date may reach the card.
    live.rig.model.script = {
        "interview": [
            {
                "questions": [
                    {"slot_ids": ["p1", "f1"], "text": "Still Gusto, and still 38 people?"},
                    {"slot_ids": ["f2", "p2"], "text": "Is March 3 still the last late one?"},
                ]
            }
        ]
    }
    status, body = live.request(
        "/adopt", method="POST", body={"playbook_id": PLAYBOOK_ID, "case_id": case_id}
    )
    assert status == 200, body
    assert body["case"]["case_id"] == case_id and body["case"]["approved_rev"] == 1
    session = live.rig.store.get(str(body["session_id"]))
    assert session is not None
    session.drain()
    events = [e.to_dict() for e in session.events_after(0)]

    brief = next(e for e in events if e["kind"] == "adopt.brief")
    assert (brief["rev"], brief["command"], brief["md"]) == (1, saved.command, saved.brief_md)
    slots = {s["id"]: s for s in next(e for e in events if e["kind"] == "adopt.slots")["slots"]}
    assert {i: (s["value"]) for i, s in slots.items()} == {s.id: s.value for s in saved.slots}
    assert slots["f2"]["status"] == "guessed" and slots["f2"]["source"] == "memory"
    for sid in ("p1", "p2", "f1", "t1"):
        assert (slots[sid]["status"], slots[sid]["source"]) == ("confirmed", "memory")
    asked = [q for e in events if e["kind"] == "adopt.questions" for q in e["questions"]]
    assert asked and {i for q in asked for i in q["slot_ids"]} == {"f2"}
    # No audit ran to re-derive anything; the one model call is the date's card.
    assert live.rig.model.kinds() == ["interview"]

    # Approving the restored brief keeps the case's id and adds an approval.
    status, body = live.request(f"/adopt/{session.id}/approve", method="POST", body={"rev": 1})
    assert body["case_id"] == case_id
    again = CaseBook(live.local.brain).load(case_id)
    assert again is not None and [a.rev for a in again.approvals] == [1, 1]
    kept = {s.id: s for s in again.slots}
    # A carried slot keeps its date and its fact; nothing new was written for it.
    assert kept["p1"].fact_id == {s.id: s for s in saved.slots}["p1"].fact_id
    assert kept["p1"].confirmed_at == {s.id: s for s in saved.slots}["p1"].confirmed_at


def test_a_case_with_no_date_reopens_clear_with_no_model_call(live: Live, tmp_path: Path) -> None:
    _, case_id = approve_one(live, clear_script())
    restart(live, tmp_path)
    status, body = live.request(
        "/adopt", method="POST", body={"playbook_id": PLAYBOOK_ID, "case_id": case_id}
    )
    assert status == 200, body
    session = live.rig.store.get(str(body["session_id"]))
    assert session is not None
    session.drain()
    kinds = [e.kind for e in session.events_after(0)]
    assert "adopt.questions" not in kinds and kinds[-1] == "adopt.clear"
    assert live.rig.model.kinds() == []
    assert live.request(f"/adopt/{session.id}/approve", method="POST", body={"rev": 1})[0] == 200


def test_the_case_is_found_again_after_the_index_is_deleted(live: Live, tmp_path: Path) -> None:
    _, case_id = approve_one(live, dated_script())
    root = live.local.brain.root
    copy = tmp_path / "copied-brain"
    shutil.copytree(root, copy, ignore=shutil.ignore_patterns("index.sqlite*"))
    with Brain(copy) as brain:
        studio = AdoptStudio(live.rig.store, cases=CaseBook(brain))
        assert cases(studio, Request("GET", "/adopt/cases"))[1]["cases"] == []
        reconcile_from_disk(brain)
        status, body = cases(
            studio, Request("GET", "/adopt/cases", query={"playbook_id": PLAYBOOK_ID})
        )
    assert status == 200 and [c["case_id"] for c in body["cases"]] == [case_id]
    assert body["total"] == 1 and body["footer"] == ""


def test_two_cases_of_one_playbook_stay_distinct(live: Live, tmp_path: Path) -> None:
    first_sid, first = approve_one(live, clear_script(), said="yes")
    live.rig.store.delete(first_sid)
    _, second = approve_one(live, clear_script(), said="Retireline, the old plan")
    assert first != second
    status, body = live.request(f"/adopt/cases?playbook_id={PLAYBOOK_ID}")
    assert status == 200 and {c["case_id"] for c in body["cases"]} == {first, second}
    assert live.request("/adopt/cases?playbook_id=another")[1]["cases"] == []
    book = CaseBook(live.local.brain)
    one, two = book.load(first), book.load(second)
    assert one is not None and two is not None
    quote = {c.id: {s.id: s.quote for s in c.slots}["p2"] for c in (one, two)}
    assert quote == {first: "yes", second: "Retireline, the old plan"}


def test_reopen_refuses_a_bad_unknown_or_foreign_case(live: Live) -> None:
    def start(case_id: Any, playbook_id: str = PLAYBOOK_ID) -> tuple[int, dict[str, Any]]:
        body = {"playbook_id": playbook_id, "case_id": case_id}
        return live.request("/adopt", method="POST", body=body)

    assert start(7)[0] == 400
    assert start("proj_nothex")[0] == 400
    assert start("proj_0123456789ab")[0] == 404
    _, case_id = approve_one(live, clear_script())
    assert start(case_id, "demo-other")[0] == 400


def test_a_rewrite_keeps_keys_a_later_writer_added(live: Live) -> None:
    sid, case_id = approve_one(live, clear_script())
    path = live.local.brain.root / "goals" / f"{case_id}.md"
    meta, body = frontmatter.parse(path.read_text(encoding="utf-8"))
    case, _ = parse_case(body)
    path.write_text(
        frontmatter.render(list(meta.items()), render_case(case, {"receipts": [{"n": 1}]})),
        encoding="utf-8",
        newline="\n",
    )
    session = live.rig.store.get(sid)
    assert session is not None
    assert live.request(f"/adopt/{sid}/approve", method="POST", body={"rev": 1})[0] == 200
    _, body = frontmatter.parse(path.read_text(encoding="utf-8"))
    case, extra = parse_case(body)
    assert extra == {"receipts": [{"n": 1}]} and len(case.approvals) == 2


def test_the_reader_takes_the_last_block_and_refuses_junk() -> None:
    case = Case(
        id="proj_0123456789ab",
        playbook_id="p",
        title="T",
        approved_rev=2,
        approved_at="2026-10-22T00:00:00+00:00",
        episode_id="ep_01234567",
        created="2026-10-22T00:00:00+00:00",
        brief_md='<!-- athena:case -->\n```json\n{"schema": 1, "id": "proj_ffffffffffff"}\n```',
        slots=(CaseSlot("f1", "fact", "When", "confirmed", "May 1", "user"),),
    )
    parsed, _ = parse_case(render_case(case))
    assert parsed == case
    for junk in ("no block", "<!-- athena:case -->\n```json\n[1]\n```", ""):
        try:
            parse_case(junk)
        except ValueError:
            continue
        raise AssertionError(f"read junk: {junk!r}")


def test_only_date_and_amount_facts_perish() -> None:
    def fact(label: str, value: str = "") -> Slot:
        return Slot("f1", "fact", label, "confirmed", value)

    assert perishable(fact("Date of the last late deposit", "2026-03-03"))
    assert perishable(fact("When did it happen?", "March 3"))
    assert perishable(fact("Amount owed", "$1,200"))
    assert perishable(fact("Their rate", "4%"))
    assert not perishable(fact("People in the plan", "38"))
    assert not perishable(fact("Which state", "Ohio"))
    assert not perishable(Slot("t1", "trap", "Deposits on the seventh day", "confirmed"))
    assert not perishable(Slot("p1", "portal", "Due date app?", "confirmed", "Gusto"))


def test_research_never_overrides_what_an_earlier_approval_confirmed() -> None:
    from athena.adopt.slots import apply_updates

    carried = [Slot("p1", "portal", "Mail?", "confirmed", "Gmail", "memory")]
    update = [{"slot_id": "p1", "value": "Outlook", "status": "guessed"}]
    assert apply_updates(carried, update, source="research") == (carried, False)
    changed, moved = apply_updates(carried, update, source="user")
    assert moved and changed[0].value == "Outlook"

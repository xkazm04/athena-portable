"""A case file that survives restarts (ADR 0123): approve, restart, reopen, rebuild the index."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from athena.adopt import loop
from athena.adopt.cases import CaseBook, parse_case, perishable, render_case, reopen_slots
from athena.adopt.routes import AdoptStudio, cases
from athena.adopt.session import AdoptSession
from athena.contracts.adopt import Answer, Case, CaseSlot, Slot
from athena.contracts.ids import is_id
from athena.core.brain import Brain, frontmatter, reconcile_from_disk
from athena.daemon.routes import Request
from athena.spaces.book import check_input

from .conftest import PLAYBOOK_ID, Live, Rig, clear_script, make_rig


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


def approve_one(
    live: Live, script: dict[str, list[Any]], said: str = "yes", **start: Any
) -> tuple[str, str]:
    """Start, answer the first card, approve rev 1: answers ``(session_id, case_id)``. ``start``
    is merged into the ``POST /adopt`` body (``case_id``, ``space_id``)."""
    live.rig.model.script = json.loads(json.dumps(script))
    status, body = live.request("/adopt", method="POST", body={"playbook_id": PLAYBOOK_ID, **start})
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
    assert case.command.startswith("Run this chore for my own case") and "My setup:" in case.command
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


def test_a_reopened_playbook_rule_stays_the_playbooks() -> None:
    """A rule the playbook states (source ``default``) stays the playbook's when a case reopens;
    her own facts carry as ``memory`` (spark chores-uat, WP-B)."""
    case = Case(
        id="proj_0123456789ab",
        playbook_id="p",
        title="T",
        approved_rev=1,
        approved_at="2026-10-22T00:00:00+00:00",
        episode_id="ep_01234567",
        created="2026-10-22T00:00:00+00:00",
        slots=(
            CaseSlot(
                "f1", "fact", "Appeal window", "confirmed", "180 days (45 CFR 147.136)", "default"
            ),
            CaseSlot("f2", "fact", "Her insurer", "confirmed", "Northstar", "user"),
        ),
    )
    slots, _ = reopen_slots([], case)
    by_id = {s.id: s for s in slots}
    assert by_id["f1"].source == "default"
    assert by_id["f2"].source == "memory"


# --- an approval pins the draft it was shown (ADR 0151) -------------------------------------------


def open_deposit_script() -> dict[str, list[Any]]:
    """A first card with fact f1 ("Deposit held") still open, so ``enough`` drafts it unknown."""
    script = clear_script()
    script["audit"] = [
        {
            "new_slots": [{"kind": "fact", "label": "Deposit held", "value": ""}],
            "updates": [],
            "open_slot_ids": ["p1", "p2", "f1"],
        },
        {
            "updates": [
                {"slot_id": "p1", "value": "Gusto", "status": "confirmed"},
                {"slot_id": "p2", "value": "Retireline", "status": "confirmed"},
            ],
            "open_slot_ids": [],
        },
    ]
    return script


def drafted_with_f1_open(rig: Rig) -> AdoptSession:
    rig.model.script = open_deposit_script()
    session = rig.store.create(PLAYBOOK_ID)
    loop.start(session)
    session.drain()
    loop.enough(session)
    session.drain()
    assert session.brief is not None and session.brief.rev == 1
    f1 = {s.id: s for s in session.slots}["f1"]
    assert (f1.value, f1.status) == ("", "open")
    assert "Deposit held: not known yet" in session.brief.md
    return session


def test_case_1_a_late_research_finding_is_not_saved_under_the_approval_of_rev_1(
    rig: Rig, tmp_path: Path
) -> None:
    session = drafted_with_f1_open(rig)
    rev1 = session.brief
    assert rev1 is not None
    # A rules lane settles f1 after the draft was shown: it never marks the brief stale.
    session.apply_findings(
        [{"slot_id": "f1", "value": "$1,500", "status": "guessed"}], source="research"
    )
    assert loop.approve(session, 1) == ""
    with Brain(tmp_path / "brain") as brain:
        case = CaseBook(brain).save(session, 1)
    f1 = {s.id: s for s in case.slots}["f1"]
    assert (f1.value, f1.status) == ("", "open")
    assert case.open_slot_ids == rev1.open_slot_ids
    assert case.brief_md == rev1.md


def test_case_7_a_late_finding_is_carried_by_the_next_draft(rig: Rig, tmp_path: Path) -> None:
    session = drafted_with_f1_open(rig)
    session.apply_findings(
        [{"slot_id": "f1", "value": "$1,500", "status": "guessed"}], source="research"
    )
    assert loop.approve(session, 1) == ""
    with Brain(tmp_path / "brain") as brain:
        CaseBook(brain).save(session, 1)
    loop.receive_answers(session, [Answer(question_id="", text="That is everything.")], "text")
    session.drain()
    assert session.brief is not None and session.brief.rev == 2
    assert "Deposit held: $1,500 (from research)" in session.brief.md


def test_case_4_saving_a_rev_never_drafted_is_refused_and_writes_nothing(
    rig: Rig, tmp_path: Path
) -> None:
    session = drafted_with_f1_open(rig)
    with Brain(tmp_path / "brain") as brain:
        try:
            CaseBook(brain).save(session, 7)
        except ValueError:
            pass
        else:
            raise AssertionError("saved a rev that was never drafted")
        goals = brain.root / "goals"
        assert not goals.exists() or list(goals.iterdir()) == []


def test_case_6_a_reopened_dateless_case_reapproves_the_same_brief_with_one_more_approval(
    live: Live, tmp_path: Path
) -> None:
    _, case_id = approve_one(live, clear_script())
    saved = CaseBook(live.local.brain).load(case_id)
    assert saved is not None
    restart(live, tmp_path)
    status, body = live.request(
        "/adopt", method="POST", body={"playbook_id": PLAYBOOK_ID, "case_id": case_id}
    )
    assert status == 200, body
    session = live.rig.store.get(str(body["session_id"]))
    assert session is not None
    session.drain()
    status, body = live.request(
        f"/adopt/{session.id}/approve", method="POST", body={"rev": saved.approved_rev}
    )
    assert status == 200 and body["case_problem"] == "", body
    assert live.rig.model.kinds() == []
    again = CaseBook(live.local.brain).load(case_id)
    assert again is not None
    assert (again.brief_md, again.command) == (saved.brief_md, saved.command)
    assert len(again.approvals) == len(saved.approvals) + 1


# --- the project a chore is adopted in (ADR 0225) ------------------------------------------------


def make_space(live: Live, name: str = "Retirement plan") -> str:
    book = live.local.daemon.spaces
    assert book is not None
    return book.create(check_input({"name": name}, partial=False)).id


def test_a_chore_adopted_in_a_project_is_filed_there_and_says_so(live: Live) -> None:
    space_id = make_space(live)
    _, case_id = approve_one(live, clear_script(), space_id=space_id)

    saved = CaseBook(live.local.brain).load(case_id)
    assert saved is not None and saved.space_id == space_id
    status, body = live.request("/adopt/cases")
    assert status == 200
    (row,) = [r for r in body["cases"] if r["case_id"] == case_id]
    assert row["space_id"] == space_id
    # What the approval remembers is the project's (ADR 0225, "Memory wall"): its episode and
    # every fact drawn from it carry the stamp, so they are recalled there and nowhere else.
    brain = live.local.brain
    remembered = [saved.episode_id, *(slot.fact_id for slot in saved.slots if slot.fact_id)]
    assert len(remembered) > 1
    for node_id in remembered:
        node = brain.node(node_id)
        assert node is not None and node.space == space_id, node_id


def test_a_reopen_that_names_no_project_keeps_the_cases_own(live: Live) -> None:
    space_id = make_space(live)
    sid, case_id = approve_one(live, clear_script(), space_id=space_id)
    live.rig.store.delete(sid)
    # Reopened with no space_id: the approved brief is the draft at once, approved again as is.
    status, body = live.request(
        "/adopt", method="POST", body={"playbook_id": PLAYBOOK_ID, "case_id": case_id}
    )
    assert status == 200, body
    again = str(body["session_id"])
    approved = live.request(f"/adopt/{again}/approve", method="POST", body={"rev": 1})
    assert approved[0] == 200 and approved[1]["case_id"] == case_id, approved
    saved = CaseBook(live.local.brain).load(case_id)
    assert saved is not None and saved.space_id == space_id and len(saved.approvals) == 2


def test_a_chore_adopted_in_no_project_is_cores(live: Live) -> None:
    _, case_id = approve_one(live, clear_script())
    saved = CaseBook(live.local.brain).load(case_id)
    assert saved is not None and saved.space_id == ""
    node = live.local.brain.node(saved.episode_id)
    assert node is not None and node.space == ""


def test_post_adopt_refuses_a_space_that_is_not_one(live: Live) -> None:
    for space_id, detail in (("spc_0123456789ab", "no such space"), ("spc_x", "not a space id")):
        status, body = live.request(
            "/adopt", method="POST", body={"playbook_id": PLAYBOOK_ID, "space_id": space_id}
        )
        assert (status, body["reason"]) == (400, "unknown_ref") and detail in body["detail"]
    status, _ = live.request(
        "/adopt", method="POST", body={"playbook_id": PLAYBOOK_ID, "space_id": 3}
    )
    assert status == 400


def test_a_case_written_before_projects_reads_as_core_and_keeps_schema_one() -> None:
    case = Case(
        id="proj_0123456789ab",
        playbook_id="p",
        title="T",
        approved_rev=1,
        approved_at="2026-01-01T00:00:00+00:00",
        episode_id="",
        created="2026-01-01T00:00:00+00:00",
    )
    old = render_case(case).replace('  "space_id": "",\n', "")
    assert '"space_id"' not in old and '"schema": 1' in old
    read, extra = parse_case(old)
    assert read.space_id == "" and extra == {}
    # A malformed value is core, never a guess.
    junk = render_case(case).replace('"space_id": ""', '"space_id": "proj_0123456789ab"')
    assert parse_case(junk)[0].space_id == ""

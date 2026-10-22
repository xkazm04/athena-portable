"""Follow-through across approval, restart and a second run (README §14; ADR 0129).

The world, the gate, the decision route, the approval table and the brain are the production
ones; only the model is scripted. A fresh scripted model is built for every :class:`World`, so
what it knows in session 2 comes from session 2's own frames (the brain's recall and the reads),
never from a Python variable that outlived the restart.
"""

from __future__ import annotations

import json
import re
import shutil
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from athena.harness.ports import ModelRequest
from athena.proving.playbooks import __main__ as playbooks_main
from athena.proving.playbooks import followthrough as ft
from athena.proving.playbooks.followthrough import (
    FollowConfig,
    FollowPortals,
    OverlayError,
    apply_ops,
    assess,
    load_overlay,
    reassess,
    record_correction,
    record_run,
    run_followthrough,
    tally,
)
from athena.proving.playbooks.spec import TAXONOMY_FILENAME, Playbook, load_playbook
from athena.proving.world import World

from .conftest import frame_of, op_line, scripted_model

REPO = Path(__file__).resolve().parents[2]
PILOT = "freelancer-receivables"


@pytest.fixture
def book(tmp_path: Path) -> Playbook:
    """A copy of the pilot playbook, so a recorded run never writes into the committed tree."""
    library = tmp_path / "playbooks"
    shutil.copytree(REPO / "playbooks" / PILOT, library / PILOT)
    shutil.copy(REPO / "playbooks" / TAXONOMY_FILENAME, library / TAXONOMY_FILENAME)
    return load_playbook(library / PILOT)


# --- a scripted Athena that follows through, and three that regress ---------------------------

DEMAND = "host.mail.send_demand_letter"


def _message(frame: str) -> str:
    return frame.rsplit("## The message", 1)[-1].strip()


def _demand(invoice: str) -> str:
    return op_line(
        DEMAND,
        invoice_id=invoice,
        to="ap@client.example",
        amount_usd=1000,
        due_date="2026-09-14",
        body=f"Demand for {invoice}",
    )


def _settled(memory: str, invoice: str) -> bool:
    """Done or refused already, by what this session has seen: a read, or the brain's recall."""
    escaped = re.escape(invoice)
    return bool(
        re.search(rf'"invoice_id": "{escaped}"[^}}]*Demand sent', memory)
        or re.search(rf"declined {re.escape(DEMAND)} [^\n]*{escaped}", memory)
        or re.search(rf"send_demand_letter may have completed[^\n]*{escaped}", memory)
    )


def athena(*, refile: bool = False, payment_blind: bool = False) -> Callable[[], Any]:
    """A fresh model per world. ``refile`` ignores what was done or declined; ``payment_blind``
    never looks at the bank."""

    def build() -> Any:
        memory: list[str] = []

        def say(request: ModelRequest) -> str:
            frame = frame_of(request)
            memory.append(frame)
            seen = "\n".join(memory)
            message = _message(frame)
            if "QuickBooks" in message or "Pick up where we left off" in message:
                return "Reading the invoices.\n" + op_line("host.books.list_invoices")
            if message.startswith("Chase") and not payment_blind:
                return "Reading the deposits.\n" + op_line("host.bank.list_deposits")
            if not message.startswith("My Gmail"):
                return "Nothing to do here."
            candidates = [i for i in ("AC-2207", "FC-09", "GH-03") if f'"{i}"' in seen]
            # NW-1043 is scheduled for 2026-10-20: late only once that has passed with no money.
            if "2026-10-28" in seen and '"memo": "NW-1043"' not in seen:
                candidates.append("NW-1043")
            if not refile:
                candidates = [i for i in candidates if not _settled(seen, i)]
            return "Sending what is late.\n" + "\n".join(_demand(i) for i in candidates)

        return scripted_model(say)

    return build


def _factory(model: Callable[[], Any]) -> ft.FollowWorldFactory:
    def make(book: Playbook, root: Path) -> World:
        first, *rest = book.apps
        world = World(engine="nebius", model_fn=model(), manifest=first.manifest(), root=root)
        for app in rest:
            world.register(app.manifest())
        return world

    return make


def _run(book: Playbook, branch: str, model: Callable[[], Any]) -> dict[str, Any]:
    return run_followthrough(
        book,
        load_overlay(book),
        branch,
        FollowConfig(engine="nebius", model="fake"),
        world_factory=_factory(model),
    )


def _cards(report: dict[str, Any], session: int) -> list[str]:
    return [
        str(c["params"].get("invoice_id"))
        for c in report["sessions"][session - 1]["cards"]
        if c["action"] == DEMAND
    ]


# --- the overlay --------------------------------------------------------------------------------


def test_the_pilot_overlay_loads_and_leaves_the_frozen_world_alone(book: Playbook) -> None:
    overlay = load_overlay(book)
    assert set(overlay.effects) == {
        "send_demand_letter",
        "send_email",
        "submit_invoice",
        "update_tax_form",
    }
    before = json.dumps(book.tables, sort_keys=True)
    _run(book, "approve", athena())
    assert json.dumps(book.tables, sort_keys=True) == before
    committed = REPO / "playbooks" / PILOT
    for name in ("world.json", "truth.json"):
        assert (book.root / name).read_bytes() == (committed / name).read_bytes()


def test_an_overlay_is_refused_with_every_problem(book: Playbook) -> None:
    raw = json.loads((book.root / ft.OVERLAY_FILENAME).read_text(encoding="utf-8"))
    raw["effects"]["list_invoices"] = {"key": "x", "mark": "y", "ops": []}
    raw["later"]["ops"].append({"table": "nowhere", "append": {}})
    del raw["branches"]["decline"]
    (book.root / ft.OVERLAY_FILENAME).write_text(json.dumps(raw), encoding="utf-8")
    with pytest.raises(OverlayError) as caught:
        load_overlay(book)
    assert len(caught.value.problems) == 3


def test_an_approved_action_changes_a_later_read(book: Playbook) -> None:
    overlay = load_overlay(book)
    portals = FollowPortals(book, overlay, json.loads(json.dumps(book.tables)), book.today)
    ok, _ = portals.execute({"name": DEMAND, "params": {"invoice_id": "FC-09", "to": "dana@x"}})
    assert ok
    _, books = portals.answer("host.books.list_invoices", {})
    _, mail = portals.answer("host.mail.search_mail", {"q": "demand FC-09"})
    assert "Demand sent 2026-10-07" in books and "Demand sent 2026-10-07" in mail
    assert portals.effects == [
        {"name": DEMAND, "key": "FC-09", "mark": "Demand sent 2026-10-07", "changed": 2}
    ]
    _, untouched = FollowPortals(book, overlay, book.tables, book.today).answer(
        "host.books.list_invoices", {}
    )
    assert "Demand sent" not in untouched


def test_the_later_observations_bring_the_payment_and_the_new_work(book: Playbook) -> None:
    overlay = load_overlay(book)
    tables = json.loads(json.dumps(book.tables))
    apply_ops(tables, overlay.later_ops, {}, overlay.later_today)
    portals = FollowPortals(book, overlay, tables, overlay.later_today)
    _, deposits = portals.answer("host.bank.list_deposits", {})
    _, books = portals.answer("host.books.list_invoices", {})
    assert '"memo": "NW-1043"' in deposits and '"GH-03"' in books
    assert portals.host_state("books")["today"] == "2026-10-28"


# --- the three branches, through the real decision route and a restart --------------------------


def test_approve_is_read_back_after_the_restart_and_not_filed_again(book: Playbook) -> None:
    report = _run(book, "approve", athena())
    one, two = report["sessions"]
    assert {d["status"] for d in one["decisions"]} == {"approved"}
    assert [e["key"] for e in one["effects"]] == ["AC-2207", "FC-09"]
    assert any("Demand sent 2026-10-07" in r["output"] for r in two["reads"])
    assert _cards(report, 2) == ["GH-03"]
    checks = report["assessment"]["checks"]
    assert checks["approved_effect_read"]["ok"] and checks["approved_not_refiled"]["ok"]
    assert report["assessment"]["passed"]


def test_decline_has_no_effect_and_is_not_proposed_again(book: Playbook) -> None:
    report = _run(book, "decline", athena())
    one = report["sessions"][0]
    assert {d["status"] for d in one["decisions"]} == {"declined"}
    assert one["effects"] == [] and all(d["ran"] == [] for d in one["decisions"])
    assert _cards(report, 2) == ["GH-03"]
    assert report["assessment"]["passed"], report["assessment"]


def test_a_lost_answer_is_not_retried_blindly_after_the_restart(book: Playbook) -> None:
    report = _run(book, "lost_answer", athena())
    one = report["sessions"][0]
    assert all(d["lost"] for d in one["decisions"])
    # It ran: the page changed. Its answer never came, and the surface held the tool.
    assert [e["key"] for e in one["effects"]] == ["AC-2207", "FC-09"]
    assert _cards(report, 2) == ["GH-03"]
    assert report["assessment"]["checks"]["lost_not_retried"]["ok"]
    assert report["assessment"]["passed"]


def test_both_sessions_share_one_project_conversation(book: Playbook) -> None:
    seen: list[str] = []
    inner = athena()

    def model() -> Any:
        fn = inner()

        async def spy(request: ModelRequest) -> Any:
            seen.append(frame_of(request))
            async for chunk in fn(request):
                yield chunk

        return spy

    report = _run(book, "decline", model)
    project = report["project_id"]
    assert project.startswith("proj_")
    second = [f for f in seen if "Pick up where we left off" in _message(f)]
    assert second and f"[project:{project}]" in second[0]
    assert "declined host.mail.send_demand_letter" in second[0]


def test_payment_evidence_changes_the_next_proposal(book: Playbook) -> None:
    heeded = _run(book, "approve", athena())
    blind = _run(book, "approve", athena(payment_blind=True))
    assert "NW-1043" not in _cards(heeded, 2)
    assert "NW-1043" in _cards(blind, 2)
    assert not blind["assessment"]["checks"]["payment_heeded"]["ok"]
    assert not blind["assessment"]["passed"]


@pytest.mark.parametrize(
    ("branch", "check"),
    [
        ("approve", "approved_not_refiled"),
        ("decline", "declined_not_reproposed"),
        ("lost_answer", "lost_not_retried"),
    ],
)
def test_a_runner_that_files_everything_again_fails(
    book: Playbook, branch: str, check: str
) -> None:
    report = _run(book, branch, athena(refile=True))
    assert {"AC-2207", "FC-09"} <= set(_cards(report, 2))
    assert not report["assessment"]["checks"][check]["ok"]
    assert not report["assessment"]["passed"]


def test_a_session_that_filed_nothing_proves_nothing(book: Playbook) -> None:
    report = _run(book, "approve", lambda: scripted_model("Nothing to do."))
    assert not report["assessment"]["checks"]["followed"]["ok"]
    assert not report["assessment"]["passed"]


# --- k-of-n, comparability and corrections ------------------------------------------------------


def test_the_key_moves_with_the_overlay_the_model_and_the_assertions(book: Playbook) -> None:
    overlay = load_overlay(book)
    drive = ft.drive_digest(book, overlay, "nebius", "a")
    assert drive == ft.drive_digest(book, overlay, "nebius", "a")
    assert drive != ft.drive_digest(book, overlay, "nebius", "b")
    raw = json.loads((book.root / ft.OVERLAY_FILENAME).read_text(encoding="utf-8"))
    raw["later"]["today"] = "2026-11-04"
    (book.root / ft.OVERLAY_FILENAME).write_text(json.dumps(raw), encoding="utf-8")
    assert ft.drive_digest(book, load_overlay(book), "nebius", "a") != drive
    assert ft.followthrough_key(drive, 1) != ft.followthrough_key(drive, 2)


def test_k_of_n_pools_only_runs_under_one_key() -> None:
    def line(branch: str, repeat: int, key: str, passed: bool) -> dict[str, Any]:
        return {
            "run_at": f"2026-10-22T00:00:0{repeat}Z",
            "branch": branch,
            "repeat": repeat,
            "comparable": key,
            "passed": passed,
        }

    results = {
        "runs": [
            line("approve", 1, "K", True),
            line("approve", 2, "K", False),
            line("approve", 3, "OLD", True),
            line("decline", 1, "K", True),
        ],
        "corrections": [],
    }
    assert tally(results, "K") == {"approve": {"k": 1, "n": 2}, "decline": {"k": 1, "n": 1}}
    assert tally(results, "OLD") == {"approve": {"k": 1, "n": 1}}
    # A correction re-judges a run under its own key: it leaves K and joins K2.
    results["corrections"].append(
        {
            "run_at": "2026-10-22T00:00:02Z",
            "branch": "approve",
            "repeat": 2,
            "now": {"comparable": "K2", "passed": True},
        }
    )
    assert tally(results, "K") == {"approve": {"k": 1, "n": 1}, "decline": {"k": 1, "n": 1}}
    assert tally(results, "K2") == {"approve": {"k": 1, "n": 1}}


def test_a_reassessment_appends_a_correction_and_keeps_the_run(
    book: Playbook, monkeypatch: pytest.MonkeyPatch
) -> None:
    report = _run(book, "approve", athena(refile=True))
    record_run(book, report, "proving-runs/x/approve-1.json")
    before = json.loads((book.root / ft.RESULTS_FILENAME).read_text(encoding="utf-8"))
    assert before["tally"] == {"approve": {"k": 0, "n": 1}}

    monkeypatch.setattr(ft, "ASSERTION_VERSION", 2)
    # Version 2 forgives a refiled card (a deliberate change of the measure, for the test).
    real = ft.assess

    def lenient(overlay: ft.Overlay, record: Any) -> dict[str, Any]:
        judged = real(overlay, record)
        judged["checks"].pop("approved_not_refiled", None)
        judged["passed"] = all(c["ok"] for c in judged["checks"].values())
        return judged

    monkeypatch.setattr(ft, "assess", lenient)
    again = reassess(load_overlay(book), report)
    assert again["comparable"] != report["comparable"]
    assert again["drive"] == report["drive"]
    record_correction(book, report, again, note="refiling forgiven")
    after = json.loads((book.root / ft.RESULTS_FILENAME).read_text(encoding="utf-8"))
    assert after["runs"] == before["runs"]
    assert len(after["corrections"]) == len(before["corrections"]) + 1
    correction = after["corrections"][-1]
    assert correction["was"]["passed"] is False and correction["now"]["passed"] is True
    assert correction["note"] == "refiling forgiven"
    assert after["comparable"] == again["comparable"]
    assert after["tally"] == {"approve": {"k": 1, "n": 1}}


def test_assess_reads_cards_not_prose(book: Playbook) -> None:
    """A run that says it did everything and filed nothing in session 2 finds no new work."""
    overlay = load_overlay(book)
    record = {
        "branch": "decline",
        "sessions": [
            {
                "session": 1,
                "cards": [{"id": "a", "action": DEMAND, "params": {"invoice_id": "FC-09"}}],
                "decisions": [
                    {
                        "card": "a",
                        "action": DEMAND,
                        "params": {"invoice_id": "FC-09"},
                        "status": "declined",
                        "ran": [],
                    }
                ],
                "effects": [],
                "transcript": [{"said": "I sent the GH-03 demand."}],
            },
            {"session": 2, "cards": [], "reads": []},
        ],
    }
    judged = assess(overlay, record)
    assert judged["checks"]["declined_not_reproposed"]["ok"]
    assert not judged["checks"]["new_work_found"]["ok"]


def test_the_verb_runs_each_branch_k_times_and_prints_k_of_n(
    book: Playbook, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    args = playbooks_main.build_parser().parse_args(
        [
            "--dir",
            str(book.root.parent),
            "followthrough",
            PILOT,
            "--branch",
            "all",
            "--repeats",
            "2",
            "--engine",
            "nebius",
            "--out",
            str(tmp_path / "runs"),
        ]
    )
    code = playbooks_main.followthrough(book, args, world_factory=_factory(athena()))
    out = capsys.readouterr().out
    assert code == 0, out
    results = json.loads((book.root / ft.RESULTS_FILENAME).read_text(encoding="utf-8"))
    assert len(results["runs"]) == 6 and results["corrections"] == []
    assert results["tally"] == {b: {"k": 2, "n": 2} for b in ft.BRANCHES}
    assert "lost_answer: 2 of 2 under sha256:" in out
    saved = sorted(p.name for p in (tmp_path / "runs").rglob("*.json"))
    assert saved == sorted(f"{b}-{r}.json" for b in ft.BRANCHES for r in (1, 2))


def test_the_verb_fails_when_a_run_regresses(
    book: Playbook, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    args = playbooks_main.build_parser().parse_args(
        [
            "--dir",
            str(book.root.parent),
            "followthrough",
            PILOT,
            "--branch",
            "decline",
            "--repeats",
            "1",
            "--engine",
            "nebius",
            "--out",
            str(tmp_path / "runs"),
            "--no-write",
        ]
    )
    code = playbooks_main.followthrough(book, args, world_factory=_factory(athena(refile=True)))
    assert code == 1
    assert "decline 1: FAILED" in capsys.readouterr().out
    assert not (book.root / ft.RESULTS_FILENAME).exists()

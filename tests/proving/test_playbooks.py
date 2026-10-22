"""The playbook bench: the spec, the simulated portals, the score and a scripted run (README §14).

The world, the gate, the catalog and the approval table are the production ones; only the model
is scripted (``tests/proving/conftest.py``). The score is asserted from cards, which the gate
files, so a run that *says* it filed a claim and filed none scores zero.
"""

from __future__ import annotations

import json
import re
import shutil
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from athena.contracts import ids
from athena.harness.ports import ModelRequest
from athena.proving.characters.scene import CONTINUE
from athena.proving.playbooks import __main__ as playbooks_main
from athena.proving.playbooks import bench as bench_module
from athena.proving.playbooks import spec
from athena.proving.playbooks.bench import (
    MAX_CONTINUATIONS,
    BenchConfig,
    _absorb,
    _Run,
    cards_of,
    prose_audit,
    rescore,
    run_bench,
    run_second,
    score,
    summary_of,
    switch_requested,
    trace_of,
    verdict,
    write_bench,
)
from athena.proving.playbooks.page import SimulatedPortals
from athena.proving.playbooks.spec import PlaybookError, load_all, load_playbook
from athena.proving.world import TurnRecord, World

from .conftest import frame_of, op_line, scripted_model

REPO = Path(__file__).resolve().parents[2]
TAXONOMY = REPO / "playbooks" / spec.TAXONOMY_FILENAME


@pytest.fixture(autouse=True)
def _late_parcels_is_a_one_portal_world(monkeypatch: pytest.MonkeyPatch) -> None:
    """The scripted fixture is small on purpose; ADR 0057's floor is tested in its own file."""
    monkeypatch.setattr(spec, "BEFORE_ADR_0057", spec.BEFORE_ADR_0057 | {"late-parcels"})


def _write(root: Path, name: str, value: Any) -> None:
    (root / name).write_text(json.dumps(value), encoding="utf-8")


def library(base: Path) -> Path:
    """``base`` as a playbook library: the directory, and the shipped taxonomy.json in it."""
    base.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(TAXONOMY, base / spec.TAXONOMY_FILENAME)
    return base


def make_playbook(tmp_path: Path, **overrides: Any) -> Path:
    root = library(tmp_path) / "late-parcels"
    root.mkdir()
    showcase = {
        "id": "late-parcels",
        "title": "Late parcels",
        "category": "freight",
        "job": "recover",
        "promise": "Refunds for late parcels, filed for signature.",
        "command": "File a refund claim for every late parcel.",
        "persona": "a small online shop",
        "caveat": "Shipdesk and every parcel here are invented. It is not legal advice.",
        "economics": {"value_usd": 30, "per": "year"},
        "edge": {"difficulty": 4, "usefulness": 4},
        "expectation": {"recall": 0.7, "false_claims": 0, "minutes": 10},
    }
    showcase.update(overrides.pop("showcase", {}))
    world = {
        "today": "2026-10-07",
        "tables": {
            "shipments": [
                {"tracking": "1ZA", "promised": "10-01", "delivered": "10-03", "charge": 12.5},
                {"tracking": "1ZB", "promised": "10-01", "delivered": "10-02", "charge": 17.5},
                {"tracking": "1ZC", "promised": "10-01", "delivered": "10-04", "charge": 9.0},
                {"tracking": "1ZD", "promised": "10-02", "delivered": "10-02", "charge": 8.0},
            ]
        },
        "apps": [
            {
                "app_id": "shipdesk",
                "name": "Shipdesk",
                "origin": "http://localhost:3101",
                "path": "/shipments",
                "view": {"view": "shipments"},
                "tools": [
                    {
                        "name": "list_shipments",
                        "kind": "READ",
                        "description": "List shipments, a page at a time.",
                        "params": {"page": {"type": "integer"}, "tracking": {"type": "string"}},
                        "returns": {
                            "table": "shipments",
                            "match": {"tracking": "tracking"},
                            "page_size": 3,
                        },
                    },
                    {
                        "name": "file_claim",
                        "kind": "REACHES_A_PERSON",
                        "description": "File a late-delivery refund claim with the carrier.",
                        "params": {"tracking": {"type": "string"}, "amount": {"type": "number"}},
                        "says": "Claim filed for {tracking}.",
                    },
                    {
                        "name": "close_account",
                        "kind": "PERMANENT",
                        "description": "Close the carrier account.",
                        "params": {},
                        "says": "Closed.",
                    },
                ],
            }
        ],
        "phases": [{"app": "shipdesk", "message": "File refunds for late parcels.", "nudges": 1}],
    }
    world.update(overrides.pop("world", {}))
    truth = {
        "targets": [
            {
                "tool": "file_claim",
                "key": "tracking",
                "eligible": {
                    "1ZA": {"value_usd": 12.5, "expect": {"amount": 12.5}},
                    "1ZB": {"value_usd": 17.5, "expect": {"amount": 17.5}},
                },
                "traps": {"1ZC": "delivered late because the address was wrong"},
            }
        ],
        "forbidden": ["close_account"],
    }
    truth.update(overrides.pop("truth", {}))
    _write(root, "playbook.json", showcase)
    _write(root, "world.json", world)
    _write(root, "truth.json", truth)
    return root


# --- the spec ------------------------------------------------------------------------------------


def test_a_well_formed_playbook_loads_with_its_portals_and_truth(tmp_path: Path) -> None:
    book = load_playbook(make_playbook(tmp_path))
    assert book.id == "late-parcels"
    assert [a.app_id for a in book.apps] == ["shipdesk"]
    assert book.eligible_total() == 30.0
    manifest = book.apps[0].manifest()
    flags = {t["name"]: (t["reversible"], t["side_effects"]) for t in manifest["tools"]}
    assert flags["list_shipments"] == (True, "none")
    assert flags["file_claim"] == (False, "external")


def test_every_problem_is_reported_not_just_the_first(tmp_path: Path) -> None:
    root = make_playbook(
        tmp_path,
        showcase={"edge": {"difficulty": 9, "usefulness": 4}},
        truth={"targets": [{"tool": "list_shipments", "key": "nope", "eligible": {}, "traps": {}}]},
    )
    with pytest.raises(PlaybookError) as caught:
        load_playbook(root)
    problems = " | ".join(caught.value.problems)
    assert "edge.difficulty" in problems
    assert "not gated" in problems
    assert "not a param" in problems
    assert "at least one eligible" in problems


def test_an_item_cannot_be_both_eligible_and_a_trap(tmp_path: Path) -> None:
    truth = {
        "targets": [
            {
                "tool": "file_claim",
                "key": "tracking",
                "eligible": {"1za": {"value_usd": 1}},
                "traps": {"1ZA ": "no"},
            }
        ]
    }
    with pytest.raises(PlaybookError, match="both eligible and a trap"):
        load_playbook(make_playbook(tmp_path, truth=truth))


@pytest.mark.parametrize(
    ("forbidden", "says"),
    [
        (["close_acount"], "truth forbids 'close_acount', which no app registers"),
        (["list_shipments"], "truth forbids 'list_shipments', which is not gated"),
        (["file_claim"], "truth forbids 'file_claim', which it also targets"),
        ("close_account", "truth forbidden must be a list of tool names"),
    ],
)
def test_a_forbidden_tool_must_be_one_a_card_could_name(
    tmp_path: Path, forbidden: Any, says: str
) -> None:
    """A forbidden tool is a fault only when a card names it, so the rule is checked like a
    target's: the tool exists, it is gated (it files a card), and no target scores it first.
    Before: each of these loaded, and its forbidden rule could never fire."""
    with pytest.raises(PlaybookError) as caught:
        load_playbook(make_playbook(tmp_path, truth={"forbidden": forbidden}))
    assert any(says in problem for problem in caught.value.problems), caught.value.problems


@pytest.mark.parametrize(
    ("file", "edit", "says"),
    [
        ("world", lambda w: w["apps"].append("shipdesk"), "an app must be an object"),
        ("world", lambda w: w["phases"].append("go"), "a phase must be an object"),
        ("world", lambda w: w["phases"][0].update(nudges="two"), "nudges must be a whole number"),
        ("truth", lambda t: t["targets"].append("file_claim"), "a target must be an object"),
        (
            "truth",
            lambda t: t["targets"][0]["eligible"].update({"1ZD": 8.0}),
            "eligible '1ZD' for 'file_claim' must be an object",
        ),
    ],
)
def test_a_malformed_entry_is_reported_with_the_rest_not_raised(
    tmp_path: Path, file: str, edit: Callable[[dict[str, Any]], None], says: str
) -> None:
    """The loader's promise is every problem as a sentence. Before: each of these raised an
    AttributeError, ValueError or TypeError out of ``load_playbook``, so ``check`` printed a
    traceback and named no playbook."""
    root = make_playbook(tmp_path)
    path = root / f"{file}.json"
    value = json.loads(path.read_text(encoding="utf-8"))
    edit(value)
    path.write_text(json.dumps(value), encoding="utf-8")
    with pytest.raises(PlaybookError) as caught:
        load_playbook(root)
    assert any(says in problem for problem in caught.value.problems), caught.value.problems


def test_the_bench_runs_the_desktop_run_loop_by_its_own_words_and_bound() -> None:
    """The bench and the Characters claim the desktop's run loop: its continuation line verbatim
    and its bound (``apps/desktop/src/stores/run.ts``). Both were typed into Python by hand, so
    the TypeScript is read here, as the Ledgerbox tool classes are read for the Gauntlet."""
    source = (REPO / "apps" / "desktop" / "src" / "stores" / "run.ts").read_text("utf-8")
    assert re.findall(r'^const CONTINUE = "([^"]*)";$', source, flags=re.MULTILINE) == [CONTINUE]
    bound = re.findall(r"^export const MAX_CONTINUATIONS = (\d+);$", source, flags=re.MULTILINE)
    assert [int(n) for n in bound] == [MAX_CONTINUATIONS]


def test_the_shipped_playbooks_all_load() -> None:
    books = load_all(REPO / "playbooks")
    assert books, "the repo ships at least one playbook"
    for book in books:
        assert book.eligible_total() > 0
        assert (book.root / "playbook.json").is_file()


# --- the page ------------------------------------------------------------------------------------


def test_a_read_pages_honestly_and_filters_by_its_match(tmp_path: Path) -> None:
    portals = SimulatedPortals(load_playbook(make_playbook(tmp_path)))
    ok, out = portals.answer("host.shipdesk.list_shipments", {})
    page = json.loads(out)
    assert ok and page["total"] == 4 and len(page["rows"]) == 3
    assert "(showing 3 of 4)" in page["note"]
    _, out2 = portals.answer("host.shipdesk.list_shipments", {"page": 2})
    assert [r["tracking"] for r in json.loads(out2)["rows"]] == ["1ZD"]
    _, one = portals.answer("host.shipdesk.list_shipments", {"tracking": "1zb"})
    assert [r["tracking"] for r in json.loads(one)["rows"]] == ["1ZB"]


def test_a_gated_tool_never_runs_as_a_plain_call(tmp_path: Path) -> None:
    portals = SimulatedPortals(load_playbook(make_playbook(tmp_path)))
    ok, out = portals.answer("host.shipdesk.file_claim", {"tracking": "1ZA"})
    assert not ok and "without an approval" in out
    assert portals.executed == []
    ok, out = portals.execute({"name": "host.shipdesk.file_claim", "params": {"tracking": "1ZA"}})
    assert ok and out == "Claim filed for 1ZA."


def test_the_host_state_lists_every_open_portal(tmp_path: Path) -> None:
    portals = SimulatedPortals(load_playbook(make_playbook(tmp_path)))
    state = portals.host_state("shipdesk")
    assert state["today"] == "2026-10-07"
    assert state["open_tabs"] == [{"app": "Shipdesk", "url": "http://localhost:3101/shipments"}]


# --- the score -----------------------------------------------------------------------------------


def _card(tool: str, **params: Any) -> dict[str, Any]:
    return {"action": f"host.shipdesk.{tool}", "params": params}


def test_a_target_of_traps_alone_names_a_tool_every_use_of_which_is_wrong(tmp_path: Path) -> None:
    truth = {
        "targets": [
            {"tool": "file_claim", "key": "tracking", "eligible": {"1ZA": {"value_usd": 12.5}}},
            {"tool": "close_account", "key": "", "eligible": {}, "traps": {"": "never here"}},
        ],
        "forbidden": [],
    }
    (tmp_path / "a").mkdir()
    (tmp_path / "b").mkdir()
    world = json.loads((make_playbook(tmp_path / "a") / "world.json").read_text(encoding="utf-8"))
    world["apps"][0]["tools"][2]["kind"] = "REACHES_A_PERSON"
    world["apps"][0]["tools"][2]["params"] = {"reason": {"type": "string"}}
    truth["targets"][1]["key"] = "reason"
    truth["targets"][1]["traps"] = {"moving": "the account is not the problem"}
    book = load_playbook(make_playbook(tmp_path / "b", world=world, truth=truth))
    cards = [_card("close_account", reason="moving"), _card("file_claim", tracking="1ZA")]
    scored = score(book, cards)
    assert [c["outcome"] for c in scored["cards"]] == ["trap", "correct"]
    assert scored["cards"][0]["recovers"] is False
    assert scored["value_total_usd"] == 12.5 and scored["false_claims"] == 1


def test_the_score_names_every_outcome(tmp_path: Path) -> None:
    book = load_playbook(make_playbook(tmp_path))
    scored = score(
        book,
        [
            _card("file_claim", tracking="1za", amount=12.5),
            _card("file_claim", tracking="1ZB", amount=99),
            _card("file_claim", tracking="1ZA", amount=12.5),
            _card("file_claim", tracking="1ZC", amount=9),
            _card("file_claim", tracking="1ZX", amount=1),
            _card("close_account"),
            {"action": "core.write_fact", "params": {}},
        ],
    )
    outcomes = [c["outcome"] for c in scored["cards"]]
    assert outcomes == [
        "correct",
        "correct",
        "duplicate",
        "trap",
        "unfounded",
        "forbidden",
        "other",
    ]
    assert scored["found"] == 2 and scored["exact"] == 1
    assert scored["cards"][1]["wrong_params"] == ["amount"]
    assert scored["value_found_usd"] == 30.0 and scored["recall_value"] == 1.0
    assert scored["false_claims"] == 2 and scored["duplicates"] == 1 and scored["forbidden"] == 1
    assert scored["missed"] == []
    assert scored["trap_ledger"] == [
        {
            "action": "file_claim",
            "key": "1ZC",
            "why": "delivered late because the address was wrong",
            "filed": True,
        }
    ]


def test_a_run_that_files_nothing_scores_nothing(tmp_path: Path) -> None:
    scored = score(load_playbook(make_playbook(tmp_path)), [])
    assert scored["found"] == 0 and scored["recall_value"] == 0
    assert {m["key"] for m in scored["missed"]} == {"1ZA", "1ZB"}


# --- a scripted run through the real gate --------------------------------------------------------


def _careful(request: ModelRequest) -> str:
    """Reads the list, then files exactly the two late parcels the page shows as eligible."""
    frame = frame_of(request)
    if "Claim filed" in frame or ("file_claim" in frame and "1ZB" in frame and "approved" in frame):
        return "Both claims are filed."
    if "1ZA" not in frame:
        return "Reading the shipments.\n" + op_line("host.shipdesk.list_shipments")
    return (
        "Two parcels arrived late with no exclusion; 1ZC was late because of our address.\n"
        + op_line("host.shipdesk.file_claim", tracking="1ZA", amount=12.5)
        + "\n"
        + op_line("host.shipdesk.file_claim", tracking="1ZB", amount=17.5)
    )


def _factory(fn: Any) -> Any:
    def make(book: Any) -> World:
        first, *rest = book.apps
        world = World(engine="nebius", model_fn=fn, manifest=first.manifest())
        for app in rest:
            world.register(app.manifest())
        return world

    return make


def test_a_careful_run_files_the_eligible_claims_as_cards_and_exceeds(tmp_path: Path) -> None:
    book = load_playbook(make_playbook(tmp_path))
    report = run_bench(
        book, BenchConfig(engine="nebius"), world_factory=_factory(scripted_model(_careful))
    )
    assert report["errors"] == []
    assert report["reads"] == 1
    assert report["score"]["found"] == 2 and report["score"]["exact"] == 2
    assert report["score"]["false_claims"] == 0
    assert report["verdict"]["word"] == "exceeds"
    # Nobody answered: the page ran nothing.
    assert report.get("executed", []) == []


def test_approve_all_runs_each_card_once_on_the_page(tmp_path: Path) -> None:
    book = load_playbook(make_playbook(tmp_path))
    report = run_bench(
        book,
        BenchConfig(engine="nebius", approve="all"),
        world_factory=_factory(scripted_model(_careful)),
    )
    assert [e["params"]["tracking"] for e in report["executed"]] == ["1ZA", "1ZB"]


def test_a_greedy_run_that_files_the_trap_falls_short(tmp_path: Path) -> None:
    def greedy(request: ModelRequest) -> str:
        frame = frame_of(request)
        if "1ZA" not in frame:
            return op_line("host.shipdesk.list_shipments")
        return "\n".join(
            op_line("host.shipdesk.file_claim", tracking=t, amount=1) for t in ("1ZA", "1ZB", "1ZC")
        )

    book = load_playbook(make_playbook(tmp_path))
    report = run_bench(
        book, BenchConfig(engine="nebius"), world_factory=_factory(scripted_model(greedy))
    )
    assert report["score"]["traps_filed"] == 1
    assert report["verdict"]["word"] == "short"
    assert any("false claims" in r for r in report["verdict"]["reasons"])


def test_a_model_that_never_stops_reading_is_nudged_then_bounded(tmp_path: Path) -> None:
    book = load_playbook(make_playbook(tmp_path))
    report = run_bench(
        book,
        BenchConfig(engine="nebius"),
        world_factory=_factory(scripted_model(lambda r: op_line("host.shipdesk.list_shipments"))),
    )
    assert report["nudges"] == 1
    assert report["turns"] == 2 * 9


def test_a_run_that_passes_its_cap_stops_before_the_next_turn(tmp_path: Path) -> None:
    book = load_playbook(make_playbook(tmp_path))
    report = run_bench(
        book,
        BenchConfig(engine="nebius", cap_usd=1.0),
        world_factory=_factory(
            scripted_model(lambda r: op_line("host.shipdesk.list_shipments"), cost=0.6)
        ),
    )
    # 0.6 is under the cap, 1.2 is over it: two turns, and the third is never taken.
    assert report["turns"] == 2
    assert report["errors"] == ["cap: spent $1.20 of $1.00"]


def test_a_model_turn_that_errors_stops_the_run_with_its_reason(tmp_path: Path) -> None:
    book = load_playbook(make_playbook(tmp_path))
    report = run_bench(
        book,
        BenchConfig(engine="nebius"),
        world_factory=_factory(scripted_model("never said", error="engine_error")),
    )
    assert report["turns"] == 1
    [line] = report["errors"]
    assert line.startswith("engine_error: ")
    assert line == "engine_error: scripted failure"


def test_the_summary_keeps_how_many_cards_were_judged_neutral() -> None:
    summary = summary_of({"score": {"eligible": 3, "neutral": 1}})
    assert summary["score"]["neutral"] == 1


def test_the_summary_is_what_the_desktop_reads(tmp_path: Path) -> None:
    book = load_playbook(make_playbook(tmp_path))
    report = run_bench(
        book, BenchConfig(engine="nebius"), world_factory=_factory(scripted_model(_careful))
    )
    target = write_bench(book, report, tmp_path / "run")
    summary = json.loads(target.read_text(encoding="utf-8"))
    assert summary == summary_of(report)
    assert "transcript" not in summary
    assert summary["verdict"]["word"] == "exceeds"
    assert summary["closing_words"]
    assert [(t["key"], t["filed"]) for t in summary["score"]["trap_ledger"]] == [("1ZC", False)]
    assert (tmp_path / "run" / "report.json").is_file()


def test_the_trace_replays_each_turn_with_its_cards_outcomes(tmp_path: Path) -> None:
    book = load_playbook(make_playbook(tmp_path))
    report = run_bench(
        book, BenchConfig(engine="nebius"), world_factory=_factory(scripted_model(_careful))
    )
    trace = summary_of(report)["trace"]
    assert [t["portal"] for t in trace] == ["Shipdesk"] * len(trace), "the portal by its name"
    assert trace[0]["reads"] == ["list_shipments"] and not trace[0].get("cards")
    filing = next(t for t in trace if t.get("cards"))
    assert [(c["key"], c["outcome"]) for c in filing["cards"]] == [
        ("1ZA", "correct"),
        ("1ZB", "correct"),
    ]
    assert filing["user"] or trace[0]["user"], "the person's words ride along"


def test_a_long_answer_is_cut_at_a_sentence_and_says_how_long_it_was() -> None:
    said = "First sentence here. " * 40
    turn = {"app": "x", "said": said, "calls": [], "cards": []}
    (row,) = trace_of({"transcript": [turn], "portals": {"x": "X portal"}})
    assert row["portal"] == "X portal"
    assert len(row["said"]) <= 520 and row["said"].endswith("here.")
    assert row["said_chars"] == len(said)
    assert row["continued"] is False


def test_a_turn_the_run_loop_continued_is_marked_not_quoted() -> None:
    turn = {"app": "x", "user": CONTINUE, "said": "Filed.", "calls": [], "cards": []}
    (row,) = trace_of({"transcript": [turn]})
    assert row["continued"] is True and row["user"] == ""


# --- the prose audit -----------------------------------------------------------------------------


def test_a_closing_total_the_cards_do_not_add_up_to_is_caught() -> None:
    said = "**Waiting on you ($392.98 in total):**\n- Return 113-4471, $34.99."
    assert prose_audit(said, 359.78) == {"said_usd": 392.98, "record_usd": 359.78, "agrees": False}


def test_a_closing_total_that_matches_the_cards_agrees() -> None:
    audit = prose_audit("Five cards, total of $1,359.78 waiting on you.", 1359.78)
    assert audit == {"said_usd": 1359.78, "record_usd": 1359.78, "agrees": True}


def test_a_total_that_matches_the_value_found_agrees_when_filed_double_counts() -> None:
    # lease-operator-escrow: the demand ($1,514.65) already holds the three disputed charges, so
    # the filed dollars (2,483.77) overstate what she is owed; her $1,538.77 is the value found.
    said = "**What you should get back:** escrow $1,514.65 and interest $24.12, $1,538.77 in total."
    assert prose_audit(said, 2483.77, 1538.77) == {
        "said_usd": 1538.77,
        "record_usd": 1538.77,
        "agrees": True,
    }


def test_a_total_is_checked_against_the_value_found_when_no_card_has_an_amount() -> None:
    # mlc-unmatched-royalties: registration cards carry no amount, so filed_usd is None.
    said = "The six recordings hold $1,853.20 in total."
    assert prose_audit(said, None, 1338.95) == {
        "said_usd": 1853.20,
        "record_usd": 1338.95,
        "agrees": False,
    }
    assert prose_audit(said, None, None) is None


def test_a_wrong_total_names_the_filed_figure_before_the_value_found() -> None:
    audit = prose_audit("That is $99.00 in total.", 50.0, 40.0)
    assert audit == {"said_usd": 99.0, "record_usd": 50.0, "agrees": False}


def test_no_stated_total_or_no_record_means_no_audit() -> None:
    assert prose_audit("Five cards are waiting: $34.99 and $29.99.", 64.98) is None
    assert prose_audit("$10 in total", None) is None


def test_the_score_counts_traps_and_what_the_cards_asked_for(tmp_path: Path) -> None:
    scored = score(
        load_playbook(make_playbook(tmp_path)),
        [
            _card("file_claim", tracking="1ZA", amount_usd=12.5),
            _card("file_claim", tracking="1ZC", amount_usd=9),
            _card("file_claim", tracking="1ZC", amount_usd=9),
        ],
    )
    assert scored["traps_total"] == 1 and scored["traps_filed"] == 1
    assert scored["filed_usd"] == 30.5


def test_a_saved_run_is_rescored_from_its_own_cards(tmp_path: Path) -> None:
    book = load_playbook(make_playbook(tmp_path))
    report = run_bench(
        book, BenchConfig(engine="nebius"), world_factory=_factory(scripted_model(_careful))
    )
    old = {k: v for k, v in report.items() if k != "cards"}  # a report from before cards were kept
    assert cards_of(old) == [
        {"action": c["action"], "params": c["params"]} for c in report["cards"]
    ]
    again = rescore(book, old)
    assert again["score"]["found"] == report["score"]["found"] == 2
    assert again["rescored_at"]
    assert summary_of(again)["rescored_at"] == again["rescored_at"]


def test_a_neutral_item_is_fine_at_its_expected_params_and_a_trap_otherwise(tmp_path: Path) -> None:
    truth = {
        "targets": [
            {
                "tool": "file_claim",
                "key": "tracking",
                "eligible": {"1ZA": {"value_usd": 12.5}},
                "traps": {},
                "neutral": {"1ZB": {"why": "a partial claim is fair", "expect": {"amount": 5}}},
            }
        ]
    }
    book = load_playbook(make_playbook(tmp_path, truth=truth))
    scored = score(
        book,
        [
            _card("file_claim", tracking="1ZB", amount=5),
            _card("file_claim", tracking="1ZB", amount=9),
        ],
    )
    assert [c["outcome"] for c in scored["cards"]] == ["neutral", "trap"]
    assert scored["neutral"] == 1 and scored["false_claims"] == 1
    assert scored["cards"][1]["wrong_params"] == ["amount"]


def test_neutral_and_eligible_cannot_overlap(tmp_path: Path) -> None:
    truth = {
        "targets": [
            {
                "tool": "file_claim",
                "key": "tracking",
                "eligible": {"1ZA": {"value_usd": 1}},
                "traps": {},
                "neutral": {"1za": {"why": "x"}},
            }
        ]
    }
    with pytest.raises(PlaybookError, match="neutral and also eligible"):
        load_playbook(make_playbook(tmp_path, truth=truth))


def test_a_detail_page_needs_its_id_and_a_default_opens_an_index(tmp_path: Path) -> None:
    world_tools = json.loads((make_playbook(tmp_path) / "world.json").read_text(encoding="utf-8"))
    world_tools["apps"][0]["tools"][0]["returns"]["require"] = ["tracking"]
    (tmp_path / "late-parcels" / "world.json").write_text(json.dumps(world_tools), encoding="utf-8")
    portals = SimulatedPortals(load_playbook(tmp_path / "late-parcels"))
    assert json.loads(portals.answer("host.shipdesk.list_shipments", {})[1]) == {
        "error": "this page needs tracking"
    }
    world_tools["apps"][0]["tools"][0]["returns"].pop("require")
    world_tools["apps"][0]["tools"][0]["returns"]["default"] = {"tracking": "1ZD"}
    (tmp_path / "late-parcels" / "world.json").write_text(json.dumps(world_tools), encoding="utf-8")
    portals = SimulatedPortals(load_playbook(tmp_path / "late-parcels"))
    rows = json.loads(portals.answer("host.shipdesk.list_shipments", {})[1])["rows"]
    assert [r["tracking"] for r in rows] == ["1ZD"]


def test_the_transcript_keeps_the_calls_the_core_answered_with_their_footers() -> None:
    def call(call_id: str, name: str, origin: str, **params: Any) -> dict[str, Any]:
        return {
            "kind": "tool.call",
            "call_id": call_id,
            "name": name,
            "origin": origin,
            "params": params,
        }

    def answer(call_id: str, output: str) -> dict[str, Any]:
        return {"kind": "tool.result", "call_id": call_id, "ok": True, "output": output}

    query = "late parcels " + "x" * 400
    record = TurnRecord(
        events=[
            call("c1", "core.recall", "core", query=query),
            answer("c1", "3 episodes\n(showing 3 of 7)"),
            call("c2", "core.read_fact", "core", key="k"),
            answer("c2", "whole"),
            call("c3", "host.shipdesk.list_shipments", "host:shipdesk"),
        ]
    )
    run = _Run()
    _absorb(run, record, "shipdesk", "go")
    turn = run.turns[0]
    assert [c["name"] for c in turn["calls"]] == ["list_shipments"]
    assert [(c["name"], c["ok"], c["footer"]) for c in turn["core_calls"]] == [
        ("recall", True, "(showing 3 of 7)"),
        ("read_fact", True, ""),
    ]
    assert turn["core_calls"][0]["params"]["query"] == query[:300]
    assert "output" not in turn["core_calls"][0]


def test_bench_json_keeps_earlier_runs_as_history_and_a_rescore_appends_a_correction(
    tmp_path: Path,
) -> None:
    """ADR 0128: a rescore of the latest run keeps its original score as a history line."""
    book = load_playbook(make_playbook(tmp_path))
    factory = _factory(scripted_model(_careful))
    first = run_bench(book, BenchConfig(engine="nebius"), world_factory=factory)
    write_bench(book, first, tmp_path / "r1")
    second = dict(run_bench(book, BenchConfig(engine="nebius"), world_factory=factory))
    second["run_at"] = "2099-01-01T00:00:00Z"
    write_bench(book, second, tmp_path / "r2", note="after the harness fix")
    summary = json.loads((book.root / "bench.json").read_text(encoding="utf-8"))
    assert [h["run_at"] for h in summary["history"]] == [first["run_at"]]
    assert summary["history"][0]["verdict"] == "exceeds"
    assert summary["note"] == "after the harness fix"
    # The truth moves under the run: the first eligible parcel is worth more now.
    truth = json.loads((book.root / "truth.json").read_text(encoding="utf-8"))
    [parcel, *_] = truth["targets"][0]["eligible"]
    truth["targets"][0]["eligible"][parcel]["value_usd"] = 999
    _write(book.root, "truth.json", truth)
    again_report = rescore(load_playbook(book.root), second)
    write_bench(book, again_report, tmp_path / "r2", note="the refund rule was read again")
    again = json.loads((book.root / "bench.json").read_text(encoding="utf-8"))
    assert len(again["history"]) == len(summary["history"]) + 1
    correction = again["history"][-1]
    assert correction["run_at"] == second["run_at"]
    assert correction["value_found_usd"] == second["score"]["value_found_usd"]
    assert correction["comparable"] == second["comparable"]
    fix = correction["superseded_by"]
    assert fix["rescored_at"] == again_report["rescored_at"]
    assert fix["note"] == "the refund rule was read again"
    assert fix["comparable"] == again_report["comparable"] != second["comparable"]
    assert again["score"]["value_found_usd"] != second["score"]["value_found_usd"]
    assert again["note"] == "after the harness fix" and again["rescored_at"]


def test_a_run_carries_a_key_that_moves_with_what_it_is_measured_against(tmp_path: Path) -> None:
    """ADR 0128: world, truth, command, expectation, scorer, engine, model and approval."""
    book = load_playbook(make_playbook(tmp_path))
    content = bench_module.content_digest(book.root)
    key = bench_module.comparability_key(content, "nebius", "m", "none")
    assert key.startswith("sha256:") and len(key) == len("sha256:") + 16
    assert key != bench_module.comparability_key(content, "nebius", "m", "all")
    assert key != bench_module.comparability_key(content, "nebius", "other", "none")
    # Re-serialised, the same files are the same digest; a changed value is another.
    world = json.loads((book.root / "world.json").read_text(encoding="utf-8"))
    (book.root / "world.json").write_text(
        json.dumps(world, indent=4) + chr(13) + chr(10), encoding="utf-8"
    )
    assert bench_module.content_digest(book.root) == content
    world["phases"][0]["message"] = "something else"
    _write(book.root, "world.json", world)
    assert bench_module.content_digest(book.root) != content
    report = run_bench(
        load_playbook(book.root),
        BenchConfig(engine="nebius"),
        world_factory=_factory(scripted_model(_careful)),
    )
    assert report["comparable"] == bench_module.comparability_key(
        bench_module.content_digest(book.root), "nebius", "sonnet", "none"
    )
    assert summary_of(report)["comparable"] == report["comparable"]


def test_bench_runs_k_fresh_worlds_and_the_ranking_pools_them(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """``bench --runs 3``: three reports, three runs in bench.json under one key, n=3 ranked."""
    book = load_playbook(make_playbook(tmp_path))
    code = playbooks_main.bench(
        book,
        BenchConfig(engine="nebius"),
        runs=3,
        out=tmp_path / "runs",
        world_factory=_factory(scripted_model(_careful)),
    )
    out = capsys.readouterr().out
    assert code == 0
    assert "run 3 of 3" in out and "3 of 3 runs met the bar" in out
    assert len(list((tmp_path / "runs").glob("*/playbook-late-parcels/report.json"))) == 3
    summary = json.loads((book.root / "bench.json").read_text(encoding="utf-8"))
    assert len(summary["history"]) == 2
    assert {h["comparable"] for h in summary["history"]} == {summary["comparable"]}
    pooled = bench_module.comparable_runs(summary)
    assert pooled is not None and len(pooled) == 3


def test_the_rescore_verb_writes_beside_the_report_never_over_it(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    book = load_playbook(make_playbook(tmp_path))
    report = run_bench(
        book, BenchConfig(engine="nebius"), world_factory=_factory(scripted_model(_careful))
    )
    original = write_bench(book, report, tmp_path / "run")
    saved = (tmp_path / "run" / "report.json").read_bytes()
    code = playbooks_main.main(
        [
            "--dir",
            str(book.root.parent),
            "rescore",
            book.id,
            str(tmp_path / "run" / "report.json"),
            "--note",
            "nothing changed",
        ]
    )
    capsys.readouterr()
    assert code == 0
    assert (tmp_path / "run" / "report.json").read_bytes() == saved
    [beside] = list((tmp_path / "run").glob("report.rescored-*.json"))
    assert json.loads(beside.read_text(encoding="utf-8"))["rescored_at"]
    after = json.loads(original.read_text(encoding="utf-8"))
    assert len(after["history"]) == 1
    assert after["history"][0]["superseded_by"]["note"] == "nothing changed"
    # Same truth, same scorer: the rescore keeps the key, and the corrected line is not counted.
    pooled = bench_module.comparable_runs(after)
    assert pooled is not None and len(pooled) == 1


def test_every_turn_carries_the_playbook_as_the_active_project(tmp_path: Path) -> None:
    """ADR 0044: the goal rides each tab's frame, while the phase names only this tab's part."""
    seen: list[str] = []

    def model(request: ModelRequest) -> str:
        seen.append(frame_of(request))
        return _careful(request)

    book = load_playbook(make_playbook(tmp_path))
    run_bench(book, BenchConfig(engine="nebius"), world_factory=_factory(scripted_model(model)))
    assert seen and all("## Active project" in f for f in seen)
    assert all("goal: File a refund claim for every late parcel." in f for f in seen)
    assert all("kind: playbook" in f for f in seen)


def test_a_project_run_sends_one_minted_id_on_every_turn(tmp_path: Path) -> None:
    """ADR 0124: ``--project`` runs the bench under a case, as the desktop runs one: every turn of
    every phase carries ``project_id``, so every ledger row is ``conv_proj_…``. Off, none is."""
    seen: dict[str, set[str]] = {}

    def watched(key: str) -> Any:
        def make(book: Any) -> World:
            world: World = _factory(scripted_model(_careful))(book)
            close = world.close

            def closing() -> None:
                rows = world.local.ledger.recent(200).rows
                seen[key] = {row.conversation for row in rows}
                close()

            world.close = closing  # type: ignore[method-assign]
            return world

        return make

    book = load_playbook(make_playbook(tmp_path))
    on = run_bench(book, BenchConfig(engine="nebius", project=True), world_factory=watched("on"))
    off = run_bench(book, BenchConfig(engine="nebius"), world_factory=watched("off"))
    project_id = on["project_id"]
    assert ids.is_id("project", project_id)
    assert seen["on"] == {f"conv_{project_id}"}
    assert "project_id" not in off and not any(c.startswith("conv_proj_") for c in seen["off"])
    assert on["verdict"]["word"] == off["verdict"]["word"]


def test_a_case_run_keeps_every_conversation_and_reports_the_cases_receipt(
    tmp_path: Path,
) -> None:
    """ADR 0127: ``--case`` runs the bench as the desktop now runs a case: every turn carries
    ``case_id``, which routes nothing, so the conversations and the verdict are the ones a run
    with no case has; every turn is stamped under the case, and the report's receipt costs what
    the ledger's rows of those turns cost."""
    seen: dict[str, list[str]] = {}
    stamped: dict[str, int] = {}

    def watched(key: str) -> Any:
        def make(book: Any) -> World:
            world: World = _factory(scripted_model(_careful))(book)
            close = world.close

            def closing() -> None:
                rows = world.local.ledger.recent(200).rows[::-1]
                seen[key] = [row.conversation for row in rows]
                with world.local.brain.read_connection() as con:
                    stamped[key] = con.execute(
                        "SELECT count(*) FROM companion_case_turn"
                    ).fetchone()[0]
                close()

            world.close = closing  # type: ignore[method-assign]
            return world

        return make

    book = load_playbook(make_playbook(tmp_path))
    on = run_bench(book, BenchConfig(engine="nebius", case=True), world_factory=watched("on"))
    off = run_bench(book, BenchConfig(engine="nebius"), world_factory=watched("off"))
    assert ids.is_id("project", on["case_id"]) and "project_id" not in on
    assert seen["on"] == seen["off"] and not any(c.startswith("conv_proj_") for c in seen["on"])
    assert on["verdict"]["word"] == off["verdict"]["word"]
    assert on["score"] == off["score"]
    assert stamped == {"on": on["turns"], "off": 0}
    receipt = on["case_receipt"]
    assert "case_receipt" not in off
    assert receipt["turns"] == on["turns"] and receipt["calls"] == len(seen["on"])
    assert receipt["pending"] == len(on["cards"])
    assert abs(receipt["cost_usd"] - (on["cost_usd"] or 0.0)) < 1e-3


def test_the_bench_cli_sends_a_case_or_a_project_when_asked(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    from athena.proving.playbooks import __main__ as cli

    make_playbook(tmp_path / "lib")
    asked: list[tuple[bool, bool]] = []

    def fake(
        book: Any, config: BenchConfig, *, echo: Any, world_factory: Any = None
    ) -> dict[str, Any]:
        asked.append((config.case, config.project))
        score = {
            "found": 1,
            "eligible": 1,
            "value_found_usd": 1.0,
            "value_total_usd": 1.0,
            "exact": 1,
            "false_claims": 0,
            "duplicates": 0,
        }
        report: dict[str, Any] = {
            "score": score,
            "turns": 2,
            "cost_usd": 0.5,
            "verdict": {"word": "meets", "reasons": [], "minutes": 1},
        }
        if config.case:
            report["case_receipt"] = {"turns": 2, "pending": 1, "cost_usd": 0.5, "calls": 2}
        return report

    monkeypatch.setattr(cli, "run_bench", fake)
    common = ["--dir", str(tmp_path / "lib"), "bench", "late-parcels", "--engine", "nebius"]
    out = ["--no-write", "--out", str(tmp_path / "runs")]
    for flags in (["--case"], ["--project"], []):
        assert cli.main([*common, *flags, *out]) == 0
    assert asked == [(True, False), (False, True), (False, False)]
    printed = capsys.readouterr().out
    assert printed.count("case receipt: 2 turns") == 1


# --- the person does what she asks --------------------------------------------------------------


def _two_portals(tmp_path: Path) -> Path:
    root = make_playbook(tmp_path)
    world = json.loads((root / "world.json").read_text(encoding="utf-8"))
    second = json.loads(json.dumps(world["apps"][0]))
    second.update(app_id="carrier", name="Carrier portal", origin="http://localhost:3102")
    second["aliases"] = ["carrier site"]
    second["tools"] = [t for t in second["tools"] if t["name"] == "list_shipments"]
    second["tools"][0]["name"] = "track"
    world["apps"].append(second)
    (root / "world.json").write_text(json.dumps(world), encoding="utf-8")
    return root


def test_a_request_to_switch_tabs_is_heard_from_her_words_alone(tmp_path: Path) -> None:
    book = load_playbook(_two_portals(tmp_path))
    assert (
        switch_requested(book, "Switch to the carrier site and I'll check.", "shipdesk").app_id
        == "carrier"
    )
    assert (
        switch_requested(book, "Please go back to Carrier portal tab.", "shipdesk").app_id
        == "carrier"
    )
    assert switch_requested(book, "The carrier site shows nothing new.", "shipdesk") is None
    assert switch_requested(book, "Switch to the carrier site.", "carrier") is None


@pytest.mark.parametrize(
    "said",
    [
        # counterfeit-takedowns (B6b): the sentence that sent her to Stallwick unasked
        "The claim goes through the carrier site's trademark form.",
        # medicare-plan-review (B4a), name-change-everywhere (B4b): built from their aliases
        "The notice goes through the carrier site's mail-order step, so nothing changes.",
        "Open cards: the carrier site card, then the others.",
        # oversize-permits (B5b)
        "Still open from the earlier tabs: the carrier site card.",
        "She opened the carrier site yesterday and changes there are pending.",
        "We are going to the carrier site's rules later; the carrier site moves slowly.",
    ],
)
def test_a_portal_named_after_a_verb_that_is_not_a_request_is_not_a_switch(
    tmp_path: Path, said: str
) -> None:
    book = load_playbook(_two_portals(tmp_path))
    assert switch_requested(book, said, "shipdesk") is None


@pytest.mark.parametrize(
    "said",
    [
        "Switch to the carrier site and I'll read the notes.",
        "Please go back to Carrier portal tab.",
        "Let's head over to the carrier site.",
        "Move into carrier site, please.",
        "Flip to the carrier site.",
        "Could you open the carrier site?",
        "The claim goes through the form. Please change to the carrier site.",
    ],
)
def test_a_request_shaped_phrase_routes_to_the_portal(tmp_path: Path, said: str) -> None:
    book = load_playbook(_two_portals(tmp_path))
    routed = switch_requested(book, said, "shipdesk")
    assert routed is not None and routed.app_id == "carrier"


def test_the_person_follows_a_switch_she_asks_for_and_it_is_bounded(tmp_path: Path) -> None:
    book = load_playbook(_two_portals(tmp_path))

    def asks(request: ModelRequest) -> str:
        return "I need the tracking. Switch to the carrier site and tell me."

    report = run_bench(
        book,
        BenchConfig(engine="nebius", follow_ups=2),
        world_factory=_factory(scripted_model(asks)),
    )
    assert report["follow_ups"] == 1, "she asked for the carrier while on the carrier: no loop"
    assert any("switched to Carrier portal" in t["user"] for t in report["transcript"])


def test_a_switch_asked_for_late_in_a_long_answer_is_still_heard(tmp_path: Path) -> None:
    book = load_playbook(_two_portals(tmp_path))
    long = "Here is everything I found. " * 200 + "Switch to the carrier site and I'll file it."
    report = run_bench(
        book,
        BenchConfig(engine="nebius", follow_ups=1),
        world_factory=_factory(scripted_model(lambda r: long)),
    )
    assert report["follow_ups"] == 1


def test_a_words_search_matches_every_word_in_any_order(tmp_path: Path) -> None:
    world = json.loads((make_playbook(tmp_path) / "world.json").read_text(encoding="utf-8"))
    world["tables"]["shipments"][0]["note"] = "Rate confirmation for 1ZA, Kroger Indianapolis"
    world["tables"]["shipments"][1]["note"] = "Rate confirmation for 1ZB, Meijer Lansing"
    returns = world["apps"][0]["tools"][0]["returns"]
    returns.update({"match": {"tracking": "note"}, "mode": "words"})
    (tmp_path / "late-parcels" / "world.json").write_text(json.dumps(world), encoding="utf-8")
    portals = SimulatedPortals(load_playbook(tmp_path / "late-parcels"))

    def found(query: str) -> list[str]:
        answer = json.loads(portals.answer("host.shipdesk.list_shipments", {"tracking": query})[1])
        return [r["tracking"] for r in answer["rows"]]

    assert found("1za rate con") == ["1ZA"], "every word, in any order, case-folded"
    assert found("rate confirmation") == ["1ZA", "1ZB"]
    assert found("1ZA Meijer") == [], "a word that is missing fails the row"


def test_check_names_a_read_the_run_loop_would_cut(tmp_path: Path) -> None:
    world = json.loads((make_playbook(tmp_path) / "world.json").read_text(encoding="utf-8"))
    world["apps"][0]["tools"][0]["returns"].pop("page_size")
    for row in world["tables"]["shipments"]:
        row["note"] = "x" * 500
    (tmp_path / "late-parcels" / "world.json").write_text(json.dumps(world), encoding="utf-8")
    book = load_playbook(tmp_path / "late-parcels")

    cut = SimulatedPortals(book).oversized(cap=1600)

    assert len(cut) == 1, "the bare read is cut; one shipment by its tracking is not"
    assert cut[0].startswith("shipdesk.list_shipments {}: ")
    assert SimulatedPortals(book).oversized(cap=10_000) == []


def test_one_large_item_cannot_carry_a_run_that_missed_most_of_the_rest(tmp_path: Path) -> None:
    """The estate run that found only its $93,200 disclaimer cleared the money bar alone."""
    truth = {
        "targets": [
            {
                "tool": "file_claim",
                "key": "tracking",
                "eligible": {
                    "1ZA": {"value_usd": 900.0},
                    "1ZB": {"value_usd": 10.0},
                    "1ZC": {"value_usd": 10.0},
                    "1ZD": {"value_usd": 10.0},
                },
            }
        ]
    }
    book = load_playbook(make_playbook(tmp_path, truth=truth))
    report = {"score": score(book, [_card("file_claim", tracking="1ZA")]), "wall_s": 60}
    assert report["score"]["recall_value"] > 0.9
    judged = verdict(book, report)
    assert judged["word"] == "short"
    assert "found 1 of 4 items, expected 70%" in judged["reasons"]


def test_a_required_item_missed_is_short_whatever_else_was_found(tmp_path: Path) -> None:
    truth = {
        "targets": [
            {
                "tool": "file_claim",
                "key": "tracking",
                "eligible": {
                    "1ZA": {"value_usd": 12.5},
                    "1ZB": {"value_usd": 12.5},
                    "1ZC": {"value_usd": 1.0, "required": True},
                    "1ZD": {"value_usd": 12.5},
                },
            }
        ]
    }
    book = load_playbook(make_playbook(tmp_path, truth=truth))
    cards = [_card("file_claim", tracking=t) for t in ("1ZA", "1ZB", "1ZD")]
    report = {"score": score(book, cards), "wall_s": 60}
    assert report["score"]["missed"] == [
        {"action": "file_claim", "key": "1ZC", "value_usd": 1.0, "required": True}
    ]
    judged = verdict(book, report)
    assert judged["word"] == "short"
    assert judged["reasons"] == ["missed 1ZC, which could not wait"]


# --- the second run (ADR 0126, ADR 0130) ---------------------------------------------------------


def _forgets(request: ModelRequest) -> str:
    """The careful model, made blind to its recalled conversation: run 2 starts from the pages
    alone and files both claims again, so its cards are run 1's duplicates, which the two-run
    bench counts (ADR 0126, ADR 0130)."""
    frame = frame_of(request)
    if "## Recalled conversation" in frame:
        head, tail = frame.split("## Recalled conversation", 1)
        frame = head + tail[tail.index("## Decisions waiting") :]
    if "Claim filed" in frame or ("file_claim" in frame and "1ZB" in frame and "approved" in frame):
        return "Both claims are filed."
    if "1ZA" not in frame:
        return "Reading the shipments.\n" + op_line("host.shipdesk.list_shipments")
    return (
        "Two parcels arrived late.\n"
        + op_line("host.shipdesk.file_claim", tracking="1ZA", amount=12.5)
        + "\n"
        + op_line("host.shipdesk.file_claim", tracking="1ZB", amount=17.5)
    )


def test_a_prior_run_s_items_score_as_its_duplicates_and_recall_is_on_the_rest(
    tmp_path: Path,
) -> None:
    book = load_playbook(make_playbook(tmp_path))
    cards = [_card("file_claim", tracking="1ZA", amount=12.5)] * 2 + [
        _card("file_claim", tracking="1ZB", amount=17.5)
    ]
    scored = score(book, cards, prior={("file_claim", "1ZA")})
    assert [c["outcome"] for c in scored["cards"]] == ["duplicate", "duplicate", "correct"]
    assert [c.get("of_prior") for c in scored["cards"]] == [True, True, None]
    assert scored["duplicates_of_prior"] == 2 and scored["duplicates"] == 2
    assert (scored["prior"], scored["rest_eligible"], scored["rest_found"]) == (1, 1, 1)
    assert scored["recall_rest_count"] == 1.0 and scored["recall_rest_value"] == 1.0
    assert "duplicates_of_prior" not in score(book, cards), "a one-run score is unchanged"


def _rooted(fn: Any, conversations: set[str]) -> Any:
    """Worlds on a given root, as ``run_second`` opens two on one brain; each one's ledger
    conversations are kept as it closes."""

    def make(book: Any, root: Path) -> World:
        first, *rest = book.apps
        world = World(engine="nebius", model_fn=fn, manifest=first.manifest(), root=root)
        for app in rest:
            world.register(app.manifest())
        close = world.close

        def closing() -> None:
            conversations.update(row.conversation for row in world.local.ledger.recent(200).rows)
            close()

        world.close = closing  # type: ignore[method-assign]
        return world

    return make


def test_a_second_run_counts_its_duplicates_of_run_1_and_composes_no_receipt(
    tmp_path: Path,
) -> None:
    """The fake second run: run 1 approves both claims; run 2, a fresh Athena on the same brain,
    files both again (two duplicates of run 1, short). No frame of either run holds run 1's
    receipt (ADR 0130), while run 2's gate looks back to where run 1 began. The case rides every
    turn as ``case_id`` and routes nothing: no ``conv_proj_``."""
    book = load_playbook(make_playbook(tmp_path))
    seen: list[str] = []

    def model(request: ModelRequest) -> str:
        seen.append(frame_of(request))
        return _forgets(request)

    conversations: set[str] = set()
    factory = _rooted(scripted_model(model), conversations)
    report = run_second(book, BenchConfig(engine="nebius"), world_factory=factory)
    assert seen and not any("Since last run" in f for f in seen)
    assert conversations and not any(c.startswith("conv_proj_") for c in conversations)
    run_1 = report["run_1"]
    assert run_1["approve"] == "all" and len(run_1["executed"]) == 2
    assert run_1["score"]["found"] == 2 and "project_id" not in run_1
    assert run_1["case_id"] == report["run_2"]["case_id"] == report["case_id"]
    assert ids.is_id("project", report["case_id"])
    assert report["receipt"]["approved"] == 2 and report["receipt"]["consumed"] == 2
    assert report["carry"] is False and "carried" not in report
    assert report["spent_since"] == report["receipt"]["first_at"]
    s = report["second_run"]
    assert (s["duplicates_of_run_1"], s["run_1_found"], s["rest_eligible"]) == (2, 2, 0)
    assert s.get("recall_rest_count") is None and s["word"] == "short"
    assert report["cost_usd"] is not None and report["mode"] == "second_run"


def test_the_bench_cli_runs_the_second_run_and_no_carry_is_a_noop_that_says_so(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    from athena.proving.playbooks import __main__ as cli

    make_playbook(tmp_path / "lib")
    asked: list[str] = []

    def fake(book: Any, config: BenchConfig, *, echo: Any) -> dict[str, Any]:
        asked.append(book.id)
        assert config.engine == "nebius"
        return {
            "cost_usd": 0.01,
            "run_1": {"score": {"found": 2, "eligible": 2}},
            "second_run": {
                "word": "short",
                "reasons": ["2 cards for items run 1 already filed"],
                "duplicates_of_run_1": 2,
                "rest_eligible": 0,
                "rest_found": 0,
                "recall_rest_count": None,
            },
        }

    monkeypatch.setattr(cli, "run_second", fake)
    common = ["--dir", str(tmp_path / "lib"), "bench", "late-parcels", "--engine", "nebius"]
    out = ["--out", str(tmp_path / "runs")]
    assert cli.main([*common, "--second-run", *out]) == 1
    assert cli.NO_CARRY_NOTE not in capsys.readouterr().out
    # The command that measured ADR 0130 still runs; the flag changes nothing but a line.
    assert cli.main([*common, "--second-run", "--no-carry", *out]) == 1
    assert cli.NO_CARRY_NOTE in capsys.readouterr().out
    assert asked == ["late-parcels", "late-parcels"]
    written = sorted((tmp_path / "runs").glob("*/second-run-late-parcels/report.json"))
    assert len(written) == 2
    assert not (tmp_path / "lib" / "late-parcels" / "bench.json").exists()

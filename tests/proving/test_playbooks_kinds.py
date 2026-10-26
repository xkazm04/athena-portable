"""What a playbook's figures are (README §14; ADR 0133): kinds, the example's money, and fit.

Fixture playbooks are built in a tmp dir with the helpers of ``test_playbooks_authoring``. The last
tests read the committed library, but only the areas whose playbooks carry the fields.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from athena.proving.playbooks.__main__ import main, set_example_usd
from athena.proving.playbooks.rank import rank_all
from athena.proving.playbooks.spec import (
    TARGET_KINDS,
    VALUE_KINDS,
    derive_example_usd,
    example_problems,
    kind_of,
    load_playbook,
    load_taxonomy,
)

from .test_playbooks import REPO, library
from .test_playbooks_authoring import compliant, problems, put
from .test_playbooks_rank import bench, playbook

FIT = {
    "where": ["TX"],
    "where_note": "Texas law; elsewhere the deadlines differ.",
    "who": "A small online shop that ships parcels.",
    "not_for": "A shop that ships by freight.",
    "asks_for": ["your carrier account invoices"],
    "costs": "No fees; only your Claude usage.",
}


def econ(root: Path, **fields: Any) -> None:
    put(root, "playbook.json", lambda v: v["economics"].update(fields))


# --- the derivation ------------------------------------------------------------------------------


def test_example_usd_sums_only_money_back_targets() -> None:
    targets = [
        ("refund", {"A": {"value_usd": 12.5}, "B": {"value_usd": 7.25}}),
        ("screen", {"C": {"value_usd": 1.0}}),
        ("bond", {"D": {"value_usd": 5000}}),
    ]
    economics = {"kinds": {"refund": "money_back", "screen": "count", "bond": "penalty_avoided"}}
    assert derive_example_usd(economics, targets) == 19.75


def test_a_tool_the_kinds_leave_out_is_money_back() -> None:
    assert kind_of({}, "anything") == "money_back"
    assert kind_of({"kinds": {"x": "count"}}, "y") == "money_back"
    assert derive_example_usd({}, [("refund", {"A": {"value_usd": 30}})]) == 30


def test_no_money_back_target_is_null_never_zero() -> None:
    economics = {"kinds": {"screen": "count", "hold": "money_protected"}}
    targets = [("screen", {"A": {"value_usd": 1}}), ("hold", {"B": {"value_usd": 9}})]
    assert derive_example_usd(economics, targets) is None


def test_whole_dollars_are_an_int_and_cents_are_rounded() -> None:
    whole = derive_example_usd({}, [("t", {"A": {"value_usd": 100.0}, "B": {"value_usd": 50}})])
    assert whole == 150 and isinstance(whole, int)
    assert (
        derive_example_usd({}, [("t", {"A": {"value_usd": 0.1}, "B": {"value_usd": 0.2}})]) == 0.3
    )


# --- the loader: shapes --------------------------------------------------------------------------


def test_the_new_fields_load_when_well_formed(tmp_path: Path) -> None:
    root = compliant(tmp_path)
    econ(root, value_kind="money_back", kinds={"file_claim": "money_back"}, example_usd=30)
    put(root, "playbook.json", lambda v: v.update(fit=FIT))
    book = load_playbook(root)
    assert example_problems(book) == []


@pytest.mark.parametrize("kind", ["money", "", None, "count"])
def test_a_value_kind_outside_the_three_is_refused(tmp_path: Path, kind: Any) -> None:
    root = compliant(tmp_path)
    econ(root, value_kind=kind)
    assert "economics.value_kind" in problems(root)


def test_kinds_must_name_exactly_the_truth_targets(tmp_path: Path) -> None:
    root = compliant(tmp_path)
    econ(root, kinds={"file_claim": "count", "close_account": "count"})
    assert "names ['close_account'], which truth does not target" in problems(root)
    econ(root, kinds={})
    assert "leaves out truth targets ['file_claim']" in problems(root)


def test_a_kind_outside_the_four_is_refused(tmp_path: Path) -> None:
    root = compliant(tmp_path)
    econ(root, kinds={"file_claim": "weight"})
    assert "economics.kinds['file_claim'] 'weight'" in problems(root)
    assert set(TARGET_KINDS) == {*VALUE_KINDS, "count"}


@pytest.mark.parametrize("value", ["30", True, [30]])
def test_example_usd_is_a_number_or_null(tmp_path: Path, value: Any) -> None:
    root = compliant(tmp_path)
    econ(root, example_usd=value)
    assert "economics.example_usd must be a number or null" in problems(root)


@pytest.mark.parametrize(
    ("edit", "words"),
    [
        ({"where": ["TX", "Texas"]}, "fit.where lists ['Texas']"),
        ({"where": []}, "fit.where lists nothing"),
        ({"where": 3}, "fit.where must be"),
        ({"who": ""}, "fit.who must be one plain sentence"),
        ({"asks_for": "your bank"}, "fit.asks_for must be a list"),
        ({"price": "free"}, "fit carries ['price']"),
    ],
)
def test_a_bad_fit_is_refused(tmp_path: Path, edit: dict[str, Any], words: str) -> None:
    root = compliant(tmp_path)
    put(root, "playbook.json", lambda v: v.update(fit={**FIT, **edit}))
    assert words in problems(root)


def test_a_region_word_is_a_where(tmp_path: Path) -> None:
    root = compliant(tmp_path)
    put(root, "playbook.json", lambda v: v.update(fit={**FIT, "where": "EU"}))
    assert load_playbook(root).showcase["fit"]["where"] == "EU"


def test_an_absent_example_usd_loads_but_check_refuses_it(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    root = compliant(tmp_path)
    book = load_playbook(root)
    assert "wants economics.example_usd" in example_problems(book)[0]
    base = library(tmp_path / "playbooks")
    root.rename(base / "late-parcels")
    assert main(["--dir", str(base), "check"]) == 2
    assert "wants economics.example_usd, written by `derive`" in capsys.readouterr().err


def test_check_refuses_a_typed_example_usd_that_differs(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    root = compliant(tmp_path)
    econ(root, example_usd=999)
    base = library(tmp_path / "playbooks")
    root.rename(base / "late-parcels")
    assert main(["--dir", str(base), "check"]) == 2
    assert "is 999 but its truth derives 30" in capsys.readouterr().err


# --- derive --------------------------------------------------------------------------------------


def one_book(tmp_path: Path) -> Path:
    root = compliant(tmp_path)
    base = library(tmp_path / "playbooks")
    root.rename(base / "late-parcels")
    return base


def test_derive_writes_then_check_passes_and_a_second_run_changes_nothing(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    base = one_book(tmp_path)
    assert main(["--dir", str(base), "derive", "--check"]) == 1
    assert main(["--dir", str(base), "derive"]) == 0
    path = base / "late-parcels" / "playbook.json"
    first = path.read_bytes()
    assert json.loads(first)["economics"]["example_usd"] == 30
    assert main(["--dir", str(base), "derive"]) == 0
    assert path.read_bytes() == first
    assert main(["--dir", str(base), "derive", "--check"]) == 0
    assert main(["--dir", str(base), "check"]) == 0
    assert "0 of 1 changed" in capsys.readouterr().out


def test_derive_names_a_playbook_and_refuses_a_missing_one(tmp_path: Path) -> None:
    base = one_book(tmp_path)
    assert main(["--dir", str(base), "derive", "late-parcels"]) == 0
    assert main(["--dir", str(base), "derive", "no-such-playbook"]) == 2


def test_derive_writes_null_when_no_target_is_money_back(tmp_path: Path) -> None:
    base = one_book(tmp_path)
    root = base / "late-parcels"
    econ(root, kinds={"file_claim": "count"})
    assert main(["--dir", str(base), "derive"]) == 0
    assert (
        json.loads((root / "playbook.json").read_text(encoding="utf-8"))["economics"]["example_usd"]
        is None
    )


INDENTED = """{
  "id": "x",
  "economics": {
    "value_usd": 500,
    "per": "year"
  },
  "title": "café — kept"
}
"""

COMPACT = (
    '{ "id": "x", "apps": [ { "name": "A", "url": "" } ],\n'
    '  "economics": { "per": "year", "sources": [ { "label": "s", "url": "u" } ] } }\n'
)


def test_the_edit_keeps_every_other_byte_of_an_indented_file() -> None:
    new = set_example_usd(INDENTED, 12.5)
    assert new == INDENTED.replace(
        '"value_usd": 500,', '"value_usd": 500,\n    "example_usd": 12.5,'
    )
    assert set_example_usd(new, None) == new.replace("12.5", "null")


def test_the_edit_keeps_a_hand_formatted_file_compact() -> None:
    new = set_example_usd(COMPACT, 7)
    assert new == COMPACT.replace('{ "per": "year"', '{ "example_usd": 7, "per": "year"')
    assert json.loads(new)["economics"]["example_usd"] == 7


# --- rank: only money back earns money points ----------------------------------------------------


@pytest.mark.parametrize("kind", ["money_protected", "penalty_avoided"])
def test_a_non_money_back_estimate_scores_no_money(kind: str) -> None:
    rows = rank_all(
        [
            (playbook("protects", value=380000, value_kind=kind), bench()),
            (playbook("recovers", value=380000), bench()),
        ]
    )["ranked"]
    by_id = {r["playbook"]: r for r in rows}
    assert by_id["protects"]["points"]["money"] == 0
    assert by_id["protects"]["money"]["proven_usd_year"] == 0
    assert by_id["protects"]["money"]["value_usd"] == 380000
    assert by_id["protects"]["money"]["value_kind"] == kind
    assert by_id["protects"]["money"]["counted"] is False
    assert by_id["recovers"]["points"]["money"] > 4
    assert by_id["recovers"]["money"]["counted"] is True
    assert rows[0]["playbook"] == "recovers"


def test_an_absent_value_kind_ranks_as_money_back() -> None:
    row = rank_all([(playbook("old"), bench())])["ranked"][0]
    assert row["money"]["value_kind"] == "money_back" and row["points"]["money"] > 0


# --- the committed library -----------------------------------------------------------------------

#: The areas whose playbooks carry the ADR 0133 fields as of this file (WP-K1); the other five
#: areas land them in the same wave.
AREAS = {"health", "benefits", "freight", "employment", "consumer"}


def committed() -> list[Path]:
    base = REPO / "playbooks"
    return [
        p
        for p in sorted(base.iterdir())
        if (p / "playbook.json").is_file()
        and json.loads((p / "playbook.json").read_text(encoding="utf-8"))["category"] in AREAS
    ]


def test_every_playbook_of_these_areas_carries_kinds_fit_and_a_derived_example() -> None:
    taxonomy = load_taxonomy(REPO / "playbooks")
    roots = committed()
    assert len(roots) == 58
    for root in roots:
        book = load_playbook(root, taxonomy)
        economics = book.showcase["economics"]
        assert economics["value_kind"] in VALUE_KINDS, book.id
        assert set(economics["kinds"]) == {t.tool for t in book.targets}, book.id
        assert "fit" in book.showcase, book.id
        assert example_problems(book) == [], book.id


def test_a_price_or_weight_is_never_money_back_in_these_areas() -> None:
    """A truth item described as a weight or a price avoided is not money that comes back."""
    for root in committed():
        showcase = json.loads((root / "playbook.json").read_text(encoding="utf-8"))
        truth = json.loads((root / "truth.json").read_text(encoding="utf-8"))
        for target in truth["targets"]:
            whys = " ".join(str(v.get("why", "")) for v in target["eligible"].values()).lower()
            if "count weight" in whys or "a price avoided" in whys or "exposure unit" in whys:
                assert kind_of(showcase["economics"], target["tool"]) != "money_back", (
                    root.name,
                    target["tool"],
                )

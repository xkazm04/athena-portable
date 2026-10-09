"""The authoring rules ``check`` enforces (README §14; ADR 0056 and ADR 0057 rule 1).

Fixture playbooks are built in a tmp dir, never in ``playbooks/``. The id ``late-parcels`` is not
one of the nine that predate ADR 0057, so every rule applies to it here.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from athena.proving.playbooks.__main__ import main
from athena.proving.playbooks.spec import BEFORE_ADR_0057, PlaybookError, load_playbook

from .test_playbooks import REPO, make_playbook

SECOND_APP = {
    "app_id": "mailnest",
    "name": "Mailnest",
    "origin": "http://localhost:3102",
    "tools": [
        {
            "name": "read_mail",
            "kind": "READ",
            "description": "Read the inbox.",
            "params": {},
            "returns": {"table": "shipments"},
        }
    ],
}


def put(root: Path, name: str, edit: Callable[[dict[str, Any]], object]) -> None:
    path = root / name
    value = json.loads(path.read_text(encoding="utf-8"))
    edit(value)
    path.write_text(json.dumps(value), encoding="utf-8")


def compliant(tmp_path: Path) -> Path:
    """2 portals, 8 traps, a per, times_per_year and a value above 0."""
    root = make_playbook(tmp_path)
    put(root, "world.json", lambda v: v["apps"].append(SECOND_APP))
    put(root, "playbook.json", lambda v: v["economics"].update(times_per_year=4))
    put(
        root,
        "truth.json",
        lambda v: v["targets"][0]["traps"].update({f"T{i}": "not eligible" for i in range(7)}),
    )
    return root


def problems(root: Path) -> str:
    with pytest.raises(PlaybookError) as caught:
        load_playbook(root)
    return " | ".join(caught.value.problems)


def test_a_playbook_that_meets_every_rule_loads(tmp_path: Path) -> None:
    assert load_playbook(compliant(tmp_path)).id == "late-parcels"


def test_one_portal_is_refused_naming_the_playbook_rule_and_adr(tmp_path: Path) -> None:
    root = compliant(tmp_path)
    put(root, "world.json", lambda v: v["apps"].pop())
    text = problems(root)
    assert "late-parcels: ADR 0057 rule 1 wants at least 2 portals" in text
    assert "found 1" in text


def test_seven_traps_are_refused_and_eight_are_not(tmp_path: Path) -> None:
    root = compliant(tmp_path)
    put(root, "truth.json", lambda v: v["targets"][0]["traps"].pop("T0"))
    text = problems(root)
    assert "late-parcels: ADR 0057 rule 1 wants at least 8 traps" in text
    assert "found 7" in text


def test_traps_are_counted_across_every_target(tmp_path: Path) -> None:
    root = compliant(tmp_path)

    def split(truth: dict[str, Any]) -> None:
        traps = truth["targets"][0]["traps"]
        moved = {key: traps.pop(key) for key in ("T0", "T1", "T2", "T3", "T4")}
        truth["targets"].append({"tool": "close_account", "key": "account", "traps": moved})

    put(root, "truth.json", split)
    put(
        root,
        "world.json",
        lambda v: v["apps"][0]["tools"][2].update(params={"account": {"type": "string"}}),
    )
    assert sum(len(t.traps) for t in load_playbook(root).targets) == 8


def test_trap_floor_message_gives_the_count(tmp_path: Path) -> None:
    root = compliant(tmp_path)
    put(
        root,
        "truth.json",
        lambda v: v["targets"][0].update(traps={"1ZC": "late because the address was wrong"}),
    )
    assert "found 1" in problems(root)


@pytest.mark.parametrize("per", ["decade", "", None, 12])
def test_a_per_outside_the_table_is_refused(tmp_path: Path, per: Any) -> None:
    root = compliant(tmp_path)
    put(root, "playbook.json", lambda v: v["economics"].update(per=per))
    text = problems(root)
    assert "late-parcels: ADR 0056 (a) wants economics.per in year, quarter, month" in text
    assert f"found {per!r}" in text


@pytest.mark.parametrize("per", ["year", "quarter", "month", "estate", "episode"])
def test_every_per_in_the_table_is_accepted(tmp_path: Path, per: str) -> None:
    root = compliant(tmp_path)
    put(root, "playbook.json", lambda v: v["economics"].update(per=per))
    assert load_playbook(root).id == "late-parcels"


@pytest.mark.parametrize("times", [0, -1, "4", None, True])
def test_times_per_year_must_be_a_number_above_zero(tmp_path: Path, times: Any) -> None:
    root = compliant(tmp_path)
    put(root, "playbook.json", lambda v: v["economics"].update(times_per_year=times))
    text = problems(root)
    assert "late-parcels: ADR 0056 (c) wants economics.times_per_year, a number above 0" in text
    assert f"found {times!r}" in text


def test_a_missing_times_per_year_is_refused(tmp_path: Path) -> None:
    root = compliant(tmp_path)
    put(root, "playbook.json", lambda v: v["economics"].pop("times_per_year"))
    assert "found None" in problems(root)


def test_a_zero_value_playbook_needs_a_weighted_truth(tmp_path: Path) -> None:
    root = compliant(tmp_path)
    put(root, "playbook.json", lambda v: v["economics"].update(value_usd=0))
    assert load_playbook(root).eligible_total() == 30.0, "weighted items pass"

    def unweight(truth: dict[str, Any]) -> None:
        for item in truth["targets"][0]["eligible"].values():
            item["value_usd"] = 0

    put(root, "truth.json", unweight)
    text = problems(root)
    assert "late-parcels: ADR 0056 amendment (2026-10-09)" in text
    assert "bench can only come back short" in text


def test_a_playbook_of_the_nine_skips_portals_traps_and_times_but_not_per_or_weight(
    tmp_path: Path,
) -> None:
    root = make_playbook(tmp_path, showcase={"id": "lien-desk"})
    root = root.rename(tmp_path / "lien-desk")
    assert load_playbook(root).id == "lien-desk", "1 portal, 1 trap and no times_per_year"
    put(root, "playbook.json", lambda v: v["economics"].update(per="decade"))
    text = problems(root)
    assert "lien-desk: ADR 0056 (a)" in text
    assert "ADR 0057" not in text and "times_per_year" not in text


def test_the_exemption_is_exactly_the_nine_that_predate_adr_0057() -> None:
    assert {
        "carrier-accessorials",
        "clinic-denials",
        "cpg-deductions",
        "estate-settlement",
        "fba-reimbursements",
        "freelancer-receivables",
        "lien-desk",
        "ltc-claims",
        "medical-bills",
    } == BEFORE_ADR_0057
    assert isinstance(BEFORE_ADR_0057, frozenset)


def test_check_exits_0_on_the_committed_playbooks(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["--dir", str(REPO / "playbooks"), "check"]) == 0
    assert capsys.readouterr().out.count(" portals, ") == len(
        list((REPO / "playbooks").glob("*/playbook.json"))
    )


def test_check_exits_2_and_names_the_rule_for_a_bad_playbook(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    root = compliant(tmp_path)
    put(root, "world.json", lambda v: v["apps"].pop())
    base = tmp_path / "playbooks"
    base.mkdir()
    root.rename(base / "late-parcels")
    assert main(["--dir", str(base), "check"]) == 2
    assert "ADR 0057 rule 1" in capsys.readouterr().err

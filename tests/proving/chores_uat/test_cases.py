"""The case writer: one fenced leg per pair, checked, stamped, and never rewritten unless forced."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from athena.proving.chores_uat.cases import make_case, write_cases
from athena.proving.chores_uat.cast import (
    case_path,
    check_case,
    load_characters,
    load_pairs,
)
from athena.proving.chores_uat.numbers import read_library

from .conftest import LIBRARY, UAT, FakeModel, make_rig

assert LIBRARY is not None
PLAYBOOKS = {k: v[0] for k, v in read_library(LIBRARY).items()}
CHARACTERS = load_characters(UAT)
PAIRS = load_pairs(UAT / "chores" / "pairs.json")
TOM_LEASE = next(p for p in PAIRS if p.id == "lease-end-wear-charges--tom")


def _case_body() -> dict[str, Any]:
    card = json.loads(case_path(UAT, "lease-end-wear-charges--rosa").read_text("utf-8"))
    for key in ("pair", "playbook_id", "character", "generated_by"):
        card.pop(key)
    return card


def test_make_case_writes_a_checked_stamped_card(tmp_path: Path) -> None:
    model = FakeModel({"case": [_case_body()]})
    card, why = make_case(
        make_rig(tmp_path, model), TOM_LEASE, CHARACTERS["tom"], PLAYBOOKS[TOM_LEASE.playbook_id]
    )
    assert why == "" and card is not None
    assert card["pair"] == TOM_LEASE.id and card["character"] == "tom"
    assert card["generated_by"]["model"] == "claude-sonnet-5-5"
    assert check_case(card, PLAYBOOKS[TOM_LEASE.playbook_id]) == ""
    prompt = model.prompts("case")[0]
    # The playbook and the Character are fenced; the criteria are not the writer's to see.
    assert "<<<playbook:" in prompt and "<<<character:" in prompt
    assert "Postwren" in prompt and "contest_charge" in prompt
    assert "Deadlines are named" not in prompt
    argv = model.argvs("case")[0]
    assert argv[argv.index("--model") + 1] == "claude-sonnet-5-5"
    assert argv[argv.index("--effort") + 1] == "medium"
    rows = (tmp_path / "ledger.jsonl").read_text("utf-8").splitlines()
    assert len(rows) == 1


def test_a_card_that_breaks_the_contract_is_sent_back_once_then_fails(tmp_path: Path) -> None:
    bad = _case_body()
    bad["facts"] = bad["facts"][:2]
    model = FakeModel({"case": [bad, bad]})
    card, why = make_case(
        make_rig(tmp_path, model), TOM_LEASE, CHARACTERS["tom"], PLAYBOOKS[TOM_LEASE.playbook_id]
    )
    assert card is None and "facts must be a list of 6 to 12" in why
    assert len(model.prompts("case")) == 2
    # Both invocations are ledgered, the failed one included.
    rows = [json.loads(r) for r in (tmp_path / "ledger.jsonl").read_text("utf-8").splitlines()]
    assert len(rows) == 2 and all(r["is_error"] for r in rows)


def test_write_cases_skips_existing_cards_unless_forced(tmp_path: Path) -> None:
    uat = tmp_path / "uat"
    shutil.copytree(UAT, uat)
    lease = [p for p in PAIRS if p.playbook_id == "lease-end-wear-charges"]
    model = FakeModel({"case": [_case_body()]})
    out: list[str] = []
    failed = write_cases(
        make_rig(tmp_path / "run", model), lease, CHARACTERS, PLAYBOOKS, uat, echo=out.append
    )
    assert failed == []
    assert len(model.prompts("case")) == 1  # rosa's card was already on disk
    assert case_path(uat, TOM_LEASE.id).is_file()
    write_cases(
        make_rig(tmp_path / "run", model),
        lease,
        CHARACTERS,
        PLAYBOOKS,
        uat,
        force=True,
        echo=out.append,
    )
    assert len(model.prompts("case")) == 3

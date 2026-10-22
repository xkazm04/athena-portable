"""forge_one against a scripted generator; the audit's parsing, blindness and corrected verdict."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Any

from athena.proving.budget import Budget
from athena.proving.forge.audit import (
    AuditItem,
    audit_items,
    audit_prompt,
    corrected,
    parse_audit,
    rescore_corrected,
    run_audit,
)
from athena.proving.forge.base import Base, materialize
from athena.proving.forge.dry import dry_bench, mutate
from athena.proving.forge.forge import MARKER, forge_one, forge_prompt
from athena.proving.playbooks.bench import BenchConfig, score
from athena.proving.playbooks.spec import Playbook
from athena.proving.roles import RoleCaller, RoleReply
from athena.proving.runlog import RunLog

from .conftest import ScriptedRole, text_reply


def caller() -> RoleCaller:
    return RoleCaller(Budget(), RunLog())


def test_the_prompt_names_the_variant_and_fences_the_files(base: Base) -> None:
    prompt = forge_prompt(base, 2, 11)
    assert MARKER.format(id=base.id, k=2) in prompt
    assert prompt.count("<<<untrusted:") == 3
    assert forge_prompt(base, 1, 11) != forge_prompt(base, 2, 11)


def test_a_valid_answer_in_a_code_fence_is_a_valid_variant(base: Base) -> None:
    body = "Here you go:\n```json\n" + json.dumps(mutate(base, 1)) + "\n```"
    client = ScriptedRole(lambda s, p: text_reply(body))
    v = forge_one(caller(), client, base, 1, 11, generator="nemotron")
    assert v.valid and v.world is not None and v.truth is not None
    assert len(client.prompts) == 1  # one call per variant


def test_a_refused_answer_keeps_its_reasons_and_no_world(base: Base) -> None:
    bad = json.dumps(mutate(base, 1, bug=True))
    client = ScriptedRole(lambda s, p: text_reply(bad))
    v = forge_one(caller(), client, base, 1, 11, generator="nemotron")
    assert not v.valid and v.codes == ["tables-differ"] and v.world is None


def test_malformed_json_is_not_json_even_when_a_fragment_parses(base: Base) -> None:
    whole = json.dumps(mutate(base, 1))
    broken = whole[:-1].replace('"]', '"]"', 1)  # a stray quote, as Lightning writes them
    client = ScriptedRole(lambda s, p: text_reply(broken))
    v = forge_one(caller(), client, base, 1, 11, generator="nemotron")
    assert not v.valid and v.codes == ["not-json"]


def test_a_reply_the_ceiling_cut_is_a_void_not_a_refusal(base: Base) -> None:
    cut = RoleReply("{", "nemotron", "m", error_reason="engine_error", stopped="length")
    v = forge_one(caller(), ScriptedRole(lambda s, p: cut), base, 1, 11, generator="nemotron")
    assert v.void == "cut" and not v.valid


def test_a_failed_call_is_a_refusal_with_its_reason(base: Base) -> None:
    down = RoleReply("", "nemotron", "m", error_reason="engine_error", detail="boom")
    v = forge_one(caller(), ScriptedRole(lambda s, p: down), base, 1, 11, generator="nemotron")
    assert not v.valid and v.codes == ["call-failed"] and not v.void


# --- audit ---------------------------------------------------------------------------------------


def test_parse_audit() -> None:
    assert parse_audit({"label_holds": True, "why": "yes"}) == (True, "yes")
    assert parse_audit({"label_holds": False}) == (False, "")
    assert parse_audit({"label_holds": "true", "why": "x"}) is None
    assert parse_audit({"why": "x"}) is None
    assert parse_audit("label_holds") is None


def bench_of(base: Base) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], Playbook]:
    variant = mutate(base, 1)
    with tempfile.TemporaryDirectory() as tmp:
        book = materialize(base, variant["world"], variant["truth"], Path(tmp))
    return variant["world"], variant["truth"], dry_bench(book, BenchConfig()), book


def test_items_are_the_misses_and_the_filed_traps(base: Base) -> None:
    _world, truth, report, _book = bench_of(base)
    trap = {"action": "submit_representment", "key": "X", "outcome": "trap", "why": "w"}
    report["score"]["cards"].append(trap)
    items = audit_items(truth, report)
    kinds = [i.kind for i in items]
    assert kinds.count("miss") == len(report["score"]["missed"]) > 0
    assert kinds.count("trap_filed") == 1
    assert all(i.label.startswith(("ELIGIBLE", "TRAP")) for i in items)


def test_the_audit_prompt_is_blind_and_fences_the_record(base: Base) -> None:
    world, truth, report, _book = bench_of(base)
    item = audit_items(truth, report)[0]
    prompt = audit_prompt(base, world, item)
    assert prompt is not None
    assert "<<<untrusted:" in prompt and item.key in prompt and item.label in prompt
    for leak in ("sonnet", "recall", "missed"):
        assert leak not in prompt.lower()
    ghost = AuditItem("miss", "t", "NO-SUCH-ID-1", "ELIGIBLE")
    assert audit_prompt(base, world, ghost) is None


def test_run_audit_records_holds_errors_and_unusable_answers(base: Base) -> None:
    world, truth, report, _book = bench_of(base)
    first = audit_items(truth, report)[0]
    items = [AuditItem(first.kind, first.tool, first.key, first.label) for _ in range(3)]
    answers = iter(
        [
            json.dumps({"label_holds": True, "why": "ok"}),
            json.dumps({"label_holds": False, "why": "the row says otherwise"}),
            "not json at all",
        ]
    )
    client = ScriptedRole(lambda s, p: text_reply(next(answers), engine="claude"), engine="claude")
    run_audit(caller(), client, base, world, items)
    assert [i.label_holds for i in items] == [True, False, None]
    assert items[2].note


def test_a_forge_error_is_taken_out_of_the_truth_and_the_flip_is_rescored(base: Base) -> None:
    _world, truth, report, book = bench_of(base)
    items = audit_items(truth, report)
    assert items
    before = report["score"]["recall_value"]
    held = [AuditItem(i.kind, i.tool, i.key, i.label, label_holds=True) for i in items]
    assert rescore_corrected(book, report, held)["score"]["recall_value"] == before
    assert corrected(book, held).targets == book.targets
    for item in items:
        item.label_holds = False  # every miss was a forge error
    fixed = rescore_corrected(book, report, items)
    assert fixed["score"]["recall_value"] == 1.0 > before


def test_a_filed_trap_that_was_not_one_becomes_neutral(base: Base) -> None:
    _world, truth, report, book = bench_of(base)
    target = book.targets[0]
    trap = next(iter(target.traps))
    cards = [*report["cards"], {"action": f"host.dry.{target.tool}", "params": {target.key: trap}}]
    report = {**report, "cards": cards, "score": score(book, cards)}
    flagged = [i for i in audit_items(truth, report) if i.kind == "trap_filed"]
    assert flagged
    for item in flagged:
        item.label_holds = False
    after = rescore_corrected(book, report, flagged)["score"]
    assert after["false_claims"] == report["score"]["false_claims"] - len(flagged)

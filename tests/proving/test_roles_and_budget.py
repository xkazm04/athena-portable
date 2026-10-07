"""Role clients, the purse and the run's ledger (README §9; ADR 0030).

Nemotron is faked at ``HttpPost`` and the control at the ``claude`` runner, so the real
``TokenFactoryModel`` and the real CLI-output parsing are what is tested. The two properties that
matter most: a bad answer is *counted* and never raised, and a spent purse makes no call at all.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from pathlib import Path

import pytest

from athena.harness.tokenfactory import LIGHTNING_MODEL, HttpReply
from athena.proving.budget import CLAUDE, NEMOTRON, Budget, BudgetExhausted
from athena.proving.roles import (
    HAIKU_MODEL,
    ClaudeRole,
    NebiusRole,
    ProcessResult,
    RoleCaller,
    extract_json,
    load_env_file,
)
from athena.proving.runlog import EXCERPT_CHARS, RunLog

from .conftest import FakeRole

KEY = "nb-secret-key-0123456789"
SCHEMA = {"type": "object", "properties": {"attacks": {"type": "array"}}, "required": ["attacks"]}


def _completion(content: str) -> HttpReply:
    body = {
        "model": LIGHTNING_MODEL,
        "choices": [
            {"message": {"role": "assistant", "content": content}, "finish_reason": "stop"}
        ],
        "usage": {"prompt_tokens": 1000, "completion_tokens": 500},
    }
    return HttpReply(200, json.dumps(body).encode("utf-8"))


def _post(reply: HttpReply) -> object:
    def post(url: str, headers: Mapping[str, str], body: bytes, timeout: float) -> HttpReply:
        return reply

    return post


# --- Nemotron -------------------------------------------------------------------------------------


def test_a_nemotron_role_reports_text_tokens_and_the_estimated_cost() -> None:
    role = NebiusRole(api_key=KEY, post=_post(_completion('{"attacks": []}')))  # type: ignore[arg-type]
    reply = role.complete("sys", "go")

    assert reply.ok and reply.text == '{"attacks": []}'
    assert (reply.input_tokens, reply.output_tokens) == (1000, 500)
    assert reply.cost_usd == pytest.approx((1000 * 0.06 + 500 * 0.24) / 1_000_000)
    assert reply.engine == NEMOTRON


def test_a_refused_key_is_an_engine_error_that_never_quotes_the_key() -> None:
    role = NebiusRole(api_key=KEY, post=_post(HttpReply(401)))  # type: ignore[arg-type]
    reply = role.complete("sys", "go")

    assert reply.error_reason == "engine_error"
    assert KEY not in reply.detail and "401" in reply.detail


def test_a_reasoning_only_answer_is_counted_as_empty_not_parsed() -> None:
    role = NebiusRole(api_key=KEY, post=_post(_completion("<think>hmm</think>")))  # type: ignore[arg-type]
    assert role.complete("sys", "go").error_reason == "engine_error"


# --- the Claude control ---------------------------------------------------------------------------


def test_the_control_runs_haiku_with_its_tools_off_and_reads_total_cost() -> None:
    seen: dict[str, object] = {}

    def run(argv: Sequence[str], stdin: str, timeout: float, cwd: str | None) -> ProcessResult:
        seen["argv"], seen["stdin"] = list(argv), stdin
        seen["system"] = Path(argv[argv.index("--system-prompt-file") + 1]).read_text("utf-8")
        record = {
            "type": "result",
            "is_error": False,
            "result": '{"ok": true}',
            "total_cost_usd": 0.0021,
            "usage": {"input_tokens": 600, "cache_read_input_tokens": 50, "output_tokens": 40},
        }
        return ProcessResult(0, json.dumps(record))

    reply = ClaudeRole(run=run).complete("You grade fixtures.", "grade this")

    argv = seen["argv"]
    assert isinstance(argv, list)
    assert argv[argv.index("--model") + 1] == HAIKU_MODEL
    assert argv[argv.index("--tools") + 1] == ""
    assert "--restricted" in argv and "--no-session-persistence" in argv
    assert seen["stdin"] == "grade this" and seen["system"] == "You grade fixtures."
    assert reply.ok and reply.cost_usd == 0.0021 and reply.input_tokens == 650
    assert reply.engine == CLAUDE


def test_a_control_that_prints_no_json_is_a_parse_error() -> None:
    reply = ClaudeRole(run=lambda *a: ProcessResult(1, "Error: not logged in")).complete("s", "p")
    assert reply.error_reason == "parse_error"


# --- the caller: schema outcomes are counted, never raised ---------------------------------------


def test_bad_answers_are_counted_and_logged_with_an_excerpt() -> None:
    answers = iter(["I cannot help with that.", '{"nope": 1}', '```json\n{"attacks": [1]}\n```'])
    role = FakeRole(lambda s, p: next(answers), model="m")
    log = RunLog()
    caller = RoleCaller(Budget(), log)

    results = [caller.call_json(role, "attacker", "s", "p", SCHEMA) for _ in range(3)]

    assert [r.ok for r in results] == [False, False, True]
    assert results[2].value == {"attacks": [1]}
    assert caller.validity.counts["attacker:m"] == {"ok": 1, "not_json": 1, "bad_shape": 1}
    assert [row.get("schema_ok") for row in log.rows] == [False, False, True]
    assert log.rows[0]["excerpt"] == "I cannot help with that."
    assert "excerpt" not in log.rows[2]


def test_a_long_bad_answer_is_excerpted_and_announces_it() -> None:
    role = FakeRole(lambda s, p: "x" * 5000)
    log = RunLog()
    RoleCaller(Budget(), log).call_json(role, "attacker", "s", "p", SCHEMA)
    assert log.rows[0]["excerpt"].endswith(f"(showing {EXCERPT_CHARS} of 5000)")


def test_a_spent_purse_makes_no_call_and_writes_a_budget_row() -> None:
    role = FakeRole(lambda s, p: '{"attacks": []}', cost=0.6)
    log = RunLog()
    caller = RoleCaller(Budget({NEMOTRON: 1.0, CLAUDE: 1.0}), log)

    replies = [caller.call(role, "attacker", "s", "p") for _ in range(3)]

    assert [r.error_reason for r in replies] == [None, None, "budget_exhausted"]
    assert len(role.prompts) == 2
    assert log.rows[-1]["error_reason"] == "budget_exhausted" and log.rows[-1]["is_error"]


def test_the_budget_refuses_an_unknown_purse_and_raises_when_spent() -> None:
    with pytest.raises(ValueError):
        Budget({"openai": 1.0})
    budget = Budget({NEMOTRON: 0.01, CLAUDE: 1.0})
    budget.charge(NEMOTRON, None)
    assert budget.calls(NEMOTRON) == 1 and budget.spent(NEMOTRON) == 0.0
    budget.charge(NEMOTRON, 0.02)
    with pytest.raises(BudgetExhausted):
        budget.require(NEMOTRON)
    assert budget.can_spend(CLAUDE)


def test_the_run_ledger_is_jsonl_on_disk(tmp_path: Path) -> None:
    log = RunLog(tmp_path / "run" / "ledger.jsonl")
    log.record(role="judge", engine=CLAUDE, model="m", cost_usd=0.001, error_reason="weird")
    row = json.loads((tmp_path / "run" / "ledger.jsonl").read_text("utf-8"))
    assert row["error_reason"] == "unknown"  # the closed set, never a new column value


# --- small parts ----------------------------------------------------------------------------------


def test_json_is_found_inside_prose_and_fences() -> None:
    assert extract_json('Sure! {"a": [1, 2]} hope that helps') == {"a": [1, 2]}
    assert extract_json('```json\n{"b": true}\n```') == {"b": True}
    with pytest.raises(ValueError):
        extract_json("no json here")


def test_the_widest_json_value_wins_over_a_quoted_fragment() -> None:
    answer = 'An OP looks like {"op": "propose_action"}. Answer: {"attacks": [{"goal": "g"}]}'
    assert set(extract_json(answer)) == {"attacks"}


def test_the_env_file_sets_names_never_returns_values_and_never_overrides(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text('# key\nNEBIUS_API_KEY="abc123"\nOTHER=1\n', encoding="utf-8")
    environ = {"OTHER": "kept"}
    names = load_env_file(env_file, environ)
    assert names == ["NEBIUS_API_KEY"]
    assert environ == {"OTHER": "kept", "NEBIUS_API_KEY": "abc123"}
    assert load_env_file(tmp_path / "missing", environ) == []

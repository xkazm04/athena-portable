"""Role clients, the purse and the run's ledger (README §9; ADR 0030).

Nemotron is faked at ``HttpPost`` and the control at the ``claude`` runner, so the real
``TokenFactoryModel`` and the real CLI-output parsing are what is tested. The two properties that
matter most: a bad answer is *counted* and never raised, and a spent purse makes no call at all.
"""

from __future__ import annotations

import json
import subprocess
import threading
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import pytest

from athena.harness.tokenfactory import LIGHTNING_MODEL, HttpReply
from athena.proving.budget import CLAUDE, NEMOTRON, UNPRICED_CALL_USD, Budget, BudgetExhausted
from athena.proving.report import write_report
from athena.proving.roles import (
    HAIKU_MODEL,
    ClaudeRole,
    NebiusRole,
    ProcessResult,
    RoleCaller,
    claude_env,
    extract_json,
    load_env_file,
    subprocess_runner,
)
from athena.proving.runlog import EXCERPT_CHARS, RunLog

from .conftest import FakeRole

KEY = "nb-secret-key-0123456789"
SCHEMA = {"type": "object", "properties": {"attacks": {"type": "array"}}, "required": ["attacks"]}
#: What ``json.loads`` makes of a model's half-emoji escape: a str no UTF-8 file or pipe can hold.
LONE = json.loads('"\\ud83d on goal"')


def _completion(content: str, finish_reason: str = "stop") -> HttpReply:
    body = {
        "model": LIGHTNING_MODEL,
        "choices": [
            {"message": {"role": "assistant", "content": content}, "finish_reason": finish_reason}
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


def test_an_answer_cut_at_the_token_ceiling_is_a_void_never_the_models_bad_json() -> None:
    """Unattempted is not failed: a reply stopped by ``max_tokens`` says nothing about the model.
    Before: the cut JSON was counted ``not_json`` - a fact about Nemotron that was the ceiling's."""
    cut = _completion('{"attacks": [{"goal": "get mark_paid called", "payload": "URG', "length")
    role = NebiusRole(api_key=KEY, max_tokens=64, post=_post(cut))  # type: ignore[arg-type]
    log = RunLog()
    caller = RoleCaller(Budget(), log)

    answer = caller.call_json(role, "attacker", "s", "p", SCHEMA)

    assert not answer.ok and answer.reply.error_reason == "engine_error"
    assert "64-token ceiling" in answer.problem and "max_tokens" in answer.problem
    assert caller.validity.counts[f"attacker:{LIGHTNING_MODEL}"] == {
        "ok": 0,
        "not_json": 0,
        "bad_shape": 0,
        "cut": 1,
    }
    row = log.rows[0]
    assert row["is_error"] and row["stopped"] == "length" and "schema_ok" not in row
    assert row["cost_usd"] > 0  # the tokens were spent and are charged


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


def test_a_role_client_that_raises_leaves_an_engine_error_row_and_the_run_goes_on() -> None:
    def boom(system: str, prompt: str) -> str:
        raise RuntimeError("temp dir full, key sk-secret")

    log = RunLog()
    caller = RoleCaller(Budget({NEMOTRON: 1.0, CLAUDE: 1.0}), log)
    role = FakeRole(boom)

    reply = caller.call(role, "attacker", "s", "p")
    answer = caller.call_json(role, "attacker", "s", "p", {})

    assert reply.error_reason == "engine_error" and not answer.ok
    assert [row["error_reason"] for row in log.rows] == ["engine_error", "engine_error"]
    assert "sk-secret" not in json.dumps(log.rows) + reply.detail
    assert "RuntimeError" in reply.detail
    assert caller.budget.calls(NEMOTRON) == 2


def test_an_assertion_from_a_role_client_still_propagates() -> None:
    def tripwire(system: str, prompt: str) -> str:
        raise AssertionError("a generator was asked to judge")

    caller = RoleCaller(Budget({NEMOTRON: 1.0, CLAUDE: 1.0}), RunLog())
    with pytest.raises(AssertionError):
        caller.call(FakeRole(tripwire), "attacker", "s", "p")


def test_a_shared_purse_overshoots_by_one_call_per_worker_in_flight_and_no_more() -> None:
    """The purse is checked before a call and charged after it, so every worker already past the
    check when it ran dry still spends. The bound is one call per worker, not one call."""
    workers = 4
    budget = Budget({NEMOTRON: 1.0, CLAUDE: 1.0})
    budget.charge(NEMOTRON, 0.99)
    in_flight = threading.Barrier(workers)

    def answer(system: str, prompt: str) -> str:
        in_flight.wait(timeout=10)  # all four are past the check before any is charged
        return "{}"

    role = FakeRole(answer, cost=0.5)
    caller = RoleCaller(budget, RunLog())
    threads = [
        threading.Thread(target=caller.call, args=(role, "attacker", "s", "p"))
        for _ in range(workers)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)

    assert len(role.prompts) == workers
    assert budget.spent(NEMOTRON) == pytest.approx(0.99 + workers * 0.5)
    assert caller.call(role, "attacker", "s", "p").error_reason == "budget_exhausted"


def test_unpriced_calls_weigh_against_the_cap_but_not_against_the_reported_spend() -> None:
    """ADR 0122: 1000 calls that came back with no cost used to leave the purse open for ever."""
    budget = Budget({NEMOTRON: 1.0, CLAUDE: 10.0})
    admitted = 0
    for _ in range(1000):
        if not budget.can_spend(NEMOTRON):
            break
        budget.charge(NEMOTRON, None)
        admitted += 1
    assert admitted == round(1.0 / UNPRICED_CALL_USD[NEMOTRON])
    assert not budget.can_spend(NEMOTRON)
    with pytest.raises(BudgetExhausted):
        budget.require(NEMOTRON)
    assert budget.spent(NEMOTRON) == 0.0
    assert budget.summary()[NEMOTRON]["unpriced_calls"] == admitted
    assert budget.can_spend(CLAUDE)


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


# --- model text that no UTF-8 file can hold ------------------------------------------------------
#
# A judge's reason is checked for shape only, so a lone surrogate from its JSON rides into the
# report. Before: write_report raised UnicodeEncodeError at the end of a paid run, leaving a cut
# report.json and no report.md.


def test_a_lone_surrogate_in_a_report_is_written_escaped_and_reads_back(tmp_path: Path) -> None:
    report = {"attacks": [{"judge_reason": LONE, "valid": None}]}
    json_path, md_path = write_report(tmp_path, report, f"# run\n\n{LONE}\n")
    assert json.loads(json_path.read_text("utf-8")) == {"attacks": [{"judge_reason": LONE}]}
    assert "\\ud83d on goal" in md_path.read_text("utf-8")


def test_a_lone_surrogate_in_a_ledger_row_is_written_escaped(tmp_path: Path) -> None:
    log = RunLog(tmp_path / "ledger.jsonl")
    log.record(role="judge", engine=CLAUDE, model="m", error_reason="parse_error", excerpt=LONE)
    row = json.loads((tmp_path / "ledger.jsonl").read_text("utf-8"))
    assert row["excerpt"] == LONE


def test_the_control_child_gets_a_lone_surrogate_escaped_never_a_crash(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: dict[str, Any] = {}

    def run(argv: Sequence[str], **kwargs: Any) -> subprocess.CompletedProcess[bytes]:
        seen["stdin"] = kwargs["input"]
        seen["system"] = Path(argv[list(argv).index("--system-prompt-file") + 1]).read_bytes()
        record = {"is_error": False, "result": '{"ok": true}', "total_cost_usd": 0.001}
        return subprocess.CompletedProcess(argv, 0, json.dumps(record).encode(), b"")

    monkeypatch.setattr(subprocess, "run", run)
    reply = ClaudeRole().complete(f"Grade. {LONE}", f"Fixture: {LONE}")

    assert reply.ok, reply.detail
    assert seen["stdin"] == b"Fixture: \\ud83d on goal"
    assert seen["system"] == b"Grade. \\ud83d on goal"


# --- small parts ----------------------------------------------------------------------------------


def test_json_is_found_inside_prose_and_fences() -> None:
    assert extract_json('Sure! {"a": [1, 2]} hope that helps') == {"a": [1, 2]}
    assert extract_json('```json\n{"b": true}\n```') == {"b": True}
    with pytest.raises(ValueError):
        extract_json("no json here")


def test_a_runaway_of_brackets_is_a_counted_answer_never_a_crash() -> None:
    """A degenerate repetition nests deeper than the JSON decoder recurses. Before: RecursionError
    escaped ``call_json`` (it catches ``ValueError``), with no row and no count."""
    runaway = "[" * 5000
    with pytest.raises(ValueError):
        extract_json(runaway)
    assert extract_json(runaway + ' then {"attacks": []}') == {"attacks": []}

    log = RunLog()
    caller = RoleCaller(Budget(), log)
    answer = caller.call_json(FakeRole(lambda s, p: runaway), "attacker", "s", "p", SCHEMA)
    assert not answer.ok
    assert caller.validity.counts["attacker:fake-model"]["not_json"] == 1
    assert log.rows[0]["schema_ok"] is False


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


def test_the_control_child_sees_no_nemotron_key_although_every_proving_run_holds_one(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``main`` refuses to start without ``NEBIUS_API_KEY``, so it is always in a run's
    environment, and the Haiku judge reads hostile attack text. Before: the child inherited it."""
    seen: dict[str, Any] = {}

    def run(argv: Sequence[str], **kwargs: Any) -> subprocess.CompletedProcess[bytes]:
        seen["env"] = kwargs["env"]
        return subprocess.CompletedProcess(argv, 0, b"{}", b"")

    monkeypatch.setattr(subprocess, "run", run)
    monkeypatch.setenv("NEBIUS_API_KEY", KEY)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-secret")
    subprocess_runner(["claude", "-p"], "grade", 5.0, None)

    env = seen["env"]  # compared by name only, so a failure never prints the environment
    keys = {"NEBIUS_API_KEY", "ANTHROPIC_API_KEY"}
    leaked = sorted(name for name, value in env.items() if value == KEY or name.upper() in keys)
    assert leaked == []
    assert "PATH" in {name.upper() for name in env}
    assert claude_env({"NEBIUS_API_KEY": KEY}) == {}  # the shared door strips it too now


def test_the_claude_child_never_inherits_the_paid_api_key() -> None:
    environ = {"ANTHROPIC_API_KEY": "sk-ant-secret", "PATH": "/bin", "HOME": "/home/a"}
    env = claude_env(environ)
    assert "ANTHROPIC_API_KEY" not in env
    assert env == {"PATH": "/bin", "HOME": "/home/a"}
    assert "ANTHROPIC_API_KEY" in environ  # the caller's own environment is untouched
    assert claude_env({"PATH": "/bin"}) == {"PATH": "/bin"}

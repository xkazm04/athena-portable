"""The one door: flags, tiers, ledger rows, usage, the JSON retry, the warm session (ADR 0097)."""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path

import pytest

from athena.adopt.legs import LegRunner, WarmSession, cli_argv, load_tiers
from athena.contracts.adopt import LEG_KINDS, Tier
from athena.core.brain import Brain
from athena.core.ledger import Ledger
from athena.harness.transports import ScriptedTransport, TransportError

from .conftest import FakeLedger, FakeModel, FakeTransport, WarmFactory, stream_lines

SCHEMA = {"type": "object", "required": ["n"], "properties": {"n": {"type": "integer"}}}
SONNET = Tier(model="claude-sonnet-5-5", effort="low")


def runner(tmp_path: Path, transport: object, **kw: object) -> LegRunner:
    return LegRunner(
        transport=transport,  # type: ignore[arg-type]
        tiers=load_tiers(),
        prompt_dir=tmp_path / "prompts",
        **kw,  # type: ignore[arg-type]
    )


def test_no_tools_unless_named_and_the_tier_is_on_the_command_line() -> None:
    argv = cli_argv(SONNET, system_file="s.md")
    assert argv[argv.index("--tools") + 1] == ""
    assert "--allowedTools" not in argv
    assert argv[argv.index("--model") + 1] == "claude-sonnet-5-5"
    assert argv[argv.index("--effort") + 1] == "low"
    for flag in ("--restricted", "--strict-mcp-config", "--no-session-persistence", "-p"):
        assert flag in argv
    assert argv[argv.index("--permission-mode") + 1] == "dontAsk"
    assert "--input-format" not in argv

    research = cli_argv(SONNET, system_file="s.md", allowed_tools=("WebSearch", "WebFetch"))
    assert research[research.index("--tools") + 1] == "WebSearch,WebFetch"
    assert research[research.index("--allowedTools") + 1] == "WebSearch,WebFetch"
    docs = cli_argv(SONNET, system_file="s.md", allowed_tools=("Read",), add_dirs=("/tmp/x",))
    assert docs[docs.index("--add-dir") + 1] == "/tmp/x"
    warm = cli_argv(SONNET, system_file="s.md", warm=True)
    assert warm[warm.index("--input-format") + 1] == "stream-json"


def test_the_shipped_tiers_cover_every_kind_with_claude_5_5_only() -> None:
    tiers = load_tiers()
    assert set(tiers) == set(LEG_KINDS)
    assert all(t.model.endswith("-5-5") and t.effort in ("low", "medium") for t in tiers.values())


def test_a_tier_outside_claude_5_5_is_refused(tmp_path: Path) -> None:
    bad = {k: {"model": "claude-sonnet-5-5", "effort": "low"} for k in LEG_KINDS}
    bad["audit"] = {"model": "claude-sonnet-4-5", "effort": "low"}
    path = tmp_path / "tiers.json"
    path.write_text(json.dumps(bad), encoding="utf-8")
    with pytest.raises(ValueError, match=r"audit.model"):
        load_tiers(path)


def test_the_kind_is_required_and_known(tmp_path: Path) -> None:
    door = runner(tmp_path, ScriptedTransport([]))
    with pytest.raises(ValueError, match="unknown leg kind"):
        door.run_leg("chat", "s", "p", json_schema=None)  # type: ignore[arg-type]


def test_a_text_leg_is_one_row_one_usage_and_measures_first_text(tmp_path: Path) -> None:
    ledger = FakeLedger()
    usage: list[object] = []
    door = runner(tmp_path, ScriptedTransport([stream_lines("hello there")]), ledger=ledger)
    result = door.run_leg(
        "research", "system", "prompt", json_schema=None, on_usage=usage.append, conversation="c"
    )
    assert result.ok and result.text == "hello there"
    assert result.model == "claude-sonnet-5-5" and result.first_text_ms is not None
    assert len(usage) == 1
    (row,) = ledger.rows
    assert row["trigger"] == "adopt.research" and row["engine"] == "claude_code"
    assert row["origin"] == "core" and row["is_error"] is False
    assert row["input_tokens"] == 100 and row["cost_usd"] == 0.001


def test_a_malformed_answer_is_retried_once_with_the_problem(tmp_path: Path) -> None:
    ledger = FakeLedger()
    transport = ScriptedTransport([stream_lines("no json"), stream_lines('{"n": 3}')])
    door = runner(tmp_path, transport, ledger=ledger)
    result = door.run_leg("audit", "s", "the prompt", json_schema=SCHEMA)
    assert result.ok and result.value == {"n": 3} and result.attempts == 2
    assert "could not be used" in transport.requests[1].stdin
    assert transport.requests[1].stdin.startswith("the prompt")
    assert [r["error_reason"] for r in ledger.rows] == ["parse_error", None]


def test_malformed_twice_is_a_malformed_leg_and_two_failed_rows(tmp_path: Path) -> None:
    ledger = FakeLedger()
    transport = ScriptedTransport([stream_lines('{"n": "x"}'), stream_lines('{"m": 1}')])
    door = runner(tmp_path, transport, ledger=ledger)
    result = door.run_leg("audit", "s", "p", json_schema=SCHEMA)
    assert not result.ok and result.malformed and result.error_reason == "parse_error"
    assert result.detail.startswith("malformed:")
    assert [r["is_error"] for r in ledger.rows] == [True, True]


def test_the_callers_check_is_retried_like_the_schema(tmp_path: Path) -> None:
    transport = ScriptedTransport([stream_lines('{"n": 1}'), stream_lines('{"n": 2}')])
    door = runner(tmp_path, transport)
    result = door.run_leg(
        "audit", "s", "p", json_schema=SCHEMA, check=lambda v: "" if v["n"] == 2 else "n is 2"
    )
    assert result.ok and result.value == {"n": 2}


def test_a_cli_that_cannot_run_is_an_engine_error_row(tmp_path: Path) -> None:
    ledger = FakeLedger()
    door = runner(tmp_path, ScriptedTransport.broken(TransportError("claude: not on PATH")))
    door.ledger = ledger
    result = door.run_leg("interview", "s", "p", json_schema=SCHEMA)
    assert not result.ok and result.error_reason == "engine_error" and not result.malformed
    assert ledger.rows[0]["is_error"] is True and ledger.rows[0]["error_reason"] == "engine_error"


def test_a_cli_error_result_is_a_failed_row(tmp_path: Path) -> None:
    ledger = FakeLedger()
    door = runner(tmp_path, ScriptedTransport([stream_lines("x", is_error=True)]), ledger=ledger)
    assert door.run_leg("judge", "s", "p", json_schema=None).error_reason == "engine_error"
    assert ledger.rows[0]["is_error"] is True


def test_rows_land_in_the_real_ledger(tmp_path: Path) -> None:
    brain = Brain(tmp_path / "brain", session_id="t")
    try:
        ledger = Ledger(brain)
        transport = ScriptedTransport([stream_lines("nope"), stream_lines("still nope")])
        door = runner(tmp_path, transport, ledger=ledger)
        door.run_leg("audit", "s", "p", json_schema=SCHEMA, conversation="conv_sess_0123")
        rows = ledger.recent(10).rows
        assert len(rows) == 2 and all(r.is_error and r.error_reason == "parse_error" for r in rows)
        assert {r.surface for r in rows} == {"adopt"} and door.ledger_failures == 0
    finally:
        brain.close()


def test_the_system_prompt_is_one_file_per_text(tmp_path: Path) -> None:
    door = runner(tmp_path, ScriptedTransport([]))
    assert door.system_file("same") == door.system_file("same")
    assert door.system_file("same") != door.system_file("other")


def test_a_warm_session_keeps_one_process_and_is_killed_on_close(tmp_path: Path) -> None:
    model = FakeModel(script={"other": ['{"n": 1}']})
    spawn = WarmFactory(model)
    door = runner(tmp_path, FakeTransport(model), spawn_warm=spawn)
    warm = door.warm_session("interview", "warm system", str(tmp_path))
    for _ in range(2):
        result = door.run_leg("interview", "warm system", "p", json_schema=SCHEMA, session=warm)
        assert result.ok and result.warm
    assert len(spawn.spawned) == 1 and spawn.spawned[0].sent == 2
    assert "--input-format" in spawn.spawned[0].argv
    warm.close()
    assert spawn.spawned[0].killed
    after = door.run_leg("interview", "warm system", "p", json_schema=SCHEMA, session=warm)
    assert after.ok and not after.warm


def test_a_warm_process_that_dies_falls_back_to_a_cold_call(tmp_path: Path) -> None:
    model = FakeModel(script={"other": ['{"n": 1}']})
    spawn = WarmFactory(model, die_on=1)
    door = runner(tmp_path, FakeTransport(model), spawn_warm=spawn)
    warm = door.warm_session("interview", "warm system", str(tmp_path))
    result = door.run_leg("interview", "warm system", "p", json_schema=SCHEMA, session=warm)
    assert result.ok and not result.warm
    assert spawn.spawned[0].killed and warm.deaths == 1


def test_a_warm_retry_that_falls_back_cold_still_carries_the_prompt(tmp_path: Path) -> None:
    # The warm answer is malformed; the warm process dies on the retry, so the retry goes cold.
    # A cold call has no memory of the first answer: it must be told the prompt again.
    model = FakeModel(script={"other": ["no json", '{"n": 3}']})
    spawn = WarmFactory(model, die_on=2)
    transport = FakeTransport(model)
    door = runner(tmp_path, transport, spawn_warm=spawn)
    warm = door.warm_session("interview", "warm system", str(tmp_path))
    result = door.run_leg(
        "interview", "warm system", "the prompt", json_schema=SCHEMA, session=warm
    )
    assert result.ok and result.value == {"n": 3} and not result.warm
    (cold,) = transport.requests
    assert cold.stdin.startswith("the prompt")
    assert "could not be used" in cold.stdin


def test_a_warm_session_at_another_tier_is_not_used(tmp_path: Path) -> None:
    model = FakeModel(script={"other": ['{"n": 1}']})
    spawn = WarmFactory(model)
    door = runner(tmp_path, FakeTransport(model), spawn_warm=spawn)
    warm = door.warm_session("interview", "s", str(tmp_path))
    opus = Tier(model="claude-opus-5-5", effort="medium")
    result = door.run_leg("interview", "s", "p", json_schema=SCHEMA, session=warm, tier=opus)
    assert result.ok and not result.warm and result.model == "claude-opus-5-5"
    assert spawn.spawned == []


class _HungWarm:
    """A warm process that never answers until it is killed (a slow interviewer)."""

    def __init__(self) -> None:
        self.sent = threading.Event()
        self.killed = threading.Event()

    def send(self, line: str) -> None:
        self.sent.set()

    def read_line(self, timeout: float) -> str | None:
        if self.killed.wait(timeout):
            return None  # end of stream: the process is gone
        raise TimeoutError

    def alive(self) -> bool:
        return not self.killed.is_set()

    def kill(self) -> None:
        self.killed.set()


def test_closing_a_warm_session_does_not_wait_for_the_answer_in_flight(tmp_path: Path) -> None:
    # DELETE /adopt/<sid>, idle expiry and shutdown all close the warm session while an
    # interview leg may be reading its answer; the close kills the process at once, and the
    # interrupted ask is cancelled rather than retried as a cold call nobody will read.
    proc = _HungWarm()
    warm = WarmSession(lambda argv, cwd: proc, SONNET, "s.md", str(tmp_path), kind="interview")
    got: list[object] = []
    asker = threading.Thread(target=lambda: got.append(warm.ask("p", 30.0)), daemon=True)
    asker.start()
    assert proc.sent.wait(5)
    closer = threading.Thread(target=warm.close, daemon=True)
    started = time.monotonic()
    closer.start()
    closer.join(5)
    assert not closer.is_alive() and time.monotonic() - started < 5
    assert proc.killed.is_set()
    asker.join(5)
    (attempt,) = got
    assert attempt is not None and attempt.error_reason == "cancelled"  # type: ignore[attr-defined]

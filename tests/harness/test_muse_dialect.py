"""``muse exec`` as an engine: its MSP stream, its prompt in a file, and its failures.

Driven from ``tests/fixtures/muse_exec_text_only.jsonl``, recorded from Muse Code 1.4.13 on
2026-10-27, so a drift in the event format turns this red.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from athena.harness.cli_harness import MUSE, MUSE_EXTRA_ARGS, CliHarness
from athena.harness.engines import build_harness
from athena.harness.hooks import GateHook, LedgerHook, TruncationHook
from athena.harness.transports import ENGINE_KEYS, ScriptedTransport, child_env

from .conftest import FakeApprovals, FakeCatalog, FakeLedger
from .test_cli_harness import _drain

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "muse_exec_text_only.jsonl"


def _records() -> list[str]:
    return [
        line
        for line in FIXTURE.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.startswith("#")
    ]


def _harness(transport: ScriptedTransport, tmp_path: Path) -> CliHarness:
    return CliHarness(
        gate=GateHook(FakeCatalog(), FakeApprovals()),
        ledger=LedgerHook(FakeLedger()),
        truncation=TruncationHook(),
        transport=transport,
        dialect=MUSE,
        prompt_root=str(tmp_path),
        cwd=str(tmp_path),
        model="muse-spark-1.3",
        extra_args=MUSE_EXTRA_ARGS,
    )


def test_the_recorded_stream_decodes_to_its_deltas_usage_and_outcome() -> None:
    decoded = [MUSE.decode(json.loads(line)) for line in _records()]
    kinds = [d.kind if d else None for d in decoded]
    assert kinds[0] == "session" and None in kinds  # run.lifecycle.started is skipped
    text = "".join(d.text for d in decoded if d and d.kind == "text")
    usage = [d for d in decoded if d and d.kind == "result" and d.input_tokens]
    assert text.strip() and len(usage) == 1 and usage[0].output_tokens > 0
    assert decoded[-1] is not None and decoded[-1].kind == "result" and not decoded[-1].is_error


def test_a_turn_sends_its_prompt_as_a_file_and_nothing_on_stdin(tmp_path: Path) -> None:
    transport = ScriptedTransport([_records()])
    harness = _harness(transport, tmp_path)
    _drain(harness, [])
    request = transport.requests[0]
    assert request.stdin == ""
    at = request.argv.index("--prompt-file")
    prompt = Path(request.argv[at + 1]).read_text(encoding="utf-8")
    assert "The law" in prompt and "Which invoices are late?" in prompt
    assert request.argv[:2] == ["exec", "--json"]
    assert request.argv[request.argv.index("--contributor-mode") + 1] == "off"
    assert "--model" in request.argv and "--resume" not in request.argv


def test_the_turn_reads_the_recorded_answer_and_its_tokens(tmp_path: Path) -> None:
    harness = _harness(ScriptedTransport([_records()]), tmp_path)
    events = _drain(harness, [])
    finished = [e for e in events if type(e).__name__ == "TurnFinished"]
    assert finished, [type(e).__name__ for e in events]


def test_a_failed_terminal_is_an_engine_error_with_a_fixed_sentence(tmp_path: Path) -> None:
    failed = json.dumps(
        {
            "payload_type": "run.terminal.failed",
            "payload": {"terminal": "failed", "reason": "not logged in: run `muse login` first"},
        }
    )
    harness = _harness(ScriptedTransport([[failed]]), tmp_path)
    events = _drain(harness, [])
    errors = [e for e in events if type(e).__name__ == "TurnError"]
    assert errors and "not signed in" in str(errors[0])


def test_the_engine_defaults_to_the_muse_args_and_strips_a_meta_key(tmp_path: Path) -> None:
    harness = build_harness(
        "muse_code",
        gate=GateHook(FakeCatalog(), FakeApprovals()),
        ledger=LedgerHook(FakeLedger()),
        truncation=TruncationHook(),
        prompt_root=str(tmp_path),
        cwd=str(tmp_path),
    )
    assert isinstance(harness, CliHarness) and harness.extra_args == MUSE_EXTRA_ARGS
    assert ENGINE_KEYS["muse_code"] == ("META_API_KEY",)
    assert "META_API_KEY" not in child_env({"PATH": "/bin", "META_API_KEY": "mk"})


def test_the_next_turn_resumes_the_session_and_sends_only_its_message(tmp_path: Path) -> None:
    transport = ScriptedTransport([_records(), _records()])
    harness = _harness(transport, tmp_path)
    _drain(harness, [], message="Which invoices are late?")
    _drain(harness, [], message="And which are paid?", turn_id="turn_000000000002")
    first, second = transport.requests
    assert "--session-id" not in first.argv
    session = json.loads(_records()[0])["stream"]["id"]
    assert second.argv[second.argv.index("--session-id") + 1] == session
    prompt = Path(second.argv[second.argv.index("--prompt-file") + 1]).read_text("utf-8")
    assert "And which are paid?" in prompt and "The law" not in prompt


def test_the_batch_law_line_is_added_only_when_switched_on(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from athena.harness.cli_harness import MUSE_BATCH_LAW, MUSE_BATCH_LAW_ENV

    for value, present in (("", False), ("1", True)):
        monkeypatch.setenv(MUSE_BATCH_LAW_ENV, value)
        transport = ScriptedTransport([_records()])
        _drain(_harness(transport, tmp_path), [])
        argv = transport.requests[0].argv
        prompt = Path(argv[argv.index("--prompt-file") + 1]).read_text("utf-8")
        assert (MUSE_BATCH_LAW in prompt) is present

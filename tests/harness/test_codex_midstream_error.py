"""A codex ``error`` record is a notice; ``turn.failed``, a bad exit or silence fails a turn."""

from __future__ import annotations

import json
from pathlib import Path

from athena.contracts.channel import TurnError, TurnFinished
from athena.harness.cli_harness import CODEX
from athena.harness.transports import ExitStatus, ScriptedTransport

from .conftest import FakeCatalog, FakeLedger
from .test_cli_exit import _drain, _harness

THREAD = json.dumps({"type": "thread.started", "thread_id": "t1"})
ERROR = json.dumps({"type": "error", "message": "Reconnecting... 1/5"})
MESSAGE = json.dumps(
    {"type": "item.completed", "item": {"type": "agent_message", "text": "All settled."}}
)
COMPLETED = json.dumps(
    {"type": "turn.completed", "usage": {"input_tokens": 10, "output_tokens": 2}}
)
FAILED = json.dumps({"type": "turn.failed", "error": {"message": "the model gave up"}})


def _run(
    lines: list[str],
    catalog: FakeCatalog,
    ledger: FakeLedger,
    tmp_path: Path,
    exit_status: ExitStatus | None = None,
) -> list[object]:
    exits = {0: exit_status} if exit_status else None
    transport = ScriptedTransport([lines], exits=exits)
    return list(_drain(_harness(catalog, ledger, transport, tmp_path, dialect=CODEX)))


def test_an_error_record_then_turn_completed_finishes_the_turn(
    catalog: FakeCatalog, ledger: FakeLedger, tmp_path: Path
) -> None:
    events = _run([THREAD, ERROR, MESSAGE, COMPLETED], catalog, ledger, tmp_path)

    assert not any(isinstance(event, TurnError) for event in events)
    assert isinstance(events[-1], TurnFinished)
    assert events[-1].text == "All settled."


def test_an_error_record_then_turn_failed_fails_the_turn(
    catalog: FakeCatalog, ledger: FakeLedger, tmp_path: Path
) -> None:
    events = _run([THREAD, ERROR, FAILED], catalog, ledger, tmp_path)

    assert isinstance(events[-1], TurnError)
    assert events[-1].reason == "engine_error"


def test_an_error_record_then_turn_completed_with_a_bad_exit_still_fails(
    catalog: FakeCatalog, ledger: FakeLedger, tmp_path: Path
) -> None:
    events = _run(
        [THREAD, ERROR, MESSAGE, COMPLETED],
        catalog,
        ledger,
        tmp_path,
        ExitStatus(returncode=1, stderr_tail=""),
    )

    assert isinstance(events[-1], TurnError)


def test_an_error_record_with_no_result_after_it_fails_the_turn(
    catalog: FakeCatalog, ledger: FakeLedger, tmp_path: Path
) -> None:
    events = _run([THREAD, ERROR], catalog, ledger, tmp_path)

    assert isinstance(events[-1], TurnError)

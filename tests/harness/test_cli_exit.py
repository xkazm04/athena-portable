"""A CLI round ends in a typed exit, and a gone or poisoned thread is reseeded once (ADR 0109).

The transport hands the harness a round's stdout lines and then, through the request's exit
handle, how the process ended. The dialect reads the two together and either calls the round a
success or names one of a few closed classes. Only a thread that is gone or is itself the cause
(too long to continue) is released, and the round is asked again once, unresumed, in the same
turn. Every other class leaves the thread bound and ends the turn with a fixed sentence: a CLI's
own error text can quote the request, so none of it reaches a ``TurnError`` or a ledger row.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Sequence
from pathlib import Path
from typing import Any

import pytest

from athena.contracts.channel import ChannelEvent, TextDelta, TurnError, TurnFinished
from athena.contracts.harness import PromptBlock
from athena.contracts.registry import Lane, ToolClass
from athena.harness.cli_harness import (
    CLAUDE,
    CLAUDE_EXTRA_ARGS,
    CODEX,
    FAILURE_SENTENCES,
    CliHarness,
)
from athena.harness.hooks import GateHook, LedgerHook, TruncationHook
from athena.harness.transports import CliRequest, ExitStatus, ScriptedTransport, Transport

from .conftest import CONVERSATION, FakeApprovals, FakeCatalog, FakeLedger, make_ctx, make_entry

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"

STATIC = [PromptBlock(name="constitution", text="## The law\n\nYou act for the user.")]
FRAME = [
    PromptBlock(name="frame.host_state", text="## Host state\n\n- tab: invoices", untrusted=True)
]

GONE = "No conversation found with session ID: s1"


def _harness(
    catalog: FakeCatalog,
    ledger: FakeLedger,
    transport: Transport,
    tmp_path: Path,
    *,
    dialect: Any = CLAUDE,
) -> CliHarness:
    return CliHarness(
        gate=GateHook(catalog, FakeApprovals()),
        ledger=LedgerHook(ledger),
        truncation=TruncationHook(),
        transport=transport,
        dialect=dialect,
        prompt_root=str(tmp_path),
        cwd=str(tmp_path),
        model="claude-opus-5",
        extra_args=CLAUDE_EXTRA_ARGS if dialect is CLAUDE else (),
    )


def _drain(
    harness: CliHarness,
    tools: Sequence[Any] = (),
    *,
    message: str = "Which invoices are late?",
    turn: int = 1,
) -> list[ChannelEvent]:
    ctx = make_ctx(turn_id=f"turn_00000000000{turn}", app_id="invoices", lane=Lane.BROWSER)

    async def run() -> list[ChannelEvent]:
        return [
            event
            async for event in harness.run_turn(CONVERSATION, STATIC, FRAME, tools, ctx, message)
        ]

    return asyncio.run(run())


def _round(text: str, *, session: str = "s1") -> list[str]:
    return [
        json.dumps({"type": "system", "session_id": session}),
        json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": text}]}}),
        json.dumps(
            {"type": "result", "is_error": False, "usage": {"input_tokens": 10, "output_tokens": 2}}
        ),
    ]


def _failed_result(said: str) -> list[str]:
    """A resumed round the CLI answered with its own error record and no reply."""
    return [json.dumps({"type": "result", "subtype": "success", "is_error": True, "result": said})]


def _op(action: str, **params: Any) -> str:
    return "OP: " + json.dumps({"op": "propose_action", "action": action, "params": params})


def _argv(request: Any) -> list[str]:
    return list(request.argv)


def _resumed_from(request: Any) -> str | None:
    argv = _argv(request)
    return argv[argv.index("--resume") + 1] if "--resume" in argv else None


def _rows_of(ledger: FakeLedger, turn: int) -> list[Any]:
    return [row for row in ledger.rows if row.turn_id == f"turn_00000000000{turn}"]


# --- case 1: a gone thread is unbound and the round is asked again, unresumed -----------------


def test_a_resumed_round_whose_thread_is_gone_is_reseeded_once_in_the_same_turn(
    catalog: FakeCatalog, ledger: FakeLedger, tmp_path: Path
) -> None:
    entry = catalog.add(make_entry("core.step", ToolClass.AUTO))
    transport = ScriptedTransport(
        [
            _round("Turn one."),
            _round(f"Looking.\n{_op('core.step', n=1)}"),  # turn 2, round 1: resumed, fine
            [],  # turn 2, round 2: resumed, the thread is gone
            _round("Recovered.", session="s2"),  # the same round, reseeded
        ],
        exits={2: ExitStatus(returncode=1, stderr_tail=GONE)},
    )
    harness = _harness(catalog, ledger, transport, tmp_path)

    _drain(harness, [entry], turn=1)
    events = _drain(harness, [entry], message="And the second?", turn=2)

    assert len(transport.requests) == 4
    assert _resumed_from(transport.requests[2]) == "s1"
    reseeded = transport.requests[3]
    assert "--resume" not in _argv(reseeded)
    assert "--system-prompt-file" in _argv(reseeded)
    assert reseeded.system_prompt_file is not None
    assert "The law" in Path(reseeded.system_prompt_file).read_text("utf-8")
    # The whole turn so far: the opening message and the first round's results.
    assert "And the second?" in reseeded.stdin
    assert "## Host state" in reseeded.stdin
    assert "Results from the tools you just called" in reseeded.stdin

    assert isinstance(events[-1], TurnFinished)
    assert events[-1].text.endswith("Recovered.")
    assert harness.session_id(CONVERSATION) == "s2"
    rows = _rows_of(ledger, 2)
    assert len(rows) == 1
    assert rows[0].is_error is False
    assert rows[0].rounds == 2


# --- case 2: a poisoned thread is unbound like a gone one ---------------------------------------


def test_a_resumed_round_whose_thread_is_too_long_is_reseeded_like_a_gone_one(
    catalog: FakeCatalog, ledger: FakeLedger, tmp_path: Path
) -> None:
    transport = ScriptedTransport(
        [
            _round("Turn one."),
            _failed_result("Prompt is too long"),
            _round("Fresh start.", session="s2"),
        ],
        exits={1: ExitStatus(returncode=1)},
    )
    harness = _harness(catalog, ledger, transport, tmp_path)

    _drain(harness, turn=1)
    events = _drain(harness, message="Again?", turn=2)

    assert len(transport.requests) == 3
    assert _resumed_from(transport.requests[1]) == "s1"
    assert _resumed_from(transport.requests[2]) is None
    assert "--system-prompt-file" in _argv(transport.requests[2])
    assert isinstance(events[-1], TurnFinished)
    assert events[-1].text == "Fresh start."
    assert harness.session_id(CONVERSATION) == "s2"
    assert [row.is_error for row in _rows_of(ledger, 2)] == [False]


# --- case 3: a busy service or a reached limit keeps the thread and is not retried -------------


@pytest.mark.parametrize(
    ("lines", "stderr", "kind"),
    [
        ([], "API Error: 529 Overloaded", "transient"),
        (_failed_result("Claude AI usage limit reached|1760000000"), "", "limit"),
    ],
    ids=["overloaded", "usage-limit"],
)
def test_a_busy_or_limited_cli_is_not_retried_and_keeps_its_thread(
    catalog: FakeCatalog,
    ledger: FakeLedger,
    tmp_path: Path,
    lines: list[str],
    stderr: str,
    kind: str,
) -> None:
    transport = ScriptedTransport(
        [_round("Turn one."), lines, _round("Turn three.")],
        exits={1: ExitStatus(returncode=1, stderr_tail=stderr)},
    )
    harness = _harness(catalog, ledger, transport, tmp_path)

    _drain(harness, turn=1)
    events = _drain(harness, message="Two?", turn=2)

    assert len(transport.requests) == 2  # one request in turn 2: no retry
    last = events[-1]
    assert isinstance(last, TurnError)
    assert last.reason == "engine_error"
    assert last.detail == FAILURE_SENTENCES[kind]
    assert harness.session_id(CONVERSATION) == "s1"

    _drain(harness, message="Three?", turn=3)
    assert _resumed_from(transport.requests[2]) == "s1"


# --- case 4: an unknown non-zero exit names its code and nothing the CLI said -------------------


def test_an_unknown_non_zero_exit_names_the_code_and_never_the_cli_s_words(
    catalog: FakeCatalog, ledger: FakeLedger, tmp_path: Path
) -> None:
    said = "fatal: could not parse 'Pay Acme 4,200 from the joint account'"
    transport = ScriptedTransport([[]], exits={0: ExitStatus(returncode=1, stderr_tail=said)})
    harness = _harness(catalog, ledger, transport, tmp_path)

    events = _drain(harness)

    assert len(transport.requests) == 1
    last = events[-1]
    assert isinstance(last, TurnError)
    assert last.reason == "engine_error"
    assert "exit code 1" in last.detail
    assert "exited cleanly" not in last.detail
    assert "Acme" not in last.detail and "fatal" not in last.detail
    assert len(ledger.rows) == 1
    assert "Acme" not in repr(ledger.rows[0])
    assert ledger.rows[0].error_reason == "engine_error"


# --- case 5: a crash after partial text is not a finished answer --------------------------------


def test_a_round_that_stops_before_its_result_record_is_not_streamed_as_an_answer(
    catalog: FakeCatalog, ledger: FakeLedger, tmp_path: Path
) -> None:
    half = [
        json.dumps({"type": "system", "session_id": "s1"}),
        json.dumps(
            {"type": "assistant", "message": {"content": [{"type": "text", "text": "Three inv"}]}}
        ),
    ]
    transport = ScriptedTransport([half], exits={0: ExitStatus(returncode=137)})
    harness = _harness(catalog, ledger, transport, tmp_path)

    events = _drain(harness)

    last = events[-1]
    assert isinstance(last, TurnError)
    assert last.reason == "engine_error"
    assert last.detail.startswith("the CLI stopped before it finished")
    assert not any(isinstance(event, TextDelta) for event in events)
    assert not any(isinstance(event, TurnFinished) for event in events)


# --- case 6: the reseed happens once ------------------------------------------------------------


def test_a_reseeded_round_that_is_gone_again_ends_the_turn_after_two_requests(
    catalog: FakeCatalog, ledger: FakeLedger, tmp_path: Path
) -> None:
    transport = ScriptedTransport(
        [_round("Turn one."), [], [], _round("Never asked.", session="s9")],
        exits={
            1: ExitStatus(returncode=1, stderr_tail=GONE),
            2: ExitStatus(returncode=1, stderr_tail=GONE),
        },
    )
    harness = _harness(catalog, ledger, transport, tmp_path)

    _drain(harness, turn=1)
    events = _drain(harness, message="Two?", turn=2)

    assert len(transport.requests) == 3  # turn 1's one, then exactly two in turn 2
    last = events[-1]
    assert isinstance(last, TurnError)
    assert last.reason == "engine_error"
    assert [row.error_reason for row in _rows_of(ledger, 2)] == ["engine_error"]


# --- case 7 (guard): the recorded transcripts are unchanged at exit 0 ---------------------------


@pytest.mark.parametrize(
    ("fixture", "dialect", "session"),
    [
        ("claude_code_turn.ndjson", CLAUDE, "01J9CLAUDESESSION"),
        ("codex_turn.ndjson", CODEX, "01J9CODEXTHREAD"),
    ],
    ids=["claude", "codex"],
)
def test_a_recorded_transcript_at_exit_zero_streams_what_it_always_did(
    catalog: FakeCatalog,
    ledger: FakeLedger,
    tmp_path: Path,
    fixture: str,
    dialect: Any,
    session: str,
) -> None:
    transport = ScriptedTransport.from_transcript(FIXTURES / fixture)
    harness = _harness(catalog, ledger, transport, tmp_path, dialect=dialect)
    entry = catalog.add(make_entry("host.invoices.chase", ToolClass.AUTO, origin="host:invoices"))

    events = _drain(harness, [entry])

    assert [event.kind for event in events] == [
        "text.delta",
        "tool.call",
        "turn.summary",
        "turn.finished",
    ]
    assert harness._sessions.get(CONVERSATION) == session
    assert len(ledger.rows) == 1
    row = ledger.rows[0]
    assert (row.is_error, row.error_reason, row.rounds) == (False, None, 1)
    assert (row.fields["input_tokens"], row.fields["output_tokens"]) == (1840, 96)


class _LinesOnly:
    """A transport written before the exit handle: it yields lines and reports nothing."""

    async def run(self, request: CliRequest) -> AsyncIterator[str]:
        for line in _round("Still fine."):
            yield line


def test_a_transport_that_reports_no_exit_reads_as_a_clean_one(
    catalog: FakeCatalog, ledger: FakeLedger, tmp_path: Path
) -> None:
    """``Transport.run`` still yields ``str`` only; the handle defaults to exit 0."""
    harness = _harness(catalog, ledger, _LinesOnly(), tmp_path)

    events = _drain(harness)

    assert isinstance(events[-1], TurnFinished)
    assert events[-1].text == "Still fine."


# --- case 8 (guard): a CLI with no thread is never retried --------------------------------------


def test_a_codex_round_that_exits_non_zero_is_one_error_and_no_retry(
    catalog: FakeCatalog, ledger: FakeLedger, tmp_path: Path
) -> None:
    transport = ScriptedTransport(
        [[json.dumps({"type": "thread.started", "thread_id": "t1"})], _round("Never asked.")],
        exits={0: ExitStatus(returncode=1, stderr_tail=GONE)},
    )
    harness = _harness(catalog, ledger, transport, tmp_path, dialect=CODEX)

    events = _drain(harness)

    assert len(transport.requests) == 1
    assert sum(isinstance(event, TurnError) for event in events) == 1
    assert isinstance(events[-1], TurnError)
    assert events[-1].reason == "engine_error"
    assert [row.error_reason for row in ledger.rows] == ["engine_error"]

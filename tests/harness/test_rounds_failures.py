"""Every exit of a turn writes one ledger row (README §2; AGENTS.md 'Ledger everything').

A raise inside the round loop and a consumer that closes the stream both used to skip the row.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import time
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from athena.contracts.channel import ChannelEvent, TurnError
from athena.contracts.harness import ERROR_REASONS, PromptBlock, TurnResult
from athena.contracts.registry import ExecResult, Lane, ToolClass, TurnContext
from athena.harness.cli_harness import CLAUDE, CLAUDE_EXTRA_ARGS, CliHarness
from athena.harness.hooks import GateHook, LedgerHook, TruncationHook
from athena.harness.transports import CliRequest, ScriptedTransport

from .conftest import CONVERSATION, FakeApprovals, FakeCatalog, FakeLedger, make_ctx, make_entry

STATIC = [PromptBlock(name="constitution", text="## The law\n\nYou act for the user.")]
FRAME = [PromptBlock(name="frame.host_state", text="## Host state", untrusted=True)]


def _round(text: str) -> list[str]:
    return [
        json.dumps({"type": "system", "session_id": "01J9CLAUDESESSION"}),
        json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": text}]}}),
        json.dumps(
            {"type": "result", "is_error": False, "usage": {"input_tokens": 10, "output_tokens": 2}}
        ),
    ]


def _op(action: str) -> str:
    return "OP: " + json.dumps({"op": "propose_action", "action": action, "params": {}})


def _harness(
    catalog: FakeCatalog, ledger: FakeLedger, transport: Any, tmp_path: Path
) -> CliHarness:
    return CliHarness(
        gate=GateHook(catalog, FakeApprovals()),
        ledger=LedgerHook(ledger),
        truncation=TruncationHook(),
        transport=transport,
        dialect=CLAUDE,
        prompt_root=str(tmp_path),
        cwd=str(tmp_path),
        model="claude-opus-5",
        extra_args=CLAUDE_EXTRA_ARGS,
    )


def _ctx() -> TurnContext:
    return make_ctx(turn_id="turn_000000000001", app_id="invoices", lane=Lane.BROWSER)


def _drain(harness: CliHarness, tools: list[Any]) -> list[ChannelEvent]:
    async def run() -> list[ChannelEvent]:
        return [e async for e in harness.run_turn(CONVERSATION, STATIC, FRAME, tools, _ctx(), "go")]

    return asyncio.run(run())


class _LongLineTransport:
    """Streams one good line, then fails as StreamReader.readline does on an over-long one."""

    async def run(self, request: CliRequest) -> AsyncIterator[str]:
        yield json.dumps({"type": "system", "session_id": "s"})
        raise ValueError("Separator is not found, and chunk exceed the limit")


def test_an_executor_that_raises_still_writes_one_row_and_ends_in_turn_error(
    catalog: FakeCatalog, ledger: FakeLedger, tmp_path: Path
) -> None:
    def boom(params: dict[str, Any], ctx: TurnContext) -> ExecResult:
        raise RuntimeError("secret body the message quotes")

    entry = catalog.add(make_entry("core.boom", ToolClass.AUTO, executor=boom))
    harness = _harness(catalog, ledger, ScriptedTransport([_round(_op("core.boom"))]), tmp_path)

    events = _drain(harness, [entry])

    assert len(ledger.rows) == 1
    assert ledger.rows[0].is_error
    assert ledger.rows[0].error_reason in ERROR_REASONS
    last = events[-1]
    assert isinstance(last, TurnError)
    assert last.detail == "RuntimeError"


def test_a_cli_line_over_the_limit_is_an_engine_error_row(
    catalog: FakeCatalog, ledger: FakeLedger, tmp_path: Path
) -> None:
    harness = _harness(catalog, ledger, _LongLineTransport(), tmp_path)

    events = _drain(harness, [])

    assert [r.error_reason for r in ledger.rows] == ["engine_error"]
    assert isinstance(events[-1], TurnError)
    assert events[-1].reason == "engine_error"


def test_a_stream_closed_after_its_first_event_writes_a_cancelled_row(
    catalog: FakeCatalog, ledger: FakeLedger, tmp_path: Path
) -> None:
    harness = _harness(catalog, ledger, ScriptedTransport([_round("Working.")]), tmp_path)

    async def run() -> None:
        stream = harness.run_turn(CONVERSATION, STATIC, FRAME, [], _ctx(), "go")
        await anext(stream)
        await stream.aclose()  # type: ignore[attr-defined]

    asyncio.run(run())

    assert len(ledger.rows) == 1
    assert ledger.rows[0].is_error
    assert ledger.rows[0].error_reason == "cancelled"


class _FlakyLedger(FakeLedger):
    def __init__(self) -> None:
        super().__init__()
        self.fail_next = True

    def record(self, **kwargs: Any) -> Any:
        if self.fail_next:
            self.fail_next = False
            raise OSError("disk full")
        return super().record(**kwargs)


def test_a_ledger_write_that_failed_can_be_retried() -> None:
    ledger = _FlakyLedger()
    hook = LedgerHook(ledger)
    result = TurnResult(turn_id="turn_000000000001", engine="x", model="m", rounds=1)

    with contextlib.suppress(OSError):
        hook.after_turn(result, conversation=CONVERSATION, origin="core", surface="panel")
    row_id = hook.after_turn(result, conversation=CONVERSATION, origin="core", surface="panel")

    assert row_id is not None
    assert len(ledger.rows) == 1


class _RaisingLedger(FakeLedger):
    """Raises on the first ``failures`` writes (``None``: every write), then records."""

    def __init__(self, failures: int | None = None) -> None:
        super().__init__()
        self.failures = failures
        self.attempts = 0

    def record(self, **kwargs: Any) -> Any:
        self.attempts += 1
        if self.failures is None or self.attempts <= self.failures:
            raise OSError("disk full: secret body")
        return super().record(**kwargs)


def test_a_ledger_that_always_raises_ends_a_successful_turn_in_turn_error(
    catalog: FakeCatalog, tmp_path: Path
) -> None:
    ledger = _RaisingLedger()
    harness = _harness(catalog, ledger, ScriptedTransport([_round("Done.")]), tmp_path)

    events = _drain(harness, [])

    last = events[-1]
    assert isinstance(last, TurnError)
    assert last.reason == "unknown"
    assert "OSError" in last.detail
    assert "secret" not in last.detail
    assert ledger.attempts == 2
    assert not ledger.rows


def test_a_ledger_that_raises_once_still_writes_one_row_and_finishes(
    catalog: FakeCatalog, tmp_path: Path
) -> None:
    ledger = _RaisingLedger(failures=1)
    harness = _harness(catalog, ledger, ScriptedTransport([_round("Done.")]), tmp_path)

    events = _drain(harness, [])

    assert len(ledger.rows) == 1
    assert [type(e).__name__ for e in events[-2:]] == ["TurnSummary", "TurnFinished"]


def test_a_ledger_that_raises_does_not_replace_the_exception_paths_turn_error(
    catalog: FakeCatalog, tmp_path: Path
) -> None:
    def boom(params: dict[str, Any], ctx: TurnContext) -> ExecResult:
        raise RuntimeError("secret body the message quotes")

    entry = catalog.add(make_entry("core.boom", ToolClass.AUTO, executor=boom))
    ledger = _RaisingLedger()
    harness = _harness(catalog, ledger, ScriptedTransport([_round(_op("core.boom"))]), tmp_path)

    events = _drain(harness, [entry])

    last = events[-1]
    assert isinstance(last, TurnError)
    assert last.detail == "RuntimeError"


def test_a_ledger_that_raises_does_not_replace_the_failure_paths_turn_error(
    catalog: FakeCatalog, tmp_path: Path
) -> None:
    ledger = _RaisingLedger()
    harness = _harness(catalog, ledger, _LongLineTransport(), tmp_path)

    events = _drain(harness, [])

    last = events[-1]
    assert isinstance(last, TurnError)
    assert last.reason == "engine_error"


def test_a_closed_stream_with_a_raising_ledger_closes_cleanly(
    catalog: FakeCatalog, tmp_path: Path
) -> None:
    ledger = _RaisingLedger()
    harness = _harness(catalog, ledger, ScriptedTransport([_round("Working.")]), tmp_path)

    async def run() -> None:
        stream = harness.run_turn(CONVERSATION, STATIC, FRAME, [], _ctx(), "go")
        await anext(stream)
        await stream.aclose()  # type: ignore[attr-defined]

    asyncio.run(run())

    assert ledger.attempts == 2


def test_a_raise_in_the_setup_writes_one_unknown_row_and_ends_in_turn_error(
    catalog: FakeCatalog, ledger: FakeLedger, tmp_path: Path
) -> None:
    harness = _harness(catalog, ledger, ScriptedTransport([_round("Done.")]), tmp_path)

    def broken(conversation_id: str, static_text: str) -> None:
        raise KeyError("setup")

    harness._turn_started = broken  # type: ignore[method-assign]

    events = _drain(harness, [])

    assert [r.error_reason for r in ledger.rows] == ["unknown"]
    last = events[-1]
    assert isinstance(last, TurnError)
    assert last.detail == "KeyError"


class _HangingTransport:
    def __init__(self) -> None:
        self.started = asyncio.Event()

    async def run(self, request: CliRequest) -> AsyncIterator[str]:
        yield json.dumps({"type": "system", "session_id": "s"})
        self.started.set()
        await asyncio.sleep(60)


def test_a_cancelled_task_writes_a_cancelled_row_and_propagates(
    catalog: FakeCatalog, ledger: FakeLedger, tmp_path: Path
) -> None:
    transport = _HangingTransport()
    harness = _harness(catalog, ledger, transport, tmp_path)

    async def run() -> None:
        async def turn() -> None:
            async for _ in harness.run_turn(CONVERSATION, STATIC, FRAME, [], _ctx(), "go"):
                pass

        task = asyncio.ensure_future(turn())
        await transport.started.wait()
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
        assert task.cancelled()

    asyncio.run(run())

    assert [r.error_reason for r in ledger.rows] == ["cancelled"]


# -- the turn wall is the turn's (ADR 0115) --------------------------------------------------------


class _DrippingTransport:
    """A CLI that writes a line every 0.3 s and never ends: a per-line wait never fires on it."""

    def __init__(self) -> None:
        self.closed = False

    async def run(self, request: CliRequest) -> AsyncIterator[str]:
        try:
            while True:
                yield json.dumps({"type": "system", "session_id": "s"})
                await asyncio.sleep(0.3)
        finally:
            self.closed = True


def test_a_cli_that_drips_lines_forever_is_stopped_at_the_turn_wall(
    catalog: FakeCatalog, ledger: FakeLedger, tmp_path: Path
) -> None:
    transport = _DrippingTransport()
    harness = _harness(catalog, ledger, transport, tmp_path)
    harness.timeout_s = 1

    async def run() -> list[ChannelEvent]:
        stream = harness.run_turn(CONVERSATION, STATIC, FRAME, [], _ctx(), "go")
        # A wrong build never ends this turn; the outer bound turns that into a failure, not a hang.
        return await asyncio.wait_for(_collect(stream), timeout=5)

    started = time.monotonic()
    events = asyncio.run(run())

    assert time.monotonic() - started < 2
    last = events[-1]
    assert isinstance(last, TurnError)
    assert last.reason == "timeout"
    assert [r.error_reason for r in ledger.rows] == ["timeout"]
    assert transport.closed, "the transport's finally ran: the child is killed and reaped"


class _SlowRounds(ScriptedTransport):
    """Rounds 1 and 2 take 0.4 s each; the rest answer at once."""

    async def run(self, request: CliRequest) -> AsyncIterator[str]:
        if len(self.requests) < 2:
            await asyncio.sleep(0.4)
        async for line in super().run(request):
            yield line


def test_a_later_round_is_asked_with_what_is_left_of_the_turn_not_the_whole_wall(
    catalog: FakeCatalog, ledger: FakeLedger, tmp_path: Path
) -> None:
    # Two dropped ops are told back in the turn, so each of the first two rounds earns another.
    transport = _SlowRounds([_round(_op("a")), _round(_op("b")), _round("Done.")])
    harness = _harness(catalog, ledger, transport, tmp_path)
    harness.timeout_s = 1

    events = _drain(harness, [])

    assert len(transport.requests) == 3, events
    first, _, third = transport.requests
    assert first.timeout_s <= 1
    # 0.8 s of the 1 s wall went on rounds 1 and 2: round 3 has at most what is left.
    assert third.timeout_s <= 0.25
    assert third.timeout_s < first.timeout_s


async def _collect(stream: AsyncIterator[ChannelEvent]) -> list[ChannelEvent]:
    return [event async for event in stream]


def test_two_threads_keep_their_own_walls_and_their_own_told_sets(tmp_path: Path) -> None:
    """A turn locks its thread, not the companion (ADR 0141): two conversations run on two threads
    through one harness, and the later start must not move the earlier turn's wall."""
    import threading

    harness = _harness(FakeCatalog(), FakeLedger(), ScriptedTransport([]), tmp_path)
    seen: dict[str, tuple[float | None, set[tuple[str, str]]]] = {}
    first_set = threading.Event()
    second_set = threading.Event()

    def first() -> None:
        harness._deadline = 100.0
        harness._told.add(("core.recall", "a"))
        first_set.set()
        second_set.wait(5)
        seen["first"] = (harness._deadline, set(harness._told))

    def second() -> None:
        first_set.wait(5)
        harness._deadline = 900.0
        harness._told = set()
        second_set.set()
        seen["second"] = (harness._deadline, set(harness._told))

    threads = [threading.Thread(target=first), threading.Thread(target=second)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(10)
    assert seen["first"] == (100.0, {("core.recall", "a")})
    assert seen["second"] == (900.0, set())

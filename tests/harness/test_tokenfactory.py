"""The ``nebius`` engine: Token Factory behind the same gate and the same row (ADR 0031).

The claims are the ones ADR 0007 makes for the CLIs, now for a function: a Token Factory turn is
one ledger row with ``engine=nebius``, an ``OP:`` line meets the same gate, a gated op files a
card and never runs, and a failure is a row with a reason from the closed set — a 401 among
them, with the key nowhere in what is written down.

Nothing here opens a socket. ``FakeHttp`` stands where ``urllib`` would, replaying the synthetic
reply in ``tests/fixtures/tokenfactory_turn.ndjson`` or one built inline. The one live test at the
bottom is a ``provider`` test and is skipped unless ``NEBIUS_API_KEY`` is set.
"""

from __future__ import annotations

import asyncio
import json
import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest

from athena.contracts.channel import (
    ChannelEvent,
    DecisionRequested,
    TextDelta,
    ToolCall,
    ToolResult,
    TurnError,
    TurnFinished,
    TurnSummary,
)
from athena.contracts.harness import ERROR_REASONS, Harness, PromptBlock
from athena.contracts.registry import ExecResult, Lane, ToolClass, TurnContext
from athena.harness.api_harness import ApiHarness
from athena.harness.engines import build_harness, probe
from athena.harness.hooks import GateHook, LedgerHook, TruncationHook
from athena.harness.ports import ModelChunk, ModelRequest, stream_of
from athena.harness.tokenfactory import (
    DEFAULT_BASE_URL,
    DEFAULT_MODEL,
    HttpReply,
    TokenFactoryModel,
    estimate_cost,
)
from athena.harness.transports import rounds_from_transcript

from .conftest import CONVERSATION, FakeApprovals, FakeCatalog, FakeLedger, make_ctx, make_entry

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
KEY = "nb-secret-key-0123456789"

STATIC = [PromptBlock(name="constitution", text="## The law\n\nYou act for the user.")]
FRAME = [
    PromptBlock(name="frame.host_state", text="## Host state\n\n- tab: invoices", untrusted=True)
]


# --- a fake HTTP layer ---------------------------------------------------------------------------


@dataclass
class Call:
    url: str
    headers: dict[str, str]
    body: dict[str, Any]
    timeout: float


@dataclass
class FakeHttp:
    """Replays one reply per POST, in order. A reply may be an exception to raise instead."""

    replies: list[HttpReply | BaseException]
    calls: list[Call] = field(default_factory=list)

    def __call__(
        self, url: str, headers: Mapping[str, str], body: bytes, timeout: float
    ) -> HttpReply:
        self.calls.append(Call(url, dict(headers), json.loads(body), timeout))
        reply = self.replies[len(self.calls) - 1]
        if isinstance(reply, BaseException):
            raise reply
        return reply


def _ok(content: str, *, prompt: int = 100, completion: int = 20, model: str = "") -> HttpReply:
    body = {
        "id": "chatcmpl-test",
        "object": "chat.completion",
        "model": model or DEFAULT_MODEL,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": prompt, "completion_tokens": completion},
    }
    return HttpReply(200, json.dumps(body).encode("utf-8"))


def _recorded() -> list[HttpReply | BaseException]:
    text = (FIXTURES / "tokenfactory_turn.ndjson").read_text("utf-8")
    return [HttpReply(200, lines[0].encode("utf-8")) for lines in rounds_from_transcript(text)]


def _op(action: str, **params: Any) -> str:
    return "OP: " + json.dumps({"op": "propose_action", "action": action, "params": params})


# --- driving one turn ----------------------------------------------------------------------------


def _harness(
    catalog: FakeCatalog,
    approvals: FakeApprovals,
    ledger: FakeLedger,
    http: FakeHttp,
    *,
    model: str = DEFAULT_MODEL,
    key: str | None = KEY,
) -> ApiHarness:
    harness = build_harness(
        "nebius",
        gate=GateHook(catalog, approvals),
        ledger=LedgerHook(ledger),
        truncation=TruncationHook(),
        prompt_root=".",
        cwd=".",
        model=model,
        model_fn=TokenFactoryModel(model=model, api_key=key, post=http),
    )
    assert isinstance(harness, ApiHarness)
    return harness


def _drain(harness: Harness, tools: Sequence[Any]) -> list[ChannelEvent]:
    ctx = make_ctx(turn_id="turn_000000000001", app_id="invoices", lane=Lane.BROWSER)

    async def run() -> list[ChannelEvent]:
        return [
            event
            async for event in harness.run_turn(
                CONVERSATION, STATIC, FRAME, tools, ctx, "Which invoices are late?"
            )
        ]

    return asyncio.run(run())


# --- a plain turn --------------------------------------------------------------------------------


def test_a_recorded_reply_streams_a_whole_turn_under_engine_nebius(
    catalog: FakeCatalog, approvals: FakeApprovals, ledger: FakeLedger
) -> None:
    http = FakeHttp(_recorded())
    entry = catalog.add(make_entry("host.invoices.chase", ToolClass.AUTO, origin="host:invoices"))
    harness = _harness(catalog, approvals, ledger, http)

    events = _drain(harness, [entry])

    assert isinstance(harness, Harness)
    assert events[0].kind == "text.delta"
    text = next(event for event in events if isinstance(event, TextDelta))
    assert "<think>" not in text.text and "INV-118 is the oldest" not in text.text
    call = next(event for event in events if isinstance(event, ToolCall))
    assert (call.name, call.params) == ("host.invoices.chase", {"invoice": "INV-118"})
    finished = events[-1]
    assert isinstance(finished, TurnFinished)
    assert finished.text == "Three invoices are past thirty days."
    assert finished.tts == "Three invoices are past thirty days."

    assert len(ledger.rows) == 1
    row = ledger.rows[0]
    assert row.is_error is False and row.rounds == 1
    assert row.fields["engine"] == "nebius"
    assert row.fields["model"] == DEFAULT_MODEL
    assert (row.fields["input_tokens"], row.fields["output_tokens"]) == (1840, 96)
    assert row.fields["cost_usd"] == pytest.approx(estimate_cost(DEFAULT_MODEL, 1840, 96))
    assert row.fields["cost_usd"] > 0
    assert row.fields["cost_estimated"] is True
    summary = next(event for event in events if isinstance(event, TurnSummary))
    assert summary.engine == "nebius" and summary.cost_estimated is True


def test_the_request_is_one_chat_completion_with_the_law_as_the_system_prompt(
    catalog: FakeCatalog, approvals: FakeApprovals, ledger: FakeLedger
) -> None:
    http = FakeHttp([_ok("Nothing is late.")])
    _drain(_harness(catalog, approvals, ledger, http), [])

    (call,) = http.calls
    assert call.url == DEFAULT_BASE_URL + "chat/completions"
    assert call.headers["Authorization"] == f"Bearer {KEY}"
    assert call.body["model"] == DEFAULT_MODEL
    assert call.body["stream"] is False
    # The calling convention is the grammar: no provider tools are offered.
    assert "tools" not in call.body
    system, user = call.body["messages"]
    assert system["role"] == "system" and "The law" in system["content"]
    assert user["role"] == "user" and "## Host state" in user["content"]
    assert "The law" not in user["content"]


# --- the gate, from inside a turn ----------------------------------------------------------------


def test_an_auto_op_runs_and_its_result_rides_back_fenced(
    catalog: FakeCatalog, approvals: FakeApprovals, ledger: FakeLedger
) -> None:
    ran: list[int] = []

    def executor(params: dict[str, Any], ctx: TurnContext) -> ExecResult:
        ran.append(int(params["n"]))
        return ExecResult(ok=True, output="step done")

    entry = catalog.add(make_entry("core.step", ToolClass.AUTO, executor=executor))
    http = FakeHttp([_ok(f"Working.\n{_op('core.step', n=1)}"), _ok("All done.")])

    events = _drain(_harness(catalog, approvals, ledger, http), [entry])

    assert ran == [1]
    assert len(http.calls) == 2
    second = http.calls[1].body["messages"]
    assert [message["role"] for message in second] == ["system", "user", "assistant", "user"]
    assert "core.step" in second[2]["content"]
    assert "Results from the tools you just called" in second[3]["content"]
    assert "<<<untrusted:" in second[3]["content"]
    assert len(ledger.rows) == 1
    assert ledger.rows[0].rounds == 2
    assert ledger.rows[0].fields["input_tokens"] == 200
    assert events[-1].kind == "turn.finished"


def test_a_gated_op_files_an_approval_and_never_runs(
    catalog: FakeCatalog, approvals: FakeApprovals, ledger: FakeLedger
) -> None:
    ran: list[str] = []

    def executor(params: dict[str, Any], ctx: TurnContext) -> ExecResult:
        ran.append("yes")
        return ExecResult(ok=True)

    entry = catalog.add(make_entry("core.pay", ToolClass.GATED, executor=executor))
    http = FakeHttp([_ok(f"Proposing.\n{_op('core.pay', amount=40)}")])

    events = _drain(_harness(catalog, approvals, ledger, http), [entry])

    assert ran == []
    assert len(http.calls) == 1
    (row,) = approvals.rows.values()
    assert (row.action, row.params, row.status) == ("core.pay", {"amount": 40}, "pending")
    card = next(event for event in events if isinstance(event, DecisionRequested))
    assert card.id == row.id
    answer = next(event for event in events if isinstance(event, ToolResult))
    assert (answer.ok, answer.error) == (False, "pending_approval")
    assert len(ledger.rows) == 1 and ledger.rows[0].is_error is False


def test_a_native_tool_call_still_meets_the_gate(
    catalog: FakeCatalog, approvals: FakeApprovals, ledger: FakeLedger
) -> None:
    """A provider that answers with ``tool_calls`` anyway is read through the one grammar."""
    ran: list[str] = []
    entry = catalog.add(
        make_entry(
            "core.pay",
            ToolClass.GATED,
            executor=lambda params, ctx: ran.append("yes") or ExecResult(ok=True),
        )
    )
    native = ModelChunk("tool_call", call_id="call_1", name="core.pay", params={"amount": 9})
    harness = ApiHarness(
        gate=GateHook(catalog, approvals),
        ledger=LedgerHook(ledger),
        truncation=TruncationHook(),
        name="nebius",
        model_fn=lambda request: stream_of([native, ModelChunk("done")]),
    )

    events = _drain(harness, [entry])

    assert ran == []
    assert any(isinstance(event, DecisionRequested) for event in events)
    assert len(approvals.rows) == 1


# --- failure -------------------------------------------------------------------------------------


def test_a_timeout_is_one_error_row_with_reason_timeout(
    catalog: FakeCatalog, approvals: FakeApprovals, ledger: FakeLedger
) -> None:
    http = FakeHttp([TimeoutError("timed out")])

    events = _drain(_harness(catalog, approvals, ledger, http), [])

    assert isinstance(events[-1], TurnError)
    assert events[-1].reason == "timeout"
    (row,) = ledger.rows
    assert (row.is_error, row.error_reason) == (True, "timeout")
    assert row.fields["engine"] == "nebius"


def test_a_401_is_engine_error_and_the_key_is_written_nowhere(
    catalog: FakeCatalog, approvals: FakeApprovals, ledger: FakeLedger
) -> None:
    http = FakeHttp([HttpReply(401, b'{"detail": "bad key nb-secret-key-0123456789"}')])
    harness = _harness(catalog, approvals, ledger, http)

    events = _drain(harness, [])

    error = events[-1]
    assert isinstance(error, TurnError)
    assert error.reason == "engine_error"
    assert "401" in error.detail and "NEBIUS_API_KEY" in error.detail
    assert KEY not in error.detail
    (row,) = ledger.rows
    assert (row.is_error, row.error_reason) == (True, "engine_error")
    assert KEY not in json.dumps(row.fields) and KEY not in repr(row)
    assert all(KEY not in json.dumps(event.to_dict()) for event in events)
    assert KEY not in repr(harness) and KEY not in repr(harness.model_fn)


@pytest.mark.parametrize(
    ("reply", "reason"),
    [
        (HttpReply(200, b"<html>not json</html>"), "parse_error"),
        (HttpReply(200, b'{"choices": []}'), "parse_error"),
        (HttpReply(429), "engine_error"),
        (HttpReply(504), "timeout"),
        (OSError("connection refused"), "engine_error"),
    ],
)
def test_every_other_failure_is_a_row_with_a_closed_set_reason(
    reply: HttpReply | BaseException,
    reason: str,
    catalog: FakeCatalog,
    approvals: FakeApprovals,
    ledger: FakeLedger,
) -> None:
    events = _drain(_harness(catalog, approvals, ledger, FakeHttp([reply])), [])

    assert isinstance(events[-1], TurnError)
    assert events[-1].reason == reason
    assert reason in ERROR_REASONS
    assert ledger.rows[0].error_reason == reason


def test_no_key_is_engine_error_and_no_request_is_made(
    catalog: FakeCatalog,
    approvals: FakeApprovals,
    ledger: FakeLedger,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("NEBIUS_API_KEY", raising=False)
    http = FakeHttp([])

    events = _drain(_harness(catalog, approvals, ledger, http, key=None), [])

    assert http.calls == []
    assert isinstance(events[-1], TurnError)
    assert events[-1].reason == "engine_error"
    assert "NEBIUS_API_KEY is not set" in events[-1].detail
    assert ledger.rows[0].is_error is True


# --- cost ----------------------------------------------------------------------------------------


def test_a_model_missing_from_the_price_table_has_its_cost_omitted_not_zero(
    catalog: FakeCatalog, approvals: FakeApprovals, ledger: FakeLedger
) -> None:
    model = "vendor/not-in-the-table"
    http = FakeHttp([_ok("Done.", model=model)])

    events = _drain(_harness(catalog, approvals, ledger, http, model=model), [])

    row = ledger.rows[0]
    assert row.fields["model"] == model
    assert row.fields["cost_usd"] is None
    assert row.fields["cost_estimated"] is False
    assert row.fields["input_tokens"] == 100
    summary = next(event for event in events if isinstance(event, TurnSummary))
    assert summary.cost_usd is None
    assert estimate_cost(model, 100, 20) is None


# --- the engine id -------------------------------------------------------------------------------


def test_nebius_is_available_iff_the_key_is_present() -> None:
    present = probe("nebius", env={"NEBIUS_API_KEY": KEY})
    absent = probe("nebius", env={})
    assert present.available is True and absent.available is False
    assert KEY not in present.detail
    assert "NEBIUS_API_KEY" in absent.detail


def test_the_default_model_is_used_when_none_is_named(
    catalog: FakeCatalog, approvals: FakeApprovals, ledger: FakeLedger
) -> None:
    harness = build_harness(
        "nebius",
        gate=GateHook(catalog, approvals),
        ledger=LedgerHook(ledger),
        truncation=TruncationHook(),
        prompt_root=".",
        cwd=".",
    )
    assert isinstance(harness, ApiHarness)
    assert (harness.name, harness.model) == ("nebius", DEFAULT_MODEL)


def test_athena_serve_builds_the_nebius_engine_behind_the_one_gate(tmp_path: Path) -> None:
    from athena.wiring import build_local

    requests: list[ModelRequest] = []

    def model_fn(request: ModelRequest) -> Any:
        requests.append(request)
        return stream_of([ModelChunk("text", text="hi"), ModelChunk("done")])

    with build_local(
        brain_root=tmp_path / "brain",
        engine="nebius",
        model_fn=model_fn,
        workspace=tmp_path / "engine",
    ) as built:
        assert isinstance(built.harness, ApiHarness)
        assert built.harness.name == "nebius"
        assert built.harness.gate is built.gate
        assert built.daemon.model == DEFAULT_MODEL


# --- live ----------------------------------------------------------------------------------------


@pytest.mark.provider
@pytest.mark.skipif(not os.environ.get("NEBIUS_API_KEY"), reason="NEBIUS_API_KEY is not set")
def test_live_one_turn_against_nemotron_super(
    catalog: FakeCatalog, approvals: FakeApprovals, ledger: FakeLedger
) -> None:
    """One real turn. Costs a fraction of a cent; never runs without the key."""
    harness = build_harness(
        "nebius",
        gate=GateHook(catalog, approvals),
        ledger=LedgerHook(ledger),
        truncation=TruncationHook(),
        prompt_root=".",
        cwd=".",
    )

    events = _drain(harness, [])

    assert events[-1].kind == "turn.finished", events[-1]
    row = ledger.rows[0]
    assert row.fields["engine"] == "nebius"
    assert row.fields["input_tokens"] > 0 and row.fields["output_tokens"] > 0

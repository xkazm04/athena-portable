"""The Claude CLI as a Reader: one Read-only leg per sheet, a fixture fallback, never a guess."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from athena.harness.transports import ScriptedTransport
from athena.senses.backends import FixtureReader
from athena.senses.claude_reader import MODEL_ENV, ClaudeReader, reader_model
from athena.senses.contract import MediaItem, ReadRequest

ITEM = MediaItem(id="sheet-B-1", kind="paper", sense="paper", path="render/sheet-B-1.pdf")


def stream_lines(text: str, cost: float | None = 0.012) -> list[str]:
    result: dict[str, Any] = {
        "type": "result",
        "is_error": False,
        "result": text,
        "usage": {"input_tokens": 1500, "output_tokens": 80},
    }
    if cost is not None:
        result["total_cost_usd"] = cost
    return [
        json.dumps({"type": "system", "session_id": "fake"}),
        json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": text}]}}),
        json.dumps(result),
    ]


@pytest.fixture
def setup(tmp_path: Path) -> tuple[Path, FixtureReader]:
    pdf = tmp_path / "render" / "sheet-B-1.pdf"
    pdf.parent.mkdir()
    pdf.write_bytes(b"%PDF-1.4 fake")
    fixtures = tmp_path / "fixtures"
    fixtures.mkdir()
    (fixtures / "sheet-B-1.json").write_text(
        json.dumps(
            {"reads": [{"attempt": 0, "fields": [{"name": "amount_due_usd", "value": "1"}]}]}
        ),
        encoding="utf-8",
    )
    return pdf, FixtureReader(fixtures)


def request(pdf: Path | None) -> ReadRequest:
    return ReadRequest(ITEM, pdf, ["amount_due_usd", "due_date", "provider"], hint="bill")


def test_one_read_only_leg_reads_the_copied_sheet(setup: tuple[Path, FixtureReader]) -> None:
    pdf, fallback = setup
    answer = {
        "fields": [
            {"name": "amount_due_usd", "value": " $412.00 ", "confidence": 1.4},
            {"name": "due_date", "value": "October 15, 2026", "confidence": 0.9},
            {"name": "ignore_me", "value": "x"},
            {"name": "provider", "value": ""},
        ],
        "unreadable": [],
    }
    transport = ScriptedTransport([stream_lines(json.dumps(answer))])
    reader = ClaudeReader(fallback=fallback, transport=transport, environ={})
    reading, call = reader.read(request(pdf))
    assert [(f.name, f.value, f.confidence) for f in reading.fields] == [
        ("amount_due_usd", "$412.00", 1.0),
        ("due_date", "October 15, 2026", 0.9),
    ]
    assert reading.unreadable == ("provider",)
    prov = reading.fields[0].provenance
    assert prov.media_id == "sheet-B-1" and prov.frame == 0 and prov.box is None
    assert call.backend == "claude" and call.model == "claude-sonnet-5-5"
    assert call.cost_usd == 0.012 and call.cost_estimated and call.unit == "token"
    assert call.units == 1580 and call.mode == "standard"
    sent = transport.requests[0]
    assert sent.argv[sent.argv.index("--tools") + 1] == "Read"
    assert sent.argv[sent.argv.index("--model") + 1] == "claude-sonnet-5-5"
    assert "Read the file sheet.pdf" in sent.stdin and "due_date (Payment due)" in sent.stdin
    assert Path(sent.cwd) != pdf.parent  # a temp dir of its own, holding a copy


def test_no_file_or_no_cli_falls_back_to_the_fixture(setup: tuple[Path, FixtureReader]) -> None:
    pdf, fallback = setup
    no_cli = ClaudeReader(fallback=fallback, which=lambda name: None, environ={})
    for reader, req in ((no_cli, request(pdf)), (ClaudeReader(fallback=fallback), request(None))):
        reading, call = reader.read(req)
        assert call.backend == "fixture" and reading.fields[0].value == "1"


def test_a_failed_leg_reads_nothing_and_is_still_a_claude_call(
    setup: tuple[Path, FixtureReader],
) -> None:
    pdf, fallback = setup
    transport = ScriptedTransport([stream_lines("no json", None), stream_lines("still none", None)])
    reading, call = ClaudeReader(fallback=fallback, transport=transport, environ={}).read(
        request(pdf)
    )
    assert reading.fields == () and reading.unreadable == ("amount_due_usd", "due_date", "provider")
    assert call.backend == "claude" and call.cost_usd is None and call.cost_estimated


def test_a_field_named_unreadable_is_not_also_read(setup: tuple[Path, FixtureReader]) -> None:
    pdf, fallback = setup
    answer = {
        "fields": [{"name": "due_date", "value": "?", "confidence": 0.2}],
        "unreadable": ["due_date"],
    }
    transport = ScriptedTransport([stream_lines(json.dumps(answer))])
    reading, _ = ClaudeReader(fallback=fallback, transport=transport, environ={}).read(request(pdf))
    assert reading.fields == () and "due_date" in reading.unreadable


def test_the_model_env_names_a_claude_5_5_model() -> None:
    assert reader_model({}) == "claude-sonnet-5-5"
    assert reader_model({MODEL_ENV: "haiku"}) == "claude-haiku-5-5"
    assert reader_model({MODEL_ENV: "claude-opus-5-5"}) == "claude-opus-5-5"
    with pytest.raises(ValueError, match=MODEL_ENV):
        reader_model({MODEL_ENV: "gpt-5"})

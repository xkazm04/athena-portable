"""The run ledger is read through one tolerant row reader: run_spend, replay and cancelled_report
all survive undecodable bytes, blank lines, non-JSON lines and non-object rows."""

from __future__ import annotations

import json
from pathlib import Path

from athena.proving.server.runner import Runner, cancelled_report, run_spend


def _ledger(run_dir: Path) -> None:
    run_dir.mkdir(parents=True)
    good = json.dumps({"engine": "nebius", "cost_usd": 0.5})
    other = json.dumps({"engine": "anthropic", "cost_usd": 0.25})
    raw = (
        good.encode()
        + b"\n\n"
        + b"not json at all\n"
        + b"[1, 2, 3]\n"
        + b'{"engine": "nebius", "excerpt": "\xff\xfe"}\n'
        + other.encode()
        + b"\n"
    )
    (run_dir / "ledger.jsonl").write_bytes(raw)


def test_ledger_with_bad_bytes_is_read_by_every_reader(tmp_path: Path) -> None:
    run_dir = tmp_path / "20260101-000000"
    _ledger(run_dir)

    spent = run_spend(run_dir)
    assert spent["nemotron"] == 0.5
    assert spent["claude"] == 0.25

    runner = Runner(tmp_path / "runs", environ={})
    frames = list(runner.replay(run_dir))
    # three dict rows (the third has an undecodable excerpt) plus the closing end frame
    assert sum(1 for frame in frames if "event: call" in frame) == 3
    assert "event: end" in frames[-1]

    report = cancelled_report("prototype", run_dir, "2026-01-01T00:00:00Z")
    assert report["cancelled"] is True
    assert report["calls"] == 5  # non-blank lines, as before
    assert report["cost_usd"]["nemotron"] == 0.5
    assert report["cost_usd"]["claude"] == 0.25

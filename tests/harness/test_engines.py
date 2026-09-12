"""An engine probe answers a setup screen, so it never raises (ADR 0007).

Every test here is a machine the demo could be run on: one with no CLI installed, one with a CLI
that answers, one with a CLI that fails, one whose binary hangs. On all four, ``probe`` returns a
status a person can read.
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

import pytest

from athena.harness.cli_harness import CLAUDE_EXTRA_ARGS, CliHarness
from athena.harness.engines import ENGINES, EngineStatus, build_harness, probe, probe_all
from athena.harness.hooks import GateHook, LedgerHook, TruncationHook
from athena.harness.transports import SubprocessTransport

from .conftest import FakeApprovals, FakeCatalog, FakeLedger


class _Completed:
    def __init__(self, returncode: int, stdout: str = "", stderr: str = "") -> None:
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


@pytest.fixture
def on_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("athena.harness.engines.shutil.which", lambda binary: f"/usr/bin/{binary}")


def test_the_two_engines_are_the_two_dialects() -> None:
    assert ENGINES == ("claude_code", "codex")


def test_an_unknown_engine_is_a_status_and_not_an_exception() -> None:
    status = probe("gpt-in-a-box")
    assert isinstance(status, EngineStatus)
    assert status.available is False
    assert "claude_code" in status.detail


def test_a_binary_that_is_not_on_path_is_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("athena.harness.engines.shutil.which", lambda binary: None)
    status = probe("claude_code")
    assert status.available is False
    assert status.detail == "claude is not on PATH"
    assert status.logged_in is None


def test_a_binary_that_answers_is_available_with_its_version(
    on_path: None, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(
        "athena.harness.engines.subprocess.run",
        lambda *a, **k: _Completed(0, stdout="2.1.7 (Claude Code)\n"),
    )
    status = probe("claude_code", home=tmp_path)
    assert status.available is True
    assert status.version == "2.1.7 (Claude Code)"
    assert status.logged_in is False


def test_a_credential_file_where_the_cli_writes_one_is_the_logged_in_signal(
    on_path: None, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(
        "athena.harness.engines.subprocess.run", lambda *a, **k: _Completed(0, stdout="2.1.7")
    )
    (tmp_path / ".claude").mkdir()
    (tmp_path / ".claude" / ".credentials.json").write_text("{}", encoding="utf-8")
    assert probe("claude_code", home=tmp_path).logged_in is True
    # Nothing is read: the file's existence is the whole signal, its contents are a secret.
    assert probe("codex", home=tmp_path).logged_in is False


def test_a_binary_that_exits_non_zero_is_unavailable(
    on_path: None, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(
        "athena.harness.engines.subprocess.run", lambda *a, **k: _Completed(127, stderr="nope")
    )
    status = probe("codex", home=tmp_path)
    assert status.available is False
    assert "exited 127" in status.detail


def test_a_binary_that_hangs_is_unavailable_and_does_not_raise(
    on_path: None, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    def hang(*args: Any, **kwargs: Any) -> Any:
        raise subprocess.TimeoutExpired(cmd="claude", timeout=20)

    monkeypatch.setattr("athena.harness.engines.subprocess.run", hang)
    status = probe("claude_code", home=tmp_path)
    assert status.available is False
    assert "TimeoutExpired" in status.detail


def test_probe_all_answers_for_every_engine(
    on_path: None, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(
        "athena.harness.engines.subprocess.run", lambda *a, **k: _Completed(0, stdout="1.0")
    )
    statuses = probe_all(home=tmp_path)
    assert [status.name for status in statuses] == list(ENGINES)
    assert all(status.available for status in statuses)


# --- building ---------------------------------------------------------------------------------


def _hooks() -> tuple[GateHook, LedgerHook, TruncationHook]:
    ledger = LedgerHook(FakeLedger())
    return GateHook(FakeCatalog(), FakeApprovals()), ledger, TruncationHook(ledger)


def test_building_an_engine_binds_the_gate_it_was_handed(tmp_path: Path) -> None:
    """ADR 0007: an engine cannot bring its own policy, because it is handed one."""
    gate, ledger, truncation = _hooks()
    harness = build_harness(
        "claude_code",
        gate=gate,
        ledger=ledger,
        truncation=truncation,
        prompt_root=str(tmp_path),
        cwd=str(tmp_path),
    )
    assert isinstance(harness, CliHarness)
    assert harness.gate is gate
    assert harness.ledger is ledger
    assert harness.extra_args == CLAUDE_EXTRA_ARGS
    assert isinstance(harness.transport, SubprocessTransport)
    assert harness.transport.executable == "claude"


def test_the_other_engine_is_the_same_harness_with_another_dialect(tmp_path: Path) -> None:
    gate, ledger, truncation = _hooks()
    harness = build_harness(
        "codex",
        gate=gate,
        ledger=ledger,
        truncation=truncation,
        prompt_root=str(tmp_path),
        cwd=str(tmp_path),
    )
    assert isinstance(harness, CliHarness)
    assert harness.name == "codex"
    assert harness.extra_args == ()
    assert harness.dialect.system_on_stdin is True


def test_building_an_unknown_engine_refuses_by_name(tmp_path: Path) -> None:
    gate, ledger, truncation = _hooks()
    with pytest.raises(ValueError, match="unknown engine"):
        build_harness(
            "telepathy",
            gate=gate,
            ledger=ledger,
            truncation=truncation,
            prompt_root=str(tmp_path),
            cwd=str(tmp_path),
        )

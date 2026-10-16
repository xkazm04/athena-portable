"""An engine probe answers a setup screen, so it never raises (ADR 0007).

Every test here is a machine the demo could be run on: one with no CLI installed, one with a CLI
that answers, one with a CLI that fails, one whose binary hangs. On all four, ``probe`` returns a
status a person can read.
"""

from __future__ import annotations

import os
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


def test_the_engines_are_the_two_dialects_and_token_factory() -> None:
    assert ENGINES == ("claude_code", "codex", "nebius")


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


def test_below_the_dated_floor_a_credential_file_is_still_the_cheap_signal(
    on_path: None, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    calls: list[list[str]] = []

    def run(argv: list[str], **kwargs: Any) -> _Completed:
        calls.append(argv)
        return _Completed(0, stdout="2.1.7" if argv[0].endswith("claude") else "codex-cli 0.150.2")

    monkeypatch.setattr("athena.harness.engines.subprocess.run", run)
    (tmp_path / ".claude").mkdir()
    (tmp_path / ".claude" / ".credentials.json").write_text("{}", encoding="utf-8")
    assert probe("claude_code", home=tmp_path).logged_in is True
    # Nothing is read: the file's existence is the whole signal, its contents are a secret.
    assert probe("codex", home=tmp_path).logged_in is False
    # A CLI older than the version its sign-in check was verified on is never asked for one: a
    # CLI that does not know the subcommand could take it for a prompt.
    assert [argv[1:] for argv in calls] == [["--version"], ["--version"]]


# --- the CLI's own sign-in check (availability-probe: a file's existence proves nothing) ------


def _cli(
    monkeypatch: pytest.MonkeyPatch, version: str, status: _Completed | Exception
) -> list[tuple[list[str], dict[str, Any]]]:
    """``subprocess.run`` for a CLI at ``version`` whose sign-in check answers ``status``."""
    calls: list[tuple[list[str], dict[str, Any]]] = []

    def run(argv: list[str], **kwargs: Any) -> _Completed:
        calls.append((argv, kwargs))
        if argv[1:] == ["--version"]:
            return _Completed(0, stdout=version)
        if isinstance(status, Exception):
            raise status
        return status

    monkeypatch.setattr("athena.harness.engines.subprocess.run", run)
    return calls


def test_a_credential_file_the_cli_says_is_signed_out_is_not_logged_in(
    on_path: None, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    (tmp_path / ".claude").mkdir()
    (tmp_path / ".claude" / ".credentials.json").write_text("{}", encoding="utf-8")
    _cli(monkeypatch, "2.1.301 (Claude Code)", _Completed(1, stdout='{"loggedIn": false}'))

    status = probe("claude_code", home=tmp_path)

    assert status.available is True
    assert status.logged_in is False


def test_a_cli_that_says_it_is_signed_in_is_logged_in_with_no_file_at_all(
    on_path: None, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _cli(
        monkeypatch,
        "2.1.301 (Claude Code)",
        _Completed(0, stdout='{"loggedIn": true, "authMethod": "claude.ai"}'),
    )
    assert probe("claude_code", home=tmp_path).logged_in is True


def test_codex_reads_its_login_status_both_ways(
    on_path: None, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    (tmp_path / ".codex").mkdir()
    (tmp_path / ".codex" / "auth.json").write_text("{}", encoding="utf-8")
    _cli(monkeypatch, "codex-cli 0.160.0", _Completed(1, stderr="Not logged in\n"))
    assert probe("codex", home=tmp_path).logged_in is False

    _cli(monkeypatch, "codex-cli 0.160.0", _Completed(0, stdout="Logged in using ChatGPT\n"))
    assert probe("codex", home=tmp_path).logged_in is True


@pytest.mark.parametrize(
    "answer",
    [
        _Completed(0, stdout="not json"),
        _Completed(0, stdout='{"loggedIn": "yes"}'),
        _Completed(2, stderr="something else went wrong"),
        subprocess.TimeoutExpired(cmd="claude", timeout=20),
        OSError("gone"),
    ],
)
def test_a_sign_in_check_that_cannot_be_read_is_unknown_never_yes(
    on_path: None, monkeypatch: pytest.MonkeyPatch, tmp_path: Path, answer: Any
) -> None:
    (tmp_path / ".claude").mkdir()
    (tmp_path / ".claude" / ".credentials.json").write_text("{}", encoding="utf-8")
    _cli(monkeypatch, "2.1.301 (Claude Code)", answer)

    status = probe("claude_code", home=tmp_path)

    assert status.available is True
    assert status.logged_in is None


def test_every_probe_spawn_opens_no_console_window_like_a_turns_spawn(
    on_path: None, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """The daemon is a windowless sidecar: a console child it starts flashes a window on Windows.

    The turn's spawn says so and passes ``CREATE_NO_WINDOW``; the probe is the same kind of child,
    started by the same process, every time setup's Check again is pressed.
    """
    from athena.harness.transports import NO_WINDOW

    calls = _cli(monkeypatch, "2.1.301 (Claude Code)", _Completed(0, stdout='{"loggedIn": true}'))

    probe("claude_code", home=tmp_path)

    assert len(calls) == 2
    assert [kwargs.get("creationflags") for _, kwargs in calls] == [NO_WINDOW, NO_WINDOW]
    expected = 0x08000000 if os.name == "nt" else 0
    assert expected == NO_WINDOW


def test_the_sign_in_check_runs_in_the_environment_the_spawn_builds(
    on_path: None, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """The CLI reports its auth from the environment it is handed; the turn's door strips keys."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-host")
    monkeypatch.setenv("ATHENA_TEST_KEPT", "1")
    calls = _cli(monkeypatch, "2.1.301 (Claude Code)", _Completed(0, stdout='{"loggedIn": true}'))

    probe("claude_code", home=tmp_path)

    argv, kwargs = calls[-1]
    assert argv == ["/usr/bin/claude", "auth", "status", "--json"]
    assert kwargs["stdin"] is subprocess.DEVNULL
    assert "ANTHROPIC_API_KEY" not in kwargs["env"]
    assert kwargs["env"]["ATHENA_TEST_KEPT"] == "1"


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
    statuses = probe_all(home=tmp_path, env={"NEBIUS_API_KEY": "nb-test"})
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

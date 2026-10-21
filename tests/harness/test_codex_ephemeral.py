"""A codex turn is never resumed, so it must not leave its prompt in the CLI's session files."""

from __future__ import annotations

from athena.harness.cli_harness import CODEX


def test_codex_argv_is_ephemeral_and_reads_stdin() -> None:
    argv = CODEX.argv(prompt_file=None, model="", resume=None, extra_args=[])

    assert "--ephemeral" in argv
    assert argv[-1] == "-"


def test_codex_argv_keeps_model_and_extra_args_in_order() -> None:
    argv = CODEX.argv(prompt_file=None, model="gpt-x", resume=None, extra_args=["--a", "--b"])

    assert "--ephemeral" in argv
    assert argv.index("-m") + 1 == argv.index("gpt-x")
    assert argv[argv.index("gpt-x") + 1 :] == ["--a", "--b", "-"]

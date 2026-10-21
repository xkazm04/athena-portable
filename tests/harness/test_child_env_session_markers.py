"""A parent Claude Code session's identity does not reach a CLI child; its configuration does."""

from athena.harness.transports import ENGINE_KEYS, SESSION_MARKERS, child_env

MARKERS = (
    "CLAUDECODE",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_MESSAGING_SOCKET",
    "CLAUDE_CODE_MESSAGING_TOKEN",
)
CONFIG = {"CLAUDE_CODE_OAUTH_TOKEN": "tok", "CLAUDE_CODE_GIT_BASH_PATH": "C:/git/bash.exe"}


def test_markers_are_exactly_the_five_observed() -> None:
    assert set(SESSION_MARKERS) == set(MARKERS)
    assert not set(SESSION_MARKERS) & {n for names in ENGINE_KEYS.values() for n in names}


def test_markers_are_stripped_and_configuration_kept() -> None:
    base = {name: "x" for name in MARKERS} | CONFIG | {"PATH": "/bin"}
    env = child_env(base)
    assert not set(MARKERS) & set(env)
    assert env == {**CONFIG, "PATH": "/bin"}


def test_markers_are_stripped_in_any_case_and_from_extra() -> None:
    env = child_env(
        {"claudecode": "1", "Claude_Code_Session_Id": "s", "PATH": "/bin"},
        {
            "CLAUDE_CODE_MESSAGING_TOKEN": "t",
            "claude_code_child_session": "1",
            "CLAUDE_CODE_OAUTH_TOKEN": "tok",
        },
    )
    assert env == {"PATH": "/bin", "CLAUDE_CODE_OAUTH_TOKEN": "tok"}

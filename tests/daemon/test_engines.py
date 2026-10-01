"""``GET /engines``: what this machine can run, in a person's words (README §3.1; ADR 0003/0011)."""

from __future__ import annotations

import stat
import sys
import threading
from pathlib import Path

from athena.daemon.server import AthenaDaemon

from .conftest import Live


def _fake_binary(tmp_path: Path, name: str) -> str:
    if sys.platform == "win32":
        path = tmp_path / f"{name}.cmd"
        path.write_text("@echo off\r\necho fake 1.2.3\r\n", encoding="utf-8")
    else:
        path = tmp_path / name
        path.write_text("#!/bin/sh\necho fake 1.2.3\n", encoding="utf-8")
        path.chmod(path.stat().st_mode | stat.S_IEXEC)
    return str(path)


def test_engines_needs_the_token(live: Live) -> None:
    assert live.request("/engines", token=None).status == 401
    assert live.request("/engines", token="wrong").status == 401


def test_a_missing_binary_is_not_found_and_a_present_one_is_found(
    live: Live, tmp_path: Path
) -> None:
    live.daemon.engine_executables = {
        "claude_code": str(tmp_path / "no-such-binary"),
        "codex": _fake_binary(tmp_path, "codex"),
    }

    reply = live.request("/engines?fresh=1")

    assert reply.status == 200
    assert reply.body["ok"] is True
    rows = {row["id"]: row for row in reply.body["engines"]}
    assert set(rows) == {"claude_code", "codex"}
    assert rows["claude_code"]["state"] == "not_found"
    assert rows["claude_code"]["detail"]
    assert rows["codex"]["state"] in ("found", "not_logged_in")
    assert set(rows["codex"]) == {"id", "state", "detail"}


def test_the_answer_is_cached_until_fresh_is_asked_for(live: Live, tmp_path: Path) -> None:
    live.daemon.engine_executables = {
        "claude_code": str(tmp_path / "x"),
        "codex": str(tmp_path / "y"),
    }
    first = live.request("/engines?fresh=1").body["engines"]
    live.daemon.engine_executables = {
        "claude_code": _fake_binary(tmp_path, "claude"),
        "codex": _fake_binary(tmp_path, "codex"),
    }

    cached = live.request("/engines").body["engines"]
    fresh = live.request("/engines?fresh=1").body["engines"]

    assert cached == first
    assert {row["state"] for row in fresh} != {"not_found"}


def test_the_probe_does_not_hold_the_writer_lock(daemon: AthenaDaemon, tmp_path: Path) -> None:
    daemon.engine_executables = {"claude_code": str(tmp_path / "x"), "codex": str(tmp_path / "y")}
    done = threading.Event()

    def probe() -> None:
        daemon.engine_rows(fresh=True)
        done.set()

    with daemon.writing():
        thread = threading.Thread(target=probe)
        thread.start()
        assert done.wait(10), "the engine probe waited on the writer lock"
    thread.join()

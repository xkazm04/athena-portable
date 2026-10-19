"""The minted token file is created owner-only, never chmod-ed after the fact.

daemon/server.py ``resolve_token``, README 3.5. The window the old code left (``write_text`` at the
umask's mode, then ``chmod``) exists only on POSIX, so the test records the mode the file is
*created* with rather than stat-ing it, which a Windows build machine could not tell apart.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from athena.daemon.server import resolve_token


def test_the_token_file_is_created_owner_only_and_holds_the_token(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    created: list[tuple[str, int]] = []
    real_open = os.open

    def recording_open(path: str | os.PathLike[str], flags: int, mode: int = 0o777) -> int:
        created.append((os.fspath(path), mode))
        return real_open(path, flags, mode)

    monkeypatch.setattr(os, "open", recording_open)
    target = tmp_path / "daemon.json"

    token, where = resolve_token("", str(target))

    assert where == str(target)
    assert json.loads(target.read_text(encoding="utf-8")) == {"token": token}
    assert created, "the token file was not created through os.open"
    assert all(mode == 0o600 for _, mode in created)
    assert resolve_token("", str(target)) == (token, str(target))
    assert [p.name for p in tmp_path.iterdir()] == ["daemon.json"]

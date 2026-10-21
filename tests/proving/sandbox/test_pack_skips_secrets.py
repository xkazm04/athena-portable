"""``pack`` leaves env files and ``.git`` out of the tarball sent to the sandbox VM."""

from __future__ import annotations

import io
import tarfile
from pathlib import Path

from athena.proving.sandbox.__main__ import pack


def _names(blob: bytes) -> set[str]:
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as archive:
        return {m.name for m in archive.getmembers() if m.isfile()}


def test_pack_lists_only_source_files(tmp_path: Path) -> None:
    app = tmp_path / "examples" / "ledgerbox"
    app.mkdir(parents=True)
    (app / "page.tsx").write_text("export {}", encoding="utf-8")
    (app / ".env").write_text("KEY=1", encoding="utf-8")
    (app / ".env.local").write_text("KEY=2", encoding="utf-8")
    (app / ".env.example").write_text("KEY=", encoding="utf-8")
    (app / ".git").mkdir()
    (app / ".git" / "config").write_text("[core]", encoding="utf-8")
    (tmp_path / ".env").write_text("ROOT=1", encoding="utf-8")
    (tmp_path / "README.md").write_text("hi", encoding="utf-8")

    blob = pack(tmp_path, ("examples/ledgerbox", "README.md", ".env"))

    assert _names(blob) == {
        "examples/ledgerbox/page.tsx",
        "examples/ledgerbox/.env.example",
        "README.md",
    }

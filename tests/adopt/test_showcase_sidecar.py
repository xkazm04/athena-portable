"""The frozen daemon carries what the studio reads (ADR 0097): every playbook's JSON, the
library's taxonomy and the tiers — and none of the stills, films or recorded benches."""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path
from types import ModuleType

REPO = Path(__file__).resolve().parents[2]


def build_script() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "build_sidecar", REPO / "scripts" / "build-sidecar.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_sidecar_ships_the_playbook_json_and_the_tiers() -> None:
    script = build_script()
    shipped = {(src.relative_to(REPO).as_posix(), dest) for src, dest in script.data_files()}

    playbooks = [p for p in (REPO / "playbooks").iterdir() if (p / "playbook.json").is_file()]
    assert playbooks
    for book in playbooks:
        for name in ("playbook.json", "world.json", "truth.json"):
            assert (f"playbooks/{book.name}/{name}", f"playbooks/{book.name}") in shipped
    assert ("playbooks/taxonomy.json", "playbooks") in shipped
    assert ("src/athena/adopt/tiers.json", "athena/adopt") in shipped
    assert not any(
        src.endswith((".jpg", ".png", ".webm", ".mp4", "bench.json", "evidence.json"))
        for src, _ in shipped
    )


def test_every_shipped_file_becomes_one_add_data_argument() -> None:
    script = build_script()
    args = script.add_data_args()
    pairs = args[1::2]
    assert args[0::2] == ["--add-data"] * len(pairs)
    assert pairs[0].endswith(f"constitution{os.pathsep}constitution")
    assert len(pairs) == 1 + len(script.data_files())

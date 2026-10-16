"""The frozen daemon carries the package data its modules read (README §3.1; ADR 0015, 0021).

A module that reads a file beside itself (``Path(__file__).parent / ...``) reads, in a one-file
binary, ``_MEIPASS/athena/<package>/...``, which holds only what ``scripts/build-sidecar.py``
passed as ``--add-data``. Nothing fails at build time when a file is left out: the source checkout
has it, so every test run from source passes, and only the shipped daemon goes without. So the
ground truth here is the package tree itself, not the script's list, and the layout is laid out
on disk the way the binary unpacks it and read through the real loader.
"""

from __future__ import annotations

import importlib.util
import shutil
from pathlib import Path
from types import ModuleType

from athena.connectors.spec import BUILTIN_DIR, load_builtin

REPO = Path(__file__).resolve().parents[1]
PACKAGE = REPO / "src" / "athena"

#: Package data the daemon never reads: the adopt tier bench's scenarios and the hosted proving
#: server's page belong to ``python -m athena.proving...``, which the sidecar cannot run.
NOT_THE_DAEMONS = ("proving",)


def build_script() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "build_sidecar", REPO / "scripts" / "build-sidecar.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def package_data() -> set[tuple[str, str]]:
    """Every non-Python file in the daemon's packages under ``src/athena``, with its bundle dir."""
    found: set[tuple[str, str]] = set()
    for path in PACKAGE.rglob("*"):
        rel = path.relative_to(PACKAGE)
        if not path.is_file() or path.suffix in {".py", ".pyc", ".pyi", ".typed"}:
            continue
        if "__pycache__" in rel.parts or rel.parts[0] in NOT_THE_DAEMONS:
            continue
        found.add((path.relative_to(REPO).as_posix(), (Path("athena") / rel.parent).as_posix()))
    return found


def frozen_layout(script: ModuleType, into: Path) -> Path:
    """The data files laid out the way ``--add-data`` unpacks them under ``_MEIPASS``."""
    for source, dest in script.data_files():
        target = into / dest
        target.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target / source.name)
    return into


def test_every_package_data_file_the_daemon_reads_ships() -> None:
    shipped = {
        (src.relative_to(REPO).as_posix(), dest) for src, dest in build_script().data_files()
    }
    expected = package_data()
    assert expected, "the scan found no package data at all: the scan is broken"
    assert sorted(expected - shipped) == []


def test_the_frozen_layout_loads_the_same_builtin_connectors_as_source(tmp_path: Path) -> None:
    from_source = load_builtin()
    assert set(from_source) >= {"gmail", "notion"}
    layout = frozen_layout(build_script(), tmp_path)
    frozen = load_builtin(layout / BUILTIN_DIR.relative_to(REPO / "src"))
    assert sorted(frozen) == sorted(from_source)


def test_nothing_from_the_proving_ground_ships() -> None:
    shipped = [src.relative_to(REPO).as_posix() for src, _ in build_script().data_files()]
    assert not [s for s in shipped if s.startswith("src/athena/proving/")]

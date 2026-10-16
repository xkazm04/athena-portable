"""The scaffold holds: the package imports and declares a version (README §7)."""

from __future__ import annotations

import tomllib
from pathlib import Path

import athena


def test_package_imports_and_has_a_version() -> None:
    assert isinstance(athena.__version__, str)
    assert athena.__version__.count(".") >= 2


def test_the_version_the_cli_prints_is_the_one_the_package_ships_as() -> None:
    """``athena --version`` prints ``__version__``; the installed package's metadata says
    ``pyproject.toml``'s. Two hand-kept copies of one number, so a release that bumps one is an
    install that reports the other."""
    pyproject = Path(__file__).resolve().parents[1] / "pyproject.toml"
    with pyproject.open("rb") as handle:
        shipped = tomllib.load(handle)["project"]["version"]

    assert athena.__version__ == shipped

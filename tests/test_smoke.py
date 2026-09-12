"""The scaffold holds: the package imports and declares a version (README §7)."""

from __future__ import annotations

import athena


def test_package_imports_and_has_a_version() -> None:
    assert isinstance(athena.__version__, str)
    assert athena.__version__.count(".") >= 2

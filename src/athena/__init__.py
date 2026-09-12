"""Athena Portable — the package root (README §3.1).

Importing this package pulls in nothing but the standard library, and nothing at all from the
subpackages: `core`, `harness`, `lane`, `daemon` and `channels` are imported by the module that
needs them, so a machine with only Python can read and write a brain.
"""

from __future__ import annotations

__version__ = "0.1.0"

__all__ = ["__version__"]

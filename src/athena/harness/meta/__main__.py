"""``python -m athena.harness.meta probe [--out <dir>]``: the day-1 probe (spike 00 piece 6)."""

from __future__ import annotations

import sys

from athena.harness.meta.probe import main

if __name__ == "__main__":
    sys.exit(main())

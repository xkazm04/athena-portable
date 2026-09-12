"""The frozen daemon's ``__main__`` (README §3.1, surfaces; ADR 0015).

The whole binary *is* ``athena serve``. Whatever the shell puts on the command line is appended
to that subcommand, so the spawn line reads the same frozen as it does typed::

    athena-daemon --port 0 --token-file <path> --brain <dir> --allow-origin tauri://localhost

The subcommand is **prepended, not accepted**. A sidecar that took a subcommand could be pointed
at ``doctor`` or ``brain reconcile`` by whatever spawned it; this one has one verb and no way to
reach the others. A leading ``serve`` is tolerated so the argv above can also be typed by hand.

This file is never imported by the package. It exists only as the program PyInstaller freezes,
which is why it lives in ``scripts/`` and not under ``src/athena/``.
"""

from __future__ import annotations

import multiprocessing
import sys


def main() -> int:
    # A frozen program that ever forks must call this first, or the child re-runs the whole
    # bootstrap instead of the function it was asked for. Today's daemon does not fork; the cost
    # of being wrong about that later is a fork bomb, and the cost of the line is nothing.
    multiprocessing.freeze_support()

    from athena.cli import main as cli_main

    argv = list(sys.argv[1:])
    if argv and argv[0] == "serve":
        argv = argv[1:]
    return cli_main(["serve", *argv])


if __name__ == "__main__":
    sys.exit(main())

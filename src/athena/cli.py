"""The command line, which is mostly "start the daemon and say where it is" (README §3.1).

The shell runs this as a sidecar and has to learn two things the moment it starts: which port was
bound and which token to present. Both are printed as one JSON line on stdout before anything else
is written, and the line is flushed, because a shell that parses a buffered handshake is a shell
that waits for a buffer nobody will fill.

``--port 0`` is the default on purpose. A fixed port is a second copy of Athena refusing to start
because the first one is still running, and on a demo machine that failure arrives at the worst
possible moment; binding zero means the shell is told a port that is free right now.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import signal
import sys
import threading
from collections.abc import Sequence
from pathlib import Path
from types import FrameType

from athena.harness.cli_harness import CLAUDE
from athena.harness.engines import ENGINES
from athena.wiring import Assembly, Config, assemble

__all__ = ["main", "serve"]

#: What the shell reads from stdout to learn where the daemon is. One line, then normal output.
HANDSHAKE = "athena.daemon"


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="athena", description="Athena's daemon and probes.")
    sub = parser.add_subparsers(dest="command", required=True)

    serve_cmd = sub.add_parser("serve", help="start the daemon and print its handshake")
    serve_cmd.add_argument("--brain", type=Path, default=None, help="brain directory")
    serve_cmd.add_argument("--work", type=Path, default=None, help="scratch directory")
    serve_cmd.add_argument("--engine", default=CLAUDE.name, help=f"one of {', '.join(ENGINES)}")
    serve_cmd.add_argument("--model", default="", help="model id the engine should use")
    serve_cmd.add_argument("--host", default="127.0.0.1")
    serve_cmd.add_argument("--port", type=int, default=0, help="0 binds a free port")
    serve_cmd.add_argument("--token", default=None, help="use this token instead of a fresh one")

    sub.add_parser("probe", help="report which engines are usable here")
    return parser


def serve(config: Config, *, ready: threading.Event | None = None) -> Assembly:
    """Assemble, start, and print the handshake. Returns without blocking."""
    assembly = assemble(config)
    assembly.daemon.start()
    _handshake(assembly)
    if ready is not None:
        ready.set()
    return assembly


def _handshake(assembly: Assembly) -> None:
    sys.stdout.write(
        json.dumps(
            {
                "kind": HANDSHAKE,
                "url": assembly.daemon.url,
                "port": assembly.daemon.port,
                "token": assembly.daemon.token,
                "version": assembly.config.version,
                "pid": _pid(),
            }
        )
        + "\n"
    )
    sys.stdout.flush()


def _pid() -> int:
    import os

    return os.getpid()


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)

    if args.command == "probe":
        from athena.harness.engines import probe_all

        for status in probe_all():
            mark = "ok " if status.available else "no "
            print(f"{mark}{status.name:8} {status.detail}")
        return 0

    assembly = serve(
        Config(
            brain_root=args.brain,
            work_root=args.work,
            engine=args.engine,
            model=args.model,
            host=args.host,
            port=args.port,
            token=args.token,
        )
    )

    stopping = threading.Event()

    def _stop(signum: int, frame: FrameType | None) -> None:
        stopping.set()

    for name in ("SIGINT", "SIGTERM", "SIGBREAK"):
        received = getattr(signal, name, None)
        if received is not None:
            # Not the main thread, or a signal this platform does not have.
            with contextlib.suppress(ValueError, OSError):
                signal.signal(received, _stop)

    try:
        stopping.wait()
    except KeyboardInterrupt:  # pragma: no cover - console-only path
        pass
    finally:
        assembly.close()
    return 0


if __name__ == "__main__":  # pragma: no cover - the console entry point
    raise SystemExit(main())

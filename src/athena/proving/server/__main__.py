"""``python -m athena.proving.server``: serve the trigger page (README §9; ADR 0037).

::

    PROVING_JUDGE_TOKEN=... uv run python -m athena.proving.server [--host 127.0.0.1]
        [--port 8790] [--out proving-runs] [--claude/--no-claude] [--env-file .env]
        [--uat-dir uat] [--allow-origin ORIGIN ...]

``PROVING_JUDGE_TOKEN``, ``NEBIUS_API_KEY`` and the daily caps (``PROVING_DAILY_CAP_CLAUDE``,
``PROVING_DAILY_CAP_NEMOTRON``, USD) are read from the environment, or from the ``.env`` file when
the environment has none. No value is ever printed: the start line says only whether triggering
is on. ``PORT`` is honoured when ``--port`` is not given, as a container platform sets it.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path

from athena.proving.budget import ENGINES
from athena.proving.report import RUNS_DIRNAME
from athena.proving.roles import load_env_file
from athena.proving.server.app import ProvingServer, build_handler
from athena.proving.server.runner import (
    DAILY_CAP_ENV,
    DEFAULT_DAILY_CAPS,
    TOKEN_ENV,
    Runner,
)
from athena.proving.server.runs import RunIndex

__all__ = ["build_parser", "main"]

DEFAULT_PORT = 8790


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m athena.proving.server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--out", default=RUNS_DIRNAME, help="the runs directory (read and written)")
    parser.add_argument(
        "--claude",
        dest="claude_row",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="offer the Athena-on-Claude row (needs a claude CLI on PATH)",
    )
    parser.add_argument("--env-file", default=".env")
    parser.add_argument("--uat-dir", default="uat")
    parser.add_argument("--allow-origin", nargs="*", default=[])
    return parser


def daily_caps(environ: Mapping[str, str]) -> dict[str, float]:
    caps = dict(DEFAULT_DAILY_CAPS)
    for engine in ENGINES:
        raw = environ.get(DAILY_CAP_ENV[engine], "").strip()
        if raw:
            caps[engine] = float(raw)
    return caps


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    load_env_file(args.env_file)
    port = args.port if args.port is not None else int(os.environ.get("PORT") or DEFAULT_PORT)
    runs_root = Path(args.out).resolve()
    runner = Runner(
        runs_root,
        claude_allowed=args.claude_row,
        env_file=args.env_file,
        uat_dir=args.uat_dir,
        daily_caps=daily_caps(os.environ),
    )
    index = RunIndex(runs_root)
    server = ProvingServer(
        (args.host, port), build_handler(runner, index, allow_origins=args.allow_origin)
    )
    triggering = "on" if os.environ.get(TOKEN_ENV, "").strip() else f"off ({TOKEN_ENV} unset)"
    print(
        f"proving ground on http://{args.host}:{server.server_address[1]}/ - triggering "
        f"{triggering}; athena-on-claude row {'on' if args.claude_row else 'off'}; "
        f"claude cli {'found' if runner.claude_cli else 'absent'}",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        runner.stop()
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

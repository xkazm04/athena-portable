"""``python -m athena.proving.sandbox spike``: run the five probes live (README §9; ADR 0033).

Reads ``NEBIUS_API_KEY`` and ``NEBIUS_AI_PROJECT`` from the environment, or from ``--env-file``
(only those two names are read, and neither is ever printed). Packs the repository's daemon
source — and, with ``--app``, one example Next app — into a tarball, runs the spike and writes
``<out>/<ts>/sandbox-spike.json`` and ``.md``. Prints the verdict line and the report path.
"""

from __future__ import annotations

import argparse
import io
import os
import sys
import tarfile
from collections.abc import Sequence
from pathlib import Path

from athena.proving.sandbox.client import API_KEY_ENV, PROJECT_ENV, SandboxClient
from athena.proving.sandbox.spike import (
    BASE_IMAGE,
    SpikeConfig,
    load_env_file,
    run_spike,
    write_report,
)

#: What the daemon needs inside, relative to the repository root.
DAEMON_PATHS = ("src/athena", "constitution", "pyproject.toml", "README.md")

#: What one example Next app needs on top: the workspace files and the app with its kit.
APP_PATHS = (
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "examples/ledgerbox",
    "examples/demo-kit",
)

_SKIP = {"node_modules", ".next", "__pycache__", ".turbo", ".mypy_cache", ".ruff_cache"}


def pack(root: Path, paths: Sequence[str]) -> bytes:
    """A gzipped tarball of ``paths`` under ``root``, build output and caches left out."""

    def keep(info: tarfile.TarInfo) -> tarfile.TarInfo | None:
        return None if _SKIP & set(Path(info.name).parts) else info

    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
        for rel in paths:
            source = root / rel
            if source.exists():
                archive.add(source, arcname=rel, filter=keep)
    return buffer.getvalue()


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m athena.proving.sandbox")
    sub = parser.add_subparsers(dest="verb", required=True)
    spike = sub.add_parser("spike", help="run the five Sandboxes probes live")
    spike.add_argument("--env-file", type=Path, default=None)
    spike.add_argument("--out", type=Path, default=Path("proving-runs"))
    spike.add_argument("--repeats", type=int, default=5)
    spike.add_argument("--branches", type=int, default=4)
    spike.add_argument("--base-image", default=BASE_IMAGE)
    spike.add_argument("--app", action=argparse.BooleanOptionalAction, default=True)
    spike.add_argument("--root", type=Path, default=Path("."), help="the repository root")
    args = parser.parse_args(argv)

    env = dict(os.environ)
    if args.env_file is not None:
        env.update(load_env_file(args.env_file, (API_KEY_ENV, PROJECT_ENV)))
    client = SandboxClient(api_key=env.get(API_KEY_ENV, ""), project=env.get(PROJECT_ENV, ""))
    paths = DAEMON_PATHS + (APP_PATHS if args.app else ())
    config = SpikeConfig(
        base_image=args.base_image,
        repeats=args.repeats,
        branches=args.branches,
        tarball=pack(args.root, paths),
        app=args.app,
    )
    result = run_spike(client, config)
    run_dir = write_report(result, args.out)
    print(result.verdict)
    print(run_dir / "sandbox-spike.md")
    return 0 if result.verdict.startswith("PASS") else 1


if __name__ == "__main__":
    sys.exit(main())

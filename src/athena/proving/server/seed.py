"""Seed recorded runs into a runs directory, for the hosted page (README §9; ADR 0039).

The hosted container has no ``claude`` CLI, so it can never record a Characters run or a full
Gauntlet (one with the Haiku control). Those runs are recorded where Claude is available and then
*copied in*: into the image at build time (``proving/serverless/seed-runs/``, read through
``PROVING_SEED_DIR`` at start) or straight onto the mounted volume (``PROVING_RUNS_DIR``). Either
way the page lists them beside the runs the host made itself, by the mode each report states.

Three rules:

- **Only what the page reads.** ``report.json``, ``report.md`` and ``ledger.jsonl``. A breach's
  preserved world (``breaches/``) holds a throwaway brain; it stays where it was recorded.
- **Never over a run that is there.** A run id already in the destination is skipped, so a
  restart that seeds again changes nothing, and a run the host recorded is never replaced.
- **Never a secret.** A file holding the value of ``NEBIUS_API_KEY`` or ``PROVING_JUDGE_TOKEN``
  refuses its whole run. A report is not meant to hold one; this is the check that it does not.

Each run is copied into a scratch directory beside the destination and renamed into place, so a
half-copied run is never listed.

::

    uv run python -m athena.proving.server.seed --from proving-runs \\
        --to proving/serverless/seed-runs [RUN_ID ...]
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path

from athena.proving.report import RUNS_DIRNAME
from athena.proving.server.runner import RUN_ID, TOKEN_ENV

__all__ = [
    "RUNS_DIR_ENV",
    "SEED_DIR_ENV",
    "SEED_FILES",
    "SeedResult",
    "main",
    "seed_runs",
]

#: The runs directory when ``--out`` is not given: hosted, a mounted volume.
RUNS_DIR_ENV = "PROVING_RUNS_DIR"

#: A directory of recorded runs copied into the runs directory at server start.
SEED_DIR_ENV = "PROVING_SEED_DIR"

#: What a seeded run carries: exactly what the page reads.
SEED_FILES: tuple[str, ...] = ("report.json", "report.md", "ledger.jsonl")

_SECRET_NAMES = ("NEBIUS_API_KEY", TOKEN_ENV)


@dataclass
class SeedResult:
    """The run ids seeded, and what was skipped or refused, and why."""

    seeded: list[str] = field(default_factory=list)
    skipped: dict[str, str] = field(default_factory=dict)
    refused: dict[str, str] = field(default_factory=dict)


def _secrets(environ: Mapping[str, str]) -> list[str]:
    values = [environ.get(name, "").strip() for name in _SECRET_NAMES]
    return [value for value in values if len(value) >= 8]


def seed_runs(
    source: Path,
    dest: Path,
    only: Iterable[str] = (),
    *,
    environ: Mapping[str, str] | None = None,
) -> SeedResult:
    """Copy each recorded run under ``source`` into ``dest`` unless it is already there."""
    result = SeedResult()
    wanted = set(only)
    if not source.is_dir():
        result.skipped[str(source.name)] = "no such directory"
        return result
    secrets = _secrets(environ if environ is not None else os.environ)
    dest.mkdir(parents=True, exist_ok=True)
    for run_dir in sorted(p for p in source.iterdir() if p.is_dir()):
        run_id = run_dir.name
        if not RUN_ID.match(run_id) or (wanted and run_id not in wanted):
            continue
        if not (run_dir / "report.json").is_file():
            result.skipped[run_id] = "no report.json (unfinished)"
            continue
        if (dest / run_id).exists():
            result.skipped[run_id] = "already there"
            continue
        files = [run_dir / name for name in SEED_FILES if (run_dir / name).is_file()]
        leaked = [
            f.name
            for f in files
            if any(value in f.read_text(encoding="utf-8", errors="replace") for value in secrets)
        ]
        if leaked:
            result.refused[run_id] = f"holds a secret value: {', '.join(leaked)}"
            continue
        scratch = dest / f".seed-{run_id}"
        if scratch.exists():
            shutil.rmtree(scratch)
        scratch.mkdir()
        for f in files:
            shutil.copy2(f, scratch / f.name)
        scratch.rename(dest / run_id)
        result.seeded.append(run_id)
    return result


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m athena.proving.server.seed")
    parser.add_argument("--from", dest="source", default=RUNS_DIRNAME)
    parser.add_argument("--to", dest="dest", required=True)
    parser.add_argument("runs", nargs="*", help="run ids to copy (default: every finished run)")
    args = parser.parse_args(argv)
    result = seed_runs(Path(args.source), Path(args.dest), args.runs)
    for run_id in result.seeded:
        print(f"seeded {run_id}")
    for run_id, why in result.skipped.items():
        print(f"skipped {run_id}: {why}")
    for run_id, why in result.refused.items():
        print(f"REFUSED {run_id}: {why}", file=sys.stderr)
    return 1 if result.refused else 0


if __name__ == "__main__":
    sys.exit(main())

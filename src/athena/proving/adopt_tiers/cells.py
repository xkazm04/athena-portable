"""ADR 0145 (tier bench, comparable cells): which records may be compared, and over which cells.

A **cell** is one ``(scenario, rep)``. Three rules keep a pick from resting on records that are
not comparable:

- **One bench digest.** :func:`bench_digest` is a sha over what produced a record and is not in
  it: the studio's interviewer, auditor and brief-writer prompts, the bench's persona and judge
  prompts, the loop's card cap, and each scenario file's bytes. Every record is stamped with the
  digest of its own scenario (:func:`cell_digest`); a record stamped with another digest, or none
  (written before the stamp existed), is **stale**: the plan runs it again and the pick leaves it
  out, counted.
- **Paired cells.** A config's quality is read only over the cells every config still in the
  running completed; a config that did not complete every cell another one did is out, with
  ``covered k of N cells``, instead of being ranked on an easier mix (:func:`paired`).
- **Outcome-conditioned speed.** Speed ranks only over the paired cells where every survivor
  reached an end state (:data:`ENDED_CLEAR`: cleared, or wrote a brief at the card cap of its own
  accord); a wall-capped or stalled interview's few legs would otherwise pull a p50 down
  (:func:`conditioned`). The unconditioned p50 is published beside it.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import asdict
from pathlib import Path
from typing import Any

from athena.proving.adopt_tiers.scenarios import SCENARIOS_DIR, Scenario

__all__ = [
    "DIGEST_KEY",
    "ENDED_CLEAR",
    "Cell",
    "bench_digest",
    "cell_digest",
    "cell_of",
    "conditioned",
    "coverage",
    "is_current",
    "paired",
    "restrict",
]

#: The record key that carries the digest.
DIGEST_KEY = "bench_digest"
#: The ends a speed figure may be read over: a clear, or a brief the loop wrote itself.
ENDED_CLEAR = frozenset({"clear", "brief"})

Cell = tuple[str, int]


def _scenario_bytes(scenario: Scenario, directory: Path) -> bytes:
    path = directory / f"{scenario.id}.json"
    try:
        return path.read_bytes()
    except OSError:
        # A scenario built in memory (a test) has no file: its content stands in for the bytes.
        return json.dumps(asdict(scenario), sort_keys=True, default=str).encode("utf-8")


def bench_digest(scenarios: Sequence[Scenario], *, directory: Path = SCENARIOS_DIR) -> str:
    """A stable sha over the prompts, the card cap and each scenario file's bytes."""
    # Read at call time, module by module, so the digest follows what the bench would run now.
    from athena.adopt import prompts
    from athena.proving.adopt_tiers import score, simulate

    h = hashlib.sha256()

    def part(label: str, data: bytes) -> None:
        h.update(label.encode("utf-8") + b"\0" + str(len(data)).encode("ascii") + b"\0" + data)

    for label, text in (
        ("INTERVIEW_SYSTEM", prompts.INTERVIEW_SYSTEM),
        ("AUDIT_SYSTEM", prompts.AUDIT_SYSTEM),
        ("BRIEF_SYSTEM", prompts.BRIEF_SYSTEM),
        ("PERSONA_SYSTEM", simulate.PERSONA_SYSTEM),
        ("JUDGE_SYSTEM", score.JUDGE_SYSTEM),
    ):
        part(label, text.encode("utf-8"))
    part("MAX_ROUNDS", str(prompts.MAX_ROUNDS).encode("ascii"))
    for scenario in sorted(scenarios, key=lambda s: s.id):
        part(f"scenario:{scenario.id}", _scenario_bytes(scenario, directory))
    return h.hexdigest()


def cell_digest(scenario: Scenario, *, directory: Path = SCENARIOS_DIR) -> str:
    """The digest a record of this scenario is stamped with (a run of a subset of scenarios
    stamps the same value as a full run)."""
    return bench_digest([scenario], directory=directory)


def is_current(record: Mapping[str, Any], digest: str) -> bool:
    return record.get(DIGEST_KEY) == digest


def cell_of(record: Mapping[str, Any]) -> Cell:
    return str(record.get("scenario")), int(record.get("rep") or 0)


def coverage(records: Iterable[Mapping[str, Any]]) -> dict[str, set[Cell]]:
    """Per config, the cells it completed."""
    out: dict[str, set[Cell]] = {}
    for record in records:
        out.setdefault(str(record.get("config")), set()).add(cell_of(record))
    return out


def paired(records: Iterable[Mapping[str, Any]], configs: Iterable[str]) -> set[Cell]:
    """The cells every one of ``configs`` completed."""
    cov = coverage(records)
    sets = [cov.get(c, set()) for c in configs]
    return set.intersection(*sets) if sets else set()


def conditioned(
    records: Iterable[Mapping[str, Any]], configs: Iterable[str], cells: Iterable[Cell]
) -> set[Cell]:
    """Of ``cells``, the ones where every one of ``configs`` ended clear or with a brief."""
    names = set(configs)
    ended: dict[Cell, dict[str, str]] = {}
    for record in records:
        config = str(record.get("config"))
        if config in names:
            ended.setdefault(cell_of(record), {})[config] = str(record.get("ended") or "")
    return {
        cell
        for cell in cells
        if all(ended.get(cell, {}).get(c) in ENDED_CLEAR for c in names) and names
    }


def restrict(
    records: Iterable[Mapping[str, Any]], configs: Iterable[str], cells: Iterable[Cell]
) -> list[dict[str, Any]]:
    """The records of ``configs`` that fall in ``cells``."""
    names, keep = set(configs), set(cells)
    return [dict(r) for r in records if str(r.get("config")) in names and cell_of(r) in keep]

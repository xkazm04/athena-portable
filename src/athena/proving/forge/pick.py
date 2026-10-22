"""Which playbooks the forge works on (README §14; spark nvidia-revisit, WP-F ``pick``).

Eight by rule: four whose committed bench is ``short`` and four ``exceeds``, one per area where the
library allows. Deterministic: candidates are sorted, then shuffled by a seeded generator, so the
same library and seed pick the same eight. Short is scarce (3 of 100 at the time of writing); when
fewer than four exist, all are taken and the rest of the eight is filled with ``exceeds``, and the
result says so.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from pathlib import Path

from athena.proving.forge.base import Base, read_json

__all__ = ["Picks", "pick", "pick_detail"]

PER_SIDE = 4


@dataclass(frozen=True)
class Picks:
    ids: list[str]
    shorts: list[str]
    notes: list[str] = field(default_factory=list)


def pick_detail(library: str | Path, seed: int = 11, per_side: int = PER_SIDE) -> Picks:
    root = Path(library)
    bases: list[Base] = []
    for d in sorted(root.iterdir()):
        if (d / "playbook.json").is_file() and (d / "bench.json").is_file():
            # Only the showcase and the bench are read: the world and truth are not needed to pick.
            bench = read_json(d / "bench.json")
            bases.append(
                Base(
                    id=d.name,
                    library=root,
                    showcase=dict(read_json(d / "playbook.json")),
                    world={},
                    truth={},
                    bench=dict(bench) if isinstance(bench, dict) else {},
                )
            )
    shorts = [b for b in bases if b.verdict_word == "short"]
    exceeds = [b for b in bases if b.verdict_word == "exceeds"]
    rng = random.Random(seed)
    rng.shuffle(shorts)
    rng.shuffle(exceeds)
    notes: list[str] = []
    chosen: list[Base] = []
    areas: set[str] = set()

    def take(pool: list[Base], want: int, *, distinct: bool) -> None:
        for b in pool:
            if sum(1 for c in chosen if c in pool) >= want:
                return
            if b in chosen or (distinct and b.category in areas):
                continue
            chosen.append(b)
            areas.add(b.category)

    take(shorts, per_side, distinct=True)
    take(shorts, per_side, distinct=False)
    take(exceeds, per_side, distinct=True)
    take(exceeds, per_side, distinct=False)
    picked_shorts = [b for b in chosen if b in shorts]
    if len(picked_shorts) < per_side:
        notes.append(
            f"only {len(picked_shorts)} short playbook(s) in the library (wanted {per_side}): "
            f"all taken, and the rest of the {2 * per_side} filled with exceeds"
        )
        want = 2 * per_side - len(picked_shorts)
        take(exceeds, want, distinct=True)
        take(exceeds, want, distinct=False)
    if len(chosen) < 2 * per_side:
        notes.append(f"the library holds only {len(chosen)} benched playbooks that qualify")
    repeated = len(chosen) - len({b.category for b in chosen})
    if repeated:
        notes.append(f"{repeated} playbook(s) share an area: the library had no more distinct ones")
    return Picks(
        ids=sorted(b.id for b in chosen),
        shorts=sorted(b.id for b in picked_shorts),
        notes=notes,
    )


def pick(library: str | Path, seed: int = 11) -> list[str]:
    """The eight playbook ids, sorted."""
    return pick_detail(library, seed).ids

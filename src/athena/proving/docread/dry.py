"""WP-V (nvidia-revisit): the dry run's readers. Recorded-fixture stand-ins, no network, no render.

Deterministic functions of the unit and the sheet (a CRC picks what each pretend reader gets wrong),
so the dry report exercises the scorer, the proof and the report writer end to end. The figures a
dry run prints are NOT a measurement of either model, and the report says ``"dry": true``.
"""

from __future__ import annotations

import zlib

from athena.proving.adopt_tiers.scenarios import Scenario
from athena.proving.docread.corpus import Unit
from athena.proving.docread.score import Reading

__all__ = ["DRY_MODELS", "dry_reading", "is_dry"]

#: Per reader and degradation: one in N stated fields is dropped (0 = never).
_DROP = {
    ("vl", "clean"): 0,
    ("vl", "pdf"): 0,
    ("vl", "skew"): 6,
    ("vl", "scan"): 4,
    ("claude", "clean"): 0,
    ("claude", "pdf"): 0,
    ("claude", "skew"): 0,
    ("claude", "scan"): 8,
}
#: One in N units the VL invents a value for a field the document does not state.
_INVENT = {"vl": 7, "claude": 0}
_MODEL = {"vl": "dry-fixture-vl", "claude": "dry-fixture-claude"}
#: The model a dry reading carries: how a run folder's answers say they are fixtures, whatever
#: flag a later ``read`` or ``score`` is given.
DRY_MODELS: frozenset[str] = frozenset(_MODEL.values())


def is_dry(reading: Reading) -> bool:
    return reading.model in DRY_MODELS


def dry_reading(reader: str, unit: Unit, scenario: Scenario) -> Reading:
    values: dict[str, str] = {}
    entries = [e for e in scenario.sheet if e.kind in ("fact", "trap")]
    drop = _DROP.get((reader, unit.degradation), 0)
    for entry in entries:
        if entry.id not in unit.facts:
            continue
        if drop and zlib.crc32(f"{reader}/{unit.id}/{entry.id}".encode()) % drop == 0:
            continue
        values[entry.id] = entry.truth
    invent = _INVENT.get(reader, 0)
    if invent:
        for entry in entries:
            if (
                entry.id not in unit.facts
                and zlib.crc32(f"inv/{unit.id}/{entry.id}".encode()) % invent == 0
            ):
                values[entry.id] = entry.truth
    ms = 900 + zlib.crc32(f"ms/{reader}/{unit.id}".encode()) % 400
    return Reading(reader, unit.id, values, model=_MODEL[reader], ms=ms, cost_usd=0.0)

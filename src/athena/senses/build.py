"""Build and prove one chore's senses: ``media.json`` -> ``sensed.json`` -> ``proofs.json``.

:func:`build` loads the chore's media index, runs every sense the index names (in
:data:`~athena.senses.contract.SENSES` order, each over the whole index - a sense filters to its own
items), merges their tables and writes ``senses/sensed.json``. Two senses writing one table name is
refused, as is a sensed table shadowing a ``world.json`` table (the loader checks it again).

:func:`prove` builds, then runs each sense's ``prove`` against ``senses/key.json`` and writes
``senses/proofs.json``. :func:`featured_status` reads it back (ADR 0226, decision 3).

The written files carry no clock: a fixture build is byte-identical run to run, so a committed
``sensed.json`` only changes when the media, the fixtures or a sense did.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import asdict
from pathlib import Path
from typing import Any

from athena.senses.backends import call_row, make_senses, sense_of
from athena.senses.contract import (
    BACKENDS,
    FIXTURES_DIR,
    MEDIA_FILE,
    PROOFS_FILE,
    SENSED_FILE,
    SENSES,
    SENSES_DIR,
    Backend,
    FeaturedStatus,
    MediaItem,
    ProofResult,
    SenseContext,
    SenseOutput,
)
from athena.senses.registry import KEY_FILE, sense_module

MEDIA_KINDS = frozenset({"paper", "video", "audio", "photo"})


class SenseError(ValueError):
    def __init__(self, problems: list[str]) -> None:
        super().__init__("; ".join(problems))
        self.problems = problems


def _read(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise SenseError([f"{path.name} is not an object"])
    return value


def _write(path: Path, value: Mapping[str, Any]) -> None:
    text = json.dumps(value, indent=2, ensure_ascii=False) + "\n"
    path.write_text(text, encoding="utf-8", newline="\n")


def load_media(root: Path) -> tuple[tuple[MediaItem, ...], dict[str, Backend]]:
    """``senses/media.json`` as items and the backends it asks for; every problem at once."""
    raw = _read(root / SENSES_DIR / MEDIA_FILE)
    problems: list[str] = []
    items: list[MediaItem] = []
    seen: set[str] = set()
    for i, m in enumerate(raw.get("media", [])):
        where = f"media[{i}]"
        mid = str(m.get("id", ""))
        if not mid or mid in seen:
            problems.append(f"{where}: id must be present and unique")
        seen.add(mid)
        if m.get("kind") not in MEDIA_KINDS:
            problems.append(f"{where}: kind must be one of {sorted(MEDIA_KINDS)}")
        if m.get("sense") not in SENSES:
            problems.append(f"{where}: sense must be one of {list(SENSES)}")
        params = m.get("params", {})
        if not isinstance(params, Mapping):
            problems.append(f"{where}: params must be an object")
            params = {}
        items.append(
            MediaItem(
                id=mid,
                kind=m.get("kind", "photo"),
                sense=m.get("sense", "paper"),
                path=str(m.get("path", "")),
                source=str(m.get("source", "")),
                params=dict(params),
                personal=bool(m.get("personal", True)),
            )
        )
    if not items:
        problems.append("media.json lists no media")
    backends: dict[str, Backend] = {}
    for role, backend in dict(raw.get("backends", {})).items():
        if role not in ("segmenter", "transcriber", "reader") or backend not in BACKENDS:
            problems.append(f"backends.{role}: {backend!r} is not a backend")
        else:
            backends[role] = backend
    if problems:
        raise SenseError(problems)
    return tuple(items), backends


def context(root: Path, overrides: Mapping[str, Backend] | None = None) -> SenseContext:
    media, backends = load_media(root)
    backends.update(overrides or {})
    world = _read(root / "world.json")
    senses = make_senses(root / SENSES_DIR / FIXTURES_DIR, backends)
    return SenseContext(root.name, root, world, media, senses)


def run_senses(ctx: SenseContext) -> SenseOutput:
    """Every sense the index names, merged; a table written twice is refused."""
    authored = set(dict(ctx.world.get("tables", {})))
    tables: dict[str, list[dict[str, Any]]] = {}
    calls: list[Any] = []
    asked: list[str] = []
    named = {m.sense for m in ctx.media}
    for name in SENSES:
        if name not in named:
            continue
        out = sense_module(sense_of(name)).build(ctx)
        for table, rows in out.tables.items():
            if table in tables or table in authored:
                raise SenseError([f"sense {name!r} writes table {table!r}, already written"])
            tables[table] = [dict(r) for r in rows]
        calls.extend(out.calls)
        asked.extend(out.asked)
    return SenseOutput(tables=tables, calls=tuple(calls), asked=tuple(asked))


def build(root: Path, overrides: Mapping[str, Backend] | None = None) -> SenseOutput:
    ctx = context(root, overrides)
    out = run_senses(ctx)
    _write(
        root / SENSES_DIR / SENSED_FILE,
        {
            "playbook": ctx.playbook_id,
            "backends": dict(ctx.senses.backends),
            "cost_usd": round(sum(c.cost_usd or 0.0 for c in out.calls), 6),
            "unpriced_calls": sum(1 for c in out.calls if c.cost_usd is None),
            "asked": list(out.asked),
            "calls": [call_row(c) for c in out.calls],
            "tables": out.tables,
        },
    )
    return out


def prove(root: Path, overrides: Mapping[str, Backend] | None = None) -> list[ProofResult]:
    ctx = context(root, overrides)
    out = run_senses(ctx)
    key = _read(root / SENSES_DIR / KEY_FILE)
    results: list[ProofResult] = []
    rows: list[dict[str, Any]] = []
    for name in SENSES:
        if any(m.sense == name for m in ctx.media):
            for r in sense_module(sense_of(name)).prove(ctx, out, key):
                results.append(r)
                # Proof ids are the spike README's (F1, R4...), so two senses in one chore can
                # both have an F1: the row names its sense, and the pair is the identity.
                rows.append(
                    {"sense": name, **{k: v for k, v in asdict(r).items() if v is not None}}
                )
    _write(
        root / SENSES_DIR / PROOFS_FILE,
        {
            "playbook": ctx.playbook_id,
            "backends": dict(ctx.senses.backends),
            "passed": all(r.passed for r in results) and bool(results),
            "proofs": rows,
        },
    )
    return results


def featured_status(root: Path) -> FeaturedStatus:
    """``proven`` / ``rehearsed`` / ``failing`` / ``unproven`` from ``senses/proofs.json``."""
    path = root / SENSES_DIR / PROOFS_FILE
    if not path.is_file():
        return "unproven"
    proofs = _read(path)
    if not proofs.get("proofs"):
        return "unproven"
    if not proofs.get("passed"):
        return "failing"
    return "proven" if "meta" in dict(proofs.get("backends", {})).values() else "rehearsed"

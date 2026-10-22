"""``--dry``: the whole forge with no network, no ``claude`` and no model (README §14).

A recorded-fixture stand-in for each model role, deterministic in its prompt: the generator mutates
the base programmatically (new ids, a distractor row, two look-alike traps cloned from eligible
rows) and answers in a code fence as a model would; one in four Nemotron answers is planted with a
bug so the refusal histogram has something in it; the auditor rules on a hash of the record; the
"bench" files every eligible item but one in four. Nothing here measures anything: a dry report
says so on its first line, and its numbers are plumbing checks, never results.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from athena.proving.budget import NEMOTRON
from athena.proving.forge.base import Base, find_rows
from athena.proving.forge.forge import SYSTEM as FORGE_SYSTEM
from athena.proving.playbooks.bench import BenchConfig, score, verdict
from athena.proving.playbooks.spec import Playbook, _norm
from athena.proving.roles import RoleReply

__all__ = ["DryRole", "dry_bench", "mutate"]

_MARK = re.compile(r"PLAYBOOK_ID=(\S+) VARIANT=(\d+)")
_RECORD = re.compile(r"\(table (\S+), id (\S+), for the action (\S+)\)")


def mutate(base: Base, k: int, *, bug: bool = False) -> dict[str, Any]:
    """A variant of ``base``: ids renamed, distractors and two new traps added, truth rewritten."""
    world, truth = copy.deepcopy(base.world), copy.deepcopy(base.truth)
    located: list[str] = []
    for target in truth.get("targets", []):
        for part in ("eligible", "traps", "neutral"):
            for key in target.get(part, {}):
                if len(key) >= 4 and any(
                    _norm(key) in [_norm(v) for v in row.values() if isinstance(v, str)]
                    for _t, row in find_rows(world, key, limit=1)
                ):
                    located.append(key)
    renames = {old: f"{old}-{k}" for old in sorted(set(located), key=len, reverse=True)}
    tables_text = json.dumps(world["tables"], ensure_ascii=False)
    truth_text = json.dumps(truth, ensure_ascii=False)
    for old, new in renames.items():
        tables_text = tables_text.replace(f'"{old}"', f'"{new}"')
        truth_text = truth_text.replace(f'"{old}"', f'"{new}"')
    world["tables"] = json.loads(tables_text)
    truth = json.loads(truth_text)
    added = 0
    for target in truth.get("targets", []):
        for key in list(target.get("eligible", {})):
            if added >= 2:
                break
            hits = find_rows(world, key, limit=1)
            if not hits:
                continue
            table, row = hits[0]
            if not any(isinstance(v, str) and v == key for v in row.values()):
                continue
            clone = {f: (f"{key}-T{added}" if v == key else v) for f, v in row.items()}
            world["tables"][table].append(clone)
            target.setdefault("traps", {})[f"{key}-T{added}"] = (
                "A look-alike of an eligible record that fails the playbook's deadline rule"
            )
            added += 1
        if added >= 2:
            break
    if bug:
        first = next(iter(world["tables"]))
        del world["tables"][first]
    return {"world": world, "truth": truth}


@dataclass
class DryRole:
    """A :class:`~athena.proving.roles.RoleClient` that answers from the fixtures above."""

    engine: str
    model: str
    bases: Mapping[str, Base]
    #: Every ``bug_every``-th variant is planted with a bug (0 = never).
    bug_every: int = 0

    def complete(self, system: str, prompt: str) -> RoleReply:
        cost = 0.003 if self.engine == NEMOTRON else 0.01
        if system == FORGE_SYSTEM:
            mark = _MARK.search(prompt)
            assert mark is not None, "a forge prompt carries its marker"
            pid, k = mark.group(1), int(mark.group(2))
            bug = bool(self.bug_every) and k % self.bug_every == self.bug_every - 1
            text = "```json\n" + json.dumps(mutate(self.bases[pid], k, bug=bug)) + "\n```"
        else:
            record = _RECORD.search(prompt)
            seed = hashlib.sha256((record.group(0) if record else prompt).encode()).digest()[0]
            holds = seed % 5 != 0
            text = json.dumps({"label_holds": holds, "why": "dry fixture ruling"})
        return RoleReply(text, self.engine, self.model, 1000, 1000, cost, 5)


def dry_bench(book: Playbook, config: BenchConfig) -> dict[str, Any]:
    """A report shaped like the bench's, from a scripted run: all eligible items but one in four."""
    cards: list[dict[str, Any]] = []
    for target in book.targets:
        for index, (key, item) in enumerate(target.eligible.items()):
            if index % 4 == 3:
                continue
            params = {target.key: key, **dict(item.get("expect", {}))}
            cards.append({"action": f"host.dry.{target.tool}", "params": params})
    scored = score(book, cards)
    report: dict[str, Any] = {
        "playbook": book.id,
        "engine": "dry",
        "model": "simulated",
        "approve": "none",
        "wall_s": 90.0,
        "turns": 0,
        "errors": [],
        "cards": cards,
        "score": scored,
    }
    report["verdict"] = verdict(book, report)
    return report

"""The forge's validator: pure, deterministic, and the only judge of a variant (README §14).

A model never says a variant is good. ``validate(base, variant)`` returns every reason the variant
is refused, as ``"<code>: <detail>"`` sentences, and an empty list when there is none. The codes
are the histogram keys of the report. A variant must keep the playbook's rules (apps, tools,
phases, table names, targets) and change its facts, and its truth must still be true of its world.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from athena.proving.forge.base import Base, has_row, loader_problems, target_ids
from athena.proving.playbooks.spec import _norm

__all__ = ["CODES", "MIN_NEW_TRAPS", "code_of", "parse_variant", "validate"]

#: How many trap ids a variant must bring that the base truth did not name.
MIN_NEW_TRAPS = 2

CODES: tuple[str, ...] = (
    "unparseable",
    "missing-key",
    "apps-differ",
    "tools-differ",
    "phases-differ",
    "tables-differ",
    "targets-differ",
    "bad-truth",
    "id-not-a-row",
    "overlap",
    "value-not-number",
    "eligible-incomplete",
    "trap-reason",
    "loader",
    "few-new-traps",
)


def code_of(problem: str) -> str:
    """The histogram key of one problem sentence."""
    return problem.split(":", 1)[0]


def parse_variant(variant: Any) -> tuple[dict[str, Any], dict[str, Any]] | str:
    """``(world, truth)``, or the refusal sentence."""
    if isinstance(variant, str):
        try:
            variant = json.loads(variant)
        except json.JSONDecodeError as exc:
            return f"unparseable: not JSON ({exc.msg})"
    if not isinstance(variant, Mapping):
        return "unparseable: the variant is not an object"
    world, truth = variant.get("world"), variant.get("truth")
    if not isinstance(world, dict):
        return "missing-key: world is missing or not an object"
    if not isinstance(truth, dict):
        return "missing-key: truth is missing or not an object"
    return world, truth


def validate(base: Base, variant: Any) -> list[str]:
    """Every reason ``variant`` is refused against ``base``; ``[]`` when it is valid."""
    parsed = parse_variant(variant)
    if isinstance(parsed, str):
        return [parsed]
    world, truth = parsed
    found: list[str] = []
    for owner, part, names in (
        ("world", world, ("apps", "phases", "tables")),
        ("truth", truth, ("targets",)),
    ):
        for name in names:
            want = dict if name == "tables" else list
            if not isinstance(part.get(name), want):
                found.append(f"missing-key: {owner}.{name} is missing or the wrong type")
    if found:
        return found

    found += _structure(base, world, truth)
    if not found:
        found += _facts(base, world, truth)
    if not found:
        found += [f"loader: {p}" for p in loader_problems(base, world, truth)]
    found += _new_traps(base, truth)
    return found


# --- the rules that must not move ----------------------------------------------------------------


def _apps(world: Mapping[str, Any]) -> dict[str, Any]:
    return {str(a.get("app_id")): a for a in world.get("apps", []) if isinstance(a, Mapping)}


def _tools(app: Mapping[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for tool in app.get("tools", []):
        if isinstance(tool, Mapping):
            out[str(tool.get("name"))] = (tool.get("kind"), tool.get("params"), tool.get("returns"))
    return out


def _structure(base: Base, world: Mapping[str, Any], truth: Mapping[str, Any]) -> list[str]:
    found: list[str] = []
    mine, theirs = _apps(base.world), _apps(world)
    if list(mine) != list(theirs):
        found.append(f"apps-differ: expected {list(mine)}, found {list(theirs)}")
    for app_id in mine.keys() & theirs.keys():
        had, has = _tools(mine[app_id]), _tools(theirs[app_id])
        if set(had) != set(has):
            found.append(
                f"tools-differ: {app_id} tools {sorted(has)} are not the base's {sorted(had)}"
            )
        for name in had.keys() & has.keys():
            if had[name] != has[name]:
                found.append(f"tools-differ: {app_id}.{name} changed its kind, params or returns")
        if mine[app_id].get("origin") != theirs[app_id].get("origin"):
            found.append(f"apps-differ: {app_id} changed its origin")
    if base.world.get("phases") != world.get("phases"):
        found.append("phases-differ: the phases are not the base's, word for word")
    if set(base.world.get("tables", {})) != set(world.get("tables", {})):
        found.append(
            f"tables-differ: tables {sorted(world.get('tables', {}))} are not the base's "
            f"{sorted(base.world.get('tables', {}))}"
        )

    def shape(t: Mapping[str, Any]) -> list[tuple[str, str]]:
        return sorted(
            (str(x.get("tool")), str(x.get("key")))
            for x in t.get("targets", [])
            if isinstance(x, Mapping)
        )

    if shape(base.truth) != shape(truth):
        found.append("targets-differ: the truth targets other tools or keys than the base's")
    if base.truth.get("forbidden", []) != truth.get("forbidden", []):
        found.append("targets-differ: the forbidden tools are not the base's")
    return found


# --- the truth against the world -----------------------------------------------------------------


def _derived(base: Base) -> set[str]:
    """Ids the base truth names that the base world holds in no row (a month, a quarter, a state
    derived from several rows). They cannot be checked in a variant either, so they are not."""
    out: set[str] = set()
    for raw in base.truth.get("targets", []):
        if isinstance(raw, Mapping):
            for ids in target_ids(raw).values():
                out |= {i for i in ids if not has_row(base.world, i)}
    return out


def _expecting(base: Base) -> set[str]:
    """The target tools whose every eligible entry carries ``expect`` params in the base truth.

    The prompt tells the generator to keep them; a variant that drops them lets the scorer take
    a card with any params as right, so it would be an easier world, not a varied one.
    """
    out: set[str] = set()
    for raw in base.truth.get("targets", []):
        eligible = raw.get("eligible") if isinstance(raw, Mapping) else None
        if (
            isinstance(raw, Mapping)
            and isinstance(eligible, Mapping)
            and eligible
            and all(
                isinstance(v, Mapping) and isinstance(v.get("expect"), Mapping)
                for v in eligible.values()
            )
        ):
            out.add(str(raw.get("tool")))
    return out


def _facts(base: Base, world: Mapping[str, Any], truth: Mapping[str, Any]) -> list[str]:
    found: list[str] = []
    derived = _derived(base)
    expecting = _expecting(base)
    for raw in truth.get("targets", []):
        if not isinstance(raw, Mapping):
            found.append("bad-truth: a target is not an object")
            continue
        tool = str(raw.get("tool"))
        for part in ("eligible", "traps", "neutral"):
            if part in raw and not isinstance(raw[part], Mapping):
                found.append(f"bad-truth: {tool} {part} is not an object")
        ids = target_ids(raw)
        for part, label in (("eligible", "eligible"), ("traps", "trap"), ("neutral", "neutral")):
            for item in sorted(ids[part] - derived):
                if not has_row(world, item):
                    found.append(f"id-not-a-row: {tool} {label} {item} is in no row of any table")
        both = ids["eligible"] & ids["traps"]
        if both:
            found.append(f"overlap: {tool} {sorted(both)} are both eligible and a trap")
        eligible = raw.get("eligible")
        if isinstance(eligible, Mapping):
            for item, value in eligible.items():
                amount = value.get("value_usd") if isinstance(value, Mapping) else None
                if isinstance(amount, bool) or not isinstance(amount, int | float):
                    found.append(f"value-not-number: {tool} {item} value_usd is {amount!r}")
                why = value.get("why") if isinstance(value, Mapping) else None
                if not isinstance(why, str) or not why.strip():
                    found.append(f"eligible-incomplete: {tool} {item} has no why")
                if tool in expecting and not (
                    isinstance(value, Mapping) and isinstance(value.get("expect"), Mapping)
                ):
                    found.append(f"eligible-incomplete: {tool} {item} lost its expect params")
        traps = raw.get("traps")
        if isinstance(traps, Mapping):
            for item, why in traps.items():
                if not isinstance(why, str) or not why.strip():
                    found.append(f"trap-reason: {tool} trap {item} has no reason")
    return found


def _new_traps(base: Base, truth: Mapping[str, Any]) -> list[str]:
    known: set[str] = set()
    for raw in base.truth.get("targets", []):
        if isinstance(raw, Mapping):
            for ids in target_ids(raw).values():
                known |= ids
    fresh: set[str] = set()
    for raw in truth.get("targets", []):
        if isinstance(raw, Mapping) and isinstance(raw.get("traps"), Mapping):
            fresh |= {_norm(k) for k in raw["traps"]} - known
    if len(fresh) < MIN_NEW_TRAPS:
        return [
            f"few-new-traps: {len(fresh)} trap id(s) the base truth does not name, "
            f"need {MIN_NEW_TRAPS}"
        ]
    return []

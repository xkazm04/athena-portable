"""uat chores (spark chores-uat): ``report --against`` — two runs compared, over matched pairs.

A fix wave is certified by a before/after: the same pairs run again after the fix. This module
reads two run directories (dumps and ``run.json`` only, like :mod:`.report`) and answers the
delta the operator used to assemble by hand:

- **Matched pairs only.** A pair present in one run is named (``only_in_base``/``only_in_head``)
  and left out of every number; every section says ``over N matched pairs`` (a re-run is a
  second sample, so its n and its set are part of the figure).
- **Flips per pair.** A criterion that went fail->pass is ``+n``, pass->fail ``-n``, so one loss
  and one gain under an unchanged total stay visible. A ``null`` criterion is not evaluable:
  null->value counts in ``became_evaluable`` and value->null in ``became_unevaluable``, never as
  a pass or a fail flip.
- **Instrument moves at the number.** ``run.json``'s instrument is compared on :data:`IDENTITY`
  (the keys a resume refuses on; ``git_head`` is informational). A moved key, or a run with no
  readable instrument (``unknown`` is never read as unchanged), marks every judge-derived
  section (criteria, adopt, findings) ``mixed``: its delta mixes a product change with an
  instrument change. The brief metrics read the brief itself, so they are never mixed.
- **Absent is omitted.** A side with no priced dump has no ``known_usd`` (never 0.0).
"""

from __future__ import annotations

import json
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from athena.proving.chores_uat.report import criteria_counts, load_dumps
from athena.proving.report import TEXT_ERRORS

__all__ = ["IDENTITY", "Comparison", "compare", "compare_md", "write_compare"]

#: The instrument keys that decide whether two runs' dumps may be read as one: a resume refuses
#: when one moved, and a comparison marks its judge-derived numbers ``mixed``. ``git_head`` is
#: informational (the product under test is what a comparison is meant to move).
IDENTITY = (
    "persona_system",
    "judge_system",
    "interview_system",
    "audit_system",
    "brief_system",
    "tiers",
    "persona_tier",
    "judge_tier",
)

_GUESS = "(my guess)"
_DATES = "dates that matter"
_ADOPT = ("yes", "maybe", "no")


@dataclass(frozen=True)
class Comparison:
    """Two runs compared. Sections are plain JSON-ready mappings; each carries ``over``."""

    base_run: str
    head_run: str
    matched: tuple[str, ...]
    only_in_base: tuple[str, ...]
    only_in_head: tuple[str, ...]
    instrument_base: Mapping[str, Any] | None
    instrument_head: Mapping[str, Any] | None
    instrument_moved: tuple[str, ...]
    mixed: bool
    criteria: dict[str, Any] = field(default_factory=dict)
    pairs: list[dict[str, Any]] = field(default_factory=list)
    adopt: dict[str, Any] = field(default_factory=dict)
    findings: dict[str, Any] = field(default_factory=dict)
    brief: dict[str, Any] = field(default_factory=dict)
    cost: dict[str, Any] = field(default_factory=dict)

    @property
    def n(self) -> int:
        return len(self.matched)

    def as_dict(self) -> dict[str, Any]:
        return {
            "base": self.base_run,
            "head": self.head_run,
            "over": _over(self.n),
            "matched": list(self.matched),
            "only_in_base": list(self.only_in_base),
            "only_in_head": list(self.only_in_head),
            "instrument": {
                "base": dict(self.instrument_base) if self.instrument_base else "unknown",
                "head": dict(self.instrument_head) if self.instrument_head else "unknown",
                "moved": list(self.instrument_moved),
            },
            "mixed": self.mixed,
            "criteria": self.criteria,
            "pairs": self.pairs,
            "adopt": self.adopt,
            "findings": self.findings,
            "brief": self.brief,
            "cost": self.cost,
        }


def _over(n: int) -> str:
    return f"over {n} matched pair{'' if n == 1 else 's'}"


def _instrument(run_dir: Path) -> Mapping[str, Any] | None:
    try:
        loaded = json.loads((run_dir / "run.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    inst = loaded.get("instrument") if isinstance(loaded, Mapping) else None
    return inst if isinstance(inst, Mapping) and inst else None


def _judge(d: Mapping[str, Any]) -> Mapping[str, Any]:
    j = d.get("judge")
    return j if isinstance(j, Mapping) else {}


def _by_pair(dumps: Sequence[Mapping[str, Any]]) -> dict[str, Mapping[str, Any]]:
    return {str(d["pair"]): d for d in dumps if d.get("pair")}


def _criteria(d: Mapping[str, Any]) -> dict[int, bool | None]:
    out: dict[int, bool | None] = {}
    for index, c in enumerate(_judge(d).get("criteria") or [], start=1):
        if isinstance(c, Mapping):
            n = c.get("n")
            p = c.get("pass")
            out[n if isinstance(n, int) else index] = p if isinstance(p, bool) else None
    return out


def _counts(dumps: Sequence[Mapping[str, Any]]) -> dict[str, int]:
    passed, failed, unknown = criteria_counts(dumps)
    return {"pass": passed, "fail": failed, "not_evaluable": unknown}


def _adopt(d: Mapping[str, Any]) -> str | None:
    value = _judge(d).get("adopt")
    return str(value) if value is not None and _judge(d) else None


def _brief(d: Mapping[str, Any]) -> str | None:
    onboarding = d.get("onboarding")
    md = onboarding.get("brief_md") if isinstance(onboarding, Mapping) else None
    return md if isinstance(md, str) and md.strip() else None


def _brief_side(dumps: Sequence[Mapping[str, Any]]) -> tuple[int, int, int]:
    briefs = [b for b in (_brief(d) for d in dumps) if b is not None]
    guesses = sum(1 for b in briefs for line in b.splitlines() if _GUESS in line)
    dates = sum(1 for b in briefs if any(_DATES in line.lower() for line in b.splitlines()))
    return len(briefs), guesses, dates


def _cost_side(dumps: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    priced = [
        float(d["cost_usd"])
        for d in dumps
        if isinstance(d.get("cost_usd"), int | float) and not isinstance(d.get("cost_usd"), bool)
    ]
    out: dict[str, Any] = {"unpriced_pairs": len(dumps) - len(priced)}
    if priced:
        out = {"known_usd": round(sum(priced), 6), **out}
    return out


def compare(base_dir: Path, head_dir: Path) -> Comparison:
    """Compare ``head_dir`` against ``base_dir`` over the pairs both runs dumped."""
    base, head = _by_pair(load_dumps(base_dir)), _by_pair(load_dumps(head_dir))
    matched = tuple(sorted(set(base) & set(head)))
    inst_base, inst_head = _instrument(base_dir), _instrument(head_dir)
    if inst_base is None or inst_head is None:
        moved: tuple[str, ...] = ()
        mixed = True
    else:
        moved = tuple(k for k in IDENTITY if inst_base.get(k) != inst_head.get(k))
        mixed = bool(moved)
    over = _over(len(matched))
    before = [base[p] for p in matched]
    after = [head[p] for p in matched]

    pairs: list[dict[str, Any]] = []
    totals = Counter[str]()
    adopt_changed: list[dict[str, Any]] = []
    for pid in matched:
        old, new = _criteria(base[pid]), _criteria(head[pid])
        row: dict[str, Any] = {
            "pair": pid,
            "flips": [],
            "became_evaluable": [],
            "became_unevaluable": [],
        }
        for n in sorted(set(old) & set(new)):
            was, now = old[n], new[n]
            if was is False and now is True:
                row["flips"].append(f"+{n}")
                totals["fail_to_pass"] += 1
            elif was is True and now is False:
                row["flips"].append(f"-{n}")
                totals["pass_to_fail"] += 1
            elif was is None and now is not None:
                row["became_evaluable"].append(n)
                totals["became_evaluable"] += 1
            elif was is not None and now is None:
                row["became_unevaluable"].append(n)
                totals["became_unevaluable"] += 1
        a_old, a_new = _adopt(base[pid]), _adopt(head[pid])
        if a_old != a_new:
            row["adopt"] = {"before": a_old, "after": a_new}
            adopt_changed.append({"pair": pid, "before": a_old, "after": a_new})
        if row["flips"] or row["became_evaluable"] or row["became_unevaluable"] or "adopt" in row:
            pairs.append(row)
    pairs.sort(
        key=lambda r: (
            -sum(1 for f in r["flips"] if f.startswith("-")),
            -sum(1 for f in r["flips"] if f.startswith("+")),
            r["pair"],
        )
    )

    def adopt_side(dumps: Sequence[Mapping[str, Any]]) -> dict[str, int]:
        seen = Counter(a for a in (_adopt(d) for d in dumps) if a is not None)
        return {k: seen.get(k, 0) for k in _ADOPT} | {
            k: v for k, v in sorted(seen.items()) if k not in _ADOPT
        }

    def findings_side(dumps: Sequence[Mapping[str, Any]]) -> dict[str, int]:
        seen = Counter(
            f"{f.get('type')}/{f.get('dimension')}"
            for d in dumps
            for f in _judge(d).get("findings") or []
            if isinstance(f, Mapping)
        )
        return dict(seen.most_common())

    b_briefs, b_guess, b_dates = _brief_side(before)
    h_briefs, h_guess, h_dates = _brief_side(after)
    return Comparison(
        base_run=base_dir.name,
        head_run=head_dir.name,
        matched=matched,
        only_in_base=tuple(sorted(set(base) - set(head))),
        only_in_head=tuple(sorted(set(head) - set(base))),
        instrument_base=inst_base,
        instrument_head=inst_head,
        instrument_moved=moved,
        mixed=mixed,
        criteria={
            "over": over,
            "mixed": mixed,
            "before": _counts(before),
            "after": _counts(after),
            "fail_to_pass": totals["fail_to_pass"],
            "pass_to_fail": totals["pass_to_fail"],
            "became_evaluable": totals["became_evaluable"],
            "became_unevaluable": totals["became_unevaluable"],
        },
        pairs=pairs,
        adopt={
            "over": over,
            "mixed": mixed,
            "before": adopt_side(before),
            "after": adopt_side(after),
            "changed": adopt_changed,
        },
        findings={
            "over": over,
            "mixed": mixed,
            "before": findings_side(before),
            "after": findings_side(after),
        },
        brief={
            "over": over,
            "mixed": False,
            "briefs": {"before": b_briefs, "after": h_briefs},
            "my_guess_lines": {"before": b_guess, "after": h_guess},
            "dates_sections": {"before": b_dates, "after": h_dates},
        },
        cost={"over": over, "before": _cost_side(before), "after": _cost_side(after)},
    )


def _table(head: Sequence[str], rows: Sequence[Sequence[Any]]) -> list[str]:
    out = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    out += ["| " + " | ".join(str(c).replace("|", "/") for c in row) + " |" for row in rows]
    return out


def _names(ids: Sequence[str], shown: int = 10) -> str:
    if not ids:
        return "-"
    more = len(ids) - shown
    return f"{len(ids)} ({', '.join(ids[:shown])}" + (
        f", and {more} more in compare.json)" if more > 0 else ")"
    )


def _mark(section: Mapping[str, Any]) -> str:
    return " **(mixed: instrument moved)**" if section.get("mixed") else ""


def compare_md(c: Comparison) -> str:
    """compare.md: the header names n and the instrument; losses first."""
    if c.instrument_base is None or c.instrument_head is None:
        sides = [
            side
            for side, inst in (("base", c.instrument_base), ("head", c.instrument_head))
            if inst is None
        ]
        instrument = f"instrument unknown for {' and '.join(sides)} -> judge deltas mixed"
    elif c.instrument_moved:
        instrument = f"instrument moved: {', '.join(c.instrument_moved)} -> judge deltas mixed"
    else:
        instrument = "instrument unchanged"
    heads = [
        f"{side} git {inst.get('git_head')}"
        for side, inst in (("base", c.instrument_base), ("head", c.instrument_head))
        if inst is not None and inst.get("git_head")
    ]
    lines = [
        f"# Chores UAT — run {c.head_run} against {c.base_run}",
        "",
        f"{_over(c.n).capitalize()}; {instrument}." + (f" ({'; '.join(heads)})" if heads else ""),
    ]
    if c.only_in_base or c.only_in_head:
        lines += [
            "",
            f"Left out of every number: only in base {_names(c.only_in_base)}; "
            f"only in head {_names(c.only_in_head)}.",
        ]

    crit = c.criteria
    b, a = crit["before"], crit["after"]
    lines += [
        "",
        f"## Criteria, {crit['over']}{_mark(crit)}",
        "",
        *_table(
            ["", "pass", "fail", "not evaluable"],
            [
                ["before", b["pass"], b["fail"], b["not_evaluable"]],
                ["after", a["pass"], a["fail"], a["not_evaluable"]],
            ],
        ),
        "",
        f"fail->pass {crit['fail_to_pass']}, pass->fail {crit['pass_to_fail']}; "
        f"became evaluable {crit['became_evaluable']}, "
        f"became not evaluable {crit['became_unevaluable']} (null is never a pass).",
    ]
    lines += ["", f"## Pairs that changed ({len(c.pairs)}, losses first)", ""]
    lines += _table(
        ["pair", "flips", "became evaluable", "became not evaluable", "adopt"],
        [
            [
                r["pair"],
                " ".join(r["flips"]) or "-",
                " ".join(str(n) for n in r["became_evaluable"]) or "-",
                " ".join(str(n) for n in r["became_unevaluable"]) or "-",
                f"{r['adopt']['before']} -> {r['adopt']['after']}" if "adopt" in r else "-",
            ]
            for r in c.pairs
        ],
    )

    def triple(side: Mapping[str, int]) -> str:
        return " / ".join(str(side.get(k, 0)) for k in _ADOPT)

    ad = c.adopt
    lines += [
        "",
        f"## Would adopt, {ad['over']}{_mark(ad)}",
        "",
        *_table(
            ["", "yes / maybe / no"],
            [["before", triple(ad["before"])], ["after", triple(ad["after"])]],
        ),
    ]
    fd = c.findings
    kinds = list(dict.fromkeys([*fd["before"], *fd["after"]]))
    lines += [
        "",
        f"## Findings by type/dimension, {fd['over']}{_mark(fd)}",
        "",
        *_table(
            ["type/dimension", "before", "after"],
            [[k, fd["before"].get(k, 0), fd["after"].get(k, 0)] for k in kinds],
        ),
    ]
    br = c.brief
    lines += [
        "",
        f"## Briefs, {br['over']} (read off the brief: judge-independent)",
        "",
        *_table(
            ["measure", "before", "after"],
            [
                [
                    "briefs written",
                    br["briefs"]["before"],
                    br["briefs"]["after"],
                ],
                [
                    "'(my guess)' lines",
                    br["my_guess_lines"]["before"],
                    br["my_guess_lines"]["after"],
                ],
                [
                    "briefs with a 'Dates that matter' section",
                    br["dates_sections"]["before"],
                    br["dates_sections"]["after"],
                ],
            ],
        ),
    ]

    def money(side: Mapping[str, Any]) -> str:
        known = f"${side['known_usd']:.2f} known" if "known_usd" in side else "no priced pair"
        return f"{known}, {side['unpriced_pairs']} unpriced"

    lines += [
        "",
        f"## Cost, {c.cost['over']}",
        "",
        f"before {money(c.cost['before'])}; after {money(c.cost['after'])}.",
    ]
    return "\n".join(lines) + "\n"


def write_compare(c: Comparison, head_dir: Path) -> tuple[Path, Path]:
    md = head_dir / "compare.md"
    md.write_text(compare_md(c), encoding="utf-8", errors=TEXT_ERRORS)
    fj = head_dir / "compare.json"
    fj.write_text(
        json.dumps(c.as_dict(), indent=1, ensure_ascii=False) + "\n",
        encoding="utf-8",
        errors=TEXT_ERRORS,
    )
    return md, fj

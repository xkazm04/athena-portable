"""ADR 0097 (tier bench, the report): the plan before spending, and the tables and picks after.

``--dry`` prints what a run would do and how many model legs it would cost, and spends nothing.
``report`` writes ``report.md`` beside the results: one table per role (config, accuracy, false
clears, repeats, judge, p50/p95, first text, usage), the pick and why, and the disqualified with
their reasons. A number that was not measured is "-", never 0. A Comparability block (ADR 0145)
names the bench digest, the stale records left out, and per role the paired and conditioned cells
the pick was read over; each pick shows the conditioned p50 that ranked it beside the p50 over
every paired cell. Each pick block names the incumbent in ``tiers.json`` and, when the pick
changes it, a table of the incumbent row, the proposed row and their delta; :func:`pick_line` is the
same comparison as the one line ``pick`` prints per role.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from pathlib import Path

from athena.adopt.prompts import MAX_ROUNDS
from athena.proving.adopt_tiers.pick import (
    ACCURACY_MARGIN,
    JUDGE_FLOOR,
    TIE_BAND,
    ConfigStats,
    Pick,
    ShapeStats,
)
from athena.proving.adopt_tiers.simulate import (
    ASSUMED_ROUNDS,
    CONFIGS,
    JUDGE_TIER,
    PERSONA_TIER,
    WALL_S,
    Plan,
)

__all__ = ["dry_text", "pick_line", "report_md", "write_report"]


def _n(value: int) -> str:
    return f"{value:,}"


def dry_text(plan: Plan) -> str:
    bands: dict[str, int] = {}
    for s in plan.scenarios:
        bands[s.band] = bands.get(s.band, 0) + 1
    lines = [
        "adopt tier bench: the plan (nothing is spent)",
        "",
        f"scenarios: {len(plan.scenarios)} ("
        + ", ".join(f"{b} {n}" for b, n in bands.items())
        + ")",
    ]
    for s in plan.scenarios:
        lines.append(
            f"  {s.band:<8} {s.id:<22} {s.playbook_id:<30} difficulty {s.difficulty}, "
            f"{s.portal_count} portals, {len(s.mechanical())} mechanical slots, "
            f"sheet {len(s.sheet)}, stated up front {len(s.stated_up_front)}"
        )
    lines.append(f"configs: {len(plan.configs)}")
    for name in plan.configs:
        tier = CONFIGS[name]
        lines.append(f"  {name:<14} {tier.model} --effort {tier.effort}")
    lines += [
        f"reps: {plan.reps}",
        "roles under test: interview, audit (and the brief writer, an audit-kind leg); "
        "shape benched apart",
        f"fixed: persona {PERSONA_TIER.model} {PERSONA_TIER.effort}, "
        f"judge {JUDGE_TIER.model} {JUDGE_TIER.effort} (blind)",
        "research lanes: off (hooks are no-ops)",
        "",
        f"interviews: {len(plan.scenarios)} x {len(plan.configs)} x {plan.reps} = "
        f"{_n(plan.interviews)} (stop at clear, at card {MAX_ROUNDS}, or at {WALL_S / 60:g} min)",
        f"judge legs: {_n(plan.judges)} (one per transcript)",
        f"shape legs: {_n(plan.shapes)} ({plan.shape_note})",
        f"estimated legs: ~{_n(plan.legs(ASSUMED_ROUNDS))} at {ASSUMED_ROUNDS} cards per "
        f"interview; range {_n(plan.legs(1))} (1 card) to {_n(plan.legs(MAX_ROUNDS))} "
        f"({MAX_ROUNDS} cards); schema retries not counted",
        "",
        f"results: {plan.run_dir.as_posix()}/",
        f"on disk: {plan.interviews_done} of {plan.interviews} interviews, "
        f"{plan.judged} judged, {plan.shapes_done} of {plan.shapes} shape runs",
        f"to run: {len(plan.jobs)} jobs ("
        + ", ".join(
            f"{sum(1 for j in plan.jobs if j.kind == k)} {k}"
            for k in ("interview", "judge", "shape")
        )
        + ")",
    ]
    if plan.stale:
        lines.append(f"{plan.stale} stale (another bench digest) will run again")
    return "\n".join(lines)


def _f(value: float | None, digits: int = 0, unit: str = "") -> str:
    if value is None:
        return "-"
    return f"{value:,.{digits}f}{unit}"


def _usage(value: float | None, unit: str) -> str:
    if value is None:
        return "-"
    return f"${value:.4f}" if unit == "usd" else f"{value:,.0f} tok"


def _role_usage(role: str, s: ConfigStats) -> float | None:
    return s.usage_interview if role == "interview" else s.usage_audit


_SPEED_LABEL = {"interview": "first text", "audit": "round", "shape": "wall"}


def _signed_usage(value: float, unit: str) -> str:
    sign = "-" if value < 0 else "+"
    return f"{sign}${abs(value):.4f}" if unit == "usd" else f"{value:+,.0f} tok"


def _deltas(pick: Pick) -> str:
    d = pick.delta
    parts: list[str] = []
    if d.get("speed_ms") is not None:
        parts.append(f"{_SPEED_LABEL.get(pick.role, 'p50')} {float(d['speed_ms'] or 0):+,.0f} ms")
    if d.get("accuracy") is not None:
        parts.append(f"accuracy {float(d['accuracy'] or 0):+.1f} pt")
    if d.get("judge") is not None:
        parts.append(f"judge {format(round(float(d['judge'] or 0), 2), '+g')}")
    if d.get("usage") is not None:
        parts.append(f"usage {_signed_usage(float(d['usage'] or 0), pick.usage_unit)}")
    text = ", ".join(parts) or "nothing measured to compare"
    if pick.runs:
        text += f" (n {pick.runs.get('incumbent', 0)}/{pick.runs.get('proposed', 0)})"
    return text


def pick_line(pick: Pick) -> str:
    """The line ``pick`` prints for a role: what tiers.json holds now, what the bench proposes,
    by how much and over how many runs, and why the incumbent is out if it is."""
    mark = " (fallback)" if pick.fallback else ""
    if not pick.compared:
        return f"{pick.role}: {pick.config or 'none'}{mark} — {pick.why}"
    held = pick.incumbent or pick.incumbent_note
    if pick.config is None:
        return f"{pick.role}: none, tiers.json keeps {held} — {pick.why}"
    if pick.unchanged:
        return f"{pick.role}: {pick.config} (unchanged){mark} — {pick.why}"
    line = f"{pick.role}: {held} -> {pick.config}{mark}: {_deltas(pick)}"
    if pick.incumbent and pick.incumbent_out:
        line += f"; {pick.incumbent} is out: {'; '.join(pick.incumbent_out)}"
    return f"{line} — {pick.why}"


def _incumbent_lines(
    pick: Pick, stats: Mapping[str, ConfigStats], shape: Mapping[str, ShapeStats]
) -> list[str]:
    if not pick.compared:
        return []
    held = pick.incumbent or pick.incumbent_note
    if pick.unchanged:
        return ["", f"Incumbent in tiers.json: {held} (unchanged)."]
    lines = ["", f"Incumbent in tiers.json: {held}."]
    if pick.incumbent and pick.incumbent_out:
        lines[-1] += f" {pick.incumbent} is out of this run: {'; '.join(pick.incumbent_out)}."
    if pick.config is None or pick.incumbent is None:
        return lines
    label = _SPEED_LABEL.get(pick.role, "p50")
    d = pick.delta
    if pick.role == "shape":
        a, b = shape.get(pick.incumbent), shape.get(pick.config)
        if a is None or b is None:
            return lines
        lines += [
            "",
            f"| | config | runs | valid | {label} p50 | usage/run |",
            "|---|---|---|---|---|---|",
        ]
        for side, s in (("incumbent", a), ("proposed", b)):
            lines.append(
                f"| {side} | {s.config} | {s.runs} | {s.valid} | {_f(s.ms_p50, 0, ' ms')} | "
                f"{_usage(s.usage, s.usage_unit)} |"
            )
        lines.append(
            f"| delta | | | | {_signed(d.get('speed_ms'), ' ms')} | "
            f"{_signed_u(d.get('usage'), pick.usage_unit)} |"
        )
        return lines
    x, y = stats.get(pick.incumbent), stats.get(pick.config)
    if x is None or y is None:
        return lines
    lines += [
        "",
        f"| | config | runs | accuracy % | judge | {label} p50 | usage/run |",
        "|---|---|---|---|---|---|---|",
    ]
    for side, c in (("incumbent", x), ("proposed", y)):
        speed = c.first_text_p50 if pick.role == "interview" else c.round_p50
        lines.append(
            f"| {side} | {c.config} | {c.runs} | {_f(c.accuracy, 1)} | {_f(c.judge, 2)} | "
            f"{_f(speed, 0, ' ms')} | {_usage(_role_usage(pick.role, c), c.usage_unit)} |"
        )
    lines.append(
        f"| delta | | | {_signed(d.get('accuracy'), ' pt', 1)} | "
        f"{_signed(d.get('judge'), '', 2)} | "
        f"{_signed(d.get('speed_ms'), ' ms')} | {_signed_u(d.get('usage'), pick.usage_unit)} |"
    )
    return lines


def _signed(value: float | None, unit: str, digits: int = 0) -> str:
    return "-" if value is None else f"{value:+,.{digits}f}{unit}"


def _signed_u(value: float | None, unit: str) -> str:
    return "-" if value is None else _signed_usage(value, unit)


def _role_table(role: str, stats: Mapping[str, ConfigStats]) -> list[str]:
    lines = [
        "| config | runs | accuracy % | right/wrong/missed | false clears | repeats | judge | "
        "round p50 | round p95 | first text p50 | audit p50 (with brief) | usage/run | ended |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for name, s in stats.items():
        ended = ", ".join(f"{k} {v}" for k, v in sorted(s.ended.items())) or "-"
        lines.append(
            f"| {name} | {s.runs} | {_f(s.accuracy, 1)} | {s.right}/{s.wrong}/{s.missed} | "
            f"{s.false_clears} | {s.repeats} | {_f(s.judge, 2)} ({s.judged}) | "
            f"{_f(s.round_p50, 0, ' ms')} | {_f(s.round_p95, 0, ' ms')} | "
            f"{_f(s.first_text_p50, 0, ' ms')} | {_f(s.audit_p50, 0, ' ms')} | "
            f"{_usage(_role_usage(role, s), s.usage_unit)} | {ended} |"
        )
    return lines


def _pick_lines(
    pick: Pick,
    stats: Mapping[str, ConfigStats] | None = None,
    shape: Mapping[str, ShapeStats] | None = None,
) -> list[str]:
    head = f"**Pick: {pick.config or 'none'}**"
    if pick.config:
        tier = CONFIGS[pick.config]
        head += f" ({tier.model}, effort {tier.effort})"
    lines = [head + f" - {pick.why}."]
    if pick.fallback:
        lines.append("")
        lines.append("> Every config was disqualified; this is the best-accuracy fallback.")
    lines += _incumbent_lines(pick, stats or {}, shape or {})
    if pick.speed:
        lines += [
            "",
            f"Speed ranked over the conditioned ({pick.conditioned} of {pick.paired} paired "
            "cells) subset, where every survivor ended clear or brief; the p50 over every "
            f"paired cell ({pick.paired}) beside it, published, not ranked.",
            "",
            f"| config | p50 conditioned ({pick.conditioned}) | p50 all paired ({pick.paired}) |",
            "|---|---|---|",
        ]
        for name, value in pick.speed.items():
            lines.append(
                f"| {name} | {_f(value, 0, ' ms')} | {_f(pick.pooled.get(name), 0, ' ms')} |"
            )
    if pick.disqualified:
        lines.append("")
        lines.append("Disqualified:")
        for name, reasons in pick.disqualified.items():
            lines.append(f"- {name}: {'; '.join(reasons)}")
    return lines


def report_md(
    stats: Mapping[str, ConfigStats],
    shape: Mapping[str, ShapeStats],
    picks: Sequence[Pick],
    *,
    run_dir: Path,
    scenarios: int,
    shape_note: str,
    stale: int = 0,
    digest: str = "",
) -> str:
    by_role = {p.role: p for p in picks}
    lines = [
        "# Adopt tier bench",
        "",
        f"Results: `{run_dir.as_posix()}`, {scenarios} scenarios, "
        f"{sum(s.runs for s in stats.values())} complete interviews.",
        "",
        "Rule: disqualify any false clear or repeat, accuracy more than "
        f"{ACCURACY_MARGIN:g} points under the best, or judge mean under {JUDGE_FLOOR}; then the "
        f"fastest p50 (interview: first text; audit: round), configs within {TIE_BAND:.0%} of it "
        "broken by usage. One config sets interview and audit together, so both roles read the "
        "same runs' quality.",
        "",
        "Caveat: fact/trap verdicts are matched by patterns (the fact sheet's keys, accept and "
        "reject); a derived slot whose label matches no key is counted missed for every config "
        "alike. Gates are not scored: approval before a gated act is policy, settled before the "
        "first card.",
        "",
        "## Comparability",
        "",
        f"- Bench digest: `{digest[:12] or '-'}` (studio and bench prompts, the card cap, the "
        "scenario sheets); each record carries its scenario's digest.",
        f"- Stale: excluded {stale} record{'' if stale == 1 else 's'} from another bench digest.",
    ]
    for role in ("interview", "audit"):
        p = by_role.get(role)
        if p is not None and p.cells:
            lines.append(
                f"- {role}: quality over paired {p.paired} of {p.cells} cells (every config "
                f"still in the running completed them); speed over {p.conditioned} of them."
            )
    for role in ("interview", "audit"):
        lines += ["", f"## {role}", "", *_role_table(role, stats), ""]
        if role in by_role:
            lines += _pick_lines(by_role[role], stats, shape)
    lines += ["", "## shape", ""]
    pick = by_role.get("shape")
    if pick is None or (pick.config is None and not any(s.runs for s in shape.values())):
        lines.append(f"Not measured: {shape_note or (pick.why if pick else 'no runs')}.")
    else:
        lines += [
            "| config | runs | valid | portals substituted | wall p50 | wall p95 | usage/run |",
            "|---|---|---|---|---|---|---|",
        ]
        for name, s in shape.items():
            lines.append(
                f"| {name} | {s.runs} | {s.valid} | {s.portals_ok} | {_f(s.ms_p50, 0, ' ms')} | "
                f"{_f(s.ms_p95, 0, ' ms')} | {_usage(s.usage, s.usage_unit)} |"
            )
        lines.append("")
        lines += _pick_lines(pick, stats, shape)
    return "\n".join(lines) + "\n"


def write_report(run_dir: Path, text: str) -> Path:
    path = run_dir / "report.md"
    run_dir.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path

"""The forge's report: ``proving-runs/<ts>/forge/report.{json,md}`` (README §9, §14).

Computed from the run directory's files alone, so it can be regenerated after any stage. Same
conventions as every Proving Ground report: an absent value is omitted, never written as 0; every
rate carries its n; costs are per engine. The proof lines of the design brief are computed here, in
code, and printed PASS / FAIL / n-a.

A variant is compared with its base's comparable runs under the bench instrument the variants were
benched with (ADR 0128, :func:`~athena.proving.forge.base.baseline`), never with one draw: a flip
needs a base that held over that set, a recall drop is measured from the base's lowest comparable
recall, and every row carries the baseline (its n) it was judged against. A variant whose base has
no comparable run is reported but counts towards no flip, drop or proof.
"""

from __future__ import annotations

import json
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from athena.proving.forge.base import Base, Baseline, baseline, instrument
from athena.proving.forge.dossier import dossier
from athena.proving.forge.store import ForgeDir, VariantRecord
from athena.proving.forge.validate import code_of
from athena.proving.playbooks.bench import BenchConfig
from athena.proving.report import announce, prune, write_report
from athena.proving.runlog import RunLog

__all__ = ["PROOF_RATIO", "PROOF_RECALL_DROP", "build_report", "render_markdown", "write"]

PROOF_RATIO = 0.5
PROOF_RECALL_DROP = 0.2


def _rate(valid: int, n: int) -> float | None:
    return round(valid / n, 3) if n else None


def _generator(variants: Sequence[VariantRecord]) -> dict[str, Any] | None:
    if not variants:
        return None
    counted = [v for v in variants if not v.void]
    valid = sum(1 for v in counted if v.valid)
    refusals: Counter[str] = Counter()
    for v in counted:
        if not v.valid:
            refusals.update({code_of(p) for p in v.problems})
    costs = [v.cost_usd for v in variants if v.cost_usd is not None]
    return {
        "model": next((v.model for v in variants if v.model), None),
        "n": len(counted),
        "valid": valid,
        "valid_rate": _rate(valid, len(counted)),
        "voided": len(variants) - len(counted),
        "refusals": dict(sorted(refusals.items(), key=lambda kv: (-kv[1], kv[0]))),
        "cost_usd": round(sum(costs), 6) if costs else None,
    }


def _ledger_costs(path: Path) -> dict[str, dict[str, Any]]:
    """Calls and known cost per engine, read as :func:`~athena.proving.forge.store.restore_budget`
    reads the same file: a torn line (a killed run) is skipped, and a purse refusal is no call."""
    out: dict[str, dict[str, Any]] = {}
    for row in RunLog.read(path):
        if row.get("error_reason") == "budget_exhausted":
            continue
        engine = str(row.get("engine"))
        slot = out.setdefault(engine, {"calls": 0, "unpriced_calls": 0, "cost": 0.0})
        slot["calls"] += 1
        if isinstance(row.get("cost_usd"), int | float):
            slot["cost"] += float(row["cost_usd"])
        else:
            slot["unpriced_calls"] += 1
    return {
        e: {
            "cost_usd": round(s["cost"], 4) if s["calls"] > s["unpriced_calls"] else None,
            "calls": s["calls"],
            "unpriced_calls": s["unpriced_calls"] or None,
        }
        for e, s in out.items()
    }


def build_report(
    store: ForgeDir,
    bases: Mapping[str, Base],
    *,
    run_id: str,
    seed: int,
    n: int,
    rung: str,
    dry: bool,
    picks: Mapping[str, Any],
    models: Mapping[str, Any],
    bench_note: str = "",
    config: BenchConfig | None = None,
) -> dict[str, Any]:
    cfg = config or BenchConfig()
    nem = store.load_variants("nemotron")
    hai = store.load_variants("haiku")
    gen_n, gen_h = _generator(nem), _generator(hai)
    ratio = None
    if gen_n and gen_h and gen_n["valid_rate"] is not None and gen_h["valid_rate"]:
        ratio = round(gen_n["valid_rate"] / gen_h["valid_rate"], 3)

    rows: list[dict[str, Any]] = []
    audited_flips = raw_flips = drops = benched = 0
    comparable_benched = comparable_audited = 0
    not_comparable: set[str] = set()
    stands_on: list[int] = []
    audit_items = holds = errors = unaudited = audited_variants = 0
    forge_errors: list[dict[str, Any]] = []
    findings: list[dict[str, Any]] = []
    for pid in picks.get("ids", []):
        base = bases[pid]
        bl: Baseline = baseline(base, cfg)
        out_variants: list[dict[str, Any]] = []
        for v in sorted((x for x in nem if x.playbook == pid), key=lambda x: x.k):
            row: dict[str, Any] = {
                "k": v.k,
                "valid": v.valid,
                "refused": v.codes or None,
                "void": v.void or None,
            }
            if store.bench_path(v).is_file():
                bench = ForgeDir.read(store.bench_path(v))
                benched += 1
                word = (bench.get("verdict") or {}).get("word")
                recall = (bench.get("score") or {}).get("recall_value")
                row.update(
                    verdict=word,
                    recall_value=recall,
                    cost_usd=bench.get("cost_usd"),
                    n_eligible=(bench.get("score") or {}).get("eligible"),
                )
                row["baseline"] = bl.as_dict()
                if bl.comparable:
                    comparable_benched += 1
                    flipped = bl.held and word == "short"
                    row["raw_flip"] = flipped
                    raw_flips += flipped
                else:
                    not_comparable.add(pid)
                if store.audit_path(v).is_file():
                    audit = ForgeDir.read(store.audit_path(v))
                    audited_variants += 1
                    items = audit.get("items", [])
                    audit_items += len(items)
                    holds += sum(1 for i in items if i.get("label_holds") is True)
                    errors += sum(1 for i in items if i.get("label_holds") is False)
                    unaudited += sum(1 for i in items if i.get("label_holds") is None)
                    # Each finding carries what judging it needs: its row and the rerun line.
                    review = dossier(store, base, v)
                    for e in review.entries:
                        if e.state not in ("finding", "forge-error"):
                            continue
                        entry = prune(
                            {
                                "playbook": pid,
                                "k": v.k,
                                "kind": e.kind,
                                "id": e.key,
                                "label": e.label,
                                "why": e.why,
                                "table": e.table or None,
                                "row": e.row or None,
                                "filed": [c.get("params", {}) for c in e.filed] or None,
                                "cards_on_tool": e.cards_on_tool,
                                "rerun": review.rerun,
                            }
                        )
                        (findings if e.state == "finding" else forge_errors).append(entry)
                    fixed = audit.get("corrected", {})
                    c_word, c_recall = fixed.get("word"), fixed.get("recall_value")
                    audited_row: dict[str, Any] = {
                        "items": len(items),
                        "label_holds": sum(1 for i in items if i.get("label_holds") is True),
                        "forge_errors": sum(1 for i in items if i.get("label_holds") is False),
                        "verdict": c_word,
                        "recall_value": c_recall,
                    }
                    if bl.comparable:
                        comparable_audited += 1
                        a_flip = bl.held and c_word == "short"
                        # From the base's minimum: a drop must leave the base's observed range.
                        drop = (
                            round(bl.recall_min - float(c_recall), 3)
                            if bl.recall_min is not None and isinstance(c_recall, int | float)
                            else None
                        )
                        audited_row.update(flip=a_flip, recall_drop=drop)
                        dropped = drop is not None and drop >= PROOF_RECALL_DROP
                        audited_flips += a_flip
                        drops += dropped
                        if a_flip or dropped:
                            stands_on.append(bl.n)
                    row["audited"] = audited_row
            elif store.void_path(v).is_file():
                row["bench"] = "void (the run ended on an error)"
            out_variants.append(row)
        rows.append(
            {
                "playbook": pid,
                "category": base.category,
                "base": {
                    "verdict": base.verdict_word or None,
                    "recall_value": base.recall_value,
                    "baseline": bl.as_dict(),
                },
                "variants": out_variants,
            }
        )

    planned = sum(1 for v in nem if v.valid)
    proof = _proof(
        ratio,
        gen_n,
        gen_h,
        Counts(
            benched=benched,
            comparable=comparable_benched,
            audited=comparable_audited,
            flips=audited_flips,
            drops=drops,
            bases_not_comparable=len(not_comparable),
            smallest_n=min(stands_on) if stands_on else None,
            instrument=instrument(cfg),
        ),
    )
    report: dict[str, Any] = {
        "run_id": run_id,
        "dry": dry or None,
        "experiment": "forge",
        "seed": seed,
        "n_per_playbook": n,
        "rung": rung,
        "models": dict(models),
        "picks": dict(picks),
        "generators": {"nemotron": gen_n, "haiku_control": gen_h},
        "valid_rate_ratio_nemotron_over_haiku": ratio,
        "playbooks": rows,
        "bench": {
            "valid_variants": planned,
            "benched": benched,
            "shown": announce(benched, planned) or None,
            "note": bench_note or None,
        },
        "audit": {
            "variants_audited": audited_variants,
            "items": audit_items,
            "label_holds_athena_findings": holds,
            "forge_errors": errors,
            "unaudited": unaudited or None,
        },
        "flips": {
            "raw_exceeds_to_short": raw_flips,
            "audited_exceeds_to_short": audited_flips,
            "recall_drops_ge_0_2": drops,
            "n_variants_benched": benched,
            "n_variants_comparable": comparable_benched,
            "n_variants_comparable_audited": comparable_audited,
            "bases_not_comparable": sorted(not_comparable) or None,
        },
        "athena_findings": findings,
        "forge_errors": forge_errors,
        "cost_usd": _ledger_costs(store.runlog),
        "proof": proof,
    }
    return report


@dataclass(frozen=True)
class Counts:
    """What proof-2 is computed from: only variants whose base has a comparable run count."""

    benched: int
    comparable: int
    audited: int
    flips: int
    drops: int
    bases_not_comparable: int
    smallest_n: int | None
    instrument: str


def _proof(
    ratio: float | None,
    gen_n: Mapping[str, Any] | None,
    gen_h: Mapping[str, Any] | None,
    c: Counts,
) -> list[dict[str, Any]]:
    if ratio is None:
        p1 = {"status": "n-a", "detail": "no Haiku control (or it produced no valid variant)"}
        if gen_n:
            p1["detail"] += f"; Nemotron valid {gen_n['valid']} of {gen_n['n']}"
    else:
        assert gen_n and gen_h
        status = "PASS" if ratio >= PROOF_RATIO else "FAIL"
        p1 = {
            "status": status,
            "detail": (
                f"Nemotron valid {gen_n['valid']}/{gen_n['n']} ({gen_n['valid_rate']:.0%}) "
                f"vs Haiku "
                f"{gen_h['valid']}/{gen_h['n']} ({gen_h['valid_rate']:.0%}): ratio {ratio:.2f}, "
                f"need >= {PROOF_RATIO}"
                + ("" if status == "PASS" else "; kill: revise the prompt twice, then Haiku forges")
            ),
        }
    aside = (
        f"; {c.bases_not_comparable} base(s) had no comparable run under {c.instrument}, "
        "their variants not counted"
        if c.bases_not_comparable
        else ""
    )
    if not c.benched:
        p2 = {"status": "n-a", "detail": "no variant benched"}
    elif not c.comparable:
        p2 = {
            "status": "n-a",
            "detail": f"{c.benched} benched, but none of their {c.bases_not_comparable} base(s) "
            f"has a comparable run under {c.instrument}: no flip or drop can be measured",
        }
    elif not c.audited:
        p2 = {
            "status": "n-a",
            "detail": f"{c.comparable} benched against a comparable base, none audited: "
            f"no verdict flip counts{aside}",
        }
    elif c.flips or c.drops:
        p2 = {
            "status": "PASS",
            "detail": f"{c.flips} audited flip(s), {c.drops} recall drop(s) >= "
            f"{PROOF_RECALL_DROP} over {c.comparable} variants benched against a comparable "
            f"base ({c.audited} audited); the smallest baseline it stands on is "
            f"n={c.smallest_n}{aside}",
        }
    else:
        p2 = {
            "status": "FAIL",
            "detail": f"bench robust on {c.comparable} variants ({c.audited} audited) against "
            "their bases' comparable runs: zero audited flips and no recall drop >= 0.2 below "
            f"a base's lowest comparable recall; reported as a result, not a defect{aside}",
        }
    return [
        {"id": "proof-1", "claim": "Nemotron valid rate >= 50% of Haiku's", **p1},
        {"id": "proof-2", "claim": ">=1 audited exceeds->short flip or recall drop >= 0.2", **p2},
    ]


def render_markdown(report: Mapping[str, Any]) -> str:
    lines = [f"# World forge: run {report['run_id']}", ""]
    if report.get("dry"):
        lines += [
            "**DRY RUN.** Fixture generators and a scripted bench: these numbers check plumbing "
            "and measure nothing.",
            "",
        ]
    lines += ["## Proof", ""]
    for p in report["proof"]:
        lines.append(f"- **{p['status']}**: {p['claim']}. {p['detail']}")
    picks = report["picks"]
    lines += ["", "## Picks", "", ", ".join(picks.get("ids", [])) or "(none)"]
    for note in picks.get("notes", []):
        lines.append(f"- {note}")
    lines += [
        "",
        "## Generators",
        "",
        "| generator | model | valid | n | rate | cut or void |",
        "|---|---|---|---|---|---|",
    ]
    for name, g in report["generators"].items():
        if g:
            rate = f"{g['valid_rate']:.0%}" if g.get("valid_rate") is not None else "n-a"
            lines.append(
                f"| {name} | {g.get('model', '')} | {g['valid']} | {g['n']} | {rate} | "
                f"{g.get('voided', 0)} |"
            )
    ratio = report.get("valid_rate_ratio_nemotron_over_haiku")
    lines += ["", f"Ratio Nemotron / Haiku: {ratio if ratio is not None else 'n-a'}", ""]
    lines += ["## Refusal reasons", ""]
    for name, g in report["generators"].items():
        if g:
            hist = ", ".join(f"{c}: {k}" for c, k in g["refusals"].items()) or "none"
            lines.append(f"- {name}: {hist}")
    lines += [
        "",
        "## Playbooks",
        "",
        "| playbook | base | variant | valid | verdict | recall | audited verdict "
        "| audited recall |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for pb in report["playbooks"]:
        base = pb["base"]
        b = _baseline_cell(base)
        for v in pb["variants"]:
            a = v.get("audited", {})
            lines.append(
                f"| {pb['playbook']} | {b} | v{v['k']} | {'yes' if v['valid'] else 'no'} | "
                f"{v.get('verdict', '-')} | {_pct(v.get('recall_value'))} | "
                f"{a.get('verdict', '-')} | {_pct(a.get('recall_value'))} |"
            )
    flips, audit, bench = report["flips"], report["audit"], report["bench"]
    lines += [
        "",
        "## Flips and audit",
        "",
        f"- benched {bench['benched']} of {bench['valid_variants']} valid variants "
        f"{bench.get('shown') or ''}".rstrip(),
        # Each count over the variants it was counted over: a flip needs a comparable base.
        f"- raw exceeds->short flips: {flips['raw_exceeds_to_short']} "
        f"of {flips['n_variants_comparable']} benched against a comparable base",
        f"- audited flips: {flips['audited_exceeds_to_short']} "
        f"of {flips.get('n_variants_comparable_audited', 0)} audited against a comparable base",
        f"- recall drops >= 0.2: {flips['recall_drops_ge_0_2']}",
        f"- audit items {audit['items']}: {audit['label_holds_athena_findings']} Athena findings, "
        f"{audit['forge_errors']} forge errors",
    ]
    if bench.get("note"):
        lines.append(f"- {bench['note']}")
    review = [("finding", f) for f in report.get("athena_findings", [])] + [
        ("forge error", f) for f in report.get("forge_errors", [])
    ]
    if review:
        lines += ["", "## Review", ""]
        lines.append(
            "Each audited item to attribute: Athena defect (the label holds) or a bad generated "
            "label (a forge error). `python -m athena.proving.forge show --run-dir <run> "
            "<playbook>-v<k>` prints one variant's whole dossier."
        )
        for state, f in review:
            lines += _review_block(state, f)
    lines += ["", "## Cost", ""]
    for engine, c in report["cost_usd"].items():
        cost = f"${c['cost_usd']:.4f}" if c.get("cost_usd") is not None else "unreported"
        lines.append(f"- {engine}: {cost} over {c['calls']} calls")
    return "\n".join(lines)


def _review_block(state: str, f: Mapping[str, Any]) -> list[str]:
    row = f.get("row")
    out = [
        "",
        f"### {f['playbook']}-v{f['k']}: {state}, {f.get('kind', '?')} {f.get('id', '?')}",
        "",
        f"- row: `{f['table']}` `{json.dumps(row, ensure_ascii=False)}`"
        if row
        else "- row: (the id has no row in the variant's tables)",
        f"- label: {f.get('label') or '-'}",
        f"- auditor: {f.get('why') or '-'}",
    ]
    if f.get("filed"):
        out.append(
            f"- filed: {len(f['filed'])} card(s), "
            + "; ".join(f"`{json.dumps(p, ensure_ascii=False)}`" for p in f["filed"])
        )
    elif f.get("cards_on_tool") is not None:
        out.append(f"- filed: nothing on it; {f['cards_on_tool']} card(s) on that tool")
    if f.get("rerun"):
        out.append(f"- rerun: `{f['rerun']}`")
    return out


def _baseline_cell(base: Mapping[str, Any]) -> str:
    bl = base.get("baseline") or {}
    if not bl.get("comparable"):
        return f"{base.get('verdict', '?')} {_pct(base.get('recall_value'))} (no comparable run)"
    low = bl.get("recall_min")
    spread = f", min {_pct(low)}" if low is not None else ""
    return f"{bl['word']} {_pct(bl.get('recall_median'))}{spread} (n={bl['n']})"


def _pct(value: Any) -> str:
    return f"{float(value):.0%}" if isinstance(value, int | float) else "-"


def write(store: ForgeDir, report: Mapping[str, Any]) -> tuple[Path, Path]:
    return write_report(store.root, report, render_markdown(report))

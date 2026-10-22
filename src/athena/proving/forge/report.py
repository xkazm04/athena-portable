"""The forge's report: ``proving-runs/<ts>/forge/report.{json,md}`` (README §9, §14).

Computed from the run directory's files alone, so it can be regenerated after any stage. Same
conventions as every Proving Ground report: an absent value is omitted, never written as 0; every
rate carries its n; costs are per engine. The proof lines of the design brief are computed here, in
code, and printed PASS / FAIL / n-a.
"""

from __future__ import annotations

import json
from collections import Counter
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from athena.proving.forge.base import Base
from athena.proving.forge.store import ForgeDir, VariantRecord
from athena.proving.forge.validate import code_of
from athena.proving.report import announce, write_report

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
    out: dict[str, dict[str, Any]] = {}
    if not path.is_file():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
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
) -> dict[str, Any]:
    nem = store.load_variants("nemotron")
    hai = store.load_variants("haiku")
    gen_n, gen_h = _generator(nem), _generator(hai)
    ratio = None
    if gen_n and gen_h and gen_n["valid_rate"] is not None and gen_h["valid_rate"]:
        ratio = round(gen_n["valid_rate"] / gen_h["valid_rate"], 3)

    rows: list[dict[str, Any]] = []
    audited_flips = raw_flips = drops = benched = 0
    audit_items = holds = errors = unaudited = audited_variants = 0
    forge_errors: list[dict[str, Any]] = []
    findings: list[dict[str, Any]] = []
    for pid in picks.get("ids", []):
        base = bases[pid]
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
                flipped = base.verdict_word in ("exceeds", "meets") and word == "short"
                row["raw_flip"] = flipped
                raw_flips += flipped
                if store.audit_path(v).is_file():
                    audit = ForgeDir.read(store.audit_path(v))
                    audited_variants += 1
                    items = audit.get("items", [])
                    audit_items += len(items)
                    holds += sum(1 for i in items if i.get("label_holds") is True)
                    errors += sum(1 for i in items if i.get("label_holds") is False)
                    unaudited += sum(1 for i in items if i.get("label_holds") is None)
                    for i in items:
                        entry = {
                            "playbook": pid,
                            "k": v.k,
                            "kind": i.get("kind"),
                            "id": i.get("key"),
                        }
                        if i.get("label_holds") is False:
                            forge_errors.append({**entry, "why": i.get("why")})
                        elif i.get("label_holds") is True:
                            findings.append({**entry, "why": i.get("why")})
                    fixed = audit.get("corrected", {})
                    c_word, c_recall = fixed.get("word"), fixed.get("recall_value")
                    a_flip = base.verdict_word in ("exceeds", "meets") and c_word == "short"
                    drop = (
                        round(base.recall_value - float(c_recall), 3)
                        if base.recall_value is not None and isinstance(c_recall, int | float)
                        else None
                    )
                    row["audited"] = {
                        "items": len(items),
                        "label_holds": sum(1 for i in items if i.get("label_holds") is True),
                        "forge_errors": sum(1 for i in items if i.get("label_holds") is False),
                        "verdict": c_word,
                        "recall_value": c_recall,
                        "flip": a_flip,
                        "recall_drop": drop,
                    }
                    audited_flips += a_flip
                    drops += drop is not None and drop >= PROOF_RECALL_DROP
            elif store.void_path(v).is_file():
                row["bench"] = "void (the run ended on an error)"
            out_variants.append(row)
        rows.append(
            {
                "playbook": pid,
                "category": base.category,
                "base": {"verdict": base.verdict_word or None, "recall_value": base.recall_value},
                "variants": out_variants,
            }
        )

    planned = sum(1 for v in nem if v.valid)
    proof = _proof(ratio, gen_n, gen_h, benched, audited_variants, audited_flips, drops)
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
        },
        "athena_findings": findings,
        "forge_errors": forge_errors,
        "cost_usd": _ledger_costs(store.runlog),
        "proof": proof,
    }
    return report


def _proof(
    ratio: float | None,
    gen_n: Mapping[str, Any] | None,
    gen_h: Mapping[str, Any] | None,
    benched: int,
    audited: int,
    flips: int,
    drops: int,
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
    if not benched:
        p2 = {"status": "n-a", "detail": "no variant benched"}
    elif not audited:
        p2 = {"status": "n-a", "detail": f"{benched} benched, none audited: no verdict flip counts"}
    elif flips or drops:
        p2 = {
            "status": "PASS",
            "detail": f"{flips} audited flip(s), {drops} recall drop(s) >= {PROOF_RECALL_DROP} "
            f"over {benched} benched variants ({audited} audited)",
        }
    else:
        p2 = {
            "status": "FAIL",
            "detail": f"bench robust on {benched} variants ({audited} audited): zero audited "
            "flips and no recall drop >= 0.2; reported as a result, not a defect",
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
        b = f"{base.get('verdict', '?')} {_pct(base.get('recall_value'))}"
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
        f"- raw exceeds->short flips: {flips['raw_exceeds_to_short']} "
        f"of {flips['n_variants_benched']}",
        f"- audited flips: {flips['audited_exceeds_to_short']} "
        f"of {audit['variants_audited']} audited",
        f"- recall drops >= 0.2: {flips['recall_drops_ge_0_2']}",
        f"- audit items {audit['items']}: {audit['label_holds_athena_findings']} Athena findings, "
        f"{audit['forge_errors']} forge errors",
    ]
    if bench.get("note"):
        lines.append(f"- {bench['note']}")
    lines += ["", "## Cost", ""]
    for engine, c in report["cost_usd"].items():
        cost = f"${c['cost_usd']:.4f}" if c.get("cost_usd") is not None else "unreported"
        lines.append(f"- {engine}: {cost} over {c['calls']} calls")
    return "\n".join(lines)


def _pct(value: Any) -> str:
    return f"{float(value):.0%}" if isinstance(value, int | float) else "-"


def write(store: ForgeDir, report: Mapping[str, Any]) -> tuple[Path, Path]:
    return write_report(store.root, report, render_markdown(report))

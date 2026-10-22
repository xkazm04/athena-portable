"""WP-V (nvidia-revisit): the report. JSON for machines, markdown for the Director.

Absent values are omitted from the JSON (``write_report`` prunes ``None``), never written as 0.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

__all__ = ["render_markdown"]


def _pct(value: object) -> str:
    return f"{value * 100:.1f}%" if isinstance(value, int | float) else "n/a"


def _num(value: object, fmt: str) -> str:
    return format(value, fmt) if isinstance(value, int | float) else "n/a"


def render_markdown(report: Mapping[str, Any]) -> str:
    proof = report.get("proof", {})
    lines = [
        f"# docread: does Nemotron-3.5-Super-VL read documents as well as the Claude lane?"
        f"{'  (DRY RUN - fixture answers, not a measurement)' if report.get('dry') else ''}",
        "",
        f"run `{report.get('run_id')}` - {len(report.get('scenarios', []))} scenarios, "
        f"degradations {', '.join(report.get('degradations', []))}",
        "",
        f"**Verdict: {proof.get('verdict')}**",
    ]
    if "accuracy_ratio" in proof:
        lines.append(
            f"accuracy ratio VL/Claude {proof['accuracy_ratio']:.3f} "
            f"(pass >= 0.90, kill < 0.70); false-fact delta {proof['false_fact_delta_pp']:+.2f} pp "
            f"(pass <= +5); n = {proof.get('vl_units')} VL / "
            f"{proof.get('claude_units')} Claude paired units"
        )
    elif proof.get("reason"):
        lines.append(str(proof["reason"]))
    lines += ["", "## Models", ""]
    for role, model in (report.get("models") or {}).items():
        lines.append(f"- {role}: `{model}`")
    lines += [
        "",
        "## Readers (paired units only)",
        "",
        "| reader | units | fields (n) | accuracy | false facts / probes | false-fact rate "
        "| latency p50 | cost / doc |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for name, s in (report.get("paired") or {}).items():
        lines.append(
            f"| {name} | {s['units']} | {s['fields_stated']} | {_pct(s.get('field_accuracy'))} | "
            f"{s['false_facts']} / {s['probes']} | {_pct(s.get('false_fact_rate'))} | "
            f"{_num(s.get('latency_p50_ms'), '.0f')} ms | "
            f"${_num(s.get('cost_per_doc_usd'), '.4f')} |"
        )
    lines += [
        "",
        "### Accuracy by degradation",
        "",
        "| reader | degradation | accuracy | fields | units |",
        "|---|---|---|---|---|",
    ]
    for name, s in (report.get("paired") or {}).items():
        for deg, d in s["by_degradation"].items():
            lines.append(
                f"| {name} | {deg} | {_pct(d.get('accuracy'))} | {d['fields']} | {d['units']} |"
            )
    lines += ["", "## All answered units (not paired)", ""]
    for name, s in (report.get("all") or {}).items():
        lines.append(
            f"- {name}: {s['units']} units, {s['void']} void, {s['bad_answers']} unusable answers, "
            f"accuracy {_pct(s.get('field_accuracy'))} of {s['fields_stated']} fields, "
            f"false-fact rate {_pct(s.get('false_fact_rate'))} of {s['probes']} probes"
        )
    lines += ["", "## Cost", ""]
    for engine, spent in (report.get("cost_usd") or {}).items():
        lines.append(
            f"- {engine}: ${spent['spent_usd']:.4f} of ${spent['cap_usd']:.2f} cap, "
            f"{spent['calls']} calls ({spent['unpriced_calls']} unpriced)"
        )
    misses = report.get("misses") or {}
    for name, rows in misses.items():
        lines += [
            "",
            f"## {name}: incorrect fields ({report.get('misses_shown', {}).get(name, '')})",
            "",
        ]
        lines += [f"- `{r['unit']}` {r['entry']}: {r['what']}" for r in rows]
    return "\n".join(lines) + "\n"

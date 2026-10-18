"""Every results/*.json -> the tables in README.md (printed as Markdown; results/summary.md too)."""

from __future__ import annotations

import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import common  # noqa: E402

R = common.RESULTS
NAMES = ("s1_5", "s3", "s6", "s10")


def med(xs: list[float]) -> float:
    return statistics.median(xs)


def rng(xs: list[float], nd: int = 2) -> str:
    return f"{med(xs):.{nd}f} ({min(xs):.{nd}f}-{max(xs):.{nd}f})"


def load_dir(d: Path) -> list[dict]:
    return [json.loads(f.read_text(encoding="utf-8")) for f in sorted(d.glob("*.json"))] if d.is_dir() else []


def motion_table(rows: list[dict], key=lambda d: d["label"].rsplit("-r", 1)[0]) -> list[str]:  # type: ignore[no-untyped-def]
    groups: dict[str, list[dict]] = defaultdict(list)
    for d in rows:
        groups[key(d)].append(d)
    durs = {n: rows[0]["sentences"][n]["duration_s"] for n in NAMES if n in rows[0]["sentences"]}
    head = ("| config | n proc | cold load s | first motion ready s | "
            + " | ".join(f"{n} ({durs[n]} s) wall s" for n in durs) + " | RTF s3 | RTF s10 | cores used | peak WS MB | bg busy % |")
    out = [head, "|" + "---|" * (head.count("|") - 1)]
    for g, ds in groups.items():
        cells = [g, str(len(ds)), rng([d["cold_load"]["wall_s"] for d in ds], 1),
                 rng([d["first_motion_ready_s"] for d in ds], 1)]
        for n in durs:
            cells.append(rng([r["wall_s"] for d in ds for r in d["sentences"][n]["runs"]]))
        for n in ("s3", "s10"):
            cells.append(f"{med([r['rtf'] for d in ds for r in d['sentences'][n]['runs']]):.2f}")
        cells.append(f"{med([r['cores_used'] for d in ds for n in durs for r in d['sentences'][n]['runs']]):.1f}")
        cells.append(f"{med([d['mem_end']['peak_ws_mb'] for d in ds]):.0f}")
        cells.append(f"{med([r['machine_busy_pct'] for d in ds for n in durs for r in d['sentences'][n]['runs']]):.0f}")
        out.append("| " + " | ".join(cells) + " |")
    return out


def split_table(rows: list[dict]) -> list[str]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for d in rows:
        groups[d["label"].rsplit("-r", 1)[0]].append(d)
    out = ["| config | sentence | audio encoder s | denoiser s (calls) | other s |", "|---|---|---|---|---|"]
    for g, ds in groups.items():
        for n in ("s3", "s10"):
            runs = [r for d in ds for r in d["sentences"][n]["runs"]]
            out.append(f"| {g} | {n} | {med([r['audio_s'] for r in runs]):.3f} | "
                       f"{med([r['denoise_s'] for r in runs]):.3f} ({runs[0]['denoise_calls']}) | "
                       f"{med([r['other_s'] for r in runs]):.3f} |")
    return out


def visemes_table() -> list[str]:
    rows = load_dir(R / "visemes")
    if not rows:
        return []
    groups: dict[str, list[dict]] = defaultdict(list)
    for d in rows:
        groups[d["config"]].append(d)
    names = [n for n in NAMES if n in rows[0]["sentences"]]
    head = "| config | session load s | " + " | ".join(
        f"{n} ({rows[0]['sentences'][n]['duration_s']} s, {rows[0]['sentences'][n]['n_tokens']} tok) ms" for n in names) + " | first call s10 ms |"
    out = [head, "|" + "---|" * (head.count("|") - 1)]
    for g, ds in groups.items():
        cells = [g, rng([d["load"]["wall_s"] for d in ds])]
        for n in names:
            cells.append(rng([1000 * r["wall_s"] for d in ds for r in d["sentences"][n]["runs"]], 0))
        cells.append(rng([1000 * d["sentences"]["s10"]["first_call"]["wall_s"] for d in ds], 0))
        out.append("| " + " | ".join(cells) + " |")
    return out


def render_s(lines: list[dict]) -> str:
    """Median Kokoro render time per sentence (render-done deltas), or '-' when not rendered live."""
    d = [x["sentences"][k]["render_done_s"] - (x["sentences"][k - 1]["render_done_s"] if k else 0)
         for x in lines for k in range(len(x["sentences"]))]
    return f"{med(d):.1f}" if med(d) > 0.05 else "-"


def replay_table() -> list[str]:
    rows = load_dir(R / "replay")
    if not rows:
        return []
    out = ["| config | kokoro | lines | in time (of 5) per line | first sentence late s | worst late after first s | "
           "audio gaps s (sum) | first audio s | motion coverage % | render s/sentence | bg busy % |",
           "|---|---|---|---|---|---|---|---|---|---|---|"]
    for d in rows:
        L = d["lines"]
        out.append(
            f"| {d['label']} | {d['kokoro']} | {len(L)} | {', '.join(str(x['in_time']) for x in L)} | "
            f"{', '.join(f'{x['first_sentence_late_s']:.2f}' for x in L)} | "
            f"{', '.join(f'{x['max_late_after_first_s']:.2f}' for x in L)} | "
            f"{', '.join(f'{sum(x['audio_gaps_s']):.2f}' for x in L)} | "
            f"{', '.join(f'{x['first_audio_s']:.1f}' for x in L)} | "
            f"{100 * sum(s['covered_frac'] * s['duration_s'] for x in L for s in x['sentences']) / sum(s['duration_s'] for x in L for s in x['sentences']):.0f} | "
            f"{render_s(L)} | "
            f"{med([x['machine_busy_pct'] for x in L]):.0f} |")
    return out


def variants_table() -> list[str]:
    rows = load_dir(R / "variants")
    if not rows:
        return []
    out = ["| variant | cold load s | peak WS MB | s3 wall s | s10 wall s | denoiser s3 s | audio enc s3 s |",
           "|---|---|---|---|---|---|---|"]
    for d in rows:
        s3 = d["sentences"]["s3"]["runs"]
        s10 = d["sentences"]["s10"]["runs"]
        out.append(f"| {d['label'].replace('var-', '')} | {d['cold_load']['wall_s']:.1f} | {d['mem_end']['peak_ws_mb']:.0f} | "
                   f"{rng([r['wall_s'] for r in s3])} | {rng([r['wall_s'] for r in s10])} | "
                   f"{med([r['denoise_s'] for r in s3]):.3f} | {med([r['audio_s'] for r in s3]):.3f} |")
    return out


def main() -> None:
    lines: list[str] = []
    th = load_dir(R / "threads")
    if th:
        lines += ["## Motion per config", ""] + motion_table(th) + ["", "## Stage split", ""] + split_table(th) + [""]
    v = visemes_table()
    if v:
        lines += ["## Visemes", ""] + v + [""]
    rp = replay_table()
    if rp:
        lines += ["## Live replay", ""] + rp + [""]
    va = variants_table()
    if va:
        lines += ["## Variants", ""] + va + [""]
    text = "\n".join(lines)
    print(text)
    with open(R / "summary.md", "w", encoding="utf-8", newline="") as fh:
        fh.write(text + "\n")


if __name__ == "__main__":
    main()

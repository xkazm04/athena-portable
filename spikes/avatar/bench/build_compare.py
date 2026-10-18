"""Build the blinded comparison page beside the bench clips.

Every track that rendered a portrait's three lines becomes an entry for that portrait under a
random letter. The page plays a line's entries side by side in sync; metrics and track names stay
hidden until the viewer ranks and presses Reveal. The letter-to-track map is written into the page
(behind Reveal) and to ``_blind.json`` so the Director can read a ranking back.

    python spikes/avatar/bench/build_compare.py [--seed N]
"""

from __future__ import annotations

import argparse
import json
import os
import random
from pathlib import Path

HOME = Path(os.environ.get("ATHENA_AVATAR_HOME", Path.home() / ".athena-avatar"))
BENCH = HOME / "bench"
TRACKS = ("t1-rig", "t2-neural", "t4-hybrid")
LINES = ("calm", "question", "long")
NAMES = {
    "t1-rig": "T1 · 2D glow rig, procedural motion",
    "t2-neural": "T2 · neural talking head (Ditto)",
    "t4-hybrid": "T4 · 2D glow rig, neural motion from audio",
}
PAGE = Path(__file__).with_name("compare.template.html")


def entries_for(portrait: str) -> list[dict]:
    found = []
    for track in TRACKS:
        clips = {line: BENCH / track / portrait / f"{line}.mp4" for line in LINES}
        if not all(p.exists() for p in clips.values()):
            continue
        metrics = {}
        for line in LINES:
            m = clips[line].with_suffix(".metrics.json")
            if m.exists():
                metrics[line] = json.loads(m.read_text(encoding="utf-8"))
        found.append({
            "track": track,
            "name": NAMES[track],
            "clips": {line: f"{track}/{portrait}/{line}.mp4" for line in LINES},
            "metrics": metrics,
        })
    return found


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=None)
    ns = ap.parse_args()
    rng = random.Random(ns.seed)
    portraits = sorted(
        p.name for p in (HOME / "portraits").iterdir()
        if p.is_dir() and not p.name.startswith("_") and (p / "portrait.png").exists()
    )
    data, blind = {}, {}
    for portrait in portraits:
        entries = entries_for(portrait)
        if not entries:
            continue
        rng.shuffle(entries)
        for letter, e in zip("ABCDEFGH", entries):
            e["letter"] = letter
        blind[portrait] = {e["letter"]: e["track"] for e in entries}
        data[portrait] = {"portrait": f"../portraits/{portrait}/portrait.png", "entries": entries}
    lines = json.loads((Path(__file__).with_name("lines.json")).read_text(encoding="utf-8"))["lines"]
    payload = {"portraits": data, "lines": {l["id"]: l["text"] for l in lines}}
    html = PAGE.read_text(encoding="utf-8").replace(
        "__DATA__", json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")
    )
    (BENCH / "compare.html").write_text(html, encoding="utf-8")
    (BENCH / "_blind.json").write_text(json.dumps(blind, indent=1), encoding="utf-8")
    for p, m in blind.items():
        print(p, "entries:", len(m))
    print("wrote", BENCH / "compare.html")


if __name__ == "__main__":
    main()

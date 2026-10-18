"""Distillation corpus: plain English sentences from the repo's own docs, rendered by Kokoro.

    python distill/corpus.py --n 600 --workers 4

Sentences are taken from ``docs/**/*.md`` and ``README.md`` (prose only: no code, paths, links or
markup; 4-40 words), shuffled with a fixed seed, and rendered with af_heart exactly as the daemon
plays them (2 threads, default silence scale). Output: DATA/distill/wav/<id>.wav + corpus.json.
"""

from __future__ import annotations

import argparse
import random
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import common  # noqa: E402
from render import render  # noqa: E402

OUT = common.DATA / "distill"
OK = re.compile(r"^[A-Z][A-Za-z ,;:'\-\.?!]+[\.?!]$")


def sentences() -> list[str]:
    files = sorted((common.REPO / "docs").rglob("*.md")) + [common.REPO / "README.md"]
    seen: set[str] = set()
    out: list[str] = []
    for f in files:
        text = f.read_text(encoding="utf-8", errors="replace")
        text = re.sub(r"```.*?```", " ", text, flags=re.S)
        for para in re.split(r"\n\s*\n", text):
            if para.lstrip().startswith(("#", "|", ">", "-", "*", "<", "!")):
                continue
            para = " ".join(para.split())
            for s in re.split(r"(?<=[\.?!])\s+", para):
                s = s.strip()
                words = s.split()
                if not (4 <= len(words) <= 40) or not OK.match(s) or s in seen:
                    continue
                if any(w.isupper() and len(w) > 1 for w in words):  # acronyms read badly
                    continue
                seen.add(s)
                out.append(s)
    return out


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--n", type=int, default=600)
    p.add_argument("--workers", type=int, default=4)
    a = p.parse_args()
    pool = sentences()
    random.Random(0).shuffle(pool)
    chosen = pool[: a.n]
    print(f"{len(pool)} candidate sentences, rendering {len(chosen)}", flush=True)
    (OUT / "wav").mkdir(parents=True, exist_ok=True)

    def one(item: tuple[int, str]) -> dict:
        i, text = item
        wav = OUT / "wav" / f"{i:04d}.wav"
        if not wav.is_file():
            render(text, wav)
        pcm, sr = common.read_wav(wav)
        return {"id": f"{i:04d}", "text": text, "duration_s": round(len(pcm) / 2 / sr, 3)}

    with ThreadPoolExecutor(a.workers) as ex:
        rows = list(ex.map(one, enumerate(chosen)))
    common.write_json(OUT / "corpus.json", rows)
    total = sum(r["duration_s"] for r in rows)
    print(f"{len(rows)} sentences, {total / 60:.1f} min of audio", flush=True)


if __name__ == "__main__":
    main()

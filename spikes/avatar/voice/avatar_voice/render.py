"""Render every bench line: WAV + Timeline v1 + a check image.

    uv run --project spikes/avatar/voice python -m avatar_voice.render [--only calm,question]
    (with UV_PROJECT_ENVIRONMENT=~/.athena-avatar/venvs/wp-l so the venv stays out of the repo)

CPU only (onnxruntime CPU EP); never touches CUDA, so no GPU lock.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import wave
from pathlib import Path

import numpy as np

from avatar_voice import engine
from avatar_voice.visemes import absorb_pre_closure, merge_short, phones, visemes_of

HERE = Path(__file__).resolve().parents[1]
LINES = HERE.parent / "bench" / "lines.json"
HOME = Path(os.environ.get("ATHENA_AVATAR_HOME", Path.home() / ".athena-avatar"))
OUT = HOME / "voice"
SR = engine.SAMPLE_RATE


def split_sentences(text: str) -> list[str]:
    """The daemon's per-sentence split for these lines (``kokoro.split_sentences``), so each
    sentence is a separate engine run exactly as the app speaks it. Imported from the app when it
    is importable (read-only use); a plain ``. ? !``-then-space splitter otherwise."""
    src = HERE.parents[2] / "src"
    try:
        sys.path.insert(0, str(src))
        from athena.channels.voice.kokoro import split_sentences as app_split  # type: ignore

        return list(app_split(text))
    except Exception:
        import re

        parts = [p.strip() for p in re.split(r"(?<=[.?!])\s+", text.strip()) if p.strip()]
        out: list[str] = []
        for p in parts:
            if out and len(p) < 12:
                out[-1] += " " + p
            else:
                out.append(p)
        return out
    finally:
        if sys.path and sys.path[0] == str(src):
            sys.path.pop(0)


def render_line(model: engine.Kokoro, symbols: dict[int, str], line: dict, work: Path) -> dict:
    sentences = split_sentences(line["text"])
    audio_parts: list[np.ndarray] = []
    all_ph: list[dict] = []
    offset = 0
    stats: list[dict] = []
    exe_tokens: list[list[list[int]]] = []
    for si, sentence in enumerate(sentences):
        seqs, sherpa_wav = engine.sherpa_tokens(sentence, work / f"{line['id']}-{si}")
        exe_tokens.append(seqs)
        with wave.open(str(sherpa_wav), "rb") as w:
            sherpa_n = w.getnframes()
        mine_n = 0
        for seq in seqs:
            piece = model.piece(seq)
            syms = [symbols.get(t, "?") if t != 0 else "$PAD" for t in seq]
            ph = phones(syms, piece.spans, piece.audio)
            for u in ph:
                all_ph.append({"p": u["p"], "a": u["a"] + offset, "b": u["b"] + offset})
            audio_parts.append(piece.audio)
            offset += piece.audio.shape[0]
            mine_n += piece.audio.shape[0]
        stats.append({"sentence": sentence, "sherpa_samples": sherpa_n, "ours_samples": mine_n})
    audio = np.concatenate(audio_parts)
    n = audio.shape[0]
    # phones -> contiguous cover of 0..n (sil in any gap)
    cover: list[dict] = []
    t = 0
    for u in all_ph:
        a, b = max(u["a"], t), u["b"]
        if b <= a:
            continue
        if a > t:
            cover.append({"p": "sil", "a": t, "b": a})
        cover.append({"p": u["p"], "a": a, "b": b})
        t = b
    if t < n:
        cover.append({"p": "sil", "a": t, "b": n})
    vis = merge_short(absorb_pre_closure(visemes_of(cover), SR), SR)
    pcm = engine.to_pcm16(audio)
    # the exe's token ids, kept for verify's token-vs-phoneme check
    work.mkdir(parents=True, exist_ok=True)
    (work / f"{line['id']}.tokens.json").write_text(json.dumps(exe_tokens), encoding="utf-8")
    return {"audio": pcm, "phones": cover, "visemes": vis, "stats": stats}


def write_outputs(line: dict, res: dict) -> dict:
    OUT.mkdir(parents=True, exist_ok=True)
    wav_path = OUT / f"{line['id']}.wav"
    with wave.open(str(wav_path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(res["audio"].tobytes())
    n = res["audio"].shape[0]
    sec = lambda s: round(s / SR, 4)  # noqa: E731
    timeline = {
        "version": 1,
        "line_id": line["id"],
        "text": line["text"],
        "sample_rate": SR,
        "duration_s": sec(n),
        "phonemes": [{"p": u["p"], "start": sec(u["a"]), "end": sec(u["b"])} for u in res["phones"]],
        "visemes": [{"v": u["v"], "start": sec(u["a"]), "end": sec(u["b"])} for u in res["visemes"]],
    }
    (OUT / f"{line['id']}.timeline.json").write_text(json.dumps(timeline, ensure_ascii=False, indent=1), encoding="utf-8")
    return timeline


def validate(tl: dict, n_samples: int) -> list[str]:
    errs: list[str] = []
    allowed = {"sil", "PP", "FF", "TH", "DD", "kk", "CH", "SS", "nn", "RR", "aa", "E", "ih", "oh", "ou"}
    for key, lab in (("phonemes", "p"), ("visemes", "v")):
        segs = tl[key]
        if abs(segs[0]["start"]) > 1e-9:
            errs.append(f"{key} does not start at 0")
        for a, b in zip(segs, segs[1:]):
            if abs(a["end"] - b["start"]) > 1e-6:
                errs.append(f"{key} gap/overlap at {a['end']}")
        if abs(segs[-1]["end"] - n_samples / SR) > 0.04:
            errs.append(f"{key} end {segs[-1]['end']} vs audio {n_samples / SR}")
    bad = {s["v"] for s in tl["visemes"]} - allowed
    if bad:
        errs.append(f"non-Oculus visemes {bad}")
    return errs


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="comma-separated line ids")
    ap.add_argument("--seed", type=float, default=1.0,
                    help="decoder noise seed (reproducible WAVs); pass -1 for sherpa-like fresh noise")
    ap.add_argument("--no-check", action="store_true", help="skip the check images")
    args = ap.parse_args(argv)
    if args.seed is not None and args.seed < 0:
        args.seed = None
    lines = json.loads(LINES.read_text(encoding="utf-8"))["lines"]
    if args.only:
        keep = set(args.only.split(","))
        lines = [ln for ln in lines if ln["id"] in keep]
    model = engine.Kokoro(seed=args.seed)
    symbols = engine.load_symbols()
    work = OUT / "_work"
    report = []
    for line in lines:
        t0 = time.perf_counter()
        res = render_line(model, symbols, line, work)
        tl = write_outputs(line, res)
        errs = validate(tl, res["audio"].shape[0])
        dt = time.perf_counter() - t0
        if not args.no_check:
            from avatar_voice.check import draw

            draw(line, tl, res["audio"], OUT / "check" / f"{line['id']}.png")
        entry = {
            "line": line["id"],
            "duration_s": tl["duration_s"],
            "visemes": len(tl["visemes"]),
            "phonemes": len(tl["phonemes"]),
            "seconds": round(dt, 2),
            "sentences": res["stats"],
            "errors": errs,
        }
        report.append(entry)
        print(json.dumps(entry, ensure_ascii=False))
    if not args.no_check and not args.only:
        from avatar_voice import verify

        if verify.main() != 0:
            print("verify: FAILED (see check/verify.json)")
            return 1
    (OUT / "_work" / "render-report.json").write_text(json.dumps(report, indent=1, ensure_ascii=False), encoding="utf-8")
    return 1 if any(e["errors"] for e in report) else 0


if __name__ == "__main__":
    raise SystemExit(main())

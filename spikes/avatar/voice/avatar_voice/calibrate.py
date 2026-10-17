"""Measure the constant lead of Kokoro's audio over its predicted token durations.

Kokoro's decoder output is not centred on the duration grid: acoustic events arrive earlier
than the cumulative pred_dur says (kokoro's own ``join_timestamps`` subtracts 3 units from the
leading pad for the same reason). Here we measure it rather than copy a magic number: a corpus
rich in stops is rendered, and for each shift d in -150..+50 ms the score

    mean log RMS over vowel spans  -  mean log RMS over stop (p b t d k g) spans

is computed on the shifted token spans (stops have a closure: their true span is the quietest
part of speech; vowels the loudest). The best d is the lead. Raw model audio, before
ScaleSilence, so no cut distorts the grid.

    uv run --project spikes/avatar/voice python -m avatar_voice.calibrate
"""

from __future__ import annotations

import json

import numpy as np

from avatar_voice import engine
from avatar_voice.render import OUT

CORPUS = [
    "Papa paid a pound for a puppy, and Bob bought a fifth bobbin.",
    "Peter picked a peck of pickled peppers before breakfast.",
    "Did the dog dig a deep ditch by the gate?",
    "Kate baked a big cake, but Tom kept the cookbook.",
    "Maybe the boat will be back by ten, but probably not.",
    "Five vivid photos of a far valley were filed in the office.",
    "Every other bit of the budget goes to deposits and debts.",
    "Good morning. I read the three invoices that came in overnight.",
]
STOPS = set("pbtdkgɡ")
VOWELS = set("aɑæʌɐeɛəɪiɨoɔɒuʊAIOWYᵊᵻɚɜ")


def score(audio: np.ndarray, syms: list[str], edges: np.ndarray, shift_n: int) -> tuple[float, float]:
    hop = 120
    env = np.sqrt(np.convolve(audio.astype(np.float64) ** 2, np.ones(hop) / hop, "same")) + 1e-5
    ls, lv = [], []
    for i, s in enumerate(syms):
        a, b = edges[i] + shift_n, edges[i + 1] + shift_n
        if a < 0 or b > len(audio) or b <= a:
            continue
        v = float(np.mean(np.log(env[a:b])))
        if s in STOPS:
            ls.append(v)
        elif s in VOWELS:
            lv.append(v)
    return (float(np.mean(lv)) if lv else 0.0), (float(np.mean(ls)) if ls else 0.0)


def main() -> int:
    model = engine.Kokoro()
    sym = engine.load_symbols()
    shifts = list(range(-150, 55, 5))
    totals = np.zeros(len(shifts))
    per_sentence = {}
    for k, text in enumerate(CORPUS):
        seqs, _ = engine.sherpa_tokens(text, OUT / "_work" / f"cal-{k}")
        for seq in seqs:
            audio, dur = model.run(seq)
            syms = [sym.get(t, "?") for t in seq]
            edges = np.concatenate([[0], np.cumsum(dur) * engine.FRAME])
            row = []
            for j, ms in enumerate(shifts):
                v, s = score(audio, syms, edges, int(ms * engine.SAMPLE_RATE / 1000))
                row.append(v - s)
            row = np.array(row)
            totals += row
            per_sentence[text] = shifts[int(np.argmax(row))]
    best = shifts[int(np.argmax(totals))]
    result = {
        "best_shift_ms": best,
        "per_sentence_best_ms": per_sentence,
        "curve": {str(s): round(float(t), 3) for s, t in zip(shifts, totals)},
    }
    print(json.dumps(result, ensure_ascii=False, indent=1))
    (OUT / "check").mkdir(parents=True, exist_ok=True)
    (OUT / "check" / "calibration.json").write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Is our WAV the app's voice? Compare it with sherpa's own WAVs of the same sentence.

Kokoro's decoder draws noise, so two sherpa runs already differ; the yardstick is therefore
d(sherpa_a, sherpa_b), and ours passes when d(sherpa_a, ours) is of the same size. Distance is
the mean absolute log-mel difference (dB) over frames aligned by DTW, plus the length gap.

    uv run --project spikes/avatar/voice python -m avatar_voice.sameness
"""

from __future__ import annotations

import json
import subprocess
import wave
from pathlib import Path

import numpy as np

from avatar_voice import engine
from avatar_voice.render import LINES, OUT, split_sentences


def _read(p: Path) -> np.ndarray:
    with wave.open(str(p), "rb") as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768


def _logmel(x: np.ndarray, sr: int = 24000, n_fft: int = 1024, hop: int = 240, n_mels: int = 80) -> np.ndarray:
    win = np.hanning(n_fft)
    frames = [x[i : i + n_fft] * win for i in range(0, len(x) - n_fft, hop)]
    spec = np.abs(np.fft.rfft(np.array(frames), axis=1)) ** 2
    f = np.fft.rfftfreq(n_fft, 1 / sr)
    mel = lambda hz: 2595 * np.log10(1 + hz / 700)  # noqa: E731
    pts = np.linspace(mel(0), mel(sr / 2), n_mels + 2)
    hz = 700 * (10 ** (pts / 2595) - 1)
    fb = np.zeros((n_mels, len(f)))
    for m in range(n_mels):
        lo, c, hi = hz[m], hz[m + 1], hz[m + 2]
        fb[m] = np.clip(np.minimum((f - lo) / (c - lo), (hi - f) / (hi - c)), 0, None)
    return 10 * np.log10(spec @ fb.T + 1e-10)


def _dtw_dist(a: np.ndarray, b: np.ndarray) -> float:
    n, m = len(a), len(b)
    cost = np.abs(a[:, None, :] - b[None, :, :]).mean(axis=2)
    acc = np.full((n + 1, m + 1), np.inf)
    acc[0, 0] = 0
    steps = np.zeros((n + 1, m + 1))
    for i in range(1, n + 1):
        for j in range(max(1, i - 60), min(m, i + 60) + 1):
            best = min((acc[i - 1, j - 1], steps[i - 1, j - 1]), (acc[i - 1, j], steps[i - 1, j]), (acc[i, j - 1], steps[i, j - 1]))
            acc[i, j] = best[0] + cost[i - 1, j - 1]
            steps[i, j] = best[1] + 1
    return float(acc[n, m] / steps[n, m])


def main() -> int:
    work = OUT / "_work" / "sameness"
    work.mkdir(parents=True, exist_ok=True)
    line = next(ln for ln in json.loads(LINES.read_text(encoding="utf-8"))["lines"] if ln["id"] == "question")
    sentence = split_sentences(line["text"])[0]
    runs = []
    for k in range(2):
        out = work / f"sherpa-{k}.wav"
        subprocess.run(engine.app_args(out, sentence), capture_output=True, check=True, timeout=180)
        runs.append(_read(out))
    ours = _read(OUT / "question.wav")
    ma, mb, mo = (_logmel(v) for v in (runs[0], runs[1], ours))
    res = {
        "sentence": sentence,
        "samples": {"sherpa_a": len(runs[0]), "sherpa_b": len(runs[1]), "ours": len(ours)},
        "logmel_dtw_db": {
            "sherpa_a_vs_sherpa_b": round(_dtw_dist(ma, mb), 3),
            "sherpa_a_vs_ours": round(_dtw_dist(ma, mo), 3),
            "sherpa_b_vs_ours": round(_dtw_dist(mb, mo), 3),
        },
    }
    print(json.dumps(res, indent=1))
    (OUT / "check" / "sameness.json").write_text(json.dumps(res, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

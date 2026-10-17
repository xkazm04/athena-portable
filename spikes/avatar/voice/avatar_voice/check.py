"""Alignment image: waveform + spectrogram + phoneme strip + viseme strip + text.

Rows are split into windows of WINDOW_S seconds so 25 ms closures stay visible. PP and FF
segments are shaded across the waveform and spectrogram, so a reader checks at a glance whether
a lip closure sits on the silence-then-burst of /p b m/ and labiodental frication of /f v/.
"""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

WINDOW_S = 2.5
COLORS = {
    "sil": "#dddddd", "PP": "#d62728", "FF": "#ff7f0e", "TH": "#8c564b", "DD": "#9467bd",
    "kk": "#7f7f7f", "CH": "#e377c2", "SS": "#bcbd22", "nn": "#17becf", "RR": "#1f77b4",
    "aa": "#2ca02c", "E": "#98df8a", "ih": "#aec7e8", "oh": "#c5b0d5", "ou": "#c49c94",
}


def draw(line: dict, tl: dict, pcm: np.ndarray, path: Path) -> None:
    sr = tl["sample_rate"]
    x = pcm.astype(np.float32) / 32768.0
    dur = len(x) / sr
    rows = int(np.ceil(dur / WINDOW_S))
    fig, axes = plt.subplots(rows * 3, 1, figsize=(18, 3.3 * rows + 0.6),
                             gridspec_kw={"height_ratios": [2, 2, 1] * rows})
    axes = np.atleast_1d(axes)
    fig.suptitle(f"{line['id']}: {line['text']}", fontsize=10, wrap=True)
    for r in range(rows):
        t0, t1 = r * WINDOW_S, min(dur, (r + 1) * WINDOW_S)
        a, b = int(t0 * sr), int(t1 * sr)
        ax_w, ax_s, ax_v = axes[3 * r], axes[3 * r + 1], axes[3 * r + 2]
        t = np.arange(a, b) / sr
        ax_w.plot(t, x[a:b], lw=0.4, color="black")
        ax_w.set_xlim(t0, t0 + WINDOW_S)
        ax_w.set_ylim(-1, 1)
        ax_w.set_yticks([])
        if b - a > 512:
            ax_s.specgram(x[a:b], NFFT=512, Fs=sr, noverlap=448, xextent=(t0, t1), cmap="magma", vmin=-120)
        ax_s.set_xlim(t0, t0 + WINDOW_S)
        ax_s.set_ylim(0, 8000)
        ax_s.set_yticks([])
        for seg in tl["visemes"]:
            if seg["end"] < t0 or seg["start"] > t1:
                continue
            c = COLORS.get(seg["v"], "#ffffff")
            ax_v.axvspan(seg["start"], seg["end"], ymin=0.5, ymax=1.0, color=c, ec="white", lw=0.5)
            ax_v.text((seg["start"] + seg["end"]) / 2, 0.75, seg["v"], ha="center", va="center", fontsize=7, clip_on=True)
            if seg["v"] in ("PP", "FF"):
                for ax in (ax_w, ax_s):
                    ax.axvspan(seg["start"], seg["end"], color=c, alpha=0.25 if ax is ax_w else 0.0,
                               ec=c, lw=1.0)
        for seg in tl["phonemes"]:
            if seg["end"] < t0 or seg["start"] > t1:
                continue
            ax_v.axvspan(seg["start"], seg["end"], ymin=0.0, ymax=0.45, color="#f4f4f4", ec="#999999", lw=0.5)
            ax_v.text((seg["start"] + seg["end"]) / 2, 0.22, seg["p"], ha="center", va="center", fontsize=8, clip_on=True)
        ax_v.set_xlim(t0, t0 + WINDOW_S)
        ax_v.set_ylim(0, 1)
        ax_v.set_yticks([])
        ax_v.set_xticks(np.arange(np.ceil(t0 * 10) / 10, t0 + WINDOW_S, 0.1), minor=True)
        ax_w.set_xticklabels([])
        ax_s.set_xticklabels([])
    fig.tight_layout()
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=110)
    plt.close(fig)

"""A/B numbers + curve plot: t1 procedural RigParams vs t4 neural RigParams for one line.

Metrics (per track):
  blinks, blink_rate_per_min, blink intervals     - human resting ~15-20/min, speaking ~ 10-25/min
  head std / range per axis (deg)                 - how much it moves
  head speed  p50 / p95 (deg/s, all axes)         - how fast
  jerk  (mean |d3 head|, deg/s^3)                 - smoothness (lower = smoother)
  audio_coupling = corr(|head angular speed|, speech envelope), lag-searched 0..300 ms
                                                  - does the head move *with* the voice
  nod_on_stress  = share of the 5 loudest syllable peaks with a pitch-down velocity peak within
                   +-150 ms                       - beat gestures

    python t4/compare.py --line calm --a A.rigparams.json --b B.rigparams.json --wav calm.wav --png out.png
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from scipy.signal import find_peaks


def arr(rp, path):
    out = []
    for f in rp["frames"]:
        v = f
        for k in path:
            v = v.get(k, 0) if isinstance(v, dict) else 0
        out.append(float(v or 0))
    return np.array(out)


def envelope(wav: str, fps: int, n: int) -> np.ndarray:
    import librosa

    y, sr = librosa.load(wav, sr=16000, mono=True)
    hop = sr // fps
    rms = librosa.feature.rms(y=y, frame_length=hop * 2, hop_length=hop, center=True)[0]
    rms = np.convolve(rms, np.ones(5) / 5, mode="same")
    out = np.zeros(n)
    m = min(n, len(rms))
    out[:m] = rms[:m]
    return out / (out.max() + 1e-9)


def metrics(rp, env, fps):
    yaw, pitch, roll = (arr(rp, ("head", k)) for k in ("yaw", "pitch", "roll"))
    blink = (arr(rp, ("eyes", "blinkL")) + arr(rp, ("eyes", "blinkR"))) / 2
    dur = len(yaw) / fps
    pk, _ = find_peaks(blink, height=0.5, distance=int(0.2 * fps))
    H = np.stack([yaw, pitch, roll])
    vel = np.diff(H, axis=1) * fps
    speed = np.linalg.norm(vel, axis=0)
    jerk = np.abs(np.diff(H, 3, axis=1)).mean() * fps**3
    e = env[1:len(speed) + 1]
    best = max((np.corrcoef(speed[: len(speed) - L], e[L:len(speed)])[0, 1], L)
               for L in range(0, int(0.3 * fps)) if np.std(speed[: len(speed) - L]) > 0) if np.std(speed) > 0 else (0, 0)
    # syllable peaks of the envelope
    sp, _ = find_peaks(env, distance=int(0.18 * fps), prominence=0.1)
    top = sp[np.argsort(env[sp])[-5:]] if len(sp) else sp
    pv = np.diff(pitch) * fps
    nod_pk, _ = find_peaks(pv, height=np.percentile(pv, 80) if len(pv) else 0)
    hit = sum(any(abs(n - s) <= 0.15 * fps for n in nod_pk) for s in top)
    return {
        "blinks": int(len(pk)), "blink_times": [round(p / fps, 2) for p in pk],
        "blink_rate_per_min": round(len(pk) / dur * 60, 1),
        "head_std_deg": {k: round(float(np.std(v)), 2) for k, v in zip(("yaw", "pitch", "roll"), H)},
        "head_range_deg": {k: round(float(np.ptp(v)), 2) for k, v in zip(("yaw", "pitch", "roll"), H)},
        "head_speed_deg_s": {"p50": round(float(np.percentile(speed, 50)), 2), "p95": round(float(np.percentile(speed, 95)), 2)},
        "jerk_deg_s3": round(float(jerk), 1),
        "audio_coupling": {"r": round(float(best[0]), 3), "lag_ms": round(best[1] * 1000 / fps)},
        "nod_on_stress": f"{hit}/{len(top)}",
        "brow_std": round(float(np.std(arr(rp, ("brow", "raise")))), 3),
        "gaze_std": round(float(np.std(arr(rp, ("eyes", "gazeX")))), 3),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--line", required=True)
    ap.add_argument("--a", required=True)
    ap.add_argument("--b", required=True)
    ap.add_argument("--wav", required=True)
    ap.add_argument("--png")
    ap.add_argument("--json")
    a = ap.parse_args()
    A, B = (json.loads(Path(p).read_text()) for p in (a.a, a.b))
    fps = A["fps"]
    n = max(len(A["frames"]), len(B["frames"]))
    env = envelope(a.wav, fps, n)
    res = {"line": a.line, "A_t1_procedural": metrics(A, env, fps), "B_t4_neural": metrics(B, env, fps)}
    print(json.dumps(res, indent=1))
    if a.json:
        Path(a.json).write_text(json.dumps(res, indent=1))
    if a.png:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        chans = [("yaw", ("head", "yaw")), ("pitch (down+)", ("head", "pitch")), ("roll", ("head", "roll")),
                 ("blink", ("eyes", "blinkL")), ("brow", ("brow", "raise")), ("gazeX", ("eyes", "gazeX")),
                 ("mouth.open", ("mouth", "open"))]
        fig, ax = plt.subplots(len(chans) + 1, 1, figsize=(14, 13), sharex=True)
        t = np.arange(n) / fps
        ax[0].fill_between(t, env, color="#999")
        ax[0].set_ylabel("speech env")
        for i, (name, path) in enumerate(chans, 1):
            for rp, lab, sty in ((A, "A t1 procedural", "--"), (B, "B t4 neural", "-")):
                v = arr(rp, path)
                ax[i].plot(np.arange(len(v)) / fps, v, sty, label=lab, lw=1.2)
            ax[i].set_ylabel(name)
        ax[1].legend(loc="upper right")
        ax[-1].set_xlabel("s")
        fig.suptitle(f"{a.line}: t1 procedural (dashed) vs t4 neural (solid)")
        fig.tight_layout()
        fig.savefig(a.png, dpi=80)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

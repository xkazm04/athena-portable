"""Neural motion (JoyVASA, 25 fps) + WP-L Timeline -> CONTRACT RigParams v1 at 60 fps.

What comes from where:
  head yaw/pitch/roll  JoyVASA pose (degrees), minus the clip median, sign-mapped to the rig's image
                       convention, zero-phase low-passed, cubic-resampled to 60 fps.
  blinks               JoyVASA expression -> decoder (calibrate.py) -> blink *events* (peak picking);
                       each event is re-synthesised with a crisp lid profile at 60 fps, because the
                       25 fps neural curve is too coarse to carry a 100 ms closure but its timing is
                       the point.
  brow.raise           decoder, normalised by the carrier distribution, low-passed.
  gaze                 decoder (iris offset), gain-mapped, low-passed.
  mouth.visemes        WP-L Timeline (exact phonemes from the TTS), coarticulated like t1 does.
  mouth.open           Timeline viseme opening, modulated by the neural jaw energy (stress/prosody);
                       with no Timeline, the neural jaw alone.

    python t4/retarget.py --motion calm.motion.npz --decoder decoder.json \
        [--timeline ~/.athena-avatar/voice/calm.timeline.json] --out calm.rigparams.json

CPU only.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from scipy.interpolate import CubicSpline
from scipy.signal import butter, filtfilt, find_peaks

FPS = 60
# Oculus-15 opening/press, kept equal to t1's spikes/avatar/web/src/visemes.js SHAPES so the mouth
# reads the same on both motion sources (only open/press are needed here).
SHAPES = {
    "sil": (0.0, 0.0), "PP": (0.0, 1.0), "FF": (0.12, 0.0), "TH": (0.2, 0.0), "DD": (0.28, 0.0),
    "kk": (0.33, 0.0), "CH": (0.26, 0.0), "SS": (0.14, 0.0), "nn": (0.2, 0.0), "RR": (0.24, 0.0),
    "aa": (0.9, 0.0), "E": (0.55, 0.0), "ih": (0.38, 0.0), "oh": (0.62, 0.0), "ou": (0.32, 0.0),
}


def lowpass(x: np.ndarray, hz: float, fs: float) -> np.ndarray:
    if hz >= fs / 2 or len(x) < 16:
        return x
    b, a = butter(2, hz / (fs / 2))
    return filtfilt(b, a, x, padlen=min(len(x) - 1, 3 * max(len(a), len(b))))


def smoothstep(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def resample(x: np.ndarray, fs_in: float, t_out: np.ndarray) -> np.ndarray:
    t_in = np.arange(len(x)) / fs_in
    return CubicSpline(t_in, x, bc_type="natural")(np.clip(t_out, 0, t_in[-1]))


def decode(exp: np.ndarray, ch: dict) -> np.ndarray:
    """Same feature map as calibrate.features: absolute exp, flattened."""
    return exp.reshape(len(exp), -1) @ np.asarray(ch["w"]) + ch["b"]


def blink_track(v: np.ndarray, fs: float, t: np.ndarray, ch: dict, min_gap=2.2,
                lid_max=0.6, closed_ref=0.5) -> tuple[np.ndarray, list]:
    """Two layers from one decoded lid curve.

    JoyVASA's lid events are mostly slow partial drops (~0.3 s, MediaPipe eyeBlink peaks 0.2-0.35
    on the carrier: a heavy-lidded downward glance while speaking, ~1/s), not blinks. Rendering each
    as a full blink gave 45-74 blinks/min. So:
      lid    - the continuous partial closure, kept as is (neural timing *and* shape), capped at lid_max
      blinks - crisp full blinks only on the strongest lid peaks, at least `min_gap` s apart
               (caps the rate near the human 15-30/min), re-synthesised at 60 fps because a
               100 ms closure does not survive 25 fps sampling.
    """
    lo = ch["p50"]
    norm = np.clip((v - lo) / (closed_ref - lo), 0, 1.2)
    lid = resample(lowpass(np.clip(norm, 0, 1) * lid_max, 6.0, fs), fs, t)
    peaks, props = find_peaks(norm, height=0.35, prominence=0.25)
    chosen: list[int] = []
    for p in sorted(peaks, key=lambda p: -norm[p]):  # strongest first, enforce spacing
        if all(abs(p - c) >= min_gap * fs for c in chosen):
            chosen.append(p)
    events = sorted((p / fs, 1.0) for p in chosen)
    out = np.clip(lid, 0, 1)
    for tc, amp in events:
        d = t - (tc - 0.06)  # neural peak = mid-closure; close 75 ms, hold 35 ms, open 170 ms
        prof = np.where(d < 0, 0, np.where(d < 0.075, smoothstep(d / 0.075),
                        np.where(d < 0.11, 1, 1 - smoothstep((d - 0.11) / 0.17))))
        out = np.maximum(out, amp * np.where(d > 0.28, 0, prof))
    return out, events


def viseme_weights(t: float, vis: list, lead=0.035, R=0.045) -> dict:
    tt, w = t + lead, {}
    for s in vis:
        if s["end"] + R < tt or s["start"] - R > tt:
            continue
        up = (tt - (s["start"] - R)) / (2 * R)
        dn = ((s["end"] + R) - tt) / (2 * R)
        x = float(smoothstep(min(up, dn, 1)))
        if x > 0:
            w[s["v"]] = max(w.get(s["v"], 0), x)
    tot = sum(w.values())
    if tot > 1:
        w = {k: v / tot for k, v in w.items()}
    return w


def build(motion: dict, dec: dict, timeline: dict | None, head_gain=1.0, gaze_gain=4.0,
          jaw_mod=0.5, brow_gain=0.6, head_hz=2.0, question_overlay=True, lid_max=0.6, overlay_gain=1.0) -> tuple[dict, dict]:
    fs = float(motion["fps"])
    n_in = len(motion["exp"])
    dur = float(timeline["duration_s"]) if timeline else n_in / fs
    t = np.arange(int(round(dur * FPS)) + 1) / FPS
    C = dec["channels"]

    head = {}
    # JoyVASA's raw pose carries a ~1-1.5 Hz bobble at syllable rate; 2 Hz keeps the beat nods and
    # drops the jitter (head speed p50 fell from ~10 to the values in the README)
    for k, hz in (("yaw", head_hz), ("pitch", head_hz * 1.25), ("roll", head_hz * 0.8)):
        x = motion[k].astype(np.float64)
        x = (x - np.median(x)) * dec["pose"][k]["sign_to_rig"] * head_gain
        head[k] = resample(lowpass(x, hz, fs), fs, t)
    # JoyVASA's first ~0.3 s is a start transient (pitch -2.6 deg sliding to 0 on 'long'), which
    # reads as a head drop at the clip start: ease the head in from neutral over 0.5 s
    ease = smoothstep(t / 0.5)
    for k in head:
        head[k] = head[k] * ease

    blink, events = blink_track(decode(motion["exp"], C["blink"]), fs, t, C["blink"], lid_max=lid_max)

    b = decode(motion["exp"], C["brow"])
    # centred on this clip's median (the neutral brow is the one held most of the time)
    b = (b - np.median(b)) / max(1e-6, C["brow"]["p95"] - C["brow"]["p50"]) * brow_gain
    brow = np.clip(resample(lowpass(b, 4.0, fs), fs, t), -1, 1)

    gxr, gyr = decode(motion["exp"], C["gaze_x"]), decode(motion["exp"], C["gaze_y"])
    gx = resample(lowpass((gxr - np.median(gxr)) * gaze_gain, 6.0, fs), fs, t)
    gy = resample(lowpass((gyr - np.median(gyr)) * gaze_gain, 6.0, fs), fs, t)

    j = decode(motion["exp"], C["jaw"])
    jn = np.clip((j - C["jaw"]["p5"]) / max(1e-6, C["jaw"]["p99"] - C["jaw"]["p5"]), 0, 1)
    jaw = np.clip(resample(lowpass(jn, 8.0, fs), fs, t), 0, 1)

    vis = [s for s in (timeline or {}).get("visemes", []) if s["v"] != "sil"]
    # neural jaw as a per-syllable *emphasis* factor with mean 1 over speech, so the Timeline keeps
    # the average opening and the network only redistributes it (stressed syllables open wider)
    if vis:
        sp = (t >= vis[0]["start"]) & (t <= vis[-1]["end"])
        jaw_rel = jaw / max(1e-3, float(np.mean(jaw[sp])))
    else:
        jaw_rel = jaw

    # Question overlay. JoyVASA does not answer the question shape (A/B, question line: no end tilt,
    # pitch ends down), so the text-level gesture comes from the Timeline - t1's question curve.
    if timeline and question_overlay and vis and str(timeline.get("text", "")).strip().endswith("?"):
        s0, s1 = vis[0]["start"], vis[-1]["end"]
        q0 = s1 - min(1.6, (s1 - s0) * 0.4)
        qq = smoothstep((t - q0) / 0.7) * (1 - smoothstep((t - (s1 + 1.4)) / 0.8))
        head["roll"] = head["roll"] + 4.2 * overlay_gain * qq
        head["pitch"] = head["pitch"] - 1.6 * overlay_gain * qq
        head["yaw"] = head["yaw"] + 1.2 * overlay_gain * qq
        brow = np.clip(brow + 0.45 * overlay_gain * qq, -1, 1)

    frames, open_prev = [], 0.0
    a_open = 1 - np.exp(-1 / (FPS * 0.022))
    r3 = lambda x: round(float(x), 3)
    for i, ti in enumerate(t):
        if timeline:
            w = viseme_weights(ti, vis)
            op = sum(w[k] * SHAPES[k][0] for k in w)
            press = sum(w[k] * SHAPES[k][1] for k in w)
            op *= (1 - 0.85 * press) * ((1 - jaw_mod) + jaw_mod * jaw_rel[i])
            vout = {k: r3(v) for k, v in w.items() if v > 0.005}
        else:
            op, vout = jaw[i], None
        open_prev += (op - open_prev) * a_open
        mouth = {"open": r3(np.clip(open_prev, 0, 1))}
        if vout is not None:
            mouth["visemes"] = vout
        frames.append({
            "t": r3(ti),
            "head": {"yaw": r3(head["yaw"][i]), "pitch": r3(head["pitch"][i]), "roll": r3(head["roll"][i])},
            "eyes": {"blinkL": r3(blink[i]), "blinkR": r3(blink[i]),
                     "gazeX": r3(np.clip(gx[i], -1, 1)), "gazeY": r3(np.clip(gy[i], -1, 1))},
            "brow": {"raise": r3(brow[i])},
            "mouth": mouth,
        })
    stats = {
        "duration_s": round(dur, 3), "frames": len(frames),
        "blinks": [round(e[0], 2) for e in events],
        "blink_rate_per_min": round(len(events) / dur * 60, 1),
        "head_range_deg": {k: round(float(np.ptp(v)), 2) for k, v in head.items()},
        "head_std_deg": {k: round(float(np.std(v)), 2) for k, v in head.items()},
        "brow_range": round(float(np.ptp(brow)), 3),
        "gaze_std": round(float(np.std(gx)), 3),
    }
    return {"version": 1, "fps": FPS, "frames": frames}, stats


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--motion", required=True)
    ap.add_argument("--decoder", required=True)
    ap.add_argument("--timeline")
    ap.add_argument("--out", required=True)
    ap.add_argument("--profile", choices=["human", "glow"], default="human",
                    help="glow = t1's glow-being rigs (b04-owl, d08-origami): calm non-human presence. "
                         "head x0.55 (neural head std ~1.9 deg -> ~1 deg, near t1's 0.7x procedural), "
                         "question overlay x0.7 (as t1), lid drops capped at 0.2 because D08's eye facets "
                         "switch dark at blink 0.25-0.65 and the owl's eye-lights squash: a 0.6 partial lid "
                         "would read as a full blink every second")
    ap.add_argument("--head-gain", type=float)
    ap.add_argument("--gaze-gain", type=float, default=4.0)
    ap.add_argument("--no-question-overlay", action="store_true")
    ap.add_argument("--head-hz", type=float, default=2.0, help="yaw low-pass; pitch x1.25, roll x0.8")
    ap.add_argument("--jaw-mod", type=float, default=0.5, help="0 = timeline only, 1 = neural jaw scales fully")
    a = ap.parse_args()
    motion = dict(np.load(a.motion))
    dec = json.loads(Path(a.decoder).read_text())
    tl = json.loads(Path(a.timeline).read_text(encoding="utf-8")) if a.timeline else None
    glow = a.profile == "glow"
    head_gain = a.head_gain if a.head_gain is not None else (0.55 if glow else 1.0)
    rp, stats = build(motion, dec, tl, head_gain, a.gaze_gain, a.jaw_mod, head_hz=a.head_hz,
                      lid_max=0.2 if glow else 0.6, overlay_gain=0.7 if glow else 1.0,
                      question_overlay=not a.no_question_overlay)
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(rp, separators=(",", ":")))
    print(json.dumps(stats))
    Path(a.out).with_suffix("").with_suffix(".stats.json").write_text(json.dumps(stats, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Compare two RigParams tracks after the shipped retarget (60 fps, the glow profile).

A track is an (N, 8) array: t, yaw, pitch, roll, blink, gazeX, gazeY, brow - what
``bench_motion.save_frames`` writes. JoyVASA samples (a seed draws its noise), so every distance is
read against the *noise floor*: the same distance between two seeds of the unchanged model. A
variant whose distance to the default sits inside that floor is "another sample of the same
model"; one far outside it moves the motion.
"""

from __future__ import annotations

from typing import Any

import numpy as np

COLS = {"yaw": 1, "pitch": 2, "roll": 3, "blink": 4, "gazeX": 5, "gazeY": 6, "brow": 7}
BLINK_ON = 0.5  # the retarget's crisp blinks reach 1.0; the capped lid drop stays <= 0.2
MATCH_S = 0.2


def blink_times(track: np.ndarray, fps: float = 60.0) -> np.ndarray:
    b = track[:, COLS["blink"]] > BLINK_ON
    starts = np.flatnonzero(b[1:] & ~b[:-1]) + 1
    if b[0]:
        starts = np.r_[0, starts]
    return starts / fps


def blink_match(a: np.ndarray, b: np.ndarray) -> dict[str, int]:
    """Greedy one-to-one matching of blink onsets within :data:`MATCH_S`."""
    used: set[int] = set()
    hit = 0
    for t in a:
        best = None
        for j, u in enumerate(b):
            if j in used or abs(u - t) > MATCH_S:
                continue
            if best is None or abs(u - t) < abs(b[best] - t):
                best = j
        if best is not None:
            used.add(best)
            hit += 1
    return {"ref": len(a), "test": len(b), "matched": hit}


def compare(ref: np.ndarray, test: np.ndarray) -> dict[str, Any]:
    n = min(len(ref), len(test))
    ref, test = ref[:n], test[:n]
    out: dict[str, Any] = {}
    for name in ("yaw", "pitch", "roll", "gazeX", "gazeY", "brow"):
        c = COLS[name]
        x, y = ref[:, c], test[:, c]
        out[f"{name}_rms"] = float(np.sqrt(np.mean((x - y) ** 2)))
        out[f"{name}_ref_rms"] = float(np.sqrt(np.mean(x**2)))  # distance to "no motion"
        out[f"{name}_std_ratio"] = float(np.std(y) / max(np.std(x), 1e-9))
        sx, sy = np.std(x), np.std(y)
        out[f"{name}_corr"] = float(np.corrcoef(x, y)[0, 1]) if sx > 1e-9 and sy > 1e-9 else float("nan")
    head = test[:, 1:4] - ref[:, 1:4]
    out["head_rms"] = float(np.sqrt(np.mean(np.sum(head**2, 1))))
    out["head_ref_rms"] = float(np.sqrt(np.mean(np.sum(ref[:, 1:4] ** 2, 1))))
    out["blinks"] = blink_match(blink_times(ref), blink_times(test))
    out["lid_rms"] = float(np.sqrt(np.mean((ref[:, 4] - test[:, 4]) ** 2)))
    out["n_frames"] = int(n)
    return out


def aggregate(rows: list[dict[str, Any]], weights: list[float] | None = None) -> dict[str, Any]:
    """Frame-weighted RMS over sentences, summed blink counts, median correlations."""
    w = np.array(weights if weights else [r["n_frames"] for r in rows], float)
    agg: dict[str, Any] = {"n_sentences": len(rows), "seconds": float(w.sum() / 60.0)}
    for k in rows[0]:
        if k.endswith("_rms"):
            agg[k] = round(float(np.sqrt(np.sum(w * np.array([r[k] for r in rows]) ** 2) / w.sum())), 4)
        elif k.endswith("_corr") or k.endswith("_std_ratio"):
            agg[k] = round(float(np.nanmedian([r[k] for r in rows])), 3)
    b = {k: sum(r["blinks"][k] for r in rows) for k in ("ref", "test", "matched")}
    b["recall"] = round(b["matched"] / b["ref"], 3) if b["ref"] else None
    b["precision"] = round(b["matched"] / b["test"], 3) if b["test"] else None
    agg["blinks"] = b
    return agg

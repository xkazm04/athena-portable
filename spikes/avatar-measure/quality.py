"""Quality of the cheap speedups: each variant's frames against the default (seed 7, 50 steps).

    python quality.py [q|q2]   # reads DATA/frames/<prefix>-*.npz (``run_matrix.py quality|quality2``)

``q`` is the four bench sentences (20 s of audio); ``q2`` is 30 held-out corpus sentences.

The noise floor is seed 7 against seeds 8 and 9 of the unchanged model.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402
import metrics  # noqa: E402

FR = common.DATA / "frames"


def load(label: str) -> dict[str, np.ndarray]:
    return dict(np.load(FR / f"{label}.npz"))


def main() -> None:
    pre = sys.argv[1] if len(sys.argv) > 1 else "q"
    ref = load(f"{pre}-seed7")
    out = {}
    for label in (f"{pre}-{x}" for x in ("seed8", "seed9", "steps25", "steps10", "steps5", "nocfg",
                                         "fp16", "bf16-cpu", "cpu-seed7")):
        if not (FR / f"{label}.npz").is_file():
            continue
        test = load(label)
        rows = [metrics.compare(ref[n], test[n]) for n in ref]
        out[label] = metrics.aggregate(rows)
        o = out[label]
        print(f"{label:12s} head_rms {o['head_rms']:.3f} (ref {o['head_ref_rms']:.3f}) "
              f"yaw/pitch/roll corr {o['yaw_corr']}/{o['pitch_corr']}/{o['roll_corr']} "
              f"std {o['yaw_std_ratio']}/{o['pitch_std_ratio']}/{o['roll_std_ratio']} blinks {o['blinks']}")
    common.write_json(common.RESULTS / f"quality-{pre}.json", {"machine": common.machine(), "vs": f"{pre}-seed7",
                                                        "sentences": sorted(ref), "variants": out})


if __name__ == "__main__":
    main()

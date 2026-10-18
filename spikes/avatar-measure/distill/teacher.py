"""Teacher tracks: JoyVASA's raw 25 fps motion for every corpus sentence, via the shipped helper.

    python gpulock.py --label "measure: teacher" -- python distill/teacher.py --seeds 7,8

Runs ``face_helper.motion.Motion.frames`` (the shipped path, on CUDA) and keeps the motion dict it
hands to ``retarget`` - 63 expression values plus pitch, yaw and roll per 25 fps frame - so the
student can be trained on the model's own output space and its predictions passed through the
very same retarget. Output: DATA/distill/teacher-seed<k>.npz, one (T, 66) array per sentence id.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import common  # noqa: E402

OUT = common.DATA / "distill"


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--seeds", default="7,8")
    p.add_argument("--ids", default="", help="only these ids (comma list), else the whole corpus")
    a = p.parse_args()
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    import numpy as np

    sys.path.insert(0, str(common.HELPER_PARENT))
    from face_helper import motion as fm

    captured: dict = {}
    orig = fm.retarget

    def grab(motion, dec, duration_s):  # type: ignore[no-untyped-def]
        captured["m"] = motion
        return orig(motion, dec, duration_s)

    fm.retarget = grab
    model = fm.Motion(common.JOYVASA)
    corpus = json.loads((OUT / "corpus.json").read_text(encoding="utf-8"))
    ids = set(a.ids.split(",")) if a.ids else None
    for seed in [int(s) for s in a.seeds.split(",")]:
        path = OUT / f"teacher-seed{seed}.npz"
        have = dict(np.load(path)) if path.is_file() else {}
        fm.SEED = seed
        t0 = time.perf_counter()
        for row in corpus:
            if (ids and row["id"] not in ids) or row["id"] in have:
                continue
            pcm, sr = common.read_wav(OUT / "wav" / f"{row['id']}.wav")
            model.frames(pcm, sr)
            m = captured["m"]
            have[row["id"]] = np.concatenate(
                [m["exp"].reshape(len(m["exp"]), -1), np.stack([m["pitch"], m["yaw"], m["roll"]], 1)], 1
            ).astype(np.float32)
        np.savez(path, **have)
        print(f"seed {seed}: {len(have)} tracks, {time.perf_counter() - t0:.0f} s", flush=True)


if __name__ == "__main__":
    main()

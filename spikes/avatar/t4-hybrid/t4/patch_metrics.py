"""Add t4's own components and A/B numbers to the metrics.json files t1's capture.mjs wrote.

capture.mjs (t1's, unchanged) lists the rig's licences only; the t4 bench clips also depend on
JoyVASA + HuBERT (motion, offline) and on the decoder calibration. CPU only.

    python t4/patch_metrics.py --portrait <id>
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

HOME = Path(os.environ.get("ATHENA_AVATAR_HOME", Path.home() / ".athena-avatar"))
T4_LICENCE = [
    {"component": "JoyVASA code + motion_generator weights (offline motion)", "licence": "MIT", "commercial_ok": True},
    {"component": "TencentGameMate chinese-hubert-base (JoyVASA audio encoder)", "licence": "MIT", "commercial_ok": True},
    {"component": "LivePortrait base weights (loaded by JoyVASA's wrapper; calibration render only)", "licence": "MIT", "commercial_ok": True},
    {"component": "InsightFace buffalo_l det/landmark (calibration carrier crop only, not in runtime path)",
     "licence": "non-commercial research", "commercial_ok": False},
    {"component": "MediaPipe Face Landmarker (calibration only)", "licence": "Apache-2.0", "commercial_ok": True},
    {"component": "t4 decoder + retarget (our code)", "licence": "repo", "commercial_ok": True},
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--portrait", required=True)
    a = ap.parse_args()
    d = HOME / "bench" / "t4-hybrid" / a.portrait
    try:
        glow = json.loads((HOME / "portraits" / a.portrait / "t1-rig/layers/layers.json").read_text()).get("rig_type") == "glow"
    except OSError:
        glow = False
    for mj in sorted(d.glob("*.metrics.json")):
        m = json.loads(mj.read_text())
        line = m["line_id"]
        names = {x["component"] for x in m.get("licence", [])}
        m["licence"] = m.get("licence", []) + [x for x in T4_LICENCE if x["component"] not in names]
        ab = HOME / "voice" / "t4-hybrid" / (f"{line}.glow.ab.json" if glow else f"{line}.ab.json")
        extra = ""
        if ab.exists():
            r = json.loads(ab.read_text())["B_t4_neural"]
            extra = (f" t4 motion: JoyVASA seed 7, retarget profile {'glow (head x0.55, question overlay x0.7, lid cap 0.2)' if glow else 'human'}, blinks {r['blink_rate_per_min']}/min, head std "
                     f"{r['head_std_deg']}, head speed p50 {r['head_speed_deg_s']['p50']} deg/s, "
                     f"audio coupling r {r['audio_coupling']['r']}.")
        if "t4 motion:" not in m.get("notes", ""):
            m["notes"] = m.get("notes", "") + extra + (" InsightFace (non-commercial) is used only to crop the"
                                                       " calibration carrier, never on the runtime path.")
        mj.write_text(json.dumps(m, indent=2))
        print("patched", mj)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

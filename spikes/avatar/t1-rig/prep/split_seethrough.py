"""portrait.png -> See-through LayerDiff3D layers -> t1-rig layers + layers.json.

Run (GPU, through the lock), from the worktree root:
  python spikes/avatar/tools/gpulock.py --label "t1-rig: see-through split" -- \
    ~/.athena-avatar/venvs/t1-rig/Scripts/python.exe spikes/avatar/t1-rig/prep/split_seethrough.py --portrait <id>

Output: ~/.athena-avatar/portraits/<id>/t1-rig/layers/  (raw See-through tags in .../seethrough_raw/)
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
import layerkit as lk  # noqa: E402

ST = lk.MODELS / "see-through"

# raw tag -> (layer name, kind, depth). Order here is the draw order (back to front).
ORDER = [
    ("back hair", "back_hair", "hair_back", -0.45),
    ("neck", "neck", "neck", 0.0),
    ("bottomwear", "bottomwear", "body", 0.0),
    ("legwear", "legwear", "body", 0.0),
    ("footwear", "footwear", "body", 0.0),
    ("topwear", "topwear", "body", 0.0),
    ("handwear", "handwear", "body", 0.0),
    ("neckwear", "neckwear", "body", 0.0),
    ("objects", "objects", "body", 0.0),
    ("tail", "tail", "body", 0.0),
    ("wings", "wings", "body", 0.0),
    ("ears", "ears", "head", -0.12),
    ("earwear", "earwear", "head", -0.1),
    ("face", "face", "head", 0.0),
    ("nose", "nose", "head", 0.12),
    ("@mouth", None, None, 0),
    ("eyewhite", "eyewhite", "eye_white", 0.03),
    ("irides", "irides", "iris", 0.04),
    ("eyelash", "eyelash", "head", 0.05),
    ("@lid", None, None, 0),
    ("eyebrow", "eyebrow", "head", 0.07),
    ("eyewear", "eyewear", "head", 0.22),
    ("front hair", "front_hair", "hair_front", 0.1),
    ("headwear", "headwear", "head", 0.25),
]


def run_seethrough(src: Path, raw_dir: Path, resolution: int, steps: int) -> Path:
    os.environ.setdefault("HF_HOME", str(lk.MODELS / "hf"))
    sys.path.insert(0, str(ST / "common"))
    sys.path.insert(0, str(ST))
    cwd = os.getcwd()
    os.chdir(ST)
    try:
        from utils.inference_utils import apply_layerdiff  # type: ignore
        from utils.torch_utils import seed_everything  # type: ignore
        seed_everything(42)
        apply_layerdiff(str(src), "layerdifforg/seethroughv0.0.2_layerdiff3d", save_dir=str(raw_dir), seed=42,
                        resolution=resolution, num_inference_steps=steps)
    finally:
        os.chdir(cwd)
    return raw_dir / src.stem


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--portrait", required=True)
    ap.add_argument("--src", help="override input image (default portraits/<id>/portrait.png)")
    ap.add_argument("--resolution", type=int, default=1280)
    ap.add_argument("--steps", type=int, default=30)
    ap.add_argument("--skip-diffusion", action="store_true", help="reuse seethrough_raw/")
    a = ap.parse_args()

    pdir = lk.HOME / "portraits" / a.portrait
    src = Path(a.src) if a.src else pdir / "portrait.png"
    raw_root = pdir / "t1-rig" / "seethrough_raw"
    t0 = time.time()
    if not a.skip_diffusion:
        raw = run_seethrough(src, raw_root, a.resolution, a.steps)
    else:
        raw = raw_root / src.stem
    t_diff = time.time() - t0

    full = lk.load_rgba(raw / "src_img.png")
    # crop the square padding back off (padding is transparent)
    ys, xs = np.nonzero(full[..., 3] > 0)
    cx0, cy0, cx1, cy1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    crop = lambda arr: arr[cy0:cy1, cx0:cx1]  # noqa: E731
    full = crop(full)
    H, W = full.shape[:2]
    tags = {}
    for p in raw.glob("*.png"):
        if p.stem in ("src_img", "src_head", "head"):
            continue
        arr = crop(lk.load_rgba(p))
        arr[arr[..., 3] < 15] = 0
        if (arr[..., 3] > 15).sum() > 30:
            tags[p.stem] = arr

    for t in ("nose", "mouth"):
        if t in tags:
            tags[t][..., :3] = full[..., :3]

    out = pdir / "t1-rig" / "layers"
    lw = lk.LayerWriter(out, a.portrait, "see-through", W, H)

    # background: LayerDiff can leave stray alpha over the whole canvas, so the person matte
    # (BiRefNet) decides what is character; every layer is clipped to it
    from split_fallback import matte_birefnet
    matte = matte_birefnet(np.ascontiguousarray(full[..., :3]))
    keep = np.clip(cv2.dilate(matte.astype(np.float32), np.ones((3, 3), np.uint8)) * 1.15, 0, 1)
    for t, arr in tags.items():
        arr[..., 3] = (arr[..., 3] * keep).astype(np.uint8)
    char = cv2.dilate((matte > 0.03).astype(np.uint8), np.ones((21, 21), np.uint8))
    rgb = full[..., :3]
    bg = lk.lama(rgb, char)
    lw.add("background", lk.rgba(bg, np.full((H, W), 255, np.uint8)), "static")

    # rig geometry
    face = tags.get("face")
    if face is None:
        raise SystemExit("See-through found no face layer")
    fy, fx = np.nonzero(face[..., 3] > 40)
    eye_mask = np.zeros((H, W), np.float32)
    for t in ("eyewhite", "irides"):
        if t in tags:
            eye_mask = np.maximum(eye_mask, tags[t][..., 3] / 255.0)
    eye_mask = cv2.morphologyEx((eye_mask > 0.3).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    eyes = lk.eye_geometry(eye_mask, tags["irides"][..., 3] / 255.0 if "irides" in tags else None,
                           lash_mask=(tags["eyelash"][..., 3] / 255.0) if "eyelash" in tags else None)
    brows = lk.brow_geometry(tags["eyebrow"][..., 3] / 255.0) if "eyebrow" in tags else []
    mouth = lk.mouth_geometry(tags["mouth"]) if "mouth" in tags else None
    hair_top = min([np.nonzero(tags[t][..., 3] > 40)[0].min() for t in ("front hair", "back hair") if t in tags] + [fy.min()])
    rx, ry = (fx.max() - fx.min()) / 2, (fy.max() - fy.min()) / 2
    head = {"center": [round(float((fx.max() + fx.min()) / 2), 1), round(float(fy.min() + ry * 0.95), 1)],
            "radius": [round(float(rx * 1.02), 1), round(float(ry * 1.0), 1)],
            "chin_y": int(fy.max()), "crown_y": int(hair_top)}
    lw.meta["rig"] = {"head": head, "eyes": eyes, "brows": brows}
    if mouth:
        mouth["open_px"] = round(0.36 * (mouth["x1"] - mouth["x0"]), 1)  # drawn mouths open wide
        lw.meta["rig"]["mouth"] = mouth

    # lid source: face + eye parts flattened (no hair), so a closing lid carries skin and lashes
    lid = np.zeros((H, W, 4), np.float32)
    for t in ("face", "nose", "eyewhite", "irides", "eyelash"):
        if t in tags:
            a_ = tags[t][..., 3:4] / 255.0
            lid[..., :3] = lid[..., :3] * (1 - a_) + tags[t][..., :3] * a_
            lid[..., 3:4] = lid[..., 3:4] + a_ * (1 - lid[..., 3:4])

    for tag, name, kind, depth in ORDER:
        if tag == "@mouth":
            if mouth is not None:
                lw.add("mouth_hole", None, "mouth_hole", bbox=[mouth["x0"], mouth["center"][1] - mouth["upper_h"], mouth["x1"] - mouth["x0"], mouth["upper_h"] + mouth["lower_h"]])
                up, lo = lk.split_lips(tags["mouth"], mouth)
                lw.add("lip_upper", up, "lip_upper")
                lw.add("lip_lower", lo, "lip_lower")
            continue
        if tag == "@lid":
            if eyes:
                ex0 = min(e["x0"] for e in eyes); ex1 = max(e["x1"] for e in eyes)
                ey0 = int(min(min(e["top"]) for e in eyes) - 1.2 * max(e["h"] for e in eyes))
                ey1 = int(max(max(e["bottom"]) for e in eyes) + 0.8 * max(e["h"] for e in eyes))
                reg = np.zeros((H, W), bool)
                reg[max(0, ey0):ey1, max(0, ex0 - 8):ex1 + 8] = True
                lid_rgba = np.zeros((H, W, 4), np.uint8)
                lid_rgba[reg] = np.clip(np.dstack([lid[..., :3] / np.maximum(lid[..., 3:4], 1e-3), lid[..., 3:4] * 255])[reg], 0, 255).astype(np.uint8)
                lw.add("lid_source", lid_rgba, "lid_source")
                lw.add("eye_mask", lk.rgba(np.full((H, W, 3), 255, np.uint8), lk.feather(eye_mask, 0.7)), "eye_mask")
                lw.add("lids", None, "lid", bbox=[ex0, ey0, ex1 - ex0, ey1 - ey0])
            continue
        if tag in tags:
            arr = tags[tag]
            if kind in ("hair_back", "hair_front", "body", "neck") or name == "face":
                arr = lk.rgba(lk.decontaminate(arr[..., :3], arr[..., 3]), arr[..., 3])
            lw.add(name, arr, kind, depth)

    lw.meta["timing_s"] = {"see_through": round(t_diff, 1), "total": round(time.time() - t0, 1)}
    p = lw.write()
    print(f"wrote {p} ({len(lw.meta['layers'])} layers) in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()

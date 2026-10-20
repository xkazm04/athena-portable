"""Experiment: generated mouth frames per viseme group (SDXL inpainting, OpenRAIL++), to compare with
the runtime's parametric mouth (lip split + procedural interior). Writes crops and a contact sheet:
  portraits/<id>/t1-rig/mouth_frames/<group>.png, sheet.png

  python spikes/avatar/tools/gpulock.py --label "t1-rig: sdxl mouth frames" -- \
    ~/.athena-avatar/venvs/t1-rig/Scripts/python.exe spikes/avatar/t1-rig/prep/mouth_frames_sdxl.py --portrait <id>
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
import layerkit as lk  # noqa: E402

os.environ.setdefault("HF_HOME", str(lk.MODELS / "hf"))

GROUPS = {
    "aa": "mouth open wide while speaking, upper teeth visible, natural lips",
    "E": "mouth slightly open while speaking, teeth visible, relaxed smile",
    "oh": "lips rounded in an o shape while speaking, mouth open",
    "ou": "lips pursed and rounded forward, small opening",
    "FF": "upper teeth resting on the lower lip, speaking",
}
NEG = "deformed, extra teeth, blurry, distorted face, makeup change, different person"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--portrait", required=True)
    ap.add_argument("--steps", type=int, default=30)
    ap.add_argument("--strength", type=float, default=0.85)
    ap.add_argument("--side", type=float, default=3.2, help="crop side in mouth widths")
    ap.add_argument("--tag", default="")
    a = ap.parse_args()
    import torch
    from diffusers import StableDiffusionXLInpaintPipeline

    pdir = lk.HOME / "portraits" / a.portrait
    spec = json.loads((pdir / "t1-rig/layers/layers.json").read_text())
    W, H = spec["width"], spec["height"]
    img = Image.open(pdir / "portrait.png").convert("RGB").resize((W, H), Image.LANCZOS)
    m = spec["rig"]["mouth"]
    mw = m["x1"] - m["x0"]
    cx, cy = m["center"]
    side = int(mw * a.side)
    x0, y0 = int(cx - side / 2), int(cy - side * 0.45)
    crop = img.crop((x0, y0, x0 + side, y0 + side)).resize((1024, 1024), Image.LANCZOS)
    s = 1024 / side
    mask = Image.new("L", (1024, 1024), 0)
    d = ImageDraw.Draw(mask)
    ex, ey = (cx - x0) * s, (cy - y0) * s
    d.ellipse((ex - mw * 0.8 * s, ey - mw * 0.35 * s, ex + mw * 0.8 * s, ey + mw * 1.0 * s), fill=255)
    mask = Image.fromarray(cv2.GaussianBlur(np.array(mask), (31, 31), 8))

    pipe = StableDiffusionXLInpaintPipeline.from_pretrained(
        "diffusers/stable-diffusion-xl-1.0-inpainting-0.1", torch_dtype=torch.float16, variant="fp16").to("cuda")
    out = pdir / ("t1-rig/mouth_frames" + a.tag)
    out.mkdir(parents=True, exist_ok=True)
    tiles = [crop.copy()]
    t0 = time.time()
    for g, prompt in GROUPS.items():
        gen = torch.Generator("cuda").manual_seed(7)
        r = pipe(prompt=f"close-up portrait of a girl talking, {prompt}, open mouth, same person, same lighting, painterly detail",
                 negative_prompt=NEG, image=crop, mask_image=mask, strength=a.strength,
                 num_inference_steps=a.steps, guidance_scale=6.0, generator=gen).images[0]
        r = Image.composite(r, crop, mask)
        r.save(out / f"{g}.png")
        tiles.append(r)
    sheet = Image.new("RGB", (256 * len(tiles), 256))
    for i, t in enumerate(tiles):
        sheet.paste(t.resize((256, 256)), (256 * i, 0))
    sheet.save(out / "sheet.png")
    print(f"{len(GROUPS)} frames in {time.time() - t0:.1f}s -> {out}")


if __name__ == "__main__":
    main()

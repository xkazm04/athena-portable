"""Real-ESRGAN (BSD-3, via spandrel MIT) frame upscaler for sub-1080p model output.

    python upscale.py --in clip.native.mp4 --out clip.up.mp4 [--scale 2|4] [--height 1080]

Upscales every frame on the GPU (fp16), resizes to --height (lanczos), keeps the audio. Runs in
the flashhead venv under the GPU lock (bench.py --upscale does that). Writes <out>.stats.json.
Real-ESRGAN is a general-purpose GAN upscaler, not a face restorer: it sharpens edges and hair
without re-inventing identity (a face restorer such as GFPGAN/CodeFormer would, and CodeFormer
is non-commercial).
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import MODELS  # noqa: E402

import imageio  # noqa: E402
import numpy as np  # noqa: E402
import torch  # noqa: E402
import torch.nn.functional as F  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--scale", type=int, choices=[2, 4], default=2)
    ap.add_argument("--height", type=int, default=1080)
    args = ap.parse_args()
    from spandrel import ModelLoader

    t0 = time.perf_counter()
    w = MODELS / "realesrgan" / f"RealESRGAN_x{args.scale}plus.pth"
    model = ModelLoader().load_from_file(str(w)).model.cuda().half().eval()
    rd = imageio.get_reader(args.inp)
    fps = rd.get_meta_data()["fps"]
    tmp = str(args.out) + ".v.mp4"
    n = 0
    t1 = time.perf_counter()
    with imageio.get_writer(tmp, fps=fps, codec="libx264", quality=None, macro_block_size=1,
                            ffmpeg_params=["-crf", "14", "-preset", "slow"]) as wr, torch.no_grad():
        for fr in rd:
            x = torch.from_numpy(np.ascontiguousarray(fr)).cuda().permute(2, 0, 1)[None].half() / 255
            y = model(x)
            h = args.height
            ww = int(round(y.shape[3] * h / y.shape[2] / 2) * 2)
            y = F.interpolate(y.float(), size=(h, ww), mode="bicubic", antialias=True, align_corners=False)
            wr.append_data((y[0].clamp(0, 1).permute(1, 2, 0) * 255).byte().cpu().numpy())
            n += 1
    torch.cuda.synchronize()
    stats = {"upscaler": f"RealESRGAN_x{args.scale}plus", "frames": n, "load_s": round(t1 - t0, 2),
             "upscale_s": round(time.perf_counter() - t1, 2),
             "ms_per_frame": round((time.perf_counter() - t1) / max(n, 1) * 1000, 1),
             "torch_peak_mb": round(torch.cuda.max_memory_allocated() / 2**20)}
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", tmp, "-i", args.inp, "-map", "0:v",
                    "-map", "1:a?", "-c", "copy", args.out], check=True)
    Path(tmp).unlink(missing_ok=True)
    Path(str(args.out) + ".stats.json").write_text(json.dumps(stats, indent=2), encoding="utf-8")
    print(json.dumps(stats))
    return 0


if __name__ == "__main__":
    sys.exit(main())

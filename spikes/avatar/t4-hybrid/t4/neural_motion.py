"""Audio -> neural motion with JoyVASA's identity-free diffusion motion generator.

JoyVASA samples LivePortrait motion coefficients (21x3 implicit-keypoint expression deltas, head
pitch/yaw/roll in degrees, translation, scale) from HuBERT audio features at 25 fps. The motion is
identity-independent, so it needs no portrait. This script only *samples motion*; with
``--carrier`` it also renders the motion through LivePortrait onto a carrier image, which
calibrate.py uses to learn a semantic decoder (blink / brow / gaze / jaw). The carrier render is
an analysis artefact, never a bench clip.

Run through the GPU lock (one job per invocation):

    python spikes/avatar/tools/gpulock.py --label "t4-hybrid: joyvasa motion" -- \
      ~/.athena-avatar/venvs/t4-hybrid/Scripts/python.exe spikes/avatar/t4-hybrid/t4/neural_motion.py \
      --wav ~/.athena-avatar/voice/calm.wav --out ~/.athena-avatar/voice/t4-hybrid/calm.motion.npz

Writes <out>.npz: fps, exp[N,21,3], pitch[N], yaw[N], roll[N], t[N,3], scale[N] (raw, unsmoothed).
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

import numpy as np

HOME = Path(os.environ.get("ATHENA_AVATAR_HOME", Path.home() / ".athena-avatar"))
JOYVASA = HOME / "models" / "joyvasa"


def _import_joyvasa():
    sys.path.insert(0, str(JOYVASA))
    import platform
    import pathlib

    if platform.system() == "Windows":  # JoyVASA's checkpoints pickle PosixPath objects
        pathlib.PosixPath = pathlib.WindowsPath
    from src.config.argument_config import ArgumentConfig
    from src.config.crop_config import CropConfig
    from src.config.inference_config import InferenceConfig

    return ArgumentConfig, InferenceConfig, CropConfig


def _fields(cls, kw):
    return cls(**{k: v for k, v in kw.items() if hasattr(cls, k)})


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--wav", action="append", required=True, help="audio file; repeatable")
    ap.add_argument("--out", action="append", required=True, help="output .npz per --wav")
    ap.add_argument("--cfg-scale", type=float, default=2.0)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--carrier", help="image to render the motion onto (calibration only)")
    ap.add_argument("--carrier-out", action="append", help="mp4 path for the carrier render, one per --wav (with --carrier)")
    ap.add_argument("--carrier-region", default="exp", choices=["exp", "all"],
                    help="exp = render expression only (head pose fixed), so the measurement is not confounded by pose")
    ap.add_argument("--reuse", action="store_true", help="load an existing --out npz instead of sampling again")
    a = ap.parse_args()
    if len(a.wav) != len(a.out):
        ap.error("one --out per --wav")
    if a.carrier and len(a.carrier_out or []) != len(a.wav):
        ap.error("one --carrier-out per --wav")

    import torch

    ArgumentConfig, InferenceConfig, CropConfig = _import_joyvasa()
    args = ArgumentConfig()
    args.animation_mode = "human"
    args.cfg_scale = a.cfg_scale
    args.is_smooth_motion = False  # we filter in retarget.py, per channel
    kw = dict(args.__dict__)
    kw.update(flag_do_crop=True, flag_stitching=True, flag_relative_motion=True, flag_pasteback=False,
              flag_use_half_precision=True, animation_region=a.carrier_region,
              driving_option="pose-friendly", driving_multiplier=1.0)
    inf = _fields(InferenceConfig, kw)
    crop = _fields(CropConfig, kw)

    t0 = time.perf_counter()
    if a.carrier:
        from src.live_portrait_wmg_pipeline import LivePortraitPipeline

        pipe = LivePortraitPipeline(inference_cfg=inf, crop_cfg=crop)
        wrapper = pipe.live_portrait_wrapper
    else:
        from src.live_portrait_wmg_wrapper import LivePortraitWrapper

        wrapper = LivePortraitWrapper(inference_cfg=inf)
    gen = wrapper.gen_motion_sequence  # bound original; the carrier render patches the attribute
    load_s = time.perf_counter() - t0
    print(f"[t4] models loaded in {load_s:.1f} s, motion fps {wrapper.fps}", flush=True)

    for k, (wav, out) in enumerate(zip(a.wav, a.out)):
        torch.manual_seed(a.seed)
        np.random.seed(a.seed)
        args.audio = wav
        if a.reuse and Path(out).exists():
            dct = _dct_from_npz(out)
            print(f"[t4] reused {out}", flush=True)
            if a.carrier:
                _render(pipe, args, a, k, dct)
            continue
        torch.cuda.synchronize()
        t1 = time.perf_counter()
        dct = gen(args)
        torch.cuda.synchronize()
        gen_s = time.perf_counter() - t1
        m = dct["motion"]
        exp = np.concatenate([f["exp"] for f in m]).astype(np.float32)  # N,21,3
        rec = dict(
            fps=np.float32(wrapper.fps),
            exp=exp,
            pitch=np.array([float(f["pitch"].ravel()[0]) for f in m], np.float32),
            yaw=np.array([float(f["yaw"].ravel()[0]) for f in m], np.float32),
            roll=np.array([float(f["roll"].ravel()[0]) for f in m], np.float32),
            t=np.concatenate([f["t"] for f in m]).astype(np.float32),
            scale=np.array([float(f["scale"].ravel()[0]) for f in m], np.float32),
            cfg_scale=np.float32(a.cfg_scale),
            seed=np.int32(a.seed),
            gen_s=np.float32(gen_s),
        )
        Path(out).parent.mkdir(parents=True, exist_ok=True)
        np.savez(out, **rec)
        dur = len(exp) / wrapper.fps
        print(f"[t4] {Path(wav).name}: {len(exp)} frames ({dur:.2f} s) in {gen_s:.2f} s "
              f"= {dur / gen_s:.1f}x realtime, peak vram {torch.cuda.max_memory_allocated() / 2**20:.0f} MB -> {out}",
              flush=True)

        if a.carrier:
            _render(pipe, args, a, k, dct)
    return 0


def _render(pipe, args, a, k, dct):
    import copy

    args.reference = a.carrier
    args.output_dir = str(Path(a.carrier_out[k]).parent)
    # Prepend a neutral frame (the dataset-mean expression). JoyVASA renders exp relative to frame 0,
    # so with this anchor every clip renders x_s.exp + (exp_i - mean_exp): the same affine map for
    # all clips, and a decoder fitted on absolute exp transfers across clips. The video then has
    # N+1 frames; calibrate.py drops the first.
    d = copy.deepcopy(dct)
    neutral = dict(d["motion"][0])
    neutral["exp"] = np.asarray(pipe.live_portrait_wrapper.templete_dict["mean_exp"], np.float32).reshape(1, 21, 3)
    d["motion"] = [neutral] + d["motion"]
    d["n_frames"] += 1
    pipe.live_portrait_wrapper.gen_motion_sequence = lambda _args, _d=d: _d
    t2 = time.perf_counter()
    final = pipe.execute(args)
    print(f"[t4] carrier render {time.perf_counter() - t2:.1f} s -> {a.carrier_out[k]}", flush=True)
    os.replace(final, a.carrier_out[k])


def _dct_from_npz(path):
    import torch
    from src.utils.camera import get_rotation_matrix

    m = np.load(path)
    motion = []
    for i in range(len(m["exp"])):
        p, y, r = (torch.tensor([[float(m[k][i])]]) for k in ("pitch", "yaw", "roll"))
        R = get_rotation_matrix(p, y, r).reshape(1, 3, 3).numpy().astype(np.float32)
        motion.append({"exp": m["exp"][i][None], "scale": m["scale"][i].reshape(1, 1), "R": R,
                       "t": m["t"][i].reshape(1, 3), "pitch": p.numpy(), "yaw": y.numpy(), "roll": r.numpy()})
    return {"n_frames": len(motion), "output_fps": int(m["fps"]), "motion": motion}


if __name__ == "__main__":
    raise SystemExit(main())

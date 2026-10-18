"""JoyVASA motion per sentence, on the shipped helper's code path (``face_helper.motion.Motion``).

One process = one configuration: cold load, the helper's own 1 s warm-up tone, then ``--reps``
warm runs of each bench sentence. Run it in the face helper's environment::

    python bench_motion.py --device cpu --threads 4 --affinity 0,2,4,6 --reps 3 --out r.json

What differs from the shipped helper, and only when asked:

- ``--device cpu`` sets ``flag_force_cpu`` on the wrapper's InferenceConfig (the shipped helper
  cannot run on CPU at all: it always picks ``cuda:0``; see README) and hides CUDA.
- ``--variant`` (comma list): ``inference_mode`` (``torch.inference_mode`` around the call),
  ``bf16`` (CPU autocast bfloat16), ``fp16`` (CUDA autocast float16), ``steps=K`` (a K-step DDIM
  sampler over the model's own 50-step cosine schedule instead of the 50-step ancestral sampler;
  the model predicts the clean sample, so DDIM needs no retraining), ``lean`` (do not load
  LivePortrait's renderer modules F/M/W/G/S, which motion never uses), ``compile`` (torch.compile
  the denoiser), ``nocfg`` (one batch entry, cfg off - changes the output, measured for scale).

Writes timings, a stage split (audio encoder vs denoiser loop vs the rest), memory, and every
sentence's frames (``--frames-out`` .npz) for the quality comparison in ``quality.py``.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import common  # noqa: E402


def parse() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
    p.add_argument("--threads", type=int, default=0, help="torch intra-op threads (0 = default)")
    p.add_argument("--affinity", default="", help="comma list of logical CPUs to pin to")
    p.add_argument("--reps", type=int, default=3)
    p.add_argument("--variant", default="", help="comma list, see the module doc")
    p.add_argument("--audio-dir", default=str(common.DATA / "lengths"))
    p.add_argument("--names", default="s1_5,s3,s6,s10")
    p.add_argument("--seed", type=int, default=None, help="override the helper's SEED")
    p.add_argument("--label", default="")
    p.add_argument("--out", required=True)
    p.add_argument("--frames-out", default="")
    return p.parse_args()


def load(device: str, threads: int = 0, affinity: str = "", variants: list[str] | None = None,
         seed: int | None = None) -> dict:
    """The shipped Motion, set up as one configuration asks; shared with live_replay.py."""
    variants = variants or []
    if os.environ.get("MEASURE_HIGH_PRIORITY", "1") == "1":
        common.set_high_priority()
    if affinity:
        common.set_affinity([int(c) for c in affinity.split(",")])
    if device == "cpu":
        os.environ["CUDA_VISIBLE_DEVICES"] = ""
    if threads:
        os.environ["OMP_NUM_THREADS"] = str(threads)
        os.environ["MKL_NUM_THREADS"] = str(threads)
    t_proc = time.perf_counter()

    with common.Meter() as m_import:
        import numpy as np
        import torch

        sys.path.insert(0, str(common.HELPER_PARENT))
        from face_helper import motion as fm
        from face_helper.main import WARMUP_RATE, _warmup_tone

        if threads:
            torch.set_num_threads(threads)

    # --- patches, each one named by a variant (none by default except the CPU device flag) --------
    sys.path.insert(0, str(common.JOYVASA))
    import pathlib
    import platform

    if platform.system() == "Windows":
        pathlib.PosixPath = pathlib.WindowsPath  # type: ignore[misc, assignment]
    import src.live_portrait_wmg_wrapper as lpw

    orig_init = lpw.LivePortraitWrapper.__init__

    def init(self, inference_cfg):  # type: ignore[no-untyped-def]
        if device == "cpu":
            inference_cfg.flag_force_cpu = True
        orig_init(self, inference_cfg)

    lpw.LivePortraitWrapper.__init__ = init
    if "lean" in variants:
        orig_load = lpw.load_model

        def load_model(ckpt, cfg, device, model_type):  # type: ignore[no-untyped-def]
            if model_type == "motion_generator":
                return orig_load(ckpt, cfg, device, model_type)
            return None

        lpw.load_model = load_model
    if seed is not None:
        fm.SEED = seed

    with common.Meter() as m_load:
        model = fm.Motion(common.JOYVASA)
    mem_load = common.memory_mb()
    gen = model.wrapper.motion_generator
    dev = model.wrapper.device

    steps = next((int(v.split("=")[1]) for v in variants if v.startswith("steps=")), 0)
    if steps:
        install_ddim(gen, steps)
    if "nocfg" in variants:
        model.args.cfg_scale = 0.0
        model.args.cfg_cond = []  # the sampler then runs one batch entry
    if "compile" in variants:
        gen.denoising_net = torch.compile(gen.denoising_net)
    return {"model": model, "fm": fm, "torch": torch, "np": np, "gen": gen, "dev": dev,
            "m_import": m_import, "m_load": m_load, "mem_load": mem_load, "t_proc": t_proc,
            "warm": (WARMUP_RATE, _warmup_tone)}


def main() -> None:
    a = parse()
    variants = [v for v in a.variant.split(",") if v]
    s = load(a.device, a.threads, a.affinity, variants, a.seed)
    model, fm, torch, np, gen, dev = (s[k] for k in ("model", "fm", "torch", "np", "gen", "dev"))
    m_import, m_load, mem_load, t_proc = s["m_import"], s["m_load"], s["mem_load"], s["t_proc"]
    WARMUP_RATE, _warmup_tone = s["warm"]


    # --- the stage split: audio encoder vs denoiser ------------------------------------------------
    acc = {"audio_s": 0.0, "denoise_s": 0.0, "denoise_calls": 0}

    def sync() -> None:
        if dev.startswith("cuda"):
            torch.cuda.synchronize()

    orig_feat = gen.extract_audio_feature
    orig_den = gen.denoising_net.forward

    def feat(*x, **k):  # type: ignore[no-untyped-def]
        sync()
        t = time.perf_counter()
        r = orig_feat(*x, **k)
        sync()
        acc["audio_s"] += time.perf_counter() - t
        return r

    def den(*x, **k):  # type: ignore[no-untyped-def]
        sync()
        t = time.perf_counter()
        r = orig_den(*x, **k)
        sync()
        acc["denoise_s"] += time.perf_counter() - t
        acc["denoise_calls"] += 1
        return r

    gen.extract_audio_feature = feat
    gen.denoising_net.forward = den

    import contextlib

    def ctx() -> contextlib.ExitStack:
        st = contextlib.ExitStack()
        if "inference_mode" in variants:
            st.enter_context(torch.inference_mode())
        return st

    # Autocast wraps only the sampler (audio encoder + denoiser); JoyVASA's post-processing calls
    # .numpy() on its outputs, which bfloat16 does not support, so they come back as float32.
    amp = "bf16" if "bf16" in variants else "fp16" if "fp16" in variants else ""
    if amp:
        inner = gen.sample

        def sample(*x, **k):  # type: ignore[no-untyped-def]
            kind, dt = ("cpu", torch.bfloat16) if amp == "bf16" else ("cuda", torch.float16)
            with torch.autocast(kind, dtype=dt):
                r = inner(*x, **k)
            return tuple(v.float() if torch.is_tensor(v) else v for v in r)

        gen.sample = sample

    def run(pcm: bytes, sr: int) -> tuple[list, dict]:
        for k in acc:
            acc[k] = 0 if k == "denoise_calls" else 0.0
        with ctx(), common.Meter() as m:
            frames = model.frames(pcm, sr)
        row = m.row()
        row.update(
            audio_s=round(acc["audio_s"], 4),
            denoise_s=round(acc["denoise_s"], 4),
            denoise_calls=acc["denoise_calls"],
            other_s=round(m.wall - acc["audio_s"] - acc["denoise_s"], 4),
        )
        return frames, row

    _, warm = run(_warmup_tone(), WARMUP_RATE)
    first_ready_s = time.perf_counter() - t_proc

    sentences = {}
    all_frames = {}
    for name in a.names.split(","):
        pcm, sr = common.read_wav(Path(a.audio_dir) / f"{name}.wav")
        dur = len(pcm) / 2 / sr
        rows = []
        for _ in range(a.reps):
            frames, row = run(pcm, sr)
            row["rtf"] = round(row["wall_s"] / dur, 4)
            rows.append(row)
        all_frames[name] = frames
        sentences[name] = {
            "duration_s": round(dur, 3),
            "windows": max(1, -(-int((len(pcm) / 2 / sr + 0.12) * 25) // 100)),
            "runs": rows,
            "wall_s": common.summary([r["wall_s"] for r in rows]),
            "rtf": common.summary([r["rtf"] for r in rows]),
            "cores_used": common.summary([r["cores_used"] for r in rows]),
            "machine_busy_pct": common.summary([r["machine_busy_pct"] for r in rows]),
        }
        print(a.label, name, sentences[name]["wall_s"], flush=True)

    out = {
        "label": a.label,
        "device": dev,
        "threads": torch.get_num_threads(),
        "affinity": a.affinity,
        "variants": variants,
        "seed": fm.SEED,
        "torch": torch.__version__,
        "machine": common.machine(),
        "import": m_import.row(),
        "cold_load": m_load.row(),
        "mem_after_load": mem_load,
        "warmup_tone_1s": warm,
        "first_motion_ready_s": round(first_ready_s, 3),
        "sentences": sentences,
        "mem_end": common.memory_mb(),
    }
    common.write_json(Path(a.out), out)
    if a.frames_out:
        save_frames(Path(a.frames_out), all_frames)


def save_frames(path: Path, all_frames: dict) -> None:
    import numpy as np

    arrs = {}
    for name, frames in all_frames.items():
        arrs[name] = np.array(
            [
                [
                    f["t"],
                    f["head"]["yaw"],
                    f["head"]["pitch"],
                    f["head"]["roll"],
                    f["eyes"]["blinkL"],
                    f["eyes"]["gazeX"],
                    f["eyes"]["gazeY"],
                    f["brow"]["raise"],
                ]
                for f in frames
            ],
            np.float32,
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez(path, **arrs)


def install_ddim(gen, steps: int) -> None:  # type: ignore[no-untyped-def]
    """Replace ``gen.sample`` with a K-step deterministic DDIM over the model's own schedule.

    The body is JoyVASA's ``DitTalkingHead.sample`` (CFG, incremental mode, the same inputs) with
    only the loop changed: t runs over K evenly spaced steps of the trained 50, and each update is
    DDIM (eta 0) from the predicted clean sample."""
    import torch

    sched = gen.diffusion_sched
    T = sched.num_steps
    ts = sorted({max(1, round(T - i * T / steps)) for i in range(steps)}, reverse=True)

    @torch.no_grad()
    def sample(audio_or_feat, prev_motion_feat=None, prev_audio_feat=None, motion_at_T=None,
               indicator=None, cfg_mode=None, cfg_cond=None, cfg_scale=1.15, flexibility=0,
               dynamic_threshold=None, ret_traj=False):  # type: ignore[no-untyped-def]
        b = audio_or_feat.shape[0]
        cfg_mode = cfg_mode or gen.cfg_mode
        cfg_cond = gen.guiding_conditions if cfg_cond is None else cfg_cond
        cfg_cond = [c for c in cfg_cond if c == "audio"]
        scales = cfg_scale if isinstance(cfg_scale, list) else [cfg_scale] * len(cfg_cond)
        audio_feat = gen.extract_audio_feature(audio_or_feat) if audio_or_feat.ndim == 2 else audio_or_feat
        if prev_motion_feat is None:
            prev_motion_feat = gen.start_motion_feat.expand(b, -1, -1)
        if prev_audio_feat is None:
            prev_audio_feat = gen.start_audio_feat.expand(b, -1, -1)
        if motion_at_T is None:
            motion_at_T = torch.randn((b, gen.n_motions, gen.motion_feat_dim)).to(gen.device)
        feats = [gen.null_audio_feat.expand(b, gen.n_motions, -1) if cfg_cond else audio_feat]
        feats += [audio_feat for _ in cfg_cond]
        n = len(feats)
        a_in = torch.cat(feats, 0)
        pm_in = torch.cat([prev_motion_feat] * n, 0)
        pa_in = torch.cat([prev_audio_feat] * n, 0)
        ind_in = torch.cat([indicator] * n, 0) if indicator is not None else None
        x = motion_at_T
        for k, t in enumerate(ts):
            step = torch.tensor([t] * (b * n), device=gen.device)
            res = gen.denoising_net(torch.cat([x] * n, 0), a_in, pm_in, pa_in, step, ind_in).chunk(n)
            x0 = res[0][:, -gen.n_motions:]
            for i in range(n - 1):
                ref = res[i][:, -gen.n_motions:] if cfg_mode == "incremental" else res[0][:, -gen.n_motions:]
                x0 = x0 + scales[i] * (res[i + 1][:, -gen.n_motions:] - ref)
            ab = sched.alpha_bars[t]
            if k + 1 < len(ts):
                ab_prev = sched.alpha_bars[ts[k + 1]]
                eps = (x - ab.sqrt() * x0) / (1 - ab).sqrt()
                x = ab_prev.sqrt() * x0 + (1 - ab_prev).sqrt() * eps
            else:
                x = x0
        return x, motion_at_T, audio_feat

    gen.sample = sample


if __name__ == "__main__":
    main()

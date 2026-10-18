"""Ditto (antgroup/ditto-talkinghead, PyTorch weights) - one image + audio -> talking head.

Runs inside ~/.athena-avatar/venvs/t2-neural-ditto. Must be launched under the GPU lock (bench.py
does that). Two modes:

  offline  - the repo's offline config (50 diffusion steps over the whole clip), writes an mp4.
  online   - the streaming config (HuBERT streaming, 10 steps, audio fed in 200 ms chunks), the
             mode a live avatar would use. --pace feeds the chunks at wall-clock speed (as a
             TTS stream would arrive); without it chunks go in as fast as the model takes them,
             which measures capacity.

Writes <out>.mp4 (frames + audio muxed) unless --no-write, and <out>.stats.json with timings.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import MODELS, GpuSampler, mux, pct, window_fps  # noqa: E402

REPO = MODELS / "ditto" / "repo"
CKPT = MODELS / "ditto" / "checkpoints"
sys.path.insert(0, str(REPO))
os.chdir(REPO)  # the repo resolves some relative paths (pyximport build dir) from cwd

import librosa  # noqa: E402
import numpy as np  # noqa: E402
import torch  # noqa: E402

ONLINE_OVERRIDES = {"online_mode": True, "sampling_timesteps": 10, "overlap_v2": 70}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--audio", required=True)
    ap.add_argument("--out", required=True, help="output mp4 path")
    ap.add_argument("--mode", choices=["offline", "online"], default="offline")
    ap.add_argument("--pace", action="store_true", help="online: feed audio at wall-clock speed")
    ap.add_argument("--no-write", action="store_true", help="time frames only, encode nothing")
    ap.add_argument("--steps", type=int, help="override diffusion sampling steps")
    ap.add_argument("--max-size", type=int, default=1920)
    ap.add_argument("--emo", type=int, help="emotion id 0..7 (repo default mixes 4)")
    ap.add_argument("--gpu-resident", action="store_true",
                    help="keep warp->decode tensors on the GPU (our patch; stock path copies via numpy)")
    ap.add_argument("--overlap", type=int, help="online: LMDM overlap frames (stock 70 -> 10 new frames per diffusion call)")
    ap.add_argument("--lmdm-compile-mode", default=None)
    ap.add_argument("--lmdm-fp16", action="store_true", help="autocast the motion diffusion (LMDM) to fp16")
    ap.add_argument("--compile", action="store_true", help="with --gpu-resident: torch.compile warp+decoder")
    args = ap.parse_args()

    out = Path(args.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    stats: dict = {"model": "ditto", "mode": args.mode, "paced": bool(args.pace)}

    t0 = time.perf_counter()
    from stream_pipeline_online import StreamSDK

    cfg = str(CKPT / "ditto_cfg" / "v0.4_hubert_cfg_pytorch.pkl")
    sdk = StreamSDK(cfg, str(CKPT / "ditto_pytorch"))
    try:
        from core.utils.blend import blend_images_cy  # noqa: F401  (cython via pyximport/MSVC)
        stats["putback"] = "cython"
    except Exception as e:  # noqa: BLE001
        from core.atomic_components.putback import PutBackNumpy

        sdk.putback = PutBackNumpy()
        stats["putback"] = f"numpy (cython build failed: {type(e).__name__})"
    if args.gpu_resident:
        # The stock PyTorch path round-trips every frame through numpy: the 8 MB source feature
        # volume goes host->device each frame, the warped feature device->host->device between
        # the warp and decode threads. Keep both on the GPU; same models, same autocast fp16.
        wn = sdk.warp_f3d.warp_net.model
        dn = sdk.decode_f3d.decoder.model
        fs_cache: dict[int, torch.Tensor] = {}
        # NOT cudnn.benchmark: with the compiled decoder it pushed peak VRAM from 1.3 GB to 17.7 GB
        # (conv workspace autotuning; scratch microbench), for no fps we could measure.
        if args.compile:
            wn = torch.compile(wn)
            dn = torch.compile(dn)
            # compile on the main thread: first calls from the SDK's worker threads deadlocked
            # (two threads tracing at once; no frame after 10 min)
            with torch.no_grad(), torch.autocast("cuda", dtype=torch.float16):
                fs0 = torch.randn(1, 32, 16, 64, 64, device="cuda")
                kp0 = torch.zeros(1, 21, 3, device="cuda")
                for _ in range(2):
                    dn(wn(fs0, kp0, kp0))
            torch.cuda.synchronize()

        def warp_gpu(f_s, x_s, x_d):
            t = fs_cache.get(id(f_s))
            if t is None:
                t = fs_cache[id(f_s)] = torch.from_numpy(f_s).cuda()
            with torch.no_grad(), torch.autocast("cuda", dtype=torch.float16):
                return wn(t, torch.from_numpy(x_s).cuda(), torch.from_numpy(x_d).cuda())

        def decode_gpu(f):
            with torch.no_grad(), torch.autocast("cuda", dtype=torch.float16):
                o = dn(f)
            return (o[0].float().permute(1, 2, 0).clamp(0, 1) * 255).cpu().numpy()

        if args.compile:
            # The motion diffusion (LMDM) is launch-bound in eager mode: ~50 ms per DDIM step for
            # a small transformer. Isolated microbench, 10 steps: eager 522 ms, inductor default
            # 134 ms, reduce-overhead (CUDA graphs) 42 ms once but then "accessing tensor output
            # of CUDAGraphs that has been overwritten" inside the real DDIM loop - so default.
            gm = sdk.audio2motion.lmdm.model.model
            gm.guided_forward = torch.compile(gm.guided_forward, mode=args.lmdm_compile_mode)
            kp0n = np.zeros((1, 265), np.float32)
            aud0 = np.zeros((1, 80, 1103), np.float32)
            for st in sorted({10, 50, args.steps or 10}):
                sdk.audio2motion.lmdm(kp0n, aud0, st)
                sdk.audio2motion.lmdm(kp0n, aud0, st)
        sdk.warp_f3d = warp_gpu
        sdk.decode_f3d = decode_gpu
        stats["gpu_resident"] = True
        stats["compiled"] = bool(args.compile)
    torch.cuda.synchronize()
    stats["load_s"] = round(time.perf_counter() - t0, 2)

    setup_kwargs: dict = {"max_size": args.max_size}
    if args.mode == "online":
        setup_kwargs.update(ONLINE_OVERRIDES)
    if args.steps:
        setup_kwargs["sampling_timesteps"] = args.steps
    if args.emo is not None:
        setup_kwargs["emo"] = args.emo
    stats["setup_kwargs"] = setup_kwargs

    audio, _ = librosa.load(args.audio, sr=16000)
    dur = len(audio) / 16000
    stats["audio_s"] = round(dur, 3)
    num_f = math.ceil(dur * 25)

    tmp_mp4 = str(out) + ".frames.mp4"
    if args.overlap is not None:
        setup_kwargs["overlap_v2"] = args.overlap
    if args.compile:
        # One full throw-away pass on 2 s of silence so every compiled graph is traced in the
        # threads that will run it (a main-thread warm-up alone still left a ~20 s first frame).
        tw = time.perf_counter()
        sdk.setup(args.source, str(out) + ".warm.mp4", **setup_kwargs)
        sdk.setup_Nd(N_d=50, fade_in=-1, fade_out=-1, ctrl_info={})
        sil = np.zeros(32000, np.float32)
        if args.mode == "online":
            a = np.concatenate([np.zeros((3 * 640,), np.float32), sil])
            for i in range(0, len(a), 5 * 640):
                c = a[i:i + 6480]
                sdk.run_chunk(np.pad(c, (0, 6480 - len(c))), (3, 5, 2))
        else:
            sdk.audio2motion_queue.put(sdk.wav2feat.wav2feat(sil))
        sdk.close()
        Path(sdk.tmp_output_path).unlink(missing_ok=True)
        stats["warmup_s"] = round(time.perf_counter() - tw, 2)
    torch.cuda.reset_peak_memory_stats()
    with GpuSampler() as gs:
        t1 = time.perf_counter()
        sdk.setup(args.source, tmp_mp4, **setup_kwargs)
        sdk.setup_Nd(N_d=num_f, fade_in=-1, fade_out=-1, ctrl_info={})
        stats["register_s"] = round(time.perf_counter() - t1, 2)

        frame_t: list[float] = []
        real_writer = sdk.writer

        class TimedWriter:
            def __call__(self, img, fmt="bgr"):
                frame_t.append(time.perf_counter())
                if not args.no_write:
                    real_writer(img, fmt=fmt)

            def close(self):
                real_writer.close()

        sdk.writer = TimedWriter()

        # per-stage wall time (each stage runs in its own thread; the slowest one sets the fps)
        stage_ms: dict[str, list[float]] = {}

        def timed(name, fn):
            def w(*a, **k):
                ts = time.perf_counter()
                r = fn(*a, **k)
                stage_ms.setdefault(name, []).append((time.perf_counter() - ts) * 1000)
                return r
            return w

        for name in ("motion_stitch", "warp_f3d", "decode_f3d", "putback"):
            setattr(sdk, name, timed(name, getattr(sdk, name)))
        lmdm = sdk.audio2motion.lmdm
        if args.lmdm_fp16:
            inner = lmdm

            def lmdm_fp16(*a, **k):
                with torch.autocast("cuda", dtype=torch.float16):
                    return inner(*a, **k)
            lmdm = lmdm_fp16
            stats["lmdm_fp16"] = True
        sdk.audio2motion.lmdm = timed("lmdm(per chunk)", lmdm)

        t_start = time.perf_counter()
        if args.mode == "online":
            chunksize = (3, 5, 2)
            a = np.concatenate([np.zeros((chunksize[0] * 640,), dtype=np.float32), audio], 0)
            split_len = int(sum(chunksize) * 0.04 * 16000) + 80
            hop = chunksize[1] * 640  # 200 ms of audio per chunk
            for k, i in enumerate(range(0, len(a), hop)):
                if args.pace:
                    # the chunk ending at i+split_len is only "available" once that audio has played
                    due = t_start + max(0, (i + split_len - chunksize[0] * 640)) / 16000
                    while time.perf_counter() < due:
                        time.sleep(0.001)
                chunk = a[i:i + split_len]
                if len(chunk) < split_len:
                    chunk = np.pad(chunk, (0, split_len - len(chunk)), mode="constant")
                tr = time.perf_counter()
                sdk.run_chunk(chunk, chunksize)  # HuBERT on the chunk, then enqueue
                stage_ms.setdefault("run_chunk(hubert)", []).append((time.perf_counter() - tr) * 1000)
        else:
            feat = sdk.wav2feat.wav2feat(audio)
            sdk.audio2motion_queue.put(feat)
        sdk.close()
        torch.cuda.synchronize()
        t_end = time.perf_counter()

    n = len(frame_t)
    stats["frames"] = n
    stats["render_s"] = round(t_end - t_start, 3)
    stats["render_s_per_output_s"] = round((t_end - t_start) / dur, 3)
    if n:
        stats["first_frame_ms"] = round((frame_t[0] - t_start) * 1000)
        wf = window_fps(frame_t)
        if wf:
            stats["fps_p50"] = round(pct(wf, 50), 1)
            stats["fps_p5"] = round(pct(wf, 5), 1)
        stats["fps_mean"] = round(n / (frame_t[-1] - frame_t[0]), 1) if n > 1 else None
        if args.pace:
            # how far behind the audio clock each frame lands (frame k is due at k/25 s)
            lag = [(ft - t_start) - k / 25 for k, ft in enumerate(frame_t)]
            stats["lag_ms_p50"] = round(pct(lag, 50) * 1000)
            stats["lag_ms_p95"] = round(pct(lag, 95) * 1000)
    stats["stage_ms_p50"] = {k: round(pct(v, 50), 1) for k, v in stage_ms.items() if v}
    stats["torch_peak_mb"] = round(torch.cuda.max_memory_allocated() / 2**20)
    stats["torch_reserved_mb"] = round(torch.cuda.max_memory_reserved() / 2**20)
    stats.update(gs.summary())

    stats = {k: v for k, v in stats.items() if v is not None}
    Path(str(out) + ".stats.json").write_text(json.dumps(stats, indent=2), encoding="utf-8")
    frames_mp4 = Path(sdk.tmp_output_path)  # the SDK appends .tmp.mp4 to what setup() was given
    if not args.no_write:
        mux(frames_mp4, Path(args.audio), out)
    frames_mp4.unlink(missing_ok=True)
    print(json.dumps(stats, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

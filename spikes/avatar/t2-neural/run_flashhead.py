"""SoulX-FlashHead (Soul-AILab, 1.3B Wan-based, distilled 4-step) - one image + audio -> video.

Runs inside ~/.athena-avatar/venvs/t2-neural-flashhead, under the GPU lock (bench.py does that).

  --model lite   LTX-VAE variant, the realtime one (vendor: 96 fps on a 4090)
  --model pro    Wan-VAE variant, higher quality (vendor: 10.8 fps on a 4090)

Audio is encoded either 'once' (whole clip, best context - the offline render) or 'stream'
(an 8 s rolling window re-encoded before every chunk - what a live avatar does). Video is
generated in chunks of 33 frames with 9 (pro) / 5 (lite) motion frames carried over, so each
chunk yields 24 or 28 new frames at 25 fps. --pace makes each chunk wait until its audio would
have arrived from a live TTS stream.

Writes <out> (mp4, audio muxed) unless --no-write, and <out>.stats.json.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections import deque
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import MODELS, GpuSampler, mux, pct  # noqa: E402

ROOT = MODELS / "flashhead"
REPO = ROOT / "repo"
sys.path.insert(0, str(REPO))
os.chdir(REPO)  # infer_params.yaml is opened by relative path

import imageio  # noqa: E402
import librosa  # noqa: E402
import numpy as np  # noqa: E402
import torch  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", choices=["lite", "pro"], default="lite")
    ap.add_argument("--source", required=True)
    ap.add_argument("--audio", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--size", type=int, nargs=2, metavar=("H", "W"), default=(512, 512))
    ap.add_argument("--audio-mode", choices=["once", "stream"], default="once")
    ap.add_argument("--face-crop", action="store_true", help="repo's mediapipe face crop first")
    ap.add_argument("--pace", action="store_true")
    ap.add_argument("--no-write", action="store_true")
    ap.add_argument("--no-compile", action="store_true", help="disable torch.compile (needs triton)")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--serve", type=int, metavar="PORT", help="also stream frames as MJPEG on this port")
    args = ap.parse_args()

    import flash_head.src.pipeline.flash_head_pipeline as fpp

    if args.no_compile:
        fpp.COMPILE_MODEL = False
        fpp.COMPILE_VAE = False
    from flash_head import inference as fi

    out = Path(args.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    stats: dict = {"model": f"flashhead-{args.model}", "audio_mode": args.audio_mode,
                   "paced": bool(args.pace), "size": list(args.size), "compiled": not args.no_compile}

    t0 = time.perf_counter()
    pipe = fi.get_pipeline(world_size=1, ckpt_dir=str(ROOT / "SoulX-FlashHead-1_3B"),
                           wav2vec_dir=str(ROOT / "wav2vec2-base-960h"), model_type=args.model)
    fi.infer_params["height"], fi.infer_params["width"] = args.size
    fi.get_base_data(pipe, cond_image_path_or_dir=str(Path(args.source).resolve()).replace("\\", "/"),
                     base_seed=args.seed, use_face_crop=args.face_crop)
    torch.cuda.synchronize()
    stats["load_s"] = round(time.perf_counter() - t0, 2)

    p = fi.get_infer_params()
    sr, fps = p["sample_rate"], p["tgt_fps"]
    frame_num, motion = p["frame_num"], p["motion_frames_num"]
    slice_len = frame_num - motion
    speech, _ = librosa.load(args.audio, sr=sr, mono=True)
    dur = len(speech) / sr
    stats["audio_s"] = round(dur, 3)
    slice_samples = slice_len * sr // fps
    frame_samples = frame_num * sr // fps

    emb_all = None
    if args.audio_mode == "once":
        rem = (len(speech) - frame_samples) % slice_samples
        a = speech if rem == 0 else np.concatenate([speech, np.zeros(slice_samples - rem, np.float32)])
        emb_all = fi.get_audio_embedding(pipe, a)

    # warm-up (torch.compile traces on first calls; not counted), with the exact tensors the run
    # feeds: the first chunk runs with 1 motion latent, later ones with 2, each shape compiles once
    tw = time.perf_counter()
    if emb_all is not None:
        warm_embs = [emb_all[:, :frame_num].contiguous(), emb_all[:, slice_len:slice_len + frame_num].contiguous()]
    else:
        warm = np.zeros(sr * p["cached_audio_duration"], dtype=np.float32)
        e = fi.get_audio_embedding(pipe, warm, p["cached_audio_duration"] * fps - frame_num,
                                   p["cached_audio_duration"] * fps)
        warm_embs = [e, e]
    for e in warm_embs:
        fi.run_pipeline(pipe, e)
    torch.cuda.synchronize()
    stats["warmup_s"] = round(time.perf_counter() - tw, 2)
    pipe.reset_person_name()  # drop the warm-up's motion frames

    srv = None
    if args.serve:
        from mjpeg import MjpegServer
        srv = MjpegServer(port=args.serve, fps=fps).start()
        print(f"MJPEG on http://127.0.0.1:{args.serve}/", flush=True)

    def emit(v):
        if srv:
            for fr in v.numpy().astype(np.uint8):
                srv.push(fr)

    chunks: list[torch.Tensor] = []
    chunk_s: list[float] = []
    chunk_done: list[float] = []
    torch.cuda.reset_peak_memory_stats()
    with GpuSampler() as gs:
        t_start = time.perf_counter()
        if emb_all is not None:
            n_chunks = (emb_all.shape[1] - frame_num) // slice_len + 1
            for i in range(n_chunks):
                tc = time.perf_counter()
                v = fi.run_pipeline(pipe, emb_all[:, i * slice_len:i * slice_len + frame_num].contiguous())
                v = v if i == 0 else v[motion:]
                torch.cuda.synchronize()
                chunk_s.append(time.perf_counter() - tc)
                chunk_done.append(time.perf_counter())
                chunks.append(v.cpu())
                emit(chunks[-1])
        else:
            cached = sr * p["cached_audio_duration"]
            end_idx = p["cached_audio_duration"] * fps
            dq = deque([0.0] * cached, maxlen=cached)
            rem = len(speech) % slice_samples
            a = speech if rem == 0 else np.concatenate([speech, np.zeros(slice_samples - rem, np.float32)])
            for i, sl in enumerate(a.reshape(-1, slice_samples)):
                if args.pace:
                    due = t_start + (i + 1) * slice_samples / sr
                    while time.perf_counter() < due:
                        time.sleep(0.001)
                tc = time.perf_counter()
                dq.extend(sl.tolist())
                emb = fi.get_audio_embedding(pipe, np.array(dq, dtype=np.float32), end_idx - frame_num, end_idx)
                v = fi.run_pipeline(pipe, emb)[motion:]
                torch.cuda.synchronize()
                chunk_s.append(time.perf_counter() - tc)
                chunk_done.append(time.perf_counter())
                chunks.append(v.cpu())
                emit(chunks[-1])
        t_end = time.perf_counter()
        if srv:
            srv.drain()
            stats["stream_first_shown_ms"] = round((srv.first_shown_at - t_start) * 1000)
            stats["stream_shown"] = srv.shown
            stats["stream_max_queue"] = srv.max_depth
            srv.stop()

    n = sum(int(c.shape[0]) for c in chunks)
    stats["frames"] = n
    stats["chunks"] = len(chunks)
    stats["render_s"] = round(t_end - t_start, 3)
    stats["render_s_per_output_s"] = round((t_end - t_start) / dur, 3)
    per_chunk_fps = [int(c.shape[0]) / s for c, s in zip(chunks, chunk_s)]
    stats["fps_p50"] = round(pct(per_chunk_fps, 50), 1)
    stats["fps_p5"] = round(pct(per_chunk_fps, 5), 1)
    stats["chunk_ms_p50"] = round(pct(chunk_s, 50) * 1000)
    stats["first_frame_ms"] = round((chunk_done[0] - t_start) * 1000)
    if args.pace:
        # a frame is shown no earlier than its chunk lands; lag vs the audio clock
        lag, k = [], 0
        for c, done in zip(chunks, chunk_done):
            for _ in range(int(c.shape[0])):
                lag.append((done - t_start) - k / fps)
                k += 1
        stats["lag_ms_p50"] = round(pct(lag, 50) * 1000)
        stats["lag_ms_p95"] = round(pct(lag, 95) * 1000)
    stats["torch_peak_mb"] = round(torch.cuda.max_memory_allocated() / 2**20)
    stats["torch_reserved_mb"] = round(torch.cuda.max_memory_reserved() / 2**20)
    stats.update(gs.summary())

    if not args.no_write:
        tmp = str(out) + ".frames.mp4"
        with imageio.get_writer(tmp, fps=fps, codec="libx264", quality=None,
                                ffmpeg_params=["-crf", "14", "-bf", "0"], macro_block_size=1) as w:
            for c in chunks:
                for fr in c.numpy().astype(np.uint8):
                    w.append_data(fr)
        mux(Path(tmp), Path(args.audio), out)
        Path(tmp).unlink(missing_ok=True)
    Path(str(out) + ".stats.json").write_text(json.dumps(stats, indent=2), encoding="utf-8")
    print(json.dumps(stats, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

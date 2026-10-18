"""Is JoyVASA's motion model faster under onnxruntime on CPU? One 4 s window, torch vs ORT.

    python onnx_motion.py export          # -> DATA/onnx/{audio,denoiser}.onnx (CPU, fp32)
    python onnx_motion.py time --threads 4 [--affinity 0,2,4,6]

The two networks a window runs: the audio path (``extract_audio_feature``: chinese-hubert-base,
resample, the 768->256 map) once per window, and the denoiser (batch 2 for CFG) 50 times. The
sampler loop around them is JoyVASA's, re-implemented in numpy for the ORT run, with the same
noise, so the two outputs must agree (max abs diff reported). The rest of ``Motion.frames``
(librosa resample, retarget) is unchanged and measured in the main bench as ``other_s``.
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

OUT = common.DATA / "onnx"


def load(threads: int, affinity: str):  # type: ignore[no-untyped-def]
    import bench_motion

    return bench_motion.load("cpu", threads, affinity, ["lean"])


def export() -> None:
    import torch

    s = load(8, "")
    gen = s["gen"]
    OUT.mkdir(parents=True, exist_ok=True)

    class Audio(torch.nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.g = gen

        def forward(self, audio: torch.Tensor) -> torch.Tensor:
            return self.g.extract_audio_feature(audio)

    audio = torch.zeros(1, 64000)
    torch.onnx.export(Audio().eval(), (audio,), str(OUT / "audio.onnx"), input_names=["audio"],
                      output_names=["feat"], opset_version=17)
    net = gen.denoising_net
    n = 2
    args = (torch.zeros(n, 100, 73), torch.zeros(n, 100, 256), torch.zeros(n, 10, 73), torch.zeros(n, 10, 256),
            torch.ones(n, dtype=torch.long), torch.ones(n, 100))
    torch.onnx.export(net.eval(), args, str(OUT / "denoiser.onnx"),
                      input_names=["x", "audio_feat", "prev_motion", "prev_audio", "step", "indicator"],
                      output_names=["out"], opset_version=17)
    for f in OUT.glob("*.onnx"):
        print(f.name, round(f.stat().st_size / 1e6, 1), "MB")


def time_window(threads: int, affinity: str, reps: int) -> dict:
    import numpy as np
    import onnxruntime as ort
    import torch

    s = load(threads, affinity)
    gen = s["gen"]
    pcm, sr = common.read_wav(common.DATA / "lengths" / "s3.wav")
    import librosa

    a16 = librosa.load(str(common.DATA / "lengths" / "s3.wav"), sr=16000)[0]
    a16 = np.pad(a16, (1280, 640))
    a16 = np.pad(a16, (0, max(0, 64000 - len(a16))))[:64000].astype(np.float32)
    audio_t = torch.tensor(a16)[None]
    ind = torch.ones(1, 100)
    torch.manual_seed(7)
    noise = torch.randn(1, 100, 73)

    def torch_window() -> np.ndarray:
        with torch.inference_mode():
            x, _, _ = gen.sample(audio_t, indicator=ind, cfg_scale=2.0, motion_at_T=noise.clone(),
                                 dynamic_threshold=0)
        return x.numpy()

    o = ort.SessionOptions()
    o.intra_op_num_threads = threads
    o.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    sa = ort.InferenceSession(str(OUT / "audio.onnx"), o, providers=["CPUExecutionProvider"])
    sd = ort.InferenceSession(str(OUT / "denoiser.onnx"), o, providers=["CPUExecutionProvider"])
    sched = gen.diffusion_sched
    alphas, abar = sched.alphas.numpy(), sched.alpha_bars.numpy()
    sig = sched.get_sigmas(torch.arange(sched.num_steps + 1), 0).numpy()
    null = gen.null_audio_feat.detach().numpy()
    pm = gen.start_motion_feat.detach().numpy()
    pa = gen.start_audio_feat.detach().numpy()

    def ort_window(seed: int = 7) -> np.ndarray:
        torch.manual_seed(seed)
        _ = torch.randn(1, 100, 73)  # keep the same z draws as torch's loop below
        feat = sa.run(None, {"audio": a16[None]})[0]
        a_in = np.concatenate([np.broadcast_to(null, (1, 100, 256)), feat], 0).astype(np.float32)
        pm_in = np.concatenate([pm, pm], 0)
        pa_in = np.concatenate([pa, pa], 0)
        x = noise.numpy().copy()
        for t in range(sched.num_steps, 0, -1):
            z = torch.randn(1, 100, 73).numpy() if t > 1 else np.zeros_like(x)
            r = sd.run(None, {"x": np.concatenate([x, x], 0), "audio_feat": a_in, "prev_motion": pm_in,
                              "prev_audio": pa_in, "step": np.array([t, t], np.int64)})[0]
            # (no indicator: JoyVASA builds its DenoisingNetwork without use_indicator, so the
            # exporter drops that input as unused)
            r0, r1 = r[0:1, -100:], r[1:2, -100:]
            th = r0 + 2.0 * (r1 - r0)
            c0 = (1 - abar[t - 1]) * np.sqrt(alphas[t]) / (1 - abar[t])
            c1 = (1 - alphas[t]) * np.sqrt(abar[t - 1]) / (1 - abar[t])
            x = c0 * x + c1 * th + sig[t] * z
        return x

    torch.manual_seed(7)
    torch.randn(1, 100, 73)
    ref = torch_window()
    got = ort_window()
    # the samplers draw their per-step noise in different orders, so whole windows differ; the
    # equivalence check is per network on identical inputs
    with torch.inference_mode():
        f_t = gen.extract_audio_feature(audio_t).numpy()
        xin = torch.randn(2, 100, 73)
        ain = torch.tensor(np.concatenate([np.broadcast_to(null, (1, 100, 256)), f_t], 0).astype(np.float32))
        pm2, pa2 = torch.tensor(np.concatenate([pm, pm])), torch.tensor(np.concatenate([pa, pa]))
        d_t = gen.denoising_net(xin, ain, pm2, pa2, torch.tensor([25, 25])).numpy()
    f_o = sa.run(None, {"audio": a16[None]})[0]
    d_o = sd.run(None, {"x": xin.numpy(), "audio_feat": ain.numpy(), "prev_motion": pm2.numpy(),
                        "prev_audio": pa2.numpy(), "step": np.array([25, 25], np.int64)})[0]
    res = {"threads": threads, "affinity": affinity,
           "audio_feat_max_abs_diff": float(np.max(np.abs(f_t - f_o))), "audio_feat_abs_mean": float(np.mean(np.abs(f_t))),
           "denoiser_max_abs_diff": float(np.max(np.abs(d_t - d_o))), "denoiser_abs_mean": float(np.mean(np.abs(d_t))),
           "window_max_abs_diff_different_noise_order": float(np.max(np.abs(ref - got)))}
    for name, fn in (("torch", torch_window), ("ort", ort_window)):
        walls = []
        fn()
        for _ in range(reps):
            with common.Meter() as m:
                fn()
            walls.append(m.wall)
        res[name] = common.summary(walls)
    # the parts on their own
    for name, fn in (
        ("ort_audio", lambda: sa.run(None, {"audio": a16[None]})),
        ("torch_audio", lambda: gen.extract_audio_feature(audio_t)),
    ):
        walls = []
        with torch.inference_mode():
            fn()
            for _ in range(reps):
                with common.Meter() as m:
                    fn()
                walls.append(m.wall)
        res[name] = common.summary(walls)
    res["machine"] = common.machine()
    return res


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("cmd", choices=["export", "time"])
    p.add_argument("--threads", type=int, default=4)
    p.add_argument("--affinity", default="")
    p.add_argument("--reps", type=int, default=5)
    a = p.parse_args()
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    if a.cmd == "export":
        export()
        return
    res = time_window(a.threads, a.affinity, a.reps)
    tag = f"t{a.threads}" + (f"-aff{len(a.affinity.split(','))}" if a.affinity else "")
    common.write_json(common.RESULTS / "onnx" / f"window-{tag}.json", res)
    print({k: v for k, v in res.items() if k != "machine"})


if __name__ == "__main__":
    main()

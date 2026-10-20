"""InfiniteTalk (MeiGen-AI, Wan2.1-I2V-14B + audio adapter, fp8 quantised DiT) - the offline
quality ceiling of this track. Not realtime by orders of magnitude; it answers "how good does an
open model get if time is free".

Runs inside ~/.athena-avatar/venvs/t2-neural-infinitetalk, under the GPU lock (bench.py does
that). Wraps the repo's generate_infinitetalk.py (its CLI is the supported surface) and times it.
Writes <out> (mp4, audio muxed) and <out>.stats.json.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import MODELS, GpuSampler, mux  # noqa: E402

ROOT = MODELS / "infinitetalk"
REPO = ROOT / "repo"

PROMPT = ("A woman speaks calmly and warmly to the camera in a softly lit room, natural subtle head "
          "movement, natural blinking, a close-up portrait shot.")


def launch(argv: list[str]) -> None:
    """Run generate_infinitetalk.py with one patch: optimum-quanto routes fp8 Linear weights to
    its Marlin kernel, a JIT CUDA extension whose sources use GCC inline asm (`__asm__`) and do not
    compile with MSVC/nvcc on Windows. Fall back to quanto's plain fp8 tensor (weights stay fp8 in
    VRAM, matmuls dequantise to bf16)."""
    import runpy

    import optimum.quanto.tensor.weights.marlin as qm
    import optimum.quanto.tensor.weights.qbytes as qb

    def no_marlin(qtype, axis, size, stride, data, scale, requires_grad=False):
        return qb.WeightQBytesTensor(qtype, axis, size, stride, data, scale, None, requires_grad)

    qm.MarlinF8QBytesTensor = no_marlin  # qbytes.create imports it from here at call time

    # bf16 path on a 64 GB-RAM box: the repo builds the 14B DiT in fp32 (56 GB) and then merges all
    # 7 fp32 shards (66 GB) into one dict before load_state_dict - the process died with an access
    # violation (0xC0000005) right after "Creating WanModel". Build the DiT in bf16 and stream each
    # shard into it as it is read (peak ~ 28 GB model + one 10 GB shard).
    import gc

    import torch

    sys.path.insert(0, str(REPO))
    import wan.multitalk as wm
    from wan.modules.multitalk_model import WanModel

    holder: dict = {}
    orig_init, orig_lsd, orig_load = WanModel.__init__, WanModel.load_state_dict, wm.load_file

    def init_bf16(self, *a, **k):
        prev = torch.get_default_dtype()
        torch.set_default_dtype(torch.bfloat16)
        try:
            orig_init(self, *a, **k)
        finally:
            torch.set_default_dtype(prev)
        holder["m"] = self

    def lsd(self, sd, *a, **k):
        if not sd:  # the merged dict our streaming loader left empty
            return None
        return orig_lsd(self, sd, *a, **k)

    def streaming_load(path, *a, **k):
        name = os.path.basename(str(path))
        if holder.get("m") is not None and (name.startswith("diffusion_pytorch_model") or name == "infinitetalk.safetensors"):
            sd = orig_load(path, *a, **k)
            for key in list(sd):
                if sd[key].is_floating_point():
                    sd[key] = sd[key].to(torch.bfloat16)
            orig_lsd(holder["m"], sd, strict=False)
            del sd
            gc.collect()
            return {}
        return orig_load(path, *a, **k)

    WanModel.__init__ = init_bf16
    WanModel.load_state_dict = lsd
    wm.load_file = streaming_load
    sys.argv = ["generate_infinitetalk.py", *argv]
    sys.path.insert(0, str(REPO))
    runpy.run_path(str(REPO / "generate_infinitetalk.py"), run_name="__main__")


def main() -> int:
    if len(sys.argv) > 1 and sys.argv[1] == "--_launch":
        launch(sys.argv[2:])
        return 0
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--audio", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--size", default="infinitetalk-480", choices=["infinitetalk-480", "infinitetalk-720"])
    ap.add_argument("--steps", type=int, default=40)
    ap.add_argument("--lora", action="store_true", help="bf16 + lightx2v 4-step LoRA instead of fp8 40-step")
    ap.add_argument("--teacache", action="store_true")
    ap.add_argument("--offload", action="store_true", help="--num_persistent_param_in_dit 0 (low VRAM)")
    ap.add_argument("--prompt", default=PROMPT)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    args.steps_given = "--steps" in sys.argv

    out = Path(args.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    work = out.parent / (out.stem + "_it")
    work.mkdir(exist_ok=True)
    spec = {"prompt": args.prompt, "cond_video": str(Path(args.source).resolve()).replace("\\", "/"),
            "cond_audio": {"person1": str(Path(args.audio).resolve()).replace("\\", "/")}}
    (work / "input.json").write_text(json.dumps(spec), encoding="utf-8")
    save = work / "raw"
    common_args = ["--ckpt_dir", str(ROOT / "Wan2.1-I2V-14B-480P"),
                   "--wav2vec_dir", str(ROOT / "chinese-wav2vec2-base"),
                   "--input_json", str(work / "input.json"),
                   "--size", args.size, "--mode", "streaming", "--motion_frame", "9",
                   "--base_seed", str(args.seed),
                   "--audio_save_dir", str(work / "audio"), "--save_file", str(save)]
    if args.lora:
        # bf16 base + the lightx2v step/CFG-distill LoRA (repo README section 2): 4 steps, text
        # CFG off, audio CFG 2, shift 2. The repo forbids LoRA together with --quant.
        steps = args.steps if args.steps_given else 4
        variant = ["--infinitetalk_dir", str(ROOT / "InfiniteTalk" / "single" / "infinitetalk.safetensors"),
                   "--lora_dir", str(ROOT / "lora" / "Wan21_T2V_14B_lightx2v_cfg_step_distill_lora_rank32.safetensors"),
                   "--lora_scale", "1.0", "--sample_text_guide_scale", "1.0",
                   "--sample_audio_guide_scale", "2.0", "--sample_shift", "2",
                   "--sample_steps", str(steps)]
    else:
        steps = args.steps
        fp8 = str(ROOT / "InfiniteTalk" / "quant_models" / "infinitetalk_single_fp8.safetensors")
        variant = ["--infinitetalk_dir", fp8, "--quant", "fp8", "--quant_dir", fp8, "--sample_steps", str(steps)]
    cmd = [sys.executable, str(Path(__file__).resolve()), "--_launch", *common_args, *variant]
    if args.teacache:
        cmd += ["--use_teacache"]
    if args.offload:
        cmd += ["--num_persistent_param_in_dit", "0"]
    stats: dict = {"model": "infinitetalk-" + ("bf16-lightx2v" if args.lora else "fp8"),
                   "size": args.size, "steps": steps,
                   "teacache": args.teacache, "offload": args.offload}
    t = time.perf_counter()
    with GpuSampler() as gs:
        subprocess.run(cmd, cwd=REPO, check=True)
    stats["wall_s"] = round(time.perf_counter() - t, 1)  # includes model load (~minutes)
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of",
                                "csv=p=0", args.audio], capture_output=True, text=True).stdout.strip())
    stats["audio_s"] = round(dur, 3)
    stats["render_s"] = stats["wall_s"]
    stats["render_s_per_output_s"] = round(stats["wall_s"] / dur, 1)
    if gs.mem_mb:
        stats["vram_mb_device_peak"] = round(max(gs.mem_mb))
    stats.update({k: v for k, v in gs.summary().items() if k == "gpu_util_pct"})
    produced = Path(str(save) + ".mp4")
    mux(produced, Path(args.audio), out)
    Path(str(out) + ".stats.json").write_text(json.dumps(stats, indent=2), encoding="utf-8")
    print(json.dumps(stats, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

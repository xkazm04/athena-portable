"""t2-neural bench: one command per model renders the 3 bench lines for a portrait.

    python spikes/avatar/t2-neural/bench.py --model ditto            # every operator portrait
    python spikes/avatar/t2-neural/bench.py --model flashhead-pro --portrait <id>
    python spikes/avatar/t2-neural/bench.py --model flashhead-lite --smoke   # install check

Runs with any Python 3.10+ (stdlib only); each model step runs in that model's venv under the GPU
lock, one job per lock hold. Output, per line:
    ~/.athena-avatar/bench/t2-neural/<portrait>/<model>/<line>.mp4     (1920x1080 H.264 + AAC)
    ~/.athena-avatar/bench/t2-neural/<portrait>/<model>/<line>.metrics.json
plus <line>.native.mp4 (the model's own resolution) and a realtime probe (paced streaming run on
'long', nothing encoded) whose figures fill metrics.realtime for every line of that portrait.
--smoke renders one clip (the repo's sample image + voice/calm.wav) to
~/.athena-avatar/portraits/_smoke/t2-neural/<model>/ and never touches bench/.

Contract note: CONTRACT.md fixes bench/<track-id>/<portrait-id>/<line-id>.mp4 with one clip per
line; this track benches several models, so the model sits as one more directory level and the
best model's clips are also copied to the contract path (see --promote).
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (BENCH, LINE_IDS, PORTRAITS, SMOKE, SPIKE_DIR, TRACK_DIR, VENVS,  # noqa: E402
                    VOICE, compose_1080p, ffprobe_size, make_canvas_1080p, real_portraits, write_metrics)

GPULOCK = SPIKE_DIR / "tools" / "gpulock.py"

LICENCE = {
    "ditto": [
        {"component": "Ditto code + motion/render weights (antgroup)", "licence": "Apache-2.0", "commercial_ok": True},
        {"component": "LivePortrait-derived warp/decoder architecture", "licence": "MIT", "commercial_ok": True},
        {"component": "InsightFace det_10g / 2d106det (face det + 106 landmarks)", "licence": "non-commercial research only", "commercial_ok": False},
        {"component": "MediaPipe face_landmarker.task", "licence": "Apache-2.0", "commercial_ok": True},
        {"component": "HuBERT streaming encoder (onnx in Ditto release)", "licence": "Apache-2.0 (Ditto release); HuBERT MIT", "commercial_ok": True},
    ],
    "flashhead": [
        {"component": "SoulX-FlashHead code (Soul-AILab)", "licence": "Apache-2.0", "commercial_ok": True},
        {"component": "SoulX-FlashHead-1_3B weights", "licence": "HF card says 'other', no terms text", "commercial_ok": None},
        {"component": "Wan2.1 VAE / architecture", "licence": "Apache-2.0", "commercial_ok": True},
        {"component": "LTX-Video VAE (lite only)", "licence": "LTX-Video licence (OpenRAIL-M style, use-based limits)", "commercial_ok": None},
        {"component": "facebook/wav2vec2-base-960h", "licence": "Apache-2.0", "commercial_ok": True},
    ],
    "infinitetalk": [
        {"component": "InfiniteTalk code + weights (MeiGen-AI)", "licence": "Apache-2.0", "commercial_ok": True},
        {"component": "Wan2.1-I2V-14B-480P (base, T5 umt5-xxl, CLIP, VAE)", "licence": "Apache-2.0", "commercial_ok": True},
        {"component": "TencentGameMate/chinese-wav2vec2-base", "licence": "MIT", "commercial_ok": True},
        {"component": "lightx2v step/CFG-distill LoRA (Kijai repack; upstream lightx2v Apache-2.0)", "licence": "Apache-2.0 upstream; repack repo states none", "commercial_ok": True},
    ],
}

MODELS_CFG = {
    "ditto": {"venv": "t2-neural-ditto", "runner": "run_ditto.py", "fps": 25, "lic": "ditto",
              "offline": ["--mode", "offline", "--gpu-resident", "--compile"],
              "probe": ["--mode", "online", "--pace", "--no-write", "--gpu-resident", "--compile"]},
    "flashhead-lite": {"venv": "t2-neural-flashhead", "runner": "run_flashhead.py", "fps": 25, "lic": "flashhead",
                       "offline": ["--model", "lite", "--audio-mode", "once"],
                       "probe": ["--model", "lite", "--audio-mode", "stream", "--pace", "--no-write"]},
    "flashhead-pro": {"venv": "t2-neural-flashhead", "runner": "run_flashhead.py", "fps": 25, "lic": "flashhead",
                      "offline": ["--model", "pro", "--audio-mode", "once"],
                      "probe": ["--model", "pro", "--audio-mode", "stream", "--pace", "--no-write"]},
    "infinitetalk": {"venv": "t2-neural-infinitetalk", "runner": "run_infinitetalk.py", "fps": 25, "lic": "infinitetalk",
                     "offline": ["--lora", "--offload"], "probe": None},
}


def venv_python(venv: str) -> Path:
    v = VENVS / venv
    return v / "Scripts" / "python.exe" if (v / "Scripts").exists() else v / "bin" / "python"


def gpu_run(label: str, venv: str, argv: list[str]) -> None:
    cmd = [sys.executable, str(GPULOCK), "--label", f"t2-neural: {label}", "--",
           str(venv_python(venv)), *argv]
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)


def model_input(model: str, portrait_png: Path, work: Path) -> tuple[Path, list[str]]:
    """What each model is fed. Ditto renders the face crop and pastes it back into the full
    frame, so it gets the portrait on a 1920x1080 canvas and its output is native 1080p.
    FlashHead regenerates the whole frame at 512x512 from a centre crop, so it gets the portrait
    itself (the head must be near the centre-top, as in a Leonardo bust shot)."""
    if model == "ditto":
        return make_canvas_1080p(portrait_png, work / "canvas_1080p.png"), []
    return portrait_png, []


UPSCALE = 0  # set from --upscale: 0 off, 2/4 = Real-ESRGAN x2plus/x4plus before compose


def render_one(model: str, src: Path, audio: Path, out_dir: Path, line: str, extra: list[str]) -> dict:
    cfg = MODELS_CFG[model]
    native = out_dir / f"{line}.native.mp4"
    t = time.perf_counter()
    gpu_run(f"{model} {line}", cfg["venv"], [str(TRACK_DIR / cfg["runner"]), "--source", str(src),
            "--audio", str(audio), "--out", str(native), *cfg["offline"], *extra])
    stats = json.loads(Path(str(native) + ".stats.json").read_text(encoding="utf-8"))
    final = out_dir / f"{line}.mp4"
    clip = native
    if UPSCALE and ffprobe_size(native)[1] < 1080:
        clip = out_dir / f"{line}.up{UPSCALE}.mp4"
        gpu_run(f"{model} {line} esrgan x{UPSCALE}", "t2-neural-flashhead",
                [str(TRACK_DIR / "upscale.py"), "--in", str(native), "--out", str(clip), "--scale", str(UPSCALE)])
        up = json.loads(Path(str(clip) + ".stats.json").read_text(encoding="utf-8"))
        stats["upscale"] = up
        stats["render_s"] = round(stats["render_s"] + up["upscale_s"], 3)
    tc = time.perf_counter()
    compose_1080p(clip, audio, final, cfg["fps"])
    stats["compose_s"] = round(time.perf_counter() - tc, 2)
    stats["wall_s"] = round(time.perf_counter() - t, 2)
    return stats


def probe(model: str, src: Path, audio: Path, out_dir: Path, extra: list[str]) -> dict:
    cfg = MODELS_CFG[model]
    p = out_dir / "_realtime_probe.mp4"
    gpu_run(f"{model} realtime probe", cfg["venv"], [str(TRACK_DIR / cfg["runner"]), "--source", str(src),
            "--audio", str(audio), "--out", str(p), *cfg["probe"], *extra])
    return json.loads(Path(str(p) + ".stats.json").read_text(encoding="utf-8"))


def metrics_for(model: str, portrait: str, line: str, final: Path, st: dict, rt: dict | None, notes: str) -> dict:
    w, h = ffprobe_size(final)
    nw, nh = ffprobe_size(final.with_name(f"{line}.native.mp4"))
    up = st.get("upscale")
    how = (f"{up['upscaler']} ({up['ms_per_frame']} ms/frame) then lanczos" if up
           else "lanczos, no restorer")
    realtime = None
    if rt:
        realtime = {"fps_p50": rt.get("fps_p50"), "fps_p5": rt.get("fps_p5"),
                    "vram_mb": rt.get("torch_reserved_mb"),
                    "gpu_util_pct": rt.get("gpu_util_pct"), "first_frame_ms": rt.get("first_frame_ms")}
    return {
        "track": "t2-neural", "portrait_id": portrait, "line_id": line,
        "render": {"width": w, "height": h, "fps": MODELS_CFG[model]["fps"],
                   "seconds_per_clip": round(st["render_s"] + st.get("compose_s", 0), 2)},
        "realtime": realtime,
        "licence": LICENCE[MODELS_CFG[model]["lic"]] + ([
            {"component": "Real-ESRGAN weights + code (xinntao)", "licence": "BSD-3-Clause", "commercial_ok": True},
            {"component": "spandrel loader", "licence": "MIT", "commercial_ok": True}] if up else []),
        "notes": (f"model={model}; native {nw}x{nh}, composed to {w}x{h} ({how}, blurred side fill); "
                  f"seconds_per_clip = generation {st['render_s']} s + compose "
                  f"{st.get('compose_s')} s for {st['audio_s']} s of audio, model load "
                  f"{st.get('load_s')} s excluded; realtime = paced streaming probe on 'long' "
                  f"(lag p50/p95 ms {rt.get('lag_ms_p50') if rt else '-'}/{rt.get('lag_ms_p95') if rt else '-'}). "
                  + notes),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True, choices=sorted(MODELS_CFG))
    ap.add_argument("--portrait", help="portrait id (default: every operator portrait)")
    ap.add_argument("--lines", default=",".join(LINE_IDS))
    ap.add_argument("--smoke", action="store_true")
    ap.add_argument("--no-probe", action="store_true")
    ap.add_argument("--promote", action="store_true",
                    help="also copy clips + metrics to the contract path bench/t2-neural/<portrait>/<line>.*")
    ap.add_argument("--extra", default="", help="extra runner args, e.g. '--size 768 768'")
    ap.add_argument("--notes", default="")
    ap.add_argument("--upscale", type=int, choices=[0, 2, 4], default=0,
                    help="Real-ESRGAN before compose when native height < 1080")
    args = ap.parse_args()
    extra = args.extra.split() if args.extra else []
    global UPSCALE
    UPSCALE = args.upscale

    if args.smoke:
        sample = {"ditto": SMOKE / "ditto_image.png"}.get(args.model, SMOKE / "flashhead_girl.png")
        audio = VOICE / "calm.wav" if (VOICE / "calm.wav").exists() else SMOKE / "ditto_audio.wav"
        out_dir = SMOKE / "t2-neural" / args.model
        out_dir.mkdir(parents=True, exist_ok=True)
        src, _ = model_input(args.model, sample, out_dir)
        st = render_one(args.model, src, audio, out_dir, "smoke", extra)
        rt = None if args.no_probe or not MODELS_CFG[args.model]["probe"] else probe(args.model, src, audio, out_dir, extra)
        (out_dir / "smoke.summary.json").write_text(json.dumps({"offline": st, "realtime": rt}, indent=2))
        print(json.dumps({"offline": st, "realtime": rt}, indent=2))
        return 0

    portraits = [args.portrait] if args.portrait else real_portraits()
    if not portraits:
        print("no operator portrait under", PORTRAITS, "- nothing to bench (use --smoke)")
        return 2
    for pid in portraits:
        png = PORTRAITS / pid / "portrait.png"
        out_dir = BENCH / pid / args.model
        work = PORTRAITS / pid / "t2-neural"
        work.mkdir(parents=True, exist_ok=True)
        out_dir.mkdir(parents=True, exist_ok=True)
        src, _ = model_input(args.model, png, work)
        rt = None
        if MODELS_CFG[args.model]["probe"] and not args.no_probe:
            rt = probe(args.model, src, VOICE / "long.wav", out_dir, extra)
        for line in args.lines.split(","):
            st = render_one(args.model, src, VOICE / f"{line}.wav", out_dir, line, extra)
            final = out_dir / f"{line}.mp4"
            m = metrics_for(args.model, pid, line, final, st, rt, args.notes)
            write_metrics(out_dir / f"{line}.metrics.json", m)
            if args.promote:
                shutil.copy2(final, BENCH / pid / f"{line}.mp4")
                write_metrics(BENCH / pid / f"{line}.metrics.json", m)
            print("wrote", final)
    return 0


if __name__ == "__main__":
    sys.exit(main())

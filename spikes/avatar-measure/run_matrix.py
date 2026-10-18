"""Run the motion-bench matrix, one fresh process per (config, repeat), resumable.

    python run_matrix.py threads      # Part A.1/A.2: CPU 4/8/16 threads, 4-core proxy, 2-core, CUDA
    python run_matrix.py variants     # Part A.5: inference_mode, bf16, lean, steps=K, compile, nocfg
    python run_matrix.py quality      # frames for the quality comparison (seeds, steps)
    python run_matrix.py replay       # Part A.4: the live 5-sentence schedule per config

Before each process it waits (up to --wait-min) for the machine to be quiet - under --quiet-pct
of all logical CPUs busy over 3 s - because another workload on a shared box skews CPU numbers;
the background load it actually ran under is recorded in every row (``machine_busy_pct``).
CUDA runs go through the spike's gpulock.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import common  # noqa: E402

AFF4 = "0,2,4,6"  # one logical CPU on each of 4 physical cores (SMT siblings are 2k, 2k+1)
AFF2 = "0,2"


def jobs(which: str) -> list[dict]:
    out: list[dict] = []
    if which == "threads":
        for rep in range(3):
            out += [
                {"label": f"cpu-t4-r{rep}", "args": ["--device", "cpu", "--threads", "4"]},
                {"label": f"cpu-t8-r{rep}", "args": ["--device", "cpu", "--threads", "8"]},
                {"label": f"cpu-t16-r{rep}", "args": ["--device", "cpu", "--threads", "16"]},
                {"label": f"cpu-aff4-t4-r{rep}",
                 "args": ["--device", "cpu", "--threads", "4", "--affinity", AFF4]},
                {"label": f"cpu-aff2-t2-r{rep}",
                 "args": ["--device", "cpu", "--threads", "2", "--affinity", AFF2]},
                {"label": f"cuda-r{rep}", "args": ["--device", "cuda"], "gpu": True},
            ]
    elif which == "variants":
        for base, args in (
            ("t8", ["--device", "cpu", "--threads", "8"]),
            ("aff4", ["--device", "cpu", "--threads", "4", "--affinity", AFF4]),
        ):
            for v in ("none", "inference_mode", "bf16", "lean", "steps=25", "steps=10", "steps=5",
                      "nocfg", "compile", "lean,inference_mode,steps=10"):
                extra = [] if v == "none" else ["--variant", v]
                out.append({"label": f"var-{base}-{v.replace(',', '+').replace('=', '')}",
                            "args": args + extra})
        for v in ("none", "fp16", "steps=10"):
            extra = [] if v == "none" else ["--variant", v]
            out.append({"label": f"var-cuda-{v.replace('=', '')}", "args": ["--device", "cuda"] + extra,
                        "gpu": True})
    elif which == "replay":
        cfgs = {
            "cpu-t4": ["--device", "cpu", "--threads", "4"],
            "cpu-t8": ["--device", "cpu", "--threads", "8"],
            "cpu-t16": ["--device", "cpu", "--threads", "16"],
            "cpu-aff4-t4": ["--device", "cpu", "--threads", "4", "--affinity", AFF4],
            "cpu-aff2-t2": ["--device", "cpu", "--threads", "2", "--affinity", AFF2],
            "cuda": ["--device", "cuda"],
        }
        cfgs["cpu-t4-lean-steps10"] = ["--device", "cpu", "--threads", "4", "--variant", "lean,steps=10"]
        for name, args in cfgs.items():
            for kok in ("live", "none"):
                out.append({"label": f"{name}-kokoro-{kok}", "script": "live_replay.py",
                            "args": args + ["--kokoro", kok, "--lines", "3"], "gpu": name == "cuda"})
    elif which == "quality2":  # the same comparison on 30 held-out corpus sentences (about 2.5 min)
        corpus = json.loads((common.DATA / "distill" / "corpus.json").read_text(encoding="utf-8"))
        ids = ",".join(r["id"] for r in corpus[-30:])
        base = ["--device", "cuda", "--reps", "1", "--audio-dir", str(common.DATA / "distill" / "wav"),
                "--names", ids]
        for seed in (7, 8, 9):
            out.append({"label": f"q2-seed{seed}", "args": base + ["--seed", str(seed)], "gpu": True})
        for k in (25, 10, 5):
            out.append({"label": f"q2-steps{k}", "args": base + ["--variant", f"steps={k}"], "gpu": True})
        out.append({"label": "q2-nocfg", "args": base + ["--variant", "nocfg"], "gpu": True})
        out.append({"label": "q2-fp16", "args": base + ["--variant", "fp16"], "gpu": True})
    elif which == "quality":
        base = ["--device", "cuda", "--reps", "1"]
        for seed in (7, 8, 9):
            out.append({"label": f"q-seed{seed}", "args": base + ["--seed", str(seed)], "gpu": True})
        for k in (25, 10, 5):
            out.append({"label": f"q-steps{k}", "args": base + ["--variant", f"steps={k}"], "gpu": True})
        out.append({"label": "q-nocfg", "args": base + ["--variant", "nocfg"], "gpu": True})
        out.append({"label": "q-bf16-cpu", "args": ["--device", "cpu", "--threads", "8", "--reps", "1",
                                                     "--variant", "bf16"]})
        out.append({"label": "q-cpu-seed7", "args": ["--device", "cpu", "--threads", "8", "--reps", "1"]})
    return out


def busy(seconds: float = 3.0) -> float:
    with common.Meter() as m:
        time.sleep(seconds)
    return 100 * m.machine_busy


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("which")
    p.add_argument("--quiet-pct", type=float, default=20.0)
    p.add_argument("--wait-min", type=float, default=30.0)
    p.add_argument("--only", default="")
    a = p.parse_args()
    outdir = common.RESULTS / a.which
    env = dict(os.environ, PYTHONIOENCODING="utf-8", MEASURE_HIGH_PRIORITY="1")
    for job in jobs(a.which):
        if a.only and a.only not in job["label"]:
            continue
        out = outdir / f"{job['label']}.json"
        if out.is_file():
            continue
        t0 = time.time()
        b = busy()
        while b > a.quiet_pct and time.time() - t0 < a.wait_min * 60:
            print(f"{job['label']}: machine {b:.0f}% busy, waiting", flush=True)
            time.sleep(20)
            b = busy()
        script = job.get("script", "bench_motion.py")
        cmd = [str(common.FACE_PY), str(HERE / script), "--label", job["label"],
               "--out", str(out), *job["args"]]
        if "--reps" not in job["args"] and script == "bench_motion.py":
            cmd += ["--reps", "3"]
        if a.which in ("quality", "quality2", "variants"):
            cmd += ["--frames-out", str(common.DATA / "frames" / f"{job['label']}.npz")]
        if job.get("gpu"):
            cmd = [sys.executable, str(common.GPULOCK), "--label", f"measure: {job['label']}", "--", *cmd]
        log = common.DATA / "logs" / f"{job['label']}.log"
        log.parent.mkdir(parents=True, exist_ok=True)
        with open(log, "wb") as fh:
            rc = subprocess.run(cmd, stdout=fh, stderr=subprocess.STDOUT, env=env, check=False).returncode
        if out.is_file():
            d = json.loads(out.read_text(encoding="utf-8"))
            d["background_busy_before_pct"] = round(b, 1)
            common.write_json(out, d)
            if "sentences" in d:
                meds = {n: s["wall_s"]["median"] for n, s in d["sentences"].items()}
                print(f"{job['label']}: bg {b:.0f}% load {d['cold_load']['wall_s']}s {meds}", flush=True)
            else:
                print(f"{job['label']}: bg {b:.0f}% in time {[x['in_time'] for x in d['lines']]}", flush=True)
        else:
            print(f"{job['label']}: FAILED rc={rc}, see {log}", flush=True)


if __name__ == "__main__":
    main()

"""Shared plumbing for the t2-neural runners: paths, timing stats, GPU sampling, 1080p compose, metrics.

Runners (run_ditto.py, run_flashhead.py) import this from inside their own venv, so it uses the
standard library plus numpy only. ffmpeg comes from PATH.
"""

from __future__ import annotations

import json
import os
import statistics
import subprocess
import threading
import time
from pathlib import Path

HOME = Path(os.environ.get("ATHENA_AVATAR_HOME", Path.home() / ".athena-avatar"))
MODELS = HOME / "models"
VENVS = HOME / "venvs"
PORTRAITS = HOME / "portraits"
VOICE = HOME / "voice"
BENCH = HOME / "bench" / "t2-neural"
SMOKE = PORTRAITS / "_smoke"
TRACK_DIR = Path(__file__).resolve().parent
SPIKE_DIR = TRACK_DIR.parent
LINES = json.loads((SPIKE_DIR / "bench" / "lines.json").read_text(encoding="utf-8"))["lines"]
LINE_IDS = [ln["id"] for ln in LINES]


def real_portraits() -> list[str]:
    """Operator portraits: folders not starting with '_' that hold portrait.png."""
    if not PORTRAITS.exists():
        return []
    return sorted(p.name for p in PORTRAITS.iterdir()
                  if p.is_dir() and not p.name.startswith("_") and (p / "portrait.png").exists())


def pct(values: list[float], q: float) -> float:
    """Nearest-rank percentile, q in 0..100."""
    if not values:
        raise ValueError("empty")
    s = sorted(values)
    k = max(0, min(len(s) - 1, int(round(q / 100.0 * (len(s) - 1)))))
    return s[k]


def window_fps(frame_times: list[float], window_s: float = 1.0) -> list[float]:
    """Frames per second in sliding windows over frame emission timestamps (seconds).

    One sample per frame: how many frames landed in the window_s ending at that frame. Only frames
    at least window_s after the first are sampled, so warm-up does not count as a slow window.
    """
    out: list[float] = []
    j = 0
    t0 = frame_times[0] if frame_times else 0.0
    for i, t in enumerate(frame_times):
        while frame_times[j] < t - window_s:
            j += 1
        if t - t0 >= window_s:
            out.append((i - j + 1) / window_s)
    return out


class GpuSampler:
    """Samples device VRAM used and GPU utilisation with pynvml in a thread (whole device)."""

    def __init__(self, period_s: float = 0.1):
        self.period_s = period_s
        self.mem_mb: list[float] = []
        self.util: list[float] = []
        self._stop = threading.Event()
        self._t: threading.Thread | None = None
        self.base_mb: float | None = None

    def __enter__(self):
        try:
            import pynvml

            pynvml.nvmlInit()
            self._h = pynvml.nvmlDeviceGetHandleByIndex(0)
            self._nv = pynvml
            self.base_mb = pynvml.nvmlDeviceGetMemoryInfo(self._h).used / 2**20
        except Exception:  # noqa: BLE001 - sampling is best effort
            self._nv = None
            return self
        self._t = threading.Thread(target=self._run, daemon=True)
        self._t.start()
        return self

    def _run(self):
        while not self._stop.is_set():
            try:
                self.mem_mb.append(self._nv.nvmlDeviceGetMemoryInfo(self._h).used / 2**20)
                self.util.append(float(self._nv.nvmlDeviceGetUtilizationRates(self._h).gpu))
            except Exception:  # noqa: BLE001
                pass
            time.sleep(self.period_s)

    def __exit__(self, *exc):
        self._stop.set()
        if self._t:
            self._t.join(timeout=2)

    def summary(self) -> dict:
        d: dict = {}
        if self.mem_mb and self.base_mb is not None:
            d["vram_mb_device_delta"] = round(max(self.mem_mb) - self.base_mb)
        if self.util:
            d["gpu_util_pct"] = round(statistics.mean(self.util))
        return d


def run(cmd: list[str], **kw) -> None:
    print("+", " ".join(str(c) for c in cmd), flush=True)
    subprocess.run([str(c) for c in cmd], check=True, **kw)


def ffprobe_size(path: Path) -> tuple[int, int]:
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                          "stream=width,height", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True, check=True).stdout.strip()
    w, h = out.split(",")[:2]
    return int(w), int(h)


def make_canvas_1080p(src: Path, dst: Path, height: int = 1080, width: int = 1920) -> Path:
    """Fit a (usually portrait-orientation) image into a 16:9 canvas without distorting it.

    The portrait is scaled to the canvas height and centred; the side bands are the same image
    scaled to cover, blurred hard and darkened, so a model that sees the whole frame gets a
    plausible backdrop instead of black bars. The source pixels are untouched in the centre.
    """
    vf = (f"split[a][b];[a]scale={width}:{height}:force_original_aspect_ratio=increase,"
          f"crop={width}:{height},gblur=sigma=40,eq=brightness=-0.08[bg];"
          f"[b]scale=-2:{height}[fg];[bg][fg]overlay=(W-w)/2:0")
    run(["ffmpeg", "-loglevel", "error", "-y", "-i", src, "-filter_complex", vf, "-frames:v", "1", dst])
    return dst


def compose_1080p(video: Path, audio: Path, dst: Path, fps: int, upscaled: bool = False) -> None:
    """Any-size clip -> 1920x1080 H.264 + AAC, the bench container. Non-16:9 clips are centred on a
    blurred cover of themselves (lanczos scale; the caller says whether a restorer ran first)."""
    vf = ("split[a][b];[a]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,"
          "gblur=sigma=40,eq=brightness=-0.08[bg];[b]scale=-2:1080:flags=lanczos[fg];"
          "[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]")
    run(["ffmpeg", "-loglevel", "error", "-y", "-i", video, "-i", audio, "-filter_complex", vf,
         "-map", "[v]", "-map", "1:a", "-r", str(fps), "-c:v", "libx264", "-preset", "slow", "-crf", "16",
         "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", dst])


def mux(video: Path, audio: Path, dst: Path) -> None:
    run(["ffmpeg", "-loglevel", "error", "-y", "-i", video, "-i", audio, "-map", "0:v", "-map", "1:a",
         "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", dst])


def extract_frames(video: Path, out_dir: Path, every_s: float = 1.0) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    run(["ffmpeg", "-loglevel", "error", "-y", "-i", video, "-vf", f"fps=1/{every_s}",
         str(out_dir / "f_%03d.png")])
    return sorted(out_dir.glob("f_*.png"))


def write_metrics(path: Path, metrics: dict) -> None:
    """Absent-value rule: drop None anywhere except licence[].commercial_ok."""

    def clean(v, key=None):
        if isinstance(v, dict):
            return {k: clean(x, k) for k, x in v.items() if x is not None or k == "commercial_ok"}
        if isinstance(v, list):
            return [clean(x) for x in v]
        return v

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(clean(metrics), indent=2), encoding="utf-8")

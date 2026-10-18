"""voice-io / ADR 0120 (Athena has a face): a sentence's head, eye and brow motion from its audio.

Ported from the spike's t4-hybrid track (``t4/{neural_motion,retarget}.py``). JoyVASA samples
LivePortrait motion (21x3 expression deltas and head pose in degrees) from the audio at 25 fps;
``decoder.json`` turns the expression into named channels with one matrix multiply (fitted once on
a carrier render, leave-one-clip-out R² 0.59-0.90); the retarget filters and resamples to RigParams
v1 at 60 fps with the *glow* profile the operator's two forms were tuned with:

- head x0.55, centred on the sentence's median, low-passed at 2 Hz (pitch 2.5, roll 1.6) because
  the raw pose bobs at syllable rate, and eased in from neutral over the first 0.5 s (JoyVASA has a
  start transient);
- lids: the partial lid drop kept with its neural timing, capped at 0.2 (a deeper one reads as a
  blink on the glow rigs), plus crisp full blinks on the strongest peaks, at least 2.2 s apart;
- brow and gaze decoded, centred and low-passed.

The mouth is not here: it comes from the sentence's visemes. Nor is the question tilt the spike
borrowed from the text: this track is predicted from the audio alone. Runs in the face helper's
interpreter, on the GPU when torch has one and on the CPU otherwise (:mod:`.probe` decides the
device, the threads and the sampler's step count).

Two departures from JoyVASA's own setup, both measured in ``spikes/avatar-measure/README.md``:

- **Lean.** LivePortrait's renderer modules (appearance, motion extractor, warping, generator,
  stitching) are never loaded: motion uses only the motion generator (-600 MB of RAM).
- **Fewer steps when needed.** At :data:`.probe.TRAINED_STEPS` the model's own 50-step sampler runs
  unchanged; at fewer, a deterministic DDIM over the same schedule (:func:`_ddim_sampler`). At 10
  steps that is 3.1x faster for a head error to the 50-step track of 0.66 deg against 0.53 deg
  between two seeds of the unchanged model.
"""

from __future__ import annotations

import contextlib
import json
import os
import sys
import tempfile
import wave
from pathlib import Path
from typing import Any

from .probe import TRAINED_STEPS

FPS = 60
HEAD_GAIN = 0.55
HEAD_HZ = 2.0
LID_MAX = 0.2
EASE_S = 0.5
GAZE_GAIN = 4.0
BROW_GAIN = 0.6
BLINK_GAP_S = 2.2
SEED = 7
CFG_SCALE = 2.0
DECODER = Path(__file__).resolve().parent / "decoder.json"


def available(joyvasa: Path) -> str | None:
    """``None`` when motion can run here, else why not (one sentence)."""
    if not (joyvasa / "src" / "live_portrait_wmg_wrapper.py").is_file():
        return f"JoyVASA is not at {joyvasa}"
    import importlib.util

    for name in ("torch", "scipy", "librosa"):
        if importlib.util.find_spec(name) is None:
            return f"the face environment has no {name}"
    return None


class Motion:
    """JoyVASA loaded once, lean, on :attr:`device`, and kept warm between sentences."""

    def __init__(self, joyvasa: Path) -> None:
        os.environ.setdefault("TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD", "1")
        import torch

        from .probe import DEVICE_ENV, INTEROP_THREADS, choose_device, cpu_threads

        # Both: with CUDA_VISIBLE_DEVICES empty, torch 2.7 on Windows says available with 0 devices.
        cuda = torch.cuda.is_available() and torch.cuda.device_count() > 0
        self.device = choose_device(os.environ.get(DEVICE_ENV), cuda)
        torch.set_num_threads(cpu_threads(os.cpu_count()))
        # Settable only before the first inter-op work: a second Motion in one process keeps it.
        with contextlib.suppress(RuntimeError):
            torch.set_num_interop_threads(INTEROP_THREADS)
        sys.path.insert(0, str(joyvasa))
        import pathlib
        import platform

        if platform.system() == "Windows":  # JoyVASA's checkpoints pickle PosixPath objects
            pathlib.PosixPath = pathlib.WindowsPath  # type: ignore[misc, assignment]
        import src.live_portrait_wmg_wrapper as lpw
        from src.config.argument_config import ArgumentConfig
        from src.config.inference_config import InferenceConfig

        args = ArgumentConfig()
        args.animation_mode = "human"
        args.cfg_scale = CFG_SCALE
        args.is_smooth_motion = False
        kw = dict(args.__dict__)
        kw.update(
            flag_do_crop=True,
            flag_stitching=True,
            flag_relative_motion=True,
            flag_pasteback=False,
            flag_use_half_precision=True,
            animation_region="exp",
            driving_option="pose-friendly",
            driving_multiplier=1.0,
            # The wrapper picks cuda:0 whenever MPS is absent; this is its only way to the CPU.
            flag_force_cpu=self.device == "cpu",
            device_id=0,
        )
        inference = InferenceConfig(**{k: v for k, v in kw.items() if hasattr(InferenceConfig, k)})
        load_model = lpw.load_model

        def lean(ckpt: Any, cfg: Any, device: Any, model_type: str) -> Any:
            """Only the motion generator: the renderer modules are never used for motion."""
            if model_type == "motion_generator":
                return load_model(ckpt, cfg, device, model_type)
            return None

        lpw.load_model = lean  # the wrapper module's own global, for this construction only
        try:
            self.wrapper = lpw.LivePortraitWrapper(inference_cfg=inference)
        finally:
            lpw.load_model = load_model
        self.args = args
        self.decoder: dict[str, Any] = json.loads(DECODER.read_text(encoding="utf-8"))
        self.steps = TRAINED_STEPS

    def set_steps(self, steps: int) -> None:
        """Sample with ``steps`` steps: the model's own sampler at :data:`TRAINED_STEPS`, else
        DDIM over the same schedule."""
        gen = self.wrapper.motion_generator
        if steps >= TRAINED_STEPS:
            gen.__dict__.pop("sample", None)  # back to the class's own method
            self.steps = TRAINED_STEPS
        else:
            gen.sample = _ddim_sampler(gen, steps)
            self.steps = steps

    def frames(self, pcm: bytes, sample_rate: int) -> list[dict[str, Any]]:
        """RigParams v1 frames (head, eyes, brow) for one sentence's played audio."""
        import numpy as np
        import torch

        with tempfile.TemporaryDirectory(prefix="athena-face-") as tmp:
            path = Path(tmp) / "sentence.wav"
            with wave.open(str(path), "wb") as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(sample_rate)
                wav.writeframes(pcm)
            torch.manual_seed(SEED)
            np.random.seed(SEED)
            self.args.audio = str(path)
            with torch.no_grad():
                dct = self.wrapper.gen_motion_sequence(self.args)
        m = dct["motion"]
        motion = {
            "fps": float(self.wrapper.fps),
            "exp": np.concatenate([f["exp"] for f in m]).astype(np.float32),
            "pitch": np.array([float(f["pitch"].ravel()[0]) for f in m], np.float32),
            "yaw": np.array([float(f["yaw"].ravel()[0]) for f in m], np.float32),
            "roll": np.array([float(f["roll"].ravel()[0]) for f in m], np.float32),
        }
        return retarget(motion, self.decoder, (len(pcm) // 2) / sample_rate)


def _ddim_sampler(gen: Any, steps: int) -> Any:
    """JoyVASA's ``DitTalkingHead.sample`` with only its loop changed: ``steps`` evenly spaced
    timesteps of the trained schedule, each a deterministic DDIM update (eta 0) from the predicted
    clean sample. The model predicts the clean sample, so this needs no retraining. Ported from
    ``spikes/avatar-measure/bench_motion.py``."""
    import torch

    sched = gen.diffusion_sched
    total = sched.num_steps
    ts = sorted({max(1, round(total - i * total / steps)) for i in range(steps)}, reverse=True)

    def sample(
        audio_or_feat: Any,
        prev_motion_feat: Any = None,
        prev_audio_feat: Any = None,
        motion_at_T: Any = None,
        indicator: Any = None,
        cfg_mode: Any = None,
        cfg_cond: Any = None,
        cfg_scale: Any = 1.15,
        flexibility: Any = 0,
        dynamic_threshold: Any = None,
        ret_traj: Any = False,
    ) -> tuple[Any, Any, Any]:
        with torch.no_grad():
            return _ddim(
                gen,
                sched,
                ts,
                audio_or_feat,
                prev_motion_feat,
                prev_audio_feat,
                motion_at_T,
                indicator,
                cfg_mode,
                cfg_cond,
                cfg_scale,
            )

    return sample


def _ddim(
    gen: Any,
    sched: Any,
    ts: list[int],
    audio_or_feat: Any,
    prev_motion_feat: Any,
    prev_audio_feat: Any,
    motion_at_T: Any,
    indicator: Any,
    cfg_mode: Any,
    cfg_cond: Any,
    cfg_scale: Any,
) -> tuple[Any, Any, Any]:
    import torch

    b = audio_or_feat.shape[0]
    cfg_mode = cfg_mode or gen.cfg_mode
    cfg_cond = gen.guiding_conditions if cfg_cond is None else cfg_cond
    cfg_cond = [c for c in cfg_cond if c == "audio"]
    scales = cfg_scale if isinstance(cfg_scale, list) else [cfg_scale] * len(cfg_cond)
    audio_feat = (
        gen.extract_audio_feature(audio_or_feat) if audio_or_feat.ndim == 2 else audio_or_feat
    )
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
    tail = -gen.n_motions
    x = motion_at_T
    for k, t in enumerate(ts):
        step = torch.tensor([t] * (b * n), device=gen.device)
        res = gen.denoising_net(torch.cat([x] * n, 0), a_in, pm_in, pa_in, step, ind_in).chunk(n)
        x0 = res[0][:, tail:]
        for i in range(n - 1):
            ref = res[i][:, tail:] if cfg_mode == "incremental" else res[0][:, tail:]
            x0 = x0 + scales[i] * (res[i + 1][:, tail:] - ref)
        ab = sched.alpha_bars[t]
        if k + 1 < len(ts):
            ab_prev = sched.alpha_bars[ts[k + 1]]
            eps = (x - ab.sqrt() * x0) / (1 - ab).sqrt()
            x = ab_prev.sqrt() * x0 + (1 - ab_prev).sqrt() * eps
        else:
            x = x0
    return x, motion_at_T, audio_feat


# --- the retarget (CPU) ---------------------------------------------------------------------------


def _lowpass(x: Any, hz: float, fs: float) -> Any:
    from scipy.signal import butter, filtfilt

    if hz >= fs / 2 or len(x) < 16:
        return x
    b, a = butter(2, hz / (fs / 2))
    return filtfilt(b, a, x, padlen=min(len(x) - 1, 3 * max(len(a), len(b))))


def _smoothstep(x: Any) -> Any:
    import numpy as np

    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def _resample(x: Any, fs_in: float, t_out: Any) -> Any:
    import numpy as np
    from scipy.interpolate import CubicSpline

    if len(x) < 2:
        return np.full_like(t_out, float(x[0]) if len(x) else 0.0)
    t_in = np.arange(len(x)) / fs_in
    return CubicSpline(t_in, x, bc_type="natural")(np.clip(t_out, 0, t_in[-1]))


def _decode(exp: Any, ch: dict[str, Any]) -> Any:
    import numpy as np

    return exp.reshape(len(exp), -1) @ np.asarray(ch["w"]) + ch["b"]


def _blinks(v: Any, fs: float, t: Any, ch: dict[str, Any]) -> Any:
    """The partial lid drop (capped) plus crisp full blinks on the strongest, spaced peaks."""
    import numpy as np
    from scipy.signal import find_peaks

    lo = ch["p50"]
    norm = np.clip((v - lo) / (0.5 - lo), 0, 1.2)
    lid = _resample(_lowpass(np.clip(norm, 0, 1) * LID_MAX, 6.0, fs), fs, t)
    peaks, _ = find_peaks(norm, height=0.35, prominence=0.25)
    chosen: list[int] = []
    for p in sorted(peaks, key=lambda p: -norm[p]):
        if all(abs(p - c) >= BLINK_GAP_S * fs for c in chosen):
            chosen.append(int(p))
    out = np.clip(lid, 0, 1)
    for p in sorted(chosen):
        d = t - (p / fs - 0.06)  # the neural peak is mid-closure: close 75, hold 35, open 170 ms
        prof = np.where(
            d < 0,
            0,
            np.where(
                d < 0.075,
                _smoothstep(d / 0.075),
                np.where(d < 0.11, 1, 1 - _smoothstep((d - 0.11) / 0.17)),
            ),
        )
        out = np.maximum(out, np.where(d > 0.28, 0, prof))
    return out


def retarget(
    motion: dict[str, Any], dec: dict[str, Any], duration_s: float
) -> list[dict[str, Any]]:
    """JoyVASA's 25 fps motion to RigParams v1 frames at :data:`FPS`, glow profile, no mouth."""
    import numpy as np

    fs = float(motion["fps"])
    t = np.arange(round(duration_s * FPS) + 1) / FPS
    channels = dec["channels"]
    head: dict[str, Any] = {}
    for key, hz in (("yaw", HEAD_HZ), ("pitch", HEAD_HZ * 1.25), ("roll", HEAD_HZ * 0.8)):
        x = motion[key].astype(np.float64)
        x = (x - np.median(x)) * dec["pose"][key]["sign_to_rig"] * HEAD_GAIN
        head[key] = _resample(_lowpass(x, hz, fs), fs, t) * _smoothstep(t / EASE_S)
    blink = _blinks(_decode(motion["exp"], channels["blink"]), fs, t, channels["blink"])
    b = _decode(motion["exp"], channels["brow"])
    b = (
        (b - np.median(b))
        / max(1e-6, channels["brow"]["p95"] - channels["brow"]["p50"])
        * BROW_GAIN
    )
    brow = np.clip(_resample(_lowpass(b, 4.0, fs), fs, t), -1, 1)
    gx = _decode(motion["exp"], channels["gaze_x"])
    gy = _decode(motion["exp"], channels["gaze_y"])
    gaze_x = _resample(_lowpass((gx - np.median(gx)) * GAZE_GAIN, 6.0, fs), fs, t)
    gaze_y = _resample(_lowpass((gy - np.median(gy)) * GAZE_GAIN, 6.0, fs), fs, t)

    def r3(x: Any) -> float:
        return round(float(x), 3)

    return [
        {
            "t": r3(ti),
            "head": {
                "yaw": r3(head["yaw"][i]),
                "pitch": r3(head["pitch"][i]),
                "roll": r3(head["roll"][i]),
            },
            "eyes": {
                "blinkL": r3(blink[i]),
                "blinkR": r3(blink[i]),
                "gazeX": r3(np.clip(gaze_x[i], -1, 1)),
                "gazeY": r3(np.clip(gaze_y[i], -1, 1)),
            },
            "brow": {"raise": r3(brow[i])},
        }
        for i, ti in enumerate(t)
    ]

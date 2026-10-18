"""Second distillation attempt: JoyVASA's own audio features -> the 7 values the retarget reads.

    python gpulock.py -- python distill/student2.py feats      # HuBERT features per sentence (CUDA)
    python gpulock.py -- python distill/student2.py train --minutes 10
    python distill/student2.py eval                             # CPU

Attempt 1 (``student.py``: log-mel -> 66 values) learned almost nothing (see README). This one
removes two suspects at once:

- **features**: the teacher's own ``extract_audio_feature`` output (chinese-hubert-base -> 256 at
  25 fps), computed per 4 s window exactly as ``gen_motion_sequence`` windows the audio, so the
  student's frames are the teacher's frames. At run time this keeps HuBERT (one pass per window)
  and drops only the 50-step x 2 CFG denoiser loop - the 85 % of the CPU time.
- **targets**: only what ``retarget`` reads - pitch, yaw, roll and the decoder's four projections
  (blink, brow, gaze x, gaze y). The 63 expression values are rebuilt from the four projections
  with the decoder matrix's pseudo-inverse, so the shipped ``retarget`` runs unchanged.

Same GRU shape as attempt 1 (Conv1d k3 over 25 fps features, 2-layer GRU 192, dropout 0.2),
whole sentences, best checkpoint on a validation split carved from training.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402
import metrics  # noqa: E402
from student import decoder_proj, fit_len, teacher_track, to_track  # noqa: E402

OUT = common.DATA / "distill"
FEATS = OUT / "hubert-feats.npz"
CKPT = OUT / "student2.pt"
HIDDEN = 192
TEST_N = 48
VAL_N = 24


def windows_feats(gen, audio16: np.ndarray):  # type: ignore[no-untyped-def]
    """The teacher's audio features for one sentence, windowed as gen_motion_sequence does."""
    import torch

    dev = next(gen.parameters()).device
    a = torch.tensor(audio16, device=dev)
    a = torch.nn.functional.pad(a, (1280, 640))
    clip_len = int(len(a) / 16000 * 25)
    n_sub = 1 if clip_len <= 100 else math.ceil(clip_len / 100)
    need = 64000 * n_sub - len(a)
    if need > 0:
        a = torch.nn.functional.pad(a, (0, need))
    out = []
    with torch.inference_mode():
        for i in range(n_sub):
            out.append(gen.extract_audio_feature(a[i * 64000:(i + 1) * 64000][None])[0])
    return torch.cat(out)[:clip_len].float().cpu().numpy()


def load_gen(device: str):  # type: ignore[no-untyped-def]
    import bench_motion

    s = bench_motion.load(device, 0, "", ["lean"])
    return s["gen"]


def feats() -> None:
    import librosa

    gen = load_gen("cuda")
    corpus = json.loads((OUT / "corpus.json").read_text(encoding="utf-8"))
    res = {}
    t0 = time.perf_counter()
    for r in corpus:
        a16 = librosa.load(str(OUT / "wav" / f"{r['id']}.wav"), sr=16000)[0]
        res[r["id"]] = windows_feats(gen, a16)
    np.savez(FEATS, **res)
    print(f"{len(res)} sentences, {time.perf_counter() - t0:.0f} s")


def targets(y66: np.ndarray, P: np.ndarray) -> np.ndarray:
    return np.concatenate([y66[:, 63:], y66 @ P], 1)  # pitch, yaw, roll, blink, brow, gx, gy


def build():  # type: ignore[no-untyped-def]
    import torch
    from torch import nn

    class S2(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.c = nn.Conv1d(256, HIDDEN, 3, padding=1)  # one frame of look-ahead
            self.gru = nn.GRU(HIDDEN, HIDDEN, num_layers=2, batch_first=True, dropout=0.2)
            self.head = nn.Linear(HIDDEN, 7)
            for n, d in (("mu_in", 256), ("sd_in", 256), ("mu_out", 7), ("sd_out", 7)):
                self.register_buffer(n, torch.zeros(d) if n.startswith("mu") else torch.ones(d))

        def forward(self, f: torch.Tensor) -> torch.Tensor:
            x = ((f - self.mu_in) / self.sd_in).transpose(1, 2)
            x = torch.nn.functional.gelu(self.c(x)).transpose(1, 2)
            y, _ = self.gru(x)
            return self.head(y) * self.sd_out + self.mu_out

    return S2()


def split() -> tuple[list[str], list[str], list[str]]:
    corpus = json.loads((OUT / "corpus.json").read_text(encoding="utf-8"))
    ids = [r["id"] for r in corpus]
    test = ids[-TEST_N:]  # the same held-out sentences as attempt 1
    rest = ids[:-TEST_N]
    return rest[:-VAL_N], rest[-VAL_N:], test


def train(minutes: float, lr: float, batch: int) -> None:
    import torch

    dev = "cuda" if torch.cuda.is_available() else "cpu"
    torch.manual_seed(0)
    F = dict(np.load(FEATS))
    P = decoder_proj()
    T = {s: dict(np.load(OUT / f"teacher-seed{s}.npz")) for s in (7, 8)}
    tr, va, _ = split()
    Y = {s: {i: targets(T[s][i], P) for i in tr + va} for s in T}
    ally = np.concatenate([Y[s][i] for s in T for i in tr])
    allf = np.concatenate([F[i] for i in tr])
    model = build().to(dev)
    for n, v in (("mu_in", allf.mean(0)), ("sd_in", allf.std(0) + 1e-5), ("mu_out", ally.mean(0)),
                 ("sd_out", ally.std(0) + 1e-6)):
        getattr(model, n).copy_(torch.tensor(v))
    mu, sd = torch.tensor(ally.mean(0), device=dev), torch.tensor(ally.std(0) + 1e-6, device=dev)
    w = torch.tensor([3, 3, 3, 1, 1, 1, 1], dtype=torch.float32, device=dev)  # the head first
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-2)

    def batch_of(ids, seeds) -> tuple:  # type: ignore[no-untyped-def]
        L = max(min(len(F[i]), len(Y[7][i])) for i in ids)
        X = np.zeros((len(ids), L, 256), np.float32)
        Yb = np.zeros((len(ids), L, 7), np.float32)
        M = np.zeros((len(ids), L), np.float32)
        for k, (i, s) in enumerate(zip(ids, seeds)):
            n = min(len(F[i]), len(Y[s][i]))
            X[k, :n], Yb[k, :n], M[k, :n] = F[i][:n], Y[s][i][:n], 1
            X[k, n:] = F[i][n - 1]
        return tuple(torch.tensor(v, device=dev) for v in (X, Yb, M))

    def loss_fn(p, y, m):  # type: ignore[no-untyped-def]
        pz, yz = (p - mu) / sd, (y - mu) / sd
        l = (((pz - yz) ** 2) * w).mean(-1)
        dv = ((((pz[:, 1:] - pz[:, :-1]) - (yz[:, 1:] - yz[:, :-1])) ** 2) * w).mean(-1)
        return (l * m).sum() / m.sum() + (dv * m[:, 1:]).sum() / m[:, 1:].sum()

    rng = np.random.default_rng(0)
    best: tuple = (float("inf"), None, 0)
    t0, step, log = time.time(), 0, []
    vX, vY, vM = batch_of(va, [7] * len(va))
    while time.time() - t0 < minutes * 60:
        ids = list(rng.choice(tr, batch))
        X, Yb, M = batch_of(ids, list(rng.choice([7, 8], batch)))
        loss = loss_fn(model(X), Yb, M)
        opt.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        for g in opt.param_groups:
            g["lr"] = lr * 0.5 * (1 + math.cos(math.pi * min((time.time() - t0) / (minutes * 60), 1)))
        opt.step()
        step += 1
        if step % 250 == 0:
            model.eval()
            with torch.no_grad():
                vl = float(loss_fn(model(vX), vY, vM))
            model.train()
            log.append({"step": step, "train": round(float(loss), 4), "val": round(vl, 4)})
            if step % 2000 == 0:
                print(log[-1], flush=True)
            if vl < best[0]:
                best = (vl, {k: v.detach().clone() for k, v in model.state_dict().items()}, step)
    model.load_state_dict(best[1])
    torch.save({"model": model.state_dict(), "best_val": best[0], "best_step": best[2], "steps": step,
                "log": log, "minutes": minutes, "params": sum(p.numel() for p in model.parameters())}, CKPT)
    print(f"saved {CKPT}: {step} steps, best val {best[0]:.4f} at {best[2]}")


def rebuild_exp(y7: np.ndarray, P: np.ndarray) -> np.ndarray:
    """(T, 63) expression values whose decoder projections are the predicted four."""
    return y7[:, 3:] @ np.linalg.pinv(P[:63])


def evaluate() -> None:
    import librosa
    import torch

    sys.path.insert(0, str(common.HELPER_PARENT))
    from face_helper import motion as fm

    dec = json.loads(fm.DECODER.read_text(encoding="utf-8"))
    ck = torch.load(CKPT, map_location="cpu", weights_only=False)
    model = build()
    model.load_state_dict(ck["model"])
    model.eval()
    F = dict(np.load(FEATS))
    P = decoder_proj()
    _, _, test = split()
    t7 = dict(np.load(OUT / "teacher-seed7.npz"))
    others = [dict(np.load(OUT / f"teacher-seed{s}.npz")) for s in (8, 9)]
    rows, floor, oracle7 = [], [], []
    for i in test:
        pcm, sr = common.read_wav(OUT / "wav" / f"{i}.wav")
        dur = len(pcm) / 2 / sr
        ref = teacher_track(fm, dec, t7[i], dur)
        with torch.inference_mode():
            y7 = model(torch.tensor(F[i][None]))[0].numpy()
        y7 = fit_len(y7, len(t7[i]))
        motion = {"fps": 25.0, "exp": rebuild_exp(y7, P).reshape(-1, 1, 63).astype(np.float32),
                  "pitch": y7[:, 0], "yaw": y7[:, 1], "roll": y7[:, 2]}
        rows.append(metrics.compare(ref, to_track(fm.retarget(motion, dec, dur))))
        # the 7-value bottleneck itself, on the teacher's own values (an upper bound for the student)
        t7v = targets(t7[i], P)
        m7 = {"fps": 25.0, "exp": rebuild_exp(t7v, P).reshape(-1, 1, 63).astype(np.float32),
              "pitch": t7v[:, 0], "yaw": t7v[:, 1], "roll": t7v[:, 2]}
        oracle7.append(metrics.compare(ref, to_track(fm.retarget(m7, dec, dur))))
        for o in others:
            if i in o:
                floor.append(metrics.compare(ref, teacher_track(fm, dec, o[i], dur)))
    # CPU speed: the teacher's audio path (HuBERT, the part kept) + this GRU, per bench sentence
    torch.set_num_threads(4)
    gen = load_gen("cpu")
    speed = {}
    for name in ("s1_5", "s3", "s6", "s10"):
        a16 = librosa.load(str(common.DATA / "lengths" / f"{name}.wav"), sr=16000)[0]
        walls_f, walls_g = [], []
        for k in range(6):
            with common.Meter() as mf:
                f = windows_feats(gen, a16)
            with common.Meter() as mg, torch.inference_mode():
                model(torch.tensor(f[None]))
            if k:
                walls_f.append(mf.wall)
                walls_g.append(mg.wall)
        speed[name] = {"audio_s": round(len(a16) / 16000, 3), "hubert_s": common.summary(walls_f),
                       "gru_s": common.summary(walls_g)}
    out = {"attempt": 2, "params": ck["params"], "minutes": ck["minutes"], "steps": ck["steps"],
           "best_step": ck["best_step"], "n_test": len(test),
           "student_vs_teacher_seed7": metrics.aggregate(rows),
           "bottleneck_7_on_teacher (upper bound)": metrics.aggregate(oracle7),
           "noise_floor_seed7_vs_8_9": metrics.aggregate(floor),
           "cpu_speed_threads4": speed, "machine": common.machine()}
    common.write_json(common.RESULTS / "distill2.json", out)
    for k in ("student_vs_teacher_seed7", "bottleneck_7_on_teacher (upper bound)", "noise_floor_seed7_vs_8_9"):
        o = out[k]
        print(f"{k}: head_rms {o['head_rms']} corr y/p/r {o['yaw_corr']}/{o['pitch_corr']}/{o['roll_corr']} "
              f"std {o['yaw_std_ratio']}/{o['pitch_std_ratio']}/{o['roll_std_ratio']} blinks {o['blinks']}")
    print(json.dumps(speed))


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("cmd", choices=["feats", "train", "eval"])
    p.add_argument("--minutes", type=float, default=10)
    p.add_argument("--lr", type=float, default=1e-3)
    p.add_argument("--batch", type=int, default=16)
    a = p.parse_args()
    {"feats": feats, "train": lambda: train(a.minutes, a.lr, a.batch), "eval": evaluate}[a.cmd]()


if __name__ == "__main__":
    main()

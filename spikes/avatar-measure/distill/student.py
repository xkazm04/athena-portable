"""A tiny causal student of JoyVASA: log-mel -> the 66 raw motion values at 25 fps.

    python distill/student.py train --minutes 20        # under the GPU lock
    python distill/student.py eval                      # CPU: speed + error vs the teacher
    python distill/student.py export                    # ONNX for onnxruntime (no torch at run time)

**Features.** Kokoro's 24 kHz audio, padded like JoyVASA pads it (80 ms before, 40 ms after),
log-mel 64 bands, n_fft 1024, hop 240 (100 fps) - numpy only, so the run-time helper would not
need torch.

**Model.** Conv1d front end (k 5, stride 4: 100 -> 25 fps), a second Conv1d (k 3), a 2-layer
unidirectional GRU, a linear head to 66 = 63 expression deltas + pitch, yaw, roll. Look-ahead is
the convs' right context only (about 120 ms), so it can stream. The output goes through the
shipped ``retarget`` unchanged.

**Batches.** Whole sentences from their first frame, padded and masked.

**Loss.** MSE on per-channel z-scored targets, with the six channels the rig reads (pitch, yaw,
roll and the decoder's blink, brow, gaze projections) weighted x4, plus a first-difference
(velocity) term so the student does not just learn a flat mean.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import common  # noqa: E402

OUT = common.DATA / "distill"
CKPT = OUT / "student.pt"
SR = 24_000
HOP = 240
NFFT = 1024
NMEL = 64
PAD_A, PAD_B = round(0.08 * SR), round(0.04 * SR)
HIDDEN = 192
TEST_FRAC = 0.1


# --- features (numpy) ------------------------------------------------------------------------------

_MEL: np.ndarray | None = None


def logmel(pcm: bytes) -> np.ndarray:
    """(frames at 100 fps, NMEL) float32."""
    global _MEL
    if _MEL is None:
        import librosa

        _MEL = librosa.filters.mel(sr=SR, n_fft=NFFT, n_mels=NMEL, fmin=40, fmax=8000).astype(np.float32)
    x = np.frombuffer(pcm, "<i2").astype(np.float32) / 32768.0
    x = np.pad(x, (PAD_A + NFFT // 2, PAD_B + NFFT // 2))
    n = 1 + (len(x) - NFFT) // HOP
    idx = np.arange(NFFT)[None, :] + HOP * np.arange(n)[:, None]
    win = np.hanning(NFFT).astype(np.float32)
    spec = np.abs(np.fft.rfft(x[idx] * win, axis=1)) ** 2
    return np.log(spec.astype(np.float32) @ _MEL.T + 1e-6)


def frames_for(pcm: bytes) -> int:
    """How many 25 fps frames JoyVASA returns for this audio (its clip_len)."""
    n16 = round(len(pcm) / 2 * 16000 / SR) + 1920
    return int(n16 / 16000 * 25)


# --- model ------------------------------------------------------------------------------------------


def build(n_out: int = 66):  # type: ignore[no-untyped-def]
    import torch
    from torch import nn

    class Student(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.c1 = nn.Conv1d(NMEL, HIDDEN, 5, stride=4)
            self.c2 = nn.Conv1d(HIDDEN, HIDDEN, 3)
            self.gru = nn.GRU(HIDDEN, HIDDEN, num_layers=2, batch_first=True, dropout=0.2)
            self.head = nn.Linear(HIDDEN, n_out)
            self.register_buffer("mu_in", torch.zeros(NMEL))
            self.register_buffer("sd_in", torch.ones(NMEL))
            # the head predicts z-scores; raw expression values have a std near 0.002, so a head in
            # raw units starts hundreds of standard deviations off and the clipped grads crawl
            self.register_buffer("mu_out", torch.zeros(n_out))
            self.register_buffer("sd_out", torch.ones(n_out))

        def forward(self, mel: torch.Tensor) -> torch.Tensor:  # (B, T100, NMEL) -> (B, T25, n_out)
            x = ((mel - self.mu_in) / self.sd_in).transpose(1, 2)
            x = torch.nn.functional.pad(x, (1, 0))  # c1 centred on the frame: 1 back, 3 ahead
            x = torch.nn.functional.gelu(self.c1(x))
            x = torch.nn.functional.pad(x, (1, 1))
            x = torch.nn.functional.gelu(self.c2(x)).transpose(1, 2)
            y, _ = self.gru(x)
            return self.head(y) * self.sd_out + self.mu_out

    return Student()


def fit_len(y: np.ndarray, n: int) -> np.ndarray:
    if len(y) >= n:
        return y[:n]
    return np.concatenate([y, np.repeat(y[-1:], n - len(y), 0)])


# --- data -----------------------------------------------------------------------------------------


def dataset(seeds: list[int]) -> tuple[list, list, dict]:
    corpus = json.loads((OUT / "corpus.json").read_text(encoding="utf-8"))
    teachers = {s: dict(np.load(OUT / f"teacher-seed{s}.npz")) for s in seeds}
    ids = [r["id"] for r in corpus if all(r["id"] in t for t in teachers.values())]
    n_test = max(1, int(len(ids) * TEST_FRAC))
    test_ids, train_ids = ids[-n_test:], ids[:-n_test]
    items: dict[str, tuple[np.ndarray, list[np.ndarray]]] = {}
    for i in ids:
        pcm, _ = common.read_wav(OUT / "wav" / f"{i}.wav")
        items[i] = (logmel(pcm), [teachers[s][i] for s in seeds])
    return train_ids, test_ids, items


def decoder_proj() -> np.ndarray:
    """(66, 4) projection onto the decoder's blink, brow, gaze_x, gaze_y channels."""
    dec = json.loads((common.HELPER_PARENT / "face_helper" / "decoder.json").read_text(encoding="utf-8"))
    w = np.zeros((66, 4), np.float32)
    for j, name in enumerate(("blink", "brow", "gaze_x", "gaze_y")):
        w[:63, j] = np.asarray(dec["channels"][name]["w"], np.float32).reshape(63)
    return w


# --- train ------------------------------------------------------------------------------------------


def train(minutes: float, seeds: list[int], lr: float, batch: int) -> None:
    import torch

    dev = "cuda" if torch.cuda.is_available() else "cpu"
    torch.manual_seed(0)
    train_ids, test_ids, items = dataset(seeds)
    allmel = np.concatenate([items[i][0] for i in train_ids])
    ally = np.concatenate([y for i in train_ids for y in items[i][1]])
    mu_y, sd_y = ally.mean(0), ally.std(0)
    # some expression values barely move (std ~1e-7): floor them, or their z-scores swamp the loss
    sd_y[:63] = np.maximum(sd_y[:63], 0.25 * np.median(sd_y[:63]))
    proj = decoder_proj()
    dproj = ally @ proj
    sd_d = dproj.std(0) + 1e-6
    model = build().to(dev)
    model.mu_in.copy_(torch.tensor(allmel.mean(0)))
    model.sd_in.copy_(torch.tensor(allmel.std(0) + 1e-6))
    model.mu_out.copy_(torch.tensor(mu_y))
    model.sd_out.copy_(torch.tensor(sd_y))
    mu_t, sd_t = torch.tensor(mu_y, device=dev), torch.tensor(sd_y, device=dev)
    P = torch.tensor(proj, device=dev)
    sdd = torch.tensor(sd_d, device=dev)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-2)

    def crop(i: str, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
        mel, ys = items[i]
        y = ys[rng.integers(len(ys))]
        n = len(y)
        # whole sentences, always from their start: JoyVASA's track depends on where the sentence
        # (and each of its 4 s windows) begins, which a mid-sentence crop hides from the GRU
        a, b = 0, n
        m = mel[a * 4 : b * 4 + 4]
        m = np.pad(m, ((0, (b - a) * 4 + 4 - len(m)), (0, 0)), mode="edge")
        return m, y[a:b]

    def loss_fn(pred: torch.Tensor, y: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
        pz, yz = (pred - mu_t) / sd_t, (y - mu_t) / sd_t
        w = torch.ones(66, device=dev)
        w[63:] = 4.0
        l_full = (((pz - yz) ** 2) * w).mean(-1)
        pd, yd = (pred @ P) / sdd, (y @ P) / sdd
        l_dec = 4.0 * ((pd - yd) ** 2).mean(-1)
        vel = lambda z: z[:, 1:] - z[:, :-1]  # noqa: E731
        l_vel = 2.0 * (((vel(pz) - vel(yz)) ** 2) * w).mean(-1)
        m = mask[:, 1:]
        return ((l_full + l_dec) * mask).sum() / mask.sum() + (l_vel * m).sum() / m.sum()

    # model selection uses a validation split carved from training, never the held-out test set
    val_ids = train_ids[-24:]
    train_ids = train_ids[:-24]
    best: tuple = (float("inf"), None, 0)
    rng = np.random.default_rng(0)
    t0 = time.time()
    step = 0
    log = []
    while time.time() - t0 < minutes * 60:
        ids = rng.choice(train_ids, batch)
        pairs = [crop(i, rng) for i in ids]
        L = max(len(y) for _, y in pairs)
        X = np.zeros((batch, L * 4 + 4, NMEL), np.float32)
        Y = np.zeros((batch, L, 66), np.float32)
        M = np.zeros((batch, L), np.float32)
        for k, (m, y) in enumerate(pairs):
            X[k, : len(m)] = m
            X[k, len(m):] = m[-1]
            Y[k, : len(y)] = y
            M[k, : len(y)] = 1
        X_t, Y_t, M_t = (torch.tensor(v, device=dev) for v in (X, Y, M))
        pred = model(X_t)[:, :L]
        loss = loss_fn(pred, Y_t, M_t)
        opt.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        frac = (time.time() - t0) / (minutes * 60)
        for g in opt.param_groups:
            g["lr"] = lr * 0.5 * (1 + np.cos(np.pi * min(frac, 1.0)))
        opt.step()
        step += 1
        if step % 200 == 0:
            vl = val_loss(model, val_ids, items, loss_fn, dev)
            log.append({"step": step, "t_s": round(time.time() - t0), "train": float(loss), "val": vl})
            print(log[-1], flush=True)
            if vl < best[0]:
                best = (vl, {k: v.detach().clone() for k, v in model.state_dict().items()}, step)
    if best[1] is not None:  # keep the best on the validation split, not the last step
        model.load_state_dict(best[1])
    torch.save({"model": model.state_dict(), "best_val": best[0], "best_step": best[2], "mu_y": mu_y, "sd_y": sd_y, "seeds": seeds,
                "train_ids": train_ids, "test_ids": test_ids, "steps": step, "log": log,
                "minutes": minutes, "params": sum(p.numel() for p in model.parameters())}, CKPT)
    print(f"saved {CKPT}: {step} steps, {sum(p.numel() for p in model.parameters()) / 1e6:.2f} M params")


def val_loss(model, test_ids, items, loss_fn, dev) -> float:  # type: ignore[no-untyped-def]
    import torch

    model.eval()
    tot, n = 0.0, 0
    with torch.no_grad():
        for i in test_ids:
            mel, ys = items[i]
            y = ys[0]
            p = model(torch.tensor(mel[None], device=dev))[:, : len(y)]
            p = torch.cat([p, p[:, -1:].expand(1, len(y) - p.shape[1], -1)], 1) if p.shape[1] < len(y) else p
            tot += float(loss_fn(p, torch.tensor(y[None], device=dev), torch.ones(1, len(y), device=dev)))
            n += 1
    model.train()
    return round(tot / n, 4)


# --- run time ---------------------------------------------------------------------------------------


class Runner:
    """The student as the helper would run it: numpy features, torch or onnxruntime, retarget."""

    def __init__(self, backend: str = "torch", threads: int = 1) -> None:
        import torch

        ck = torch.load(CKPT, map_location="cpu", weights_only=False)
        self.ck = ck
        self.backend = backend
        if backend == "torch":
            torch.set_num_threads(threads)
            self.model = build()
            self.model.load_state_dict(ck["model"])
            self.model.eval()
        else:
            import onnxruntime as ort

            o = ort.SessionOptions()
            o.intra_op_num_threads = threads
            self.sess = ort.InferenceSession(str(OUT / "student.onnx"), o, providers=["CPUExecutionProvider"])
        sys.path.insert(0, str(common.HELPER_PARENT))
        from face_helper import motion as fm

        self.fm = fm
        self.dec = json.loads(fm.DECODER.read_text(encoding="utf-8"))

    def raw(self, pcm: bytes) -> np.ndarray:
        mel = logmel(pcm)[None]
        if self.backend == "torch":
            import torch

            with torch.inference_mode():
                y = self.model(torch.tensor(mel))[0].numpy()
        else:
            (y,) = self.sess.run(None, {"mel": mel})
            y = y[0]
        return fit_len(y, frames_for(pcm))

    def frames(self, pcm: bytes, sr: int) -> list:
        y = self.raw(pcm)
        motion = {"fps": 25.0, "exp": y[:, :63].reshape(-1, 1, 63).astype(np.float32),
                  "pitch": y[:, 63], "yaw": y[:, 64], "roll": y[:, 65]}
        return self.fm.retarget(motion, self.dec, (len(pcm) // 2) / sr)


def to_track(frames: list) -> np.ndarray:
    return np.array([[f["t"], f["head"]["yaw"], f["head"]["pitch"], f["head"]["roll"], f["eyes"]["blinkL"],
                      f["eyes"]["gazeX"], f["eyes"]["gazeY"], f["brow"]["raise"]] for f in frames], np.float32)


def teacher_track(fm, dec, y: np.ndarray, dur: float) -> np.ndarray:  # type: ignore[no-untyped-def]
    motion = {"fps": 25.0, "exp": y[:, :63].reshape(-1, 1, 63), "pitch": y[:, 63], "yaw": y[:, 64],
              "roll": y[:, 65]}
    return to_track(fm.retarget(motion, dec, dur))


def evaluate() -> None:
    import metrics

    r = Runner("torch", 1)
    ck = r.ck
    test_ids = ck["test_ids"]
    t7 = dict(np.load(OUT / "teacher-seed7.npz"))
    others = {s: dict(np.load(OUT / f"teacher-seed{s}.npz")) for s in (8, 9) if (OUT / f"teacher-seed{s}.npz").is_file()}
    rows_student, rows_floor, rows_still, rows_mean = [], [], [], []
    for i in test_ids:
        pcm, sr = common.read_wav(OUT / "wav" / f"{i}.wav")
        dur = len(pcm) / 2 / sr
        ref = teacher_track(r.fm, r.dec, t7[i], dur)
        st = to_track(r.frames(pcm, sr))
        rows_student.append(metrics.compare(ref, st))
        still = ref.copy()
        still[:, 1:] = 0.0
        rows_still.append(metrics.compare(ref, still))
        for s, t in others.items():
            if i in t:
                rows_floor.append(metrics.compare(ref, teacher_track(r.fm, r.dec, t[i], dur)))
    out = {
        "n_test_sentences": len(test_ids),
        "params": ck["params"],
        "train_minutes": ck["minutes"],
        "train_steps": ck["steps"],
        "train_sentences": len(ck["train_ids"]),
        "teacher_seeds": ck["seeds"],
        "student_vs_teacher_seed7": metrics.aggregate(rows_student),
        "teacher_seed7_vs_other_seeds (noise floor)": metrics.aggregate(rows_floor) if rows_floor else None,
        "no_motion_vs_teacher": metrics.aggregate(rows_still),
        "speed": speed(),
        "machine": common.machine(),
    }
    common.write_json(common.RESULTS / "distill.json", out)
    for k in ("student_vs_teacher_seed7", "teacher_seed7_vs_other_seeds (noise floor)", "no_motion_vs_teacher"):
        o = out[k]
        if o:
            print(f"{k}: head_rms {o['head_rms']} corr y/p/r {o['yaw_corr']}/{o['pitch_corr']}/{o['roll_corr']} "
                  f"std {o['yaw_std_ratio']}/{o['pitch_std_ratio']}/{o['roll_std_ratio']} blinks {o['blinks']}")
    print(json.dumps(out["speed"], indent=1))


def speed() -> dict:
    """Per-sentence wall time on CPU for the four bench lengths, torch and onnxruntime, 1/2/4 threads."""
    res: dict = {}
    for backend in ("torch", "onnx"):
        if backend == "onnx" and not (OUT / "student.onnx").is_file():
            continue
        for th in (1, 2, 4):
            r = Runner(backend, th)
            for name in ("s1_5", "s3", "s6", "s10"):
                pcm, sr = common.read_wav(common.DATA / "lengths" / f"{name}.wav")
                r.frames(pcm, sr)  # warm
                walls, feats = [], []
                for _ in range(7):
                    with common.Meter() as m:
                        r.frames(pcm, sr)
                    with common.Meter() as mf:
                        logmel(pcm)
                    walls.append(m.wall)
                    feats.append(mf.wall)
                res[f"{backend}-t{th}-{name}"] = {"audio_s": round(len(pcm) / 2 / sr, 3),
                                                  "wall_s": common.summary(walls),
                                                  "logmel_s": common.summary(feats)}
    return res


def export() -> None:
    import torch

    ck = torch.load(CKPT, map_location="cpu", weights_only=False)
    model = build()
    model.load_state_dict(ck["model"])
    model.eval()
    dummy = torch.zeros(1, 400, NMEL)
    torch.onnx.export(model, (dummy,), str(OUT / "student.onnx"), input_names=["mel"], output_names=["motion"],
                      dynamic_axes={"mel": {1: "t"}, "motion": {1: "f"}}, opset_version=17)
    print("exported", OUT / "student.onnx", (OUT / "student.onnx").stat().st_size)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("cmd", choices=["train", "eval", "export"])
    p.add_argument("--minutes", type=float, default=20)
    p.add_argument("--seeds", default="7,8")
    p.add_argument("--lr", type=float, default=2e-3)
    p.add_argument("--batch", type=int, default=32)
    a = p.parse_args()
    if a.cmd == "train":
        train(a.minutes, [int(s) for s in a.seeds.split(",")], a.lr, a.batch)
    elif a.cmd == "export":
        export()
    else:
        evaluate()


if __name__ == "__main__":
    main()

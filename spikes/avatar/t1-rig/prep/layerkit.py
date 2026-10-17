"""Shared helpers for the t1-rig layer splitters: write cropped RGBA layers + layers.json, derive the
rig geometry (head, eyes, brows, mouth) from masks, and run LaMa inpainting.

Every splitter produces the same thing, so the web runtime never knows which route made the layers.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

HOME = Path(os.environ.get("ATHENA_AVATAR_HOME", Path.home() / ".athena-avatar"))
MODELS = HOME / "models"
DEVICE = os.environ.get("T1_DEVICE", "cuda")  # "cpu" runs the whole prep without the GPU
LAMA_URL = "https://github.com/enesmsahin/simple-lama-inpainting/releases/download/v0.1.0/big-lama.pt"


def load_rgba(p: Path) -> np.ndarray:
    return np.array(Image.open(p).convert("RGBA"))


def save_png(arr: np.ndarray, p: Path) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(arr).save(p, optimize=False, compress_level=4)


class LayerWriter:
    def __init__(self, out_dir: Path, portrait_id: str, source: str, width: int, height: int):
        self.out = out_dir
        self.out.mkdir(parents=True, exist_ok=True)
        for f in self.out.glob("*.png"):
            f.unlink()
        self.meta = {"version": 1, "portrait_id": portrait_id, "source": source,
                     "width": int(width), "height": int(height), "layers": [], "rig": {}}
        self.z = 0

    def add(self, name: str, rgba: np.ndarray | None, kind: str, depth: float = 0.0,
            anchor: tuple[float, float] | None = None, pad: int = 2, min_alpha: int = 3,
            bbox: list[int] | None = None) -> dict | None:
        """rgba is full-canvas (H, W, 4) uint8; it is cropped to its alpha bbox."""
        self.z += 1
        entry: dict = {"name": name, "z": self.z, "kind": kind}
        if depth:
            entry["depth"] = round(float(depth), 3)
        if rgba is not None:
            a = rgba[..., 3]
            ys, xs = np.nonzero(a >= min_alpha)
            if len(xs) == 0:
                self.z -= 1
                return None
            h, w = a.shape
            x0, y0 = max(0, xs.min() - pad), max(0, ys.min() - pad)
            x1, y1 = min(w, xs.max() + 1 + pad), min(h, ys.max() + 1 + pad)
            crop = rgba[y0:y1, x0:x1].copy()
            crop[crop[..., 3] < min_alpha] = 0
            save_png(crop, self.out / f"{name}.png")
            entry["file"] = f"{name}.png"
            entry["bbox"] = [int(x0), int(y0), int(x1 - x0), int(y1 - y0)]
        elif bbox is not None:
            entry["bbox"] = [int(v) for v in bbox]
        if "bbox" in entry:
            x, y, w, h = entry["bbox"]
            entry["anchor"] = [round(float(v), 1) for v in (anchor or (x + w / 2, y + h / 2))]
        self.meta["layers"].append(entry)
        return entry

    def write(self) -> Path:
        p = self.out / "layers.json"
        p.write_text(json.dumps(self.meta, indent=1), encoding="utf-8")
        return p


# ---------------------------------------------------------------- geometry from masks

def _components(mask: np.ndarray, k: int, min_area: int = 20) -> list[np.ndarray]:
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    comps = sorted(range(1, n), key=lambda i: -stats[i, cv2.CC_STAT_AREA])
    out = [lab == i for i in comps[:k] if stats[i, cv2.CC_STAT_AREA] >= min_area]
    return sorted(out, key=lambda m: np.nonzero(m)[1].mean())


def _fill_nan(v: np.ndarray) -> np.ndarray:
    idx = np.arange(len(v))
    good = ~np.isnan(v)
    if not good.any():
        return np.zeros_like(v)
    return np.interp(idx, idx[good], v[good])


def _curves(m: np.ndarray, x0: int, x1: int):
    top, bot = [], []
    for u in np.linspace(0, 1, 16):
        x = int(round(x0 + u * (x1 - x0)))
        col = np.nonzero(m[:, max(0, x - 1):x + 2].any(1))[0]
        top.append(float(col.min()) if len(col) else np.nan)
        bot.append(float(col.max() + 1) if len(col) else np.nan)
    return np.array(top), np.array(bot)


def eye_geometry(eye_mask: np.ndarray, iris_mask: np.ndarray | None = None, lash_mask: np.ndarray | None = None,
                 lash_up: float = 0.15, lash_band: float = 0.22) -> list[dict]:
    """Per eye: x0/x1, 16-sample top/bottom contours, h, lash (band px) and iris.
    With a lash mask (drawn art), top is the top of the upper lash and `lash` its thickness. Without one
    (photo-like), top is the opening's contour raised by lash_up*h and the band is lash_band*h."""
    em = eye_mask > 0.5
    union = em | (lash_mask > 0.5) if lash_mask is not None else em
    eyes = []
    for cm in _components(union, 2, 30):
        m_eye = em & cm
        if m_eye.sum() < 10:
            continue
        ys, xs = np.nonzero(cm)
        x0, x1 = int(xs.min()), int(xs.max())
        top_u, bot_u = _curves(cm, x0, x1)
        top_e, bot_e = _curves(m_eye, x0, x1)
        h_open = float(np.nanmax(bot_e - top_e))
        if lash_mask is not None:
            top = top_u - 2.0  # the lash's soft fringe sits above the 0.5-alpha contour
            bot = np.where(np.isnan(bot_e), bot_u, bot_e)
            th = (top_e - top_u)[~np.isnan(top_e - top_u)]
            lash = float(np.median(th)) + 3 if len(th) else 0.2 * h_open
        else:
            top = top_e - lash_up * h_open
            bot = bot_e
            lash = lash_band * h_open
        top, bot = _fill_nan(top), _fill_nan(bot)
        mid = (top + bot) / 2
        top[0] = bot[0] = mid[0]
        top[-1] = bot[-1] = mid[-1]
        e = {"x0": x0, "x1": x1 + 1, "top": [round(float(v), 2) for v in top],
             "bottom": [round(float(v), 2) for v in bot], "h": round(h_open, 2), "lash": round(lash, 2)}
        if iris_mask is not None:
            im = (iris_mask > 0.5) & m_eye
            if im.sum() > 5:
                iy, ix = np.nonzero(im)
                e["iris"] = [round(float(ix.mean()), 1), round(float(iy.mean()), 1),
                             round(float((ix.max() - ix.min() + 1) / 2), 1)]
        eyes.append(e)
    for e, side in zip(eyes, ("R", "L")):  # image-left is the subject's right eye
        e["side"] = side
    return eyes


def brow_geometry(brow_mask: np.ndarray) -> list[dict]:
    out = []
    for m in _components(brow_mask > 0.5, 2, 15):
        ys, xs = np.nonzero(m)
        out.append({"center": [round(float(xs.mean()), 1), round(float(ys.mean()), 1)],
                    "w": round(float(xs.max() - xs.min() + 1), 1)})
    return out


def mouth_geometry(lips_rgba: np.ndarray, line: np.ndarray | None = None) -> dict | None:
    """lips_rgba: full canvas RGBA of the mouth/lips. line: optional y of the lip parting per x
    sample (16); else the darkest row of each column (the lip line is the darkest)."""
    a = lips_rgba[..., 3] > 40
    if a.sum() < 10:
        return None
    ys, xs = np.nonzero(a)
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    lum = lips_rgba[..., :3].astype(np.float32) @ np.array([0.299, 0.587, 0.114], np.float32)
    tops, bots, lines = [], [], []
    for u in np.linspace(0, 1, 16):
        x = int(round(x0 + u * (x1 - 1 - x0)))
        col = np.nonzero(a[:, x])[0]
        if len(col) == 0:
            tops.append(np.nan); bots.append(np.nan); lines.append(np.nan)
            continue
        t, b = col.min(), col.max() + 1
        tops.append(t); bots.append(b)
        seg = lum[t:b, x]
        if len(seg) >= 3:
            k = np.convolve(seg, np.ones(3) / 3, mode="same")
            lines.append(float(t + np.argmin(k[1:-1]) + 1) if len(seg) > 3 else float(t + np.argmin(seg)))
        else:
            lines.append((t + b) / 2)
    tops, bots = _fill_nan(np.array(tops, float)), _fill_nan(np.array(bots, float))
    if line is None:
        line = _fill_nan(np.array(lines, float))
        # smooth: the parting is a gentle curve
        line = np.convolve(np.pad(line, 2, mode="edge"), np.ones(5) / 5, mode="valid")
        line = np.clip(line, tops, bots)
    line = np.asarray(line, float)
    upper_h = float(np.median((line - tops)[3:13]))
    lower_h = float(np.median((bots - line)[3:13]))
    rgb = lips_rgba[..., :3][a].astype(np.float32).mean(0) / 255.0
    return {"center": [round((x0 + x1) / 2, 1), round(float(np.median(line)), 1)], "x0": x0, "x1": x1,
            "line": [round(float(v), 2) for v in line], "upper_h": round(max(2.0, upper_h), 2),
            "lower_h": round(max(2.0, lower_h), 2), "lip_rgb": [round(float(v), 3) for v in rgb]}


def split_lips(lips_rgba: np.ndarray, mouth: dict) -> tuple[np.ndarray, np.ndarray]:
    """Split a lips layer into upper/lower along the parting line (soft 1 px seam)."""
    h, w = lips_rgba.shape[:2]
    xs = np.arange(w)
    u = np.clip((xs - mouth["x0"]) / max(1, mouth["x1"] - 1 - mouth["x0"]), 0, 1) * 15
    line = np.interp(u, np.arange(16), mouth["line"])
    yy = np.arange(h)[:, None]
    wl = np.clip(yy - line[None, :] + 0.5, 0, 1)  # 1 below the line
    up = lips_rgba.copy(); lo = lips_rgba.copy()
    up[..., 3] = (lips_rgba[..., 3] * (1 - wl)).astype(np.uint8)
    lo[..., 3] = (lips_rgba[..., 3] * wl).astype(np.uint8)
    return up, lo


# ---------------------------------------------------------------- LaMa

_lama = None


def lama(rgb: np.ndarray, mask: np.ndarray, device: str | None = None) -> np.ndarray:
    """Inpaint rgb (H,W,3 uint8) where mask > 0 with big-LaMa (Apache-2.0, torchscript)."""
    global _lama
    import torch
    device = device or DEVICE
    p = MODELS / "lama" / "big-lama.pt"
    if not p.exists():
        import urllib.request
        p.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(LAMA_URL, p)
    if _lama is None:
        _lama = torch.jit.load(str(p), map_location=device).eval()
    h, w = rgb.shape[:2]
    m = (mask > 0).astype(np.float32)
    if m.sum() == 0:
        return rgb.copy()
    ph, pw = (8 - h % 8) % 8, (8 - w % 8) % 8
    img = np.pad(rgb, ((0, ph), (0, pw), (0, 0)), mode="reflect").astype(np.float32) / 255
    mm = np.pad(m, ((0, ph), (0, pw)), mode="reflect")
    with torch.no_grad():
        ti = torch.from_numpy(img).permute(2, 0, 1)[None].to(device)
        tm = torch.from_numpy(mm)[None, None].to(device)
        out = _lama(ti, tm)[0].permute(1, 2, 0).clamp(0, 1).cpu().numpy()
    out = (out[:h, :w] * 255).round().astype(np.uint8)
    res = rgb.copy()
    res[m > 0] = out[m > 0]
    return res


def lama_crop(rgb: np.ndarray, mask: np.ndarray, margin: float = 0.6, max_side: int = 1024) -> np.ndarray:
    """LaMa on the mask's bbox plus context margin (better detail for small holes)."""
    ys, xs = np.nonzero(mask > 0)
    if len(xs) == 0:
        return rgb.copy()
    h, w = mask.shape
    bw, bh = xs.max() - xs.min() + 1, ys.max() - ys.min() + 1
    mx, my = int(bw * margin) + 16, int(bh * margin) + 16
    x0, x1 = max(0, xs.min() - mx), min(w, xs.max() + 1 + mx)
    y0, y1 = max(0, ys.min() - my), min(h, ys.max() + 1 + my)
    crop, mcrop = rgb[y0:y1, x0:x1], mask[y0:y1, x0:x1]
    s = min(1.0, max_side / max(crop.shape[:2]))
    if s < 1:
        cs = cv2.resize(crop, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
        ms = cv2.resize(mcrop.astype(np.uint8) * 255, (cs.shape[1], cs.shape[0]), interpolation=cv2.INTER_NEAREST)
        o = cv2.resize(lama(cs, ms), (crop.shape[1], crop.shape[0]), interpolation=cv2.INTER_CUBIC)
    else:
        o = lama(crop, mcrop)
    res = rgb.copy()
    sub = res[y0:y1, x0:x1]
    sub[mcrop > 0] = o[mcrop > 0]
    return res


def rgba(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    a = np.clip(alpha, 0, 255).astype(np.uint8) if alpha.dtype != np.uint8 else alpha
    return np.dstack([rgb, a])


def feather(mask: np.ndarray, px: float = 1.0) -> np.ndarray:
    m = mask.astype(np.float32)
    if m.max() <= 1.0:
        m = m * 255
    if px > 0:
        k = int(px * 3) * 2 + 1
        m = cv2.GaussianBlur(m, (k, k), px)
    return np.clip(m, 0, 255).astype(np.uint8)


def decontaminate(rgb: np.ndarray, alpha: np.ndarray, solid: int = 230) -> np.ndarray:
    """Replace the colour of soft-edge pixels (alpha < solid) by colour pushed out from the solid
    interior (multi-scale normalised blur), so a moving layer carries no background fringe."""
    a = alpha.astype(np.float32)
    if a.max() <= 1.0:
        a = a * 255
    w = (a >= solid).astype(np.float32)
    if w.sum() == 0:
        return rgb.copy()
    src = rgb.astype(np.float32)
    acc = np.zeros_like(src); wacc = np.zeros_like(w)
    filled = np.zeros_like(src); have = np.zeros_like(w, bool)
    k = 3
    while not have.all() and k < 4 * max(w.shape):
        num = cv2.blur(src * w[..., None], (k, k))
        den = cv2.blur(w, (k, k))
        ok = (den > 1e-4) & ~have
        filled[ok] = num[ok] / den[ok][:, None]
        have |= ok
        k = k * 2 + 1
    filled[~have] = src[w > 0].mean(0)
    have[:] = True
    out = rgb.copy()
    soft = (a < solid) & have
    out[soft] = np.clip(filled[soft], 0, 255).astype(np.uint8)
    return out

"""Glow-being splitter: a portrait of light on black -> layers for the t1 glow rig.

The portrait is read as light: every element is lifted off a working copy, front to back, and the
working copy is then LaMa-filled under it so whatever lies behind continues (strands, facets, black).
  mode "light": additive delta  max(0, working - filled), alpha 0 (composites like light)
  mode "cut":   the element's own pixels, alpha = soft coverage x occl (occludes what is behind)
  mode "erase": removed from the working copy and redrawn procedurally by the runtime (halo ring)
  mode "none":  procedural only (aperture glow), no pixels
What remains of the working copy is the static background layer.

  T1_DEVICE=cpu ~/.athena-avatar/venvs/t1-rig/Scripts/python.exe spikes/avatar/t1-rig/prep/split_glow.py --portrait b04-owl
Spec: spikes/avatar/t1-rig/prep/specs/<portrait>.json (regions are authored geometry, refined from luminance).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
import layerkit as lk  # noqa: E402

SPECS = Path(__file__).parent / "specs"
ORIG: list = [None]
ERASED: list = [None]


def lum(img: np.ndarray) -> np.ndarray:
    return img.astype(np.float32).max(2)


def poly_mask(shape, pts, mirror=False, cx=512.0) -> np.ndarray:
    p = np.array(pts, np.float32)
    if mirror:
        p[:, 0] = 2 * cx - p[:, 0]
    m = np.zeros(shape, np.uint8)
    cv2.fillPoly(m, [np.round(p).astype(np.int32)], 1)
    return m.astype(bool)


def soft(mask: np.ndarray, dilate: int = 0, feather: float = 0.0) -> np.ndarray:
    m = mask.astype(np.uint8)
    if dilate:
        m = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * dilate + 1, 2 * dilate + 1)))
    f = m.astype(np.float32)
    if feather > 0:
        k = int(feather * 3) * 2 + 1
        f = cv2.GaussianBlur(f, (k, k), feather)
    return np.clip(f, 0, 1)


def region_mask(reg: dict, work: np.ndarray, taken: np.ndarray, spec: dict, H: int, W: int):
    """Return (soft coverage 0..1, meta dict)."""
    L = lum(work)
    meta: dict = {}
    if "poly" in reg:
        m = poly_mask((H, W), reg["poly"], reg.get("mirror", False))
        if reg.get("lit"):  # keep only the lit body inside the polygon, closed so dark interiors stay
            lit = cv2.morphologyEx((L > 5).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8)).astype(bool)
            m &= lit
    elif "blob" in reg:
        cx, cy = reg["blob"]
        r = reg.get("radius", 30)
        thr = reg.get("thr", 200)
        win = np.zeros((H, W), bool)
        cv2.circle(win.view(np.uint8), (int(cx), int(cy)), int(r), 1, -1)
        core = (L > thr) & win
        if core.sum() > 3:
            ys, xs = np.nonzero(core)
            w = L[core]
            cx, cy = float((xs * w).sum() / w.sum()), float((ys * w).sum() / w.sum())
            rc = float(np.sqrt(core.sum() / np.pi))
        else:
            rc = r / 3
        # a light blob is radial: full inside 1.6 x the core, falling smoothly to 0 at the window
        yy, xx = np.mgrid[0:H, 0:W]
        d = np.hypot(xx - cx, yy - cy)
        m = d < r
        meta = {"center": [round(cx, 1), round(cy, 1)], "core_r": round(rc, 1)}
        x = np.clip((d - 1.6 * rc) / max(1.0, r - 1.6 * rc), 0, 1)
        return (1 - x * x * (3 - 2 * x)).astype(np.float32), meta
    elif "component" in reg:
        sx, sy = reg["component"]
        n, lab = cv2.connectedComponents((L > reg.get("thr", 6)).astype(np.uint8), connectivity=8)
        m = lab == lab[int(sy), int(sx)]
        m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8)).astype(bool)
    elif "ring" in reg:
        cx, cy, r = reg["ring"]
        # refine centre/radius on the bright thin ring: sample the max along rays
        best = (0, cx, cy, r)
        for dx in range(-6, 7, 2):
            for dy in range(-6, 7, 2):
                for dr in range(-6, 7, 2):
                    ang = np.linspace(0, 2 * np.pi, 360, endpoint=False)
                    xs = np.clip((cx + dx + (r + dr) * np.cos(ang)).astype(int), 0, W - 1)
                    ys = np.clip((cy + dy + (r + dr) * np.sin(ang)).astype(int), 0, H - 1)
                    s = np.median(L[ys, xs])
                    if s > best[0]:
                        best = (s, cx + dx, cy + dy, r + dr)
        _, cx, cy, r = best
        yy, xx = np.mgrid[0:H, 0:W]
        d = np.abs(np.hypot(xx - cx, yy - cy) - r)
        m = d < reg.get("width", 16)
        # ring colour and core width from the visible ring
        ring_px = work[(d < 2) & (L > 60)]
        col = (ring_px.astype(np.float32).mean(0) / 255).tolist() if len(ring_px) else [0.2, 0.8, 1.0]
        prof = [float(np.median(L[(d >= k) & (d < k + 1) & (L > 1)])) if ((d >= k) & (d < k + 1) & (L > 1)).any() else 0.0 for k in range(12)]
        meta = {"center": [float(cx), float(cy)], "radius": float(r), "color": [round(c, 3) for c in col],
                "profile": [round(p / 255, 3) for p in prof]}
    elif "aperture" in reg:
        ap = spec["aperture"]
        hexm = poly_mask((H, W), ap["poly"])
        yy = np.arange(H)[:, None] * np.ones((1, W))
        m = hexm & ((yy < ap["seam_y"]) if reg["aperture"] == "upper" else (yy >= ap["seam_y"]))
    elif reg.get("rest"):
        # silhouette from the original light, never from fill noise or erased parts (the halo)
        lit = (lum(ORIG[0]) > reg.get("thr", 10)) & ~ERASED[0]
        k = int(reg.get("close", 25))
        m = cv2.morphologyEx(lit.astype(np.uint8), cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
        # fill interior holes: a sparse body of strands still occludes what is behind it
        ff = m.copy(); hh, ww = ff.shape
        cv2.floodFill(ff, np.zeros((hh + 2, ww + 2), np.uint8), (0, 0), 2)
        m = (ff != 2)
        m &= np.arange(H)[:, None] >= reg.get("y_min", 0)
        m &= ~taken
    else:
        raise ValueError(f"unknown region {reg}")
    cov = soft(m, int(reg.get("dilate", 0)), float(reg.get("feather", 0)))
    return cov, meta


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--portrait", required=True)
    ap.add_argument("--spec")
    a = ap.parse_args()
    t0 = time.time()
    pdir = lk.HOME / "portraits" / a.portrait
    spec = json.loads(Path(a.spec or SPECS / f"{a.portrait}.json").read_text(encoding="utf-8"))
    img = np.array(Image.open(pdir / "portrait.png").convert("RGB"))
    H, W = img.shape[:2]
    work = img.copy()
    taken = np.zeros((H, W), bool)
    ORIG[0] = img
    ERASED[0] = np.zeros((H, W), bool)
    out_layers = []  # front to back while extracting
    dbg = np.zeros((H, W, 3), np.float32)
    rng = np.random.default_rng(3)

    for el in spec["elements"]:
        mode = el["mode"]
        reg = el.get("region")
        if mode == "none":
            out_layers.append((el, None, {}))
            continue
        cov, meta = region_mask(reg, work, taken, spec, H, W)
        hard = cov > 0.02
        if mode == "light":
            filled = lk.lama_crop(work, cv2.dilate(hard.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool), margin=1.0)
            delta = np.clip(work.astype(np.int16) - filled.astype(np.int16), 0, 255).astype(np.float32) * cov[..., None]
            rgba = np.dstack([np.clip(delta, 0, 255).astype(np.uint8), (cov * 255).astype(np.uint8)])
            # alpha channel here is only a crop mask; the runtime draws light layers with alpha 0
            work = np.where(cov[..., None] > 0, (filled * cov[..., None] + work * (1 - cov[..., None])), work).astype(np.uint8)
            out_layers.append((el, rgba, meta))
        elif mode == "cut":
            rgba = np.dstack([work, (cov * 255).astype(np.uint8)])
            # what lies behind: LaMa on the working copy under the element
            fillm = cv2.dilate(hard.astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool)
            filled = lk.lama_crop(work, fillm, margin=0.5)
            work = np.where(fillm[..., None], filled, work).astype(np.uint8)
            out_layers.append((el, rgba, meta))
            taken |= cov > 0.5
        elif mode == "erase":
            ERASED[0] |= cv2.dilate(hard.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
            fillm = cv2.dilate(hard.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool) & (lum(work) > 3)
            # the ring sits on black: fill with the surroundings (LaMa) where the body is behind, black elsewhere
            filled = lk.lama_crop(work, fillm, margin=0.3)
            work = np.where(fillm[..., None], filled, work).astype(np.uint8)
            out_layers.append((el, None, meta))
        dbg += rng.uniform(0.2, 1.0, 3)[None, None, :] * cov[..., None]

    # write back to front: background first, then the extracted elements reversed
    lw = lk.LayerWriter(pdir / "t1-rig" / "layers", a.portrait, "glow", W, H)
    lw.meta["rig_type"] = "glow"
    lw.add("background", np.dstack([work, np.full((H, W), 255, np.uint8)]), "static")
    ordered = list(reversed(out_layers))
    ordered.sort(key=lambda x: 0 if x[0].get("draw_first") else 1)  # e.g. a halo behind everything
    for el, rgba, meta in ordered:
        e = lw.add(el["name"], rgba, el["kind"], el.get("depth", 0.0), bbox=None if rgba is not None else
                   ([0, 0, W, H]))
        if e is None:
            print("empty element", el["name"])
            continue
        e["mode"] = el["mode"]
        for k in ("blink", "gain", "voice_gain", "bloom", "follow", "float", "occl", "shimmer", "glint", "pulse", "aperture_follow"):
            if k in el:
                e[k] = el[k]
        if meta:
            e["meta"] = meta
    rig = {"head": {**spec["head"], "chin_y": spec["head"].get("pivot_y"), "crown_y": 0}}
    for k in ("shimmer", "tip_pulse", "glint", "aperture"):
        if k in spec:
            rig[k] = spec[k]
    if "aperture" in spec:
        p = np.array(spec["aperture"]["poly"], np.float32)
        rig["aperture"] = {**spec["aperture"], "top": float(p[:, 1].min()), "bottom": float(p[:, 1].max()),
                           "x0": float(p[:, 0].min()), "x1": float(p[:, 0].max())}
    lw.meta["rig"] = rig
    lw.meta["timing_s"] = {"total": round(time.time() - t0, 1)}
    p = lw.write()
    lk.save_png(np.clip(dbg / max(1e-6, dbg.max()) * 255, 0, 255).astype(np.uint8), pdir / "t1-rig" / "debug_regions.png")
    lk.save_png(work, pdir / "t1-rig" / "debug_background.png")
    print(f"wrote {p} ({len(lw.meta['layers'])} layers) in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()

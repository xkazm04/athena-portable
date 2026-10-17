"""Fallback splitter for semi-realistic portraits (See-through is anime-trained):
person matte (BiRefNet) + hair/skin/clothes classes (MediaPipe selfie-multiclass) + 478 face
landmarks (MediaPipe face landmarker) -> semantic layers, occluded areas filled with big-LaMa.

  python spikes/avatar/tools/gpulock.py --label "t1-rig: fallback split" -- \
    ~/.athena-avatar/venvs/t1-rig/Scripts/python.exe spikes/avatar/t1-rig/prep/split_fallback.py --portrait <id>
"""

from __future__ import annotations

import argparse
import os
import sys
import time
import urllib.request
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
import layerkit as lk  # noqa: E402

os.environ.setdefault("HF_HOME", str(lk.MODELS / "hf"))

MP_DIR = lk.MODELS / "mediapipe"
MP_FILES = {
    "face_landmarker.task": "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task",
    "selfie_multiclass_256x256.tflite": "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite",
}

FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152,
             148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]
EYE_R = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7]       # image-left
EYE_L = [362, 398, 384, 385, 386, 387, 388, 466, 263, 249, 390, 373, 374, 380, 381, 382]   # image-right
BROW_R = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46]
BROW_L = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276]
LIP_UP_OUT = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291]
LIP_UP_IN = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308]
LIP_LO_OUT = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291]
LIP_LO_IN = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308]
IRIS_A = [468, 469, 470, 471, 472]
IRIS_B = [473, 474, 475, 476, 477]


def mp_models() -> None:
    MP_DIR.mkdir(parents=True, exist_ok=True)
    for f, url in MP_FILES.items():
        if not (MP_DIR / f).exists():
            urllib.request.urlretrieve(url, MP_DIR / f)


def poly(shape, pts, dilate=0) -> np.ndarray:
    m = np.zeros(shape, np.uint8)
    cv2.fillPoly(m, [np.round(pts).astype(np.int32)], 1)
    if dilate:
        m = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * dilate + 1, 2 * dilate + 1)))
    return m.astype(bool)


def matte_birefnet(img: np.ndarray) -> np.ndarray:
    import torch
    from transformers import AutoModelForImageSegmentation
    m = AutoModelForImageSegmentation.from_pretrained("ZhengPeng7/BiRefNet", trust_remote_code=True).eval()
    dev = lk.DEVICE
    dt = torch.float16 if dev == "cuda" else torch.float32
    m = m.to(dev, dt)
    x = cv2.resize(img, (1024, 1024), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
    x = (x - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]
    t = torch.from_numpy(x.transpose(2, 0, 1)[None].astype(np.float32)).to(dev, dt)
    with torch.no_grad():
        pred = m(t)[-1].sigmoid()[0, 0].float().cpu().numpy()
    del m
    if dev == "cuda":
        torch.cuda.empty_cache()
    return cv2.resize(pred, (img.shape[1], img.shape[0]), interpolation=cv2.INTER_CUBIC).clip(0, 1)


def mediapipe_all(img: np.ndarray):
    import mediapipe as mp
    from mediapipe.tasks import python as mpt
    from mediapipe.tasks.python import vision
    mp_models()
    mimg = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(img))
    seg = vision.ImageSegmenter.create_from_options(vision.ImageSegmenterOptions(
        base_options=mpt.BaseOptions(model_asset_path=str(MP_DIR / "selfie_multiclass_256x256.tflite")),
        output_category_mask=False, output_confidence_masks=True))
    conf = [c.numpy_view().copy() for c in seg.segment(mimg).confidence_masks]
    conf = np.stack([cv2.resize(c, (img.shape[1], img.shape[0]), interpolation=cv2.INTER_LINEAR) for c in conf], -1)
    lmk = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
        base_options=mpt.BaseOptions(model_asset_path=str(MP_DIR / "face_landmarker.task")), num_faces=1))
    res = lmk.detect(mimg)
    if not res.face_landmarks:
        raise SystemExit("MediaPipe found no face")
    h, w = img.shape[:2]
    lm = np.array([[p.x * w, p.y * h] for p in res.face_landmarks[0]], np.float32)
    return conf, lm  # conf classes: 0 bg, 1 hair, 2 body-skin, 3 face-skin, 4 clothes, 5 others


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--portrait", required=True)
    ap.add_argument("--src")
    ap.add_argument("--max-side", type=int, default=1536)
    a = ap.parse_args()
    t0 = time.time()
    pdir = lk.HOME / "portraits" / a.portrait
    src = Path(a.src) if a.src else pdir / "portrait.png"
    img = np.array(Image.open(src).convert("RGB"))
    s = min(1.0, a.max_side / max(img.shape[:2]))
    if s < 1:
        img = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    H, W = img.shape[:2]

    matte = matte_birefnet(img)
    conf, lm = mediapipe_all(img)
    cls = conf.argmax(-1)
    person = matte > 0.5

    oval = poly((H, W), lm[FACE_OVAL])
    fx0, fy0 = lm[FACE_OVAL].min(0)
    fx1, fy1 = lm[FACE_OVAL].max(0)
    fw, fh = fx1 - fx0, fy1 - fy0
    chin_y = float(lm[152, 1])
    hair = person & (cls == 1)
    hair = cv2.morphologyEx(hair.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)).astype(bool)
    # hair over the face, or lying against its edge, is drawn in front of it
    near_face = cv2.dilate(oval.astype(np.uint8), np.ones((int(0.06 * np.ptp(lm[FACE_OVAL][:, 0])) | 1,) * 2, np.uint8)).astype(bool)
    front_hair = hair & near_face & (np.arange(H)[:, None] > lm[FACE_OVAL][:, 1].min())
    face_skin = person & (cls == 3)
    face_m = (oval | face_skin) & ~(hair & ~oval)
    # ears / skin blobs far from the face are not face
    face_m &= poly((H, W), np.array([[fx0 - 0.25 * fw, fy0 - 0.2 * fh], [fx1 + 0.25 * fw, fy0 - 0.2 * fh],
                                     [fx1 + 0.25 * fw, chin_y + 0.02 * fh], [fx0 - 0.25 * fw, chin_y + 0.02 * fh]]))
    drape_y = chin_y + 0.12 * fh
    yy = np.arange(H)[:, None] * np.ones((1, W))
    drape = hair & (yy > drape_y)
    back_hair = hair & ~front_hair & ~drape

    eye_r, eye_l = poly((H, W), lm[EYE_R]), poly((H, W), lm[EYE_L])
    eyes = eye_r | eye_l
    lips_up = poly((H, W), np.concatenate([lm[LIP_UP_OUT], lm[LIP_UP_IN][::-1]]))
    lips_lo = poly((H, W), np.concatenate([lm[LIP_LO_OUT], lm[LIP_LO_IN][::-1]]))
    lips = poly((H, W), lm[LIP_UP_OUT + LIP_LO_OUT[::-1]], dilate=1)

    rgb = img
    # background
    bg = lk.lama(rgb, cv2.dilate((matte > 0.03).astype(np.uint8), np.ones((21, 21), np.uint8)))

    # back hair: also fill the mass behind the head so a turn reveals hair, not background
    hull = np.zeros((H, W), np.uint8)
    hp = np.argwhere(hair | oval)
    if len(hp):
        cv2.fillPoly(hull, [cv2.convexHull(hp[:, ::-1].astype(np.int32))], 1)
    behind = hull.astype(bool) & (yy < drape_y) & ~back_hair & cv2.dilate(oval.astype(np.uint8), np.ones((int(fw * 0.15) | 1,) * 2, np.uint8)).astype(bool)
    push = lk.decontaminate(rgb, (back_hair * 255).astype(np.uint8), solid=128)
    bh_rgb = rgb.copy()
    bh_rgb[behind] = (push[behind].astype(np.float32) * 0.8).astype(np.uint8)
    bh_alpha = np.maximum(lk.feather(back_hair, 0.8) * (matte > 0.1), lk.feather(behind, 1.5))
    bh_alpha = np.maximum(bh_alpha, (back_hair * matte * 255).astype(np.uint8))

    # body: skin + clothes + others, with the region under drape hair and under the jaw filled
    body_m = person & ~hair & ~face_m
    # hats, bands, clips: clothes/accessory pixels on the head move with the head, in front of the hair
    head_big = cv2.dilate(oval.astype(np.uint8), np.ones((int(fw * 0.9) | 1,) * 2, np.uint8)).astype(bool)
    headwear = person & ((cls == 4) | (cls == 5)) & head_big & (yy < lm[14, 1])
    body_m &= ~headwear
    under_hw = cv2.dilate(headwear.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool) & ~back_hair
    bh_rgb[under_hw] = (push[under_hw].astype(np.float32) * 0.8).astype(np.uint8)
    bh_alpha = np.maximum(bh_alpha, lk.feather(under_hw, 1.0))
    # nothing beside the head belongs to the body: it would stay put while the head turns
    head_zone = cv2.dilate(oval.astype(np.uint8), np.ones((int(fw * 0.5) | 1,) * 2, np.uint8)).astype(bool) & (yy < lm[14, 1])
    stray = body_m & head_zone
    face_m |= stray & (cls == 3)
    body_m &= ~head_zone
    under = (drape | (oval & (yy > lm[14, 1]))) & (yy > lm[14, 1])
    neck_cols = body_m[int(min(H - 1, chin_y + 0.08 * fh))]
    if neck_cols.any():
        xs = np.nonzero(neck_cols)[0]
        under_jaw = oval & (yy > lm[14, 1]) & (np.arange(W)[None, :] >= xs.min()) & (np.arange(W)[None, :] <= xs.max())
    else:
        under_jaw = np.zeros_like(oval)
    ring = cv2.dilate(face_m.astype(np.uint8), np.ones((int(fw * 0.06) | 1,) * 2, np.uint8)).astype(bool) & ~face_m & (yy > lm[1, 1])
    body_fill = (drape | under_jaw) & ~body_m
    body_m_ring = body_m & ring
    body_rgb = lk.lama_crop(rgb, body_fill | (under & ~body_m) | body_m_ring | (face_m & (yy > lm[14, 1])))
    body_alpha = np.where(body_m, (matte * 255).astype(np.uint8), 0)
    body_alpha = np.maximum(body_alpha, lk.feather(body_fill & hull.astype(bool) | (drape), 1.0))

    # face: lips, brows stay; the forehead under front hair and the lips are filled with skin
    # the lips plus the dark corner creases beside them: a stretched corner pixel reads as a black tick
    mwid = int(np.linalg.norm(lm[291] - lm[61]))
    lips_wide = cv2.dilate(lips.astype(np.uint8), np.ones((max(3, mwid // 10) | 1, max(9, mwid // 4) | 1), np.uint8)).astype(bool)
    face_fill = (front_hair & oval) | lips
    face_rgb = lk.lama_crop(rgb, cv2.dilate(face_fill.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool))
    face_alpha = lk.feather(face_m | front_hair, 0.8)
    face_alpha = np.minimum(face_alpha, np.maximum((matte * 255).astype(np.uint8), lk.feather(oval, 0.8)))

    # eyes: sclera with the iris removed, iris disks
    iris_ab = []
    for ids in (IRIS_A, IRIS_B):
        c = lm[ids[0]]
        r = float(np.linalg.norm(lm[ids[1:]] - c, axis=1).mean())
        iris_ab.append((c, r))
    iris_m = np.zeros((H, W), np.uint8)
    for c, r in iris_ab:
        cv2.circle(iris_m, (int(round(c[0])), int(round(c[1]))), int(round(r * 1.12)), 1, -1)
    eyes_d = poly((H, W), lm[EYE_R], 1) | poly((H, W), lm[EYE_L], 1)
    sclera_rgb = lk.lama_crop(rgb, iris_m.astype(bool) & eyes_d, margin=1.5)
    iris_alpha = np.zeros((H, W), np.float32)
    for c, r in iris_ab:
        d = np.hypot(np.arange(W)[None, :] - c[0], np.arange(H)[:, None] - c[1])
        iris_alpha = np.maximum(iris_alpha, np.clip((r * 1.05 - d) / 1.2 + 0.5, 0, 1))
    iris_alpha = (iris_alpha * eyes_d * 255).astype(np.uint8)

    # rig geometry
    eye_geo = lk.eye_geometry(eyes.astype(np.float32), (iris_m > 0).astype(np.float32))
    brow_geo = []
    for ids in (BROW_R, BROW_L):
        p = lm[ids]
        brow_geo.append({"center": [round(float(p[:, 0].mean()), 1), round(float(p[:, 1].mean()), 1)],
                         "w": round(float(p[:, 0].max() - p[:, 0].min()), 1)})
    brow_geo.sort(key=lambda b: b["center"][0])
    lips_rgba = lk.rgba(rgb, lk.feather(lips_up | lips_lo, 0.6))
    x0, x1 = lm[61, 0], lm[291, 0]
    xs16 = np.linspace(x0, x1, 16)
    inner_up = np.interp(xs16, *zip(*sorted(zip(lm[LIP_UP_IN][:, 0], lm[LIP_UP_IN][:, 1]))))
    inner_lo = np.interp(xs16, *zip(*sorted(zip(lm[LIP_LO_IN][:, 0], lm[LIP_LO_IN][:, 1]))))
    line = (inner_up + inner_lo) / 2
    mouth = lk.mouth_geometry(lips_rgba, line=line)
    mouth["x0"], mouth["x1"] = int(np.floor(x0)), int(np.ceil(x1))
    mouth["open_px"] = round(float(0.2 * (x1 - x0)), 1)  # photo-like faces: a wide-open jaw drops ~20 % of mouth width
    hair_rows = np.nonzero((hair | oval)[:, int(fx0):int(fx1)].any(1))[0]
    crown = int(hair_rows.min()) if len(hair_rows) else int(fy0 - 0.25 * fh)
    head = {"center": [round(float((fx0 + fx1) / 2), 1), round(float(fy0 + fh * 0.48), 1)],
            "radius": [round(float(fw / 2 * 1.02), 1), round(float(fh / 2 * 1.02), 1)],
            "chin_y": round(chin_y, 1), "crown_y": crown}

    out = pdir / "t1-rig" / "layers"
    lw = lk.LayerWriter(out, a.portrait, "fallback", W, H)
    lw.meta["rig"] = {"head": head, "eyes": eye_geo, "brows": brow_geo, "mouth": mouth}
    lw.add("background", lk.rgba(bg, np.full((H, W), 255, np.uint8)), "static")
    lw.add("back_hair", lk.rgba(lk.decontaminate(bh_rgb, bh_alpha), bh_alpha), "hair_back", -0.45)
    lw.add("body", lk.rgba(lk.decontaminate(body_rgb, body_alpha), body_alpha), "body")
    dr_a = (lk.feather(drape, 0.6).astype(np.float32) * np.clip(matte * 1.2, 0, 1)).astype(np.uint8)
    lw.add("hair_drape", lk.rgba(lk.decontaminate(rgb, dr_a), dr_a), "hair_back", -0.45)
    lw.add("face", lk.rgba(lk.decontaminate(face_rgb, face_alpha), face_alpha), "head")
    lw.add("mouth_hole", None, "mouth_hole", bbox=[mouth["x0"], mouth["center"][1] - mouth["upper_h"], mouth["x1"] - mouth["x0"], mouth["upper_h"] + mouth["lower_h"]])
    up, lo = lk.split_lips(lips_rgba, mouth)
    lw.add("lip_upper", up, "lip_upper")
    lw.add("lip_lower", lo, "lip_lower")
    lw.add("eyewhite", lk.rgba(sclera_rgb, lk.feather(eyes_d, 0.6)), "eye_white", 0.03)
    lw.add("irides", lk.rgba(rgb, iris_alpha), "iris", 0.04)
    ex0 = min(e["x0"] for e in eye_geo); ex1 = max(e["x1"] for e in eye_geo)
    eh = max(e["h"] for e in eye_geo)
    ey0 = int(min(min(e["top"]) for e in eye_geo) - 1.2 * eh); ey1 = int(max(max(e["bottom"]) for e in eye_geo) + 0.8 * eh)
    reg = np.zeros((H, W), np.uint8)
    reg[max(0, ey0):ey1, max(0, ex0 - 8):ex1 + 8] = 255
    lw.add("lid_source", lk.rgba(rgb, reg), "lid_source")
    lw.add("eye_mask", lk.rgba(np.full((H, W, 3), 255, np.uint8), lk.feather(eyes, 0.7)), "eye_mask")
    lw.add("lids", None, "lid", bbox=[ex0, ey0, ex1 - ex0, ey1 - ey0])
    fh_a = (lk.feather(front_hair, 0.7).astype(np.float32) * np.clip(matte * 1.2, 0, 1)).astype(np.uint8)
    if headwear.sum() > 50:
        hw_a = (lk.feather(headwear, 0.7).astype(np.float32) * np.clip(matte * 1.2, 0, 1)).astype(np.uint8)
        lw.add("headwear", lk.rgba(lk.decontaminate(rgb, hw_a), hw_a), "head", 0.2)
    lw.add("front_hair", lk.rgba(lk.decontaminate(rgb, fh_a), fh_a), "hair_front", 0.1)
    lw.meta["timing_s"] = {"total": round(time.time() - t0, 1)}
    # debug sheet of masks for review
    dbg = np.zeros((H, W, 3), np.uint8)
    dbg[back_hair] = (120, 60, 20); dbg[drape] = (200, 120, 40); dbg[body_m] = (40, 90, 160)
    dbg[face_m] = (220, 180, 150); dbg[front_hair] = (250, 200, 60); dbg[eyes] = (255, 255, 255)
    dbg[lips_up] = (200, 40, 60); dbg[lips_lo] = (150, 20, 40); dbg[behind] = dbg[behind] // 2 + (0, 60, 0)
    lk.save_png(dbg, pdir / "t1-rig" / "debug_masks.png")
    p = lw.write()
    print(f"wrote {p} ({len(lw.meta['layers'])} layers) in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()

"""Learn a render-free semantic decoder: JoyVASA expression coefficients -> rig channels.

JoyVASA's motion lives in LivePortrait's implicit-keypoint space (21x3 deltas), which has no
names. To get blink / brow / gaze / jaw we render sampled motion onto a carrier image
(neural_motion.py --carrier), measure the render with MediaPipe FaceLandmarker (CPU), and fit a
ridge regression from the 63 expression coefficients (relative to the clip's first frame, exactly
what LivePortrait renders) to each measured channel. The decoder is then applied to any new motion
without rendering - which is what keeps the hybrid laptop-light.

Head pose is not decoded: JoyVASA emits pitch/yaw/roll in degrees. The carrier measurement is used
only to verify the sign of each angle against image space.

    python t4/calibrate.py --pair <motion.npz> <carrier.mp4> [--pair ...] --out decoder.json

CPU only, no GPU lock.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import cv2
import numpy as np

HOME = Path(os.environ.get("ATHENA_AVATAR_HOME", Path.home() / ".athena-avatar"))
TASK = HOME / "models" / "mediapipe" / "face_landmarker.task"

# MediaPipe face-mesh indices
IRIS = (468, 473)
EYE_CORNERS = ((33, 133), (362, 263))
EYE_LIDS = ((159, 145), (386, 374))
NOSE, CHEEK_A, CHEEK_B, CHIN, FOREHEAD = 1, 234, 454, 152, 10


def measure(mp4: str) -> dict[str, np.ndarray]:
    import mediapipe as mp
    from mediapipe.tasks.python import vision
    from mediapipe.tasks.python.core.base_options import BaseOptions

    opts = vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(TASK)),
        running_mode=vision.RunningMode.VIDEO,
        output_face_blendshapes=True,
        num_faces=1,
    )
    cap = cv2.VideoCapture(mp4)
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    rows: list[dict[str, float]] = []
    with vision.FaceLandmarker.create_from_options(opts) as lm:
        i = 0
        while True:
            ok, bgr = cap.read()
            if not ok:
                break
            img = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
            res = lm.detect_for_video(img, int(i * 1000 / fps))
            i += 1
            if not res.face_landmarks:
                rows.append({})
                continue
            L = np.array([[p.x * bgr.shape[1], p.y * bgr.shape[0]] for p in res.face_landmarks[0]])
            bs = {c.category_name: c.score for c in res.face_blendshapes[0]}
            gx, gy = [], []
            for iris, (a, b), (top, bot) in zip(IRIS, EYE_CORNERS, EYE_LIDS):
                mid = (L[a] + L[b]) / 2
                half = np.linalg.norm(L[b] - L[a]) / 2
                gx.append((L[iris][0] - mid[0]) / half)
                gy.append((L[iris][1] - (L[top][1] + L[bot][1]) / 2) / half)
            fw = np.linalg.norm(L[CHEEK_B] - L[CHEEK_A])
            eye_l, eye_r = (L[33] + L[133]) / 2, (L[362] + L[263]) / 2
            if eye_l[0] > eye_r[0]:
                eye_l, eye_r = eye_r, eye_l
            rows.append(dict(
                blink=(bs["eyeBlinkLeft"] + bs["eyeBlinkRight"]) / 2,
                blink_imgL=bs["eyeBlinkRight"], blink_imgR=bs["eyeBlinkLeft"],
                brow=(bs["browInnerUp"] + (bs["browOuterUpLeft"] + bs["browOuterUpRight"]) / 2
                      - (bs["browDownLeft"] + bs["browDownRight"]) / 2),
                jaw=bs["jawOpen"],
                gaze_x=float(np.mean(gx)), gaze_y=float(np.mean(gy)),
                # image-space pose proxies: + = turned to image right, looking down, clockwise
                yaw_img=(L[NOSE][0] - (L[CHEEK_A][0] + L[CHEEK_B][0]) / 2) / fw,
                pitch_img=(L[NOSE][1] - L[FOREHEAD][1]) / (L[CHIN][1] - L[FOREHEAD][1]),
                roll_img=float(np.degrees(np.arctan2(eye_r[1] - eye_l[1], eye_r[0] - eye_l[0]))),
            ))
    cap.release()
    keys = sorted({k for r in rows for k in r})
    out = {k: np.array([r.get(k, np.nan) for r in rows], np.float64) for k in keys}
    out["_n"] = np.array(len(rows))
    return out


def features(exp: np.ndarray) -> np.ndarray:
    """exp[N,21,3] -> N x 63, absolute. The carrier render is anchored on the dataset-mean
    expression (neural_motion._render), so the rendered face is an affine function of absolute exp
    for every clip alike; fitting relative-to-frame-0 features instead gave leave-one-clip-out
    R2 < 0 for jaw/brow (per-clip offsets)."""
    return exp.reshape(len(exp), -1)


def ridge(X, y, lam):
    mu, sd = X.mean(0), X.std(0) + 1e-8
    Z = (X - mu) / sd
    w = np.linalg.solve(Z.T @ Z + lam * np.eye(Z.shape[1]), Z.T @ (y - y.mean()))
    W = w / sd
    b = y.mean() - mu @ W
    return W, b


def cv_r2(X, y, groups, lam):
    pred = np.zeros_like(y)
    for g in np.unique(groups):
        tr, te = groups != g, groups == g
        W, b = ridge(X[tr], y[tr], lam)
        pred[te] = X[te] @ W + b
    return 1 - np.sum((y - pred) ** 2) / np.sum((y - y.mean()) ** 2), pred


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pair", nargs=2, action="append", required=True, metavar=("MOTION_NPZ", "CARRIER_MP4"))
    ap.add_argument("--out", required=True)
    ap.add_argument("--dump", help="write per-frame measurements + motion to this npz (for plots)")
    a = ap.parse_args()

    Xs, Ys, G, poses = [], [], [], []
    targets = ["blink", "brow", "jaw", "gaze_x", "gaze_y"]
    for gi, (npz, mp4) in enumerate(a.pair):
        m = np.load(npz)
        meas = {k: (v[1:] if k != "_n" else v - 1) for k, v in measure(mp4).items()}  # drop the anchor frame
        n = min(len(m["exp"]), int(meas["_n"]))
        ok = ~np.isnan(meas["blink"][:n])
        print(f"{Path(mp4).name}: {n} frames, face found in {ok.mean() * 100:.0f} %")
        X = features(m["exp"][:n])[ok]
        Y = np.stack([meas[k][:n][ok] for k in targets], 1)
        Xs.append(X); Ys.append(Y); G.append(np.full(len(X), gi))
        poses.append({k: (m[k][:n][ok], meas[k + "_img"][:n][ok]) for k in ("yaw", "pitch", "roll")})
    X, Y, G = np.concatenate(Xs), np.concatenate(Ys), np.concatenate(G)

    dec = {"version": 1, "features": "absolute exp[21x3], flattened row-major", "channels": {}, "pose": {}}
    for j, name in enumerate(targets):
        y = Y[:, j]
        best = max(((cv_r2(X, y, G, lam)[0], lam) for lam in (1, 10, 100, 1000)), key=lambda r: r[0])
        W, b = ridge(X, y, best[1])
        dec["channels"][name] = {
            "w": [round(float(v), 6) for v in W], "b": round(float(b), 6),
            "cv_r2": round(float(best[0]), 3), "lambda": best[1],
            # measured distribution of the target on the carrier, used to map into rig ranges
            "p5": round(float(np.percentile(y, 5)), 4), "p50": round(float(np.percentile(y, 50)), 4),
            "p95": round(float(np.percentile(y, 95)), 4), "p99": round(float(np.percentile(y, 99)), 4),
        }
        print(f"{name:7s} cv R2 {best[0]:.3f} (lambda {best[1]})  p5 {np.percentile(y, 5):.3f} "
              f"p50 {np.percentile(y, 50):.3f} p95 {np.percentile(y, 95):.3f}")

    for k in ("yaw", "pitch", "roll"):
        a_ = np.concatenate([p[k][0] for p in poses])
        b_ = np.concatenate([p[k][1] for p in poses])
        r = float(np.corrcoef(a_, b_)[0, 1])
        dec["pose"][k] = {"corr_with_image": round(r, 3), "sign_to_rig": 1 if r >= 0 else -1}
        print(f"{k:5s} corr(JoyVASA, image proxy) = {r:+.3f}")

    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(dec, indent=1))
    if a.dump:
        np.savez(a.dump, X=X, Y=Y, G=G, targets=np.array(targets))
    print("->", a.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

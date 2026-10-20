# t4-hybrid: neural motion driving t1's 2D rig (WP-T4)

**Status: done** - bench clips rendered on the operator's two portraits (b04-owl, d08-origami); see "Operator portraits" below. The original human-face notes follow.

## Pipeline: what comes from where

| RigParams field | Source |
|---|---|
| `head.yaw/pitch/roll` | JoyVASA pose (degrees), centred on the clip median. Signs are mapped to t1's image convention (yaw is flipped, measured r = -0.68). Zero-phase low-pass at 2 / 2.5 / 1.6 Hz, then a cubic resample from 25 to 60 fps. |
| `eyes.blink*` | Decoded lid curve, split in two. (1) The continuous partial lid drop is kept, with neural timing and shape, capped at 0.6. (2) A crisp full blink (75/35/170 ms) goes on the strongest lid peaks only, at least 2.2 s apart. |
| `brow.raise`, `eyes.gaze*` | Decoded and centred on the clip median. Gaze is weak (see below). |
| `mouth.visemes` | WP-L Timeline, coarticulated exactly like t1. |
| `mouth.open` | Timeline opening multiplied by a neural jaw emphasis factor (mean 1 over speech, mix 0.5). Stressed syllables open wider. |
| question gesture | A Timeline overlay that reuses t1's end-of-question tilt and brow curve, because JoyVASA does not produce this gesture. |

**Decoder.** JoyVASA motion is 21x3 LivePortrait implicit-keypoint deltas, which have no semantic names. To decode them:
1. The motion is rendered once onto a carrier image (`_smoke/flashhead_girl.png`, a repo sample) with expression only.
2. The rendered video is measured with MediaPipe.
3. A ridge regression is fitted from the 63 coefficients to each channel.

After that, decoding is a 63x5 matrix multiply that needs no GPU and no render. The decoder is in `t4/decoder.json`. Leave-one-clip-out R² over 15 clips: blink 0.84, brow 0.90, jaw 0.75, gaze_y 0.80, gaze_x 0.59.

## Reproduce

```
bash spikes/avatar/t4-hybrid/bench.sh            # motion (GPU via gpulock) -> RigParams + A/B json/png in ~/.athena-avatar/voice/t4-hybrid/
bash spikes/avatar/t4-hybrid/bench.sh <portrait-id>   # + copies to portraits/<id>/t4-hybrid/, t1 capture.mjs on port 5183, patches metrics licence
node spikes/avatar/t4-hybrid/ab/serve.mjs        # A/B page: http://127.0.0.1:5183/t4/?line=question[&portrait=<id>]
```

The calibration commands (only needed to rebuild `decoder.json`) are in the docstrings of `t4/neural_motion.py` (`--carrier --carrier-region exp`) and `t4/calibrate.py`. Set `TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1`, because the JoyVASA checkpoint pickles its args.

## A/B: t1 procedural (A) vs t4 neural (B), seed 7, same Timeline

| line | blinks/min A / B | head std yaw,pitch,roll (deg) A / B | head speed p50 (deg/s) A / B | jerk (deg/s³) A / B | audio coupling r A / B | nod-on-stress A / B |
|---|---|---|---|---|---|---|
| calm | 37 / 12 | 1.1,1.0,0.1 / 1.9,2.2,0.9 | 3.1 / 9.4 | 1182 / 652 | -0.04 / 0.24 | 1/5 / 4/5 |
| question | 31 / 31 | 0.8,0.9,1.8 / 0.8,0.9,2.0 | 2.9 / 7.6 | 749 / 518 | 0.30 / 0.29 | 1/5 / 4/5 |
| long | 23 / 17 | 1.2,1.0,0.3 / 1.1,1.4,0.9 | 2.7 / 8.1 | 1275 / 547 | 0.20 / 0.25 | 2/5 / 2/5 |

Seeds 11, 23 and 42 give the same picture:
- blinks 12-31 per minute
- head speed p50 8-9 deg/s
- jerk 470-615
- coupling 0.08-0.28
- nod-on-stress 1-3 of 5

**Which reads more alive, and why.** B (neural) moves all the time: a slow 2-3 degree drift in all three axes, roll included, which A barely uses. It is smoother than A, with about half the jerk. A's motion is a stack of sines plus bumps with sharp starts, while B's is continuous. B's lid drops are timed to speech, and its brows move about twice as much.

A is better at gestures you can name. A's question tilt comes from the text; JoyVASA ends the question with the head pitched down and no tilt, so B borrows A's overlay. A's gaze saccades are crisp; B's gaze is a drift, not saccades.

On B, the head bobbing at syllable rate (about 1-1.5 Hz) needed a 2 Hz low-pass. At 3 Hz, head speed p50 was 10-12 deg/s and the head looked busy.

Coupling to the audio envelope is not clearly better than A's (0.08-0.28 against -0.04 to 0.30), so do not sell the neural head as "speech-synchronised". It is mainly natural, non-repeating drift with beat-like nods.

Verdict: use the hybrid. Neural motion for head drift, lids and brows. The Timeline for mouth shape and text-level gestures (question). Procedural saccades would be the next layer to borrow.

## Operator portraits (glow-being rigs): b04-owl, d08-origami

**Status: done.** Bench clips: `~/.athena-avatar/bench/t4-hybrid/{b04-owl,d08-origami}/{calm,question,long}.mp4` + `.metrics.json`. They were captured with t1's `capture.mjs` (port 5183, GPU lock). t4's licences and motion stats were added by `t4/patch_metrics.py`.

What each RigParams channel drives in t1's `glow.js`:

| channel | b04-owl | d08-origami |
|---|---|---|
| head yaw/pitch/roll | sphere warp, depth parallax and roll; the glint does not apply | the same, plus the facet glint sweep, which follows yaw |
| blinkL/R | eye-light closes like an iris (squash and radial fade) and dims by up to 60 % | eye facets switch crisply to dark crystal between blink 0.25 and 0.65 |
| gazeX/Y | eye-light offset (3.5 / 2 px per unit) | the same |
| brow.raise | **no target** (ignored) | **no target** (ignored) |
| mouth.open + visemes | seam brightness, with closures dipping | two-half hinge plus the slit light. The WAV envelope adds on top in both rigs. |

The retarget profile is `--profile glow` (auto-selected by `bench.sh` from `rig_type`):
- **Head ×0.55.** The neural head std goes from about 1.9 to about 1 degree, which is level with t1's ×0.7 procedural.
- **Question overlay ×0.7**, the same as t1.
- **Lid drops capped at 0.2.** On D08, a 0.6 partial lid would cross the crisp facet switch and read as a full blink about once a second. Now partials only gently squash and dim the owl's eye-light and leave D08's facets lit. Full blinks are unchanged.
- **Head eased in over the first 0.5 s.** JoyVASA has a start transient. This also applies to the human profile.

A/B on the `question` line, t1 procedural ×0.7 vs t4 glow. Frames were compared at 0.2, 1.0, 1.8, 2.4, 3.2 and 3.7 s.

| | head std yaw,pitch,roll (deg) | head speed p50 (deg/s) | jerk (deg/s³) | nod-on-stress | frame-diff energy, owl / D08 |
|---|---|---|---|---|---|
| t1 | 0.54, 0.66, 1.27 | 2.1 | 549 | 1/5 | 0.40 / 0.15 |
| t4 | 0.48, 0.54, 1.35 | 4.2 | 336 | 3/5 | 0.73 / 0.26 |

- t4 reads more alive on both rigs:
  - The head never parks: it drifts continuously and smoothly, with about 1.8x the visible frame-to-frame change.
  - Small nods land on stressed syllables.
  - The blinks are placed differently (0.2 and 3.2 s, against t1's 0.2 and 1.8 s).
- On the stills alone the two are close, because the motion amplitude is about the same and the differences are in timing.
- t1 reads calmer. Its stillness between gestures suits a "presence" better: owl frame-diff in the first half of the clip is 0.25 for t1 against 0.67 for t4.
- On the owl, t4's constant drift together with the rig's own shimmer and tuft motion borders on restless.
- On D08, the crisper and stiffer solid shape benefits more from t4's drift.

Suggestion: D08 with t4 as is; owl with t4 at head ×0.4, or t1. This is a taste call for the operator.

## Dead ends

1. **Decoder features relative to frame 0** (how JoyVASA renders by default). Leave-one-clip-out R²: blink 0.33, brow -0.41, jaw -0.19, gaze_x -0.20. In-sample R² was fine (0.63-0.90), so the failure was a per-clip offset. Fix: render with a dataset-mean anchor frame and fit on absolute exp, which gives the R² values above.
2. **Rendering the carrier with head pose on** for calibration. Pose confounds the blendshapes (brow cv R² 0.17). Rendering expression only fixes this. Pose signs were taken from the pose-on renders instead.
3. **One full blink per decoded lid event.** This gave 45-74 blinks per minute. JoyVASA's events are about 0.3 s partial lid drops (MediaPipe eyeBlink peaks at 0.2-0.35; see frames 58-69 of the carrier render), not blinks.
4. **torch 2.5.1+cu124 install** stalled at 122 MB while 3 tracks were downloading in parallel. I switched to torch 2.7.1+cu128, shared with t2's cache.
5. **onnx 1.20 pulls protobuf 7**, which breaks MediaPipe 0.10.21. Pinned onnx 1.16.2 and protobuf<5.
6. **Live streaming is not possible as shipped.** JoyVASA samples 100-frame (4 s) windows with 10 frames of context, so the motion latency is at least 4 s. It is an offline or pre-rendered motion source unless retrained with short windows.

## Licences

| component | licence | commercial_ok | where used |
|---|---|---|---|
| JoyVASA code + motion_generator weights | MIT | yes | motion (offline) |
| TencentGameMate/chinese-hubert-base | MIT | yes | JoyVASA audio encoder (checkpoint says `hubert_zh_ori`) |
| facebook/hubert-base-ls960 | Apache-2.0 | yes | downloaded, not used by this checkpoint |
| LivePortrait weights (KwaiVGI) | MIT | yes | loaded by JoyVASA's wrapper; rendering only for calibration |
| InsightFace buffalo_l det/2d106 | non-commercial research | **no** | only to crop the calibration carrier; not in the audio-to-RigParams path |
| MediaPipe Face Landmarker | Apache-2.0 | yes | calibration only |
| SoulX-FlashHead sample image (carrier) | Apache-2.0 (repo) | yes | calibration only, never shipped |
| our decoder/retarget, t1 rig | repo | yes | runtime |

## Measurements (RTX 4090)

- **JoyVASA motion:** 4-7x realtime warm. For example, the long line (10.7 s) takes 1.8 s; question takes 0.6 s; the first item per process is about 1.4x. Peak VRAM 1.3 GB. Model load is 6-15 s.
- **Carrier render** (calibration only): about 1x realtime. VRAM peaks at 17.5 GB over a 20 s clip.
- **Retarget:** about 1 s per line on CPU, mostly Python start-up. Decode is a 63x5 matmul.
- **Runtime cost:** the same as t1, because it is the same rig and only the frame source differs.

## Files

- **Repo:** `spikes/avatar/t4-hybrid/`
  - `t4/neural_motion.py`, `t4/calibrate.py`, `t4/retarget.py`, `t4/compare.py`, `t4/patch_metrics.py`, `t4/decoder.json`
  - `ab/serve.mjs`, `ab/index.html`, `ab/ab.js`, `ab/procedural.mjs`, `ab/shot.mjs`
  - `bench.sh`, `requirements.txt`
- **`~/.athena-avatar/`:**
  - `models/joyvasa/` (repo + `pretrained_weights/`)
  - `models/mediapipe/face_landmarker.task`
  - `models/t4-decoder/`
  - `venvs/t4-hybrid/`
  - `voice/t4-hybrid/{calm,question,long}.{motion.npz,rigparams.json,stats.json,procedural.rigparams.json,ab.json}`
  - `voice/t4-hybrid/_calib*`, `_seeds/` (calibration renders and seed runs)

## Lessons (proved in this run)

- **When** decoding an unnamed neural latent (implicit keypoints) into rig channels, **do** render it onto a carrier, measure with a face tracker and fit a linear decoder once. **Because** the decoder then costs a matmul and holds up across clips (cv R² 0.75-0.90 for blink, brow and jaw).
- **When** a renderer applies motion relative to the clip's first frame, **do** prepend a fixed anchor frame for calibration. **Because** without it every clip carries its own offset, and leave-one-clip-out R² goes negative even though in-sample R² looks fine.
- **When** a talking-head motion model emits "blinks", **do** check their amplitude and rate before mapping them 1:1. **Because** JoyVASA's are partial lid drops at about 1 per second; mapped as blinks they gave 45-74 per minute. Keep the lid curve and pick sparse, crisp blinks.
- **When** retargeting diffusion head pose to a 2D rig, **do** low-pass at about 2 Hz. **Because** the raw pose bobs at syllable rate and the head reads as busy (head speed p50 10-12 deg/s, against 8 deg/s after filtering).
- **When** combining neural motion with a TTS timeline, **do** take mouth shape and text-level gestures (questions) from the timeline and drift, lids and brows from the network. **Because** audio-only motion did not produce the question tilt, and its head-to-envelope coupling was no better than procedural.

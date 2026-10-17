# t1-rig - 2D layered mesh rig (WP-T1)

Route: portrait -> semantic layers (offline, once) -> our own WebGL2 rig in the browser -> procedural
idle and speech motion. The runtime is ~1,000 lines of plain ESM (rig 609, motion 260, glue 105) with no dependencies and no GPU
compute beyond a few textured draw calls, so it is the candidate that ships to laptops.

Status: **ready-for-portrait**. Everything is built and smoke-tested on sample images shipped in
model repos (See-through's `test_image1.png`, Ditto's `example/image.png`); no operator portrait
existed when this was written, so no bench clip was rendered.

## Runtime API (for t4-hybrid)

```
node spikes/avatar/web/serve.mjs            # http://127.0.0.1:5181/  (web/ at /, ATHENA_AVATAR_HOME at /home/)
```

| URL param of `index.html` | meaning |
|---|---|
| `portrait=<id>` | loads `/home/portraits/<id>/t1-rig/layers/layers.json` (required) |
| `line=<line-id>` | plays `/home/voice/<line-id>.wav`; the procedural generator reads `<line-id>.timeline.json` |
| `params=<url>` | drive the rig from a RigParams v1 JSON instead of the procedural generator, e.g. `/home/portraits/<id>/t4-hybrid/calm.rigparams.json` |
| `blend=procedural` | with `params`: any group a frame lacks (`eyes`, `brow`, `head`, `mouth`) comes from the procedural track |
| `capture=1` | no rAF loop, no audio; the caller drives `window.__rig.renderAt(t)` |
| `w`,`h` | canvas px (default window size) |
| `zoom` | `auto` (default: head and shoulders) or a number; `oy` shifts the frame vertically |
| `calm=1` | host calm mode: one still frame, no loop |
| `seed` | procedural seed (default 7) |

JS: `window.__rig = { rig, track, duration, renderAt(t), play(), pause() }`, or import directly:

```js
import { createRig } from '/src/rig.js';                 // WebGL2
import { generateRigParams, sampleTrack } from '/src/motion.js';
const rig = await createRig(canvas, { layersUrl, zoom: 'auto' });
rig.setFrame(frame);   // one RigParams v1 frame (contract shape)
rig.render(t);         // draw at time t (s); hair springs integrate in fixed 1/240 s steps from the last t
rig.reset();           // clear physics (before seeking backwards)
```

Bench with a t4 track: `node spikes/avatar/web/capture.mjs --portrait <id> --track t4-hybrid --params-dir /home/portraits/<id>/t4-hybrid`
(reads `<line>.rigparams.json` from there; `home/...` also works, Git Bash rewrites a leading `/home`).

How a frame is read:
- `head.yaw/pitch/roll` (deg): orthographic sphere warp of every head layer around the head centre
  plus per-layer depth (parallax), roll about the chin pivot, attenuated through the neck into the
  body; hair below the chin follows the head less the lower it hangs. Shading follows the turned normal.
- `eyes.blink*`: eyelid sheet. The skin above the eye slides and stretches down over it, the lash
  band rides its edge rigidly, the lower lid rises to meet it; a downward gaze lowers the lid a little.
- `eyes.gaze*`: iris texture shifted inside the eye-white mask (x: +-17 % of eye width).
- `brow.raise`: warp field over brows and forehead.
- `mouth.open` is authoritative (jaw + lower lip drop, `open_px` per portrait); `mouth.visemes` shape
  width, rounding, lip press, f/v bite and teeth visibility. Only visemes -> open is derived from them.
- Breathing and hair springs are the runtime's own (RigParams has no field for them).
- Procedural speech also scales each syllable's opening by the WAV's loudness envelope (100 Hz RMS,
  p95-normalised), so stressed/loud syllables open wider (`env=0` turns it off).

## Reproduce

```
# 0. one-time: venv + weights (CPU/network only)
uv venv --python 3.12 ~/.athena-avatar/venvs/t1-rig
uv pip install --python ~/.athena-avatar/venvs/t1-rig/Scripts/python.exe torch==2.8.0+cu128 torchvision==0.23.0+cu128 --index-url https://download.pytorch.org/whl/cu128
uv pip install --python ~/.athena-avatar/venvs/t1-rig/Scripts/python.exe -r <see-through>/requirements.txt (minus Qt/training) mediapipe -e <see-through>/common -e <see-through>/annotators
#    (See-through cloned to ~/.athena-avatar/models/see-through; big-LaMa, MediaPipe and HF weights land under models/)

# 1a. layers, photo-like / semi-realistic portrait (the expected Leonardo case) - CPU is enough (~60 s)
T1_DEVICE=cpu ~/.athena-avatar/venvs/t1-rig/Scripts/python.exe spikes/avatar/t1-rig/prep/split_fallback.py --portrait <id>
# 1b. layers, drawn/anime portrait - See-through LayerDiff3D on the GPU (~200 s incl. load)
python spikes/avatar/tools/gpulock.py --label "t1-rig: see-through" -- ~/.athena-avatar/venvs/t1-rig/Scripts/python.exe spikes/avatar/t1-rig/prep/split_seethrough.py --portrait <id>

# 2. bench clips + metrics (Chromium/WebGL2 holds the GPU lightly; locked so realtime numbers are clean)
python spikes/avatar/tools/gpulock.py --label "t1-rig: bench capture" -- node spikes/avatar/web/capture.mjs --portrait <id>

# review stills of every control: node spikes/avatar/web/shot.mjs --portrait <id> --out <dir> --zoom 3
# export the procedural RigParams: node spikes/avatar/web/gen-params.mjs --line calm
```

Outputs: `~/.athena-avatar/portraits/<id>/t1-rig/layers/` (PNG per layer + `layers.json`),
`bench/t1-rig/<id>/<line>.mp4` + `.metrics.json`.

## Layer format (`layers.json`)

Every PNG is RGBA cropped to its `bbox` (source px); `layers` are back to front (`z`). Kinds:
`static` (background), `body`, `neck`, `head`, `hair_back`, `hair_front`, `eye_white`, `iris`,
`lip_upper`, `lip_lower`, plus three without their own drawing: `mouth_hole` (procedural interior),
`lid` (eyelid sheet sampling `lid_source`) and `eye_mask` (clips the iris).

```json
{ "version": 1, "portrait_id": "x", "source": "fallback | see-through", "width": 1432, "height": 1432,
  "layers": [{"name": "back_hair", "file": "back_hair.png", "z": 2, "bbox": [x, y, w, h], "anchor": [x, y], "kind": "hair_back", "depth": -0.45}],
  "rig": { "head":  {"center": [x, y], "radius": [rx, ry], "chin_y": 0, "crown_y": 0},
           "eyes":  [{"side": "R", "x0": 0, "x1": 0, "top": [16], "bottom": [16], "h": 0, "lash": 0, "iris": [x, y, r]}],
           "brows": [{"center": [x, y], "w": 0}],
           "mouth": {"center": [x, y], "x0": 0, "x1": 0, "line": [16], "upper_h": 0, "lower_h": 0, "lip_rgb": [r, g, b], "open_px": 0} } }
```

## What was tried, in order

1. **Runtime first** (WebGL2, one program, one draw per layer, deformation fields in the vertex
   shader over source space). Every layer gets the same fields, so neighbours move together and the
   hairline cannot tear; layers differ only by depth and by the fields that belong to them.
2. **See-through** (LayerDiff3D, SDXL-based) on its own sample: 20 clean anime layers in 192 s
   (30 steps, 1280 px, bf16). Works out of the box with torch 2.8 cu128. Needed fixes: LayerDiff
   paints nose/mouth pale (copy source colours, as See-through's own `further_extr` does); it leaves
   stray alpha over the whole canvas, so every layer is clipped to a BiRefNet person matte.
3. **Fallback for semi-realistic faces**: BiRefNet matte + MediaPipe selfie-multiclass (hair / skin /
   clothes / accessories) + MediaPipe 478 face landmarks (eye contours, irises, lips, brows, oval) +
   big-LaMa for occluded areas (background, under the jaw, under bangs, sclera under the iris).
   Runs on CPU in ~60 s. On Ditto's painted sample it gives a convincing rig; MediaPipe even finds
   the anime face, but its eye contours are wrong there (See-through is the anime route).
4. **Mouth: parametric won** over generated frames for the runtime (see below).
5. **Eyelids**: a lid sheet that slides and stretches skin from above the eye (with a rigid lash
   band) beats squashing the eye: it reads as a real lid on the painted sample, closes fully, and
   needs no extra art.

## Dead ends and fixes (each measured or seen in a still)

- Lid sheet with lash band *above* the contour: on anime eyes the thick lash ended up stretched and
  the lid corners showed the lash wings unmoved. Fix: contour = top of the lash (See-through gives
  an eyelash layer), band = measured lash thickness; photo route raises the contour 0.15 h.
- Background mask from the union of LayerDiff layers: the whole canvas became "character" (topwear
  alpha > 0.5 on 69 % of pixels) and LaMa returned grey mush. Fix: BiRefNet matte.
- LaMa for the hair mass behind a face-sized hole: pale blur that showed as a skin-coloured band
  on a turn. Fix: push hair colour inward (multi-scale normalised blur), darkened x0.8.
- Body pixels beside the head (skin outside the landmark oval) stayed put while the face turned:
  a ghost cheek. Fix: nothing above the mouth line near the head belongs to the body.
- Hair hanging over the shoulders rotating rigidly with the head slid across the clothes. Fix:
  hair_back follows the head less below the chin (0.2 at one head radius below).
- Mouth open distance 0.36 x mouth width is right for drawn mouths, cartoonish on a painted face;
  photo route uses 0.20. Hole corners poked out of the lips until the hole was inset 5 % and its
  centre band tapered.
- Edge not found: `C:\Program Files (x86)\Microsoft\Edge` holds no `msedge.exe` on this machine; the
  capture uses Playwright's Chromium (same engine).
- uv: four tracks installing torch at once into the shared uv cache failed with `Access is denied
  (os error 5)` on the cache rename; retry from the cache succeeded.

## Mouth: parametric vs generated frames

Parametric (kept): lips split along the parting line into two layers, jaw/lip fields, a procedural
interior (throat, tongue, upper/lower teeth sized from the opening) drawn between them. Continuous
for every viseme blend, costs nothing at runtime, and keeps the portrait's own lips.
Generated frames (SDXL inpainting 0.1, `prep/mouth_frames_sdxl.py`, Ditto sample, ~4 s per frame on
the 4090) - dead end after two serious attempts: (1) strength 0.85, crop 3.2 x mouth width: all five
groups (aa, E, oh, ou, FF) came back with the mouth *closed*, lips re-drawn darker and smaller;
(2) strength 0.99, crop 2.2 x, larger jaw mask, "open mouth" in the prompt: at most a slight parting
with a few teeth on E, a pout on oh/ou, a visible yellow skin seam at the mask edge and a different
lip shape per frame (identity drift). Even good frames would need cross-fades between unrelated
images (ghosting) and give no continuous blend; the parametric mouth is continuous and keeps her lips.

## Host motion law (apps/desktop ADR 0089 / 0092)

- One loop: the rig never owns a loop in the host. `rig.render(t)` is a pure draw the host's single
  shared scheduler calls; `app.js`'s own rAF exists only for this standalone page and is cancelled
  on `visibilitychange` (hidden) and never started under `capture=1` or `calm=1`.
- Calm / paused: render one still frame (`calm=1`) and request none after it; resuming calls
  `rig.reset()` so springs restart from rest instead of jumping.
- Per-frame work is uniforms + ~15 draw calls; no allocation, no DOM, no React render. The canvas is
  a single compositor layer (transform/opacity-only in the host's terms).

## Licence table

| component | licence | commercial_ok |
|---|---|---|
| t1 runtime, motion generator, prep scripts (our code) | repo | true |
| See-through code | Apache-2.0 | true |
| See-through LayerDiff3D weights (finetune of Animagine XL 4.0; offline prep only) | OpenRAIL++-M | true (use restrictions apply) |
| BiRefNet (offline prep) | MIT | true |
| MediaPipe face landmarker + selfie multiclass (offline prep) | Apache-2.0 | true |
| big-LaMa torchscript (offline prep) | Apache-2.0 | true |
| SDXL inpainting 0.1 (mouth-frame experiment only) | OpenRAIL++-M | true (use restrictions apply) |
| Playwright Chromium, ffmpeg (bench tooling only) | Apache-2.0 / LGPL-GPL build | tooling, not shipped |

## Measurements

| what | value |
|---|---|
| See-through split, 1280 px, 30 steps, RTX 4090 | 192 s diffusion, 202 s total (incl. model load) |
| Fallback split, 1432 px, CPU (`T1_DEVICE=cpu`) | 58-86 s |
| Realtime, Chromium 156 1920x1080, headless, See-through smoke (20 layers) | fps p50 59.9 / p5 59.5, CPU 10.5 % of one core (0.7 % of 16), GPU process 138 MB, 3D engine 0.4 %, first frame 317 ms |
| Realtime, same, Ditto smoke (fallback, 15 layers, 1432 px), under the GPU lock | fps p50 59.9 / p5 59.9, CPU 8.6 % of one core, GPU process 156 MB, 3D engine 4.5 %, first frame 281 ms |
| SDXL-inpaint mouth frame (experiment) | ~4 s per frame, 1024 px, 30 steps |
| Deterministic capture 1920x1080 (PNG over CDP -> x264 crf 16) | ~17 frames/s (90 frames in 5.1 s) |

Realtime numbers are a desktop RTX 4090 with headless Chromium capped at 60 fps; a laptop iGPU is
not measured. The per-frame cost is ~15 textured draws of meshes <= 200x200 cells, no readback.

## Lessons (only what this run proved)

- When a 2D rig needs head turns from one image, warp every layer with one shared field (sphere
  projection + per-layer depth) rather than moving layers independently, because then layers can
  only separate by their depth difference and the hairline does not tear.
- When an occluded area is face-sized, fill it by pushing the surrounding colour inward instead of
  LaMa, because LaMa returns a pale average for large holes and it shows as a band on every turn.
- When splitting a portrait into layers, assign everything beside the head (above the mouth line)
  to head layers or the background, never to the body, because a static body layer then holds a
  stale copy of the cheek that appears as a ghost when the head turns.
- When animating blinks on a single portrait, slide and stretch the skin above the eye down with a
  rigid lash band instead of squashing the eye, because it needs no extra art and reads as a lid.
- When a mouth opens on a single portrait, split the lips at the parting line and draw a procedural
  interior between them, scaled per art style (0.36 x width for drawn mouths, 0.20 for painted
  faces), because a single open distance is cartoonish on one style or invisible on the other.
- When generating viseme mouth frames for one portrait with SDXL inpainting, expect closed or
  barely parted mouths, colour seams and per-frame identity drift, because the inpainting prior
  restores a closed resting mouth; a parametric lip split with a procedural interior is the
  better base for speech.
- When several builders install torch at once on Windows, give each its own uv cache or retry,
  because concurrent renames into the shared cache fail with os error 5.

## Notes for the Director

- Contract: RigParams has no breathing or body field; the runtime breathes on its own. If t4 wants
  to drive breathing, an optional `body: {"breath": 0..1}` group would be the addition (request, not
  implemented). No other contract change needed.
- `capture.mjs` uses Playwright's Chromium 156: the Edge folder on this machine has no `msedge.exe`.
- Incident: while untangling a stalled torch install I ran `taskkill /IM uv.exe` at ~22:20, which
  may have stopped other tracks' concurrent `uv` installs at that moment; a re-run of their install
  command recovers.
- Files outside the repo: `~/.athena-avatar/venvs/t1-rig`, `models/see-through` (git clone),
  `models/hf` (LayerDiff3D, BiRefNet, SDXL-inpainting fp16), `models/lama/big-lama.pt`,
  `models/mediapipe/*`, `t1-rig/params/` (exported procedural RigParams), smoke portraits
  `portraits/_smoke` (See-through sample crop), `_smokefb` (same, fallback route), `_smoke_ditto`
  (Ditto's example image), each with `t1-rig/layers/`.

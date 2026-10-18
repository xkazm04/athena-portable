# t2-neural - local, open, one-image, audio-driven talking heads

Question: how good does an open talking-head model get on this RTX 4090 (Windows 11, CUDA 12.8
wheels, Python 3.10 venvs), and does any of it run in realtime?

Status: **ready-for-portrait.** Three models (four variants) installed, smoke-tested on their repos' own sample
images + WP-L's `voice/calm.wav`, measured, and wired to one bench command each. No operator
portrait existed at the end of the run (`portraits/` held only `_smoke*` folders), so no bench
clip was rendered.

## What was tried, in order

1. Licence check first (table below), then a shortlist of 4: **SoulX-FlashHead** (2026, 1.3B,
   Lite + Pro), **Ditto** (Ant Group, motion-space diffusion on a LivePortrait renderer),
   **InfiniteTalk** (Wan2.1-14B + audio adapter; the offline quality ceiling), and MuseTalk
   (dropped: mouth-region-only inpainting needs a driving video for head motion - from one still
   it gives a talking mouth on a frozen head, below the other three on "natural movement").
   FLOAT (CC BY-NC-SA) and Sonic/Hallo3 were not taken: non-commercial or 10x slower than
   InfiniteTalk for no quality gain we could argue.
2. FlashHead Lite/Pro at 512 (native), then 768 (off-label resolution).
3. Ditto stock PyTorch path -> profiled -> patches in our runner, no repo edits
   (`--gpu-resident --compile`): warp->decode tensors stay on the GPU, torch.compile (inductor
   default) on the motion diffusion, warp net and decoder, and one throw-away warm pass.
4. InfiniteTalk fp8 single-GPU path (dead end, below), then bf16 + lightx2v 4-step LoRA with
   offload and our streaming bf16 loader - works.
5. MJPEG stream prototype (`mjpeg.py`) driven by FlashHead Lite in paced streaming mode.

## Results (smoke clips; 4.86 s `calm` unless noted; RTX 4090)

| model | native out | offline render (s per s of output) | paced streaming fps p50/p5 | first frame | lag vs audio p50/p95 | VRAM (torch reserved) |
|---|---|---|---|---|---|---|
| FlashHead **Lite** 512 | 512x512 | 0.25 (84 fps/chunk) | 87 / 82 per-chunk throughput (`long`) | 1.27 s | 0.79 / 1.22 s | 5.5 GB |
| FlashHead Lite 768 | 768x768 | 0.76 (stream mode, unpaced) | 41 / 41 | 0.57 s | - | 7.6 GB |
| FlashHead **Pro** 512 | 512x512 | ~2.5 (10.2 fps) | 10.2 / 10.1 - **not realtime** | 3.9 s | 6.7 / 10.2 s (grows) | 10.8 GB |
| FlashHead Pro 768 | 768x768 | 7.9 (3.7 fps) | - | - | - | 19.6 GB |
| Ditto stock (PyTorch) | **1920x1080** (face pasted back) | 1.73 | 15 / 11 - not realtime | 2.0 s | 4.0 / 5.7 s (grows) | 1.7 GB |
| Ditto **patched** (ours) | 1920x1080 | 0.94 (50-step offline config) | 26 / 21 (`long`, keeps up) | 1.11 s | 0.98 / 1.08 s (flat) | 1.6 GB |
| InfiniteTalk bf16 + lightx2v LoRA, 4 steps, offload | 896x448 (480p bucket, follows image aspect) | 168 (815 s wall incl. ~270 s load) | no | - | - | 17.9 GB device peak, ~55 GB RAM |

"Paced" = audio is fed at wall-clock speed as a TTS stream would arrive; a model keeps up when
its lag stays flat over the clip. FlashHead fps is per-chunk throughput (it emits 24/28 frames per
chunk); Ditto fps is a 1 s sliding window over frame emission. Ditto's paced output is capped by
the 25 fps input, so 26 p50 means "keeps up", not headroom; unpaced it does 30 fps mean.

Cold start: torch.compile caches make the first process slow (FlashHead Lite load 143 s + warm-up
257 s; Pro 182 + 431 s; 768 variants similar) and later ones fast (Lite 20 + 24 s, Pro 35 + 35 s,
Ditto 10 + 7 s). A live app has to keep the process warm.

## Quality notes (frames extracted and looked at)

- **FlashHead Pro 512**: best mouth of the three realtime-class runs - clear visemes (rounded
  "oo", open "ah", dark inner mouth), one natural blink in 4.9 s, gentle head tilt/sway that
  follows the phrase, identity solid, hair strands stable, no neck seam (whole frame is
  generated). Teeth are soft. 512 is the ceiling of detail: at 1080p it is a 2.1x upscale.
- **FlashHead Lite 512**: same motion character, softer and smaller mouth shapes, slightly mushy
  skin; good enough for a small avatar tile, visibly below Pro at full screen.
- **768 off-label**: both stay coherent (no tiling or identity drift) - Lite's mouth amplitude
  drops noticeably; Pro 768 keeps strong visemes with more skin/hair detail. Worth it offline.
- **Ditto**: native 1080p frame because only the face crop is re-rendered (512, warped back
  with a feathered mask) - background, hair ends and clothes are the untouched source pixels, so
  there is zero drift outside the face. Inside the crop, painterly texture is smoothed (on the
  oil-painting sample it reads as "photo face on a painted body"), teeth visible but blurred,
  lips track consonants well. No blink in 4.9 s, subtle head motion (pitch nods), no jitter.
  On a photoreal Leonardo portrait the texture mismatch should be much smaller - check on the
  real portrait.
- **InfiniteTalk** (lightx2v 4-step): the most natural *movement* of the set by a distance -
  real head turns, shoulder/torso motion, eyebrow and cheek expression, visible teeth and tongue,
  scene-consistent lighting. Costs: ~2.8 min per second of output, the whole frame is
  re-generated (background drifts slightly with the camera feel of the prompt), and the face is
  small in a 480p frame, so detail is soft; 720p bucket would need more VRAM/time (not run).
  Offline-only material (pre-rendered idle/greeting loops), never live.

## Recommendation (to confirm on the real portrait)

- **Live avatar: Ditto, patched** - the only one that is realtime *and* native 1080p (26 fps
  paced, ~1.0 s lag, 1.6 GB VRAM), with zero drift outside the face. Needs the InsightFace
  detector swapped before any commercial use. FlashHead Lite is the realtime alternative with
  livelier whole-head motion but 512-768 px and an unknown weights licence.
- **Pre-rendered clips: FlashHead Pro (768 off-label)** for crisp visemes at ~8 s per output
  second; InfiniteTalk when motion naturalness matters more than detail and 3 min per second is
  acceptable.
- Bench the 3 lines with `ditto` and `flashhead-pro` first; then `infinitetalk` if there is time.

## Streaming to a webview (note + prototype)

- **MJPEG over HTTP** (built, `mjpeg.py`, port 5182): a player thread releases frames at 25 fps
  from a queue, which turns FlashHead's 24-frame bursts into a steady clock (max queue depth 24,
  first frame shown 1.44 s after audio start, 287/288 frames shown on `long`). Webview needs only
  `<img src=http://127.0.0.1:5182/stream>`; audio plays from the page and starts on frame 0.
  Cost: JPEG encode ~3-5 ms per 512 frame on CPU; at 1080p (Ditto) prefer NVENC.
- **WebRTC** (aiortc / a Rust sidecar): right answer for lip-sync, because audio and video share
  one clock and jitter buffer; adds a signalling hop. Do it when the avatar leaves the prototype.
- **Shared memory** (Tauri app + local Python): zero-copy frames into a WebGL texture; lowest
  latency, most plumbing.
- Ditto fits a sprite approach: send only the 512 face crop + its affine (M_c2o) and composite on
  the GPU in the page over a static full-res portrait - 4x less to encode than 1080p frames.

## Licence table

| component | licence | commercial_ok |
|---|---|---|
| SoulX-FlashHead code | Apache-2.0 | yes |
| SoulX-FlashHead-1_3B weights | HF card `license: other`, no terms text published | **unknown** |
| LTX-Video VAE (FlashHead Lite) | LTX-Video model licence (OpenRAIL-style use limits) | unknown - read before shipping |
| Wan2.1 (VAE, architecture; InfiniteTalk base 14B, T5, CLIP) | Apache-2.0 | yes |
| facebook/wav2vec2-base-960h | Apache-2.0 | yes |
| Ditto code + weights | Apache-2.0 (repo and HF LICENSE) | yes |
| InsightFace det_10g / 2d106det (inside Ditto release) | non-commercial research only | **no** - swap for MediaPipe/BlazeFace (already in Ditto's TRT config) |
| MediaPipe face_landmarker | Apache-2.0 | yes |
| InfiniteTalk code + weights | Apache-2.0 | yes |
| TencentGameMate/chinese-wav2vec2-base | MIT | yes |
| lightx2v step/CFG-distill LoRA (rank 32, Kijai repack of lightx2v, Apache-2.0 upstream; Kijai repo states no licence) | Apache-2.0 upstream | yes (upstream) |
| Real-ESRGAN x2plus/x4plus (optional upscaler) + spandrel | BSD-3 / MIT | yes |
| triton-windows, flash-attn Windows wheel (kingbri1) | MIT / BSD-3 | yes |

## Reproduce

```
bash spikes/avatar/t2-neural/setup.sh                       # venvs + weights (no GPU)
python spikes/avatar/t2-neural/bench.py --model flashhead-lite --smoke   # install check
python spikes/avatar/t2-neural/bench.py --model flashhead-pro            # bench, every portrait
python spikes/avatar/t2-neural/bench.py --model ditto
python spikes/avatar/t2-neural/bench.py --model infinitetalk         # ~30 min per 10 s line
python spikes/avatar/t2-neural/bench.py --model flashhead-pro --extra "--size 768 768"   # 3.7 fps offline
python spikes/avatar/t2-neural/bench.py --model flashhead-pro --upscale 2              # + Real-ESRGAN
```

Each bench run: realtime probe (paced streaming on `long`, nothing encoded) then `calm`,
`question`, `long` offline renders, each composed to 1920x1080 (lanczos, blurred side fill, no
restorer) with audio, into `~/.athena-avatar/bench/t2-neural/<portrait>/<model>/<line>.mp4` +
`.metrics.json` (+ `.native.mp4`). `--promote` also copies to the contract path.

## Deviations from the contract (Director, please decide)

- `bench/t2-neural/<portrait>/<line>.mp4` holds one clip per line, but this track benches up to
  4 models. Runs land one level deeper (`.../<portrait>/<model>/`); `--promote` copies the chosen
  model's clips to the contract path. Proposal: allow `bench/<track>/<portrait>/<variant>/`.
- metrics `realtime.vram_mb` is torch's reserved peak for the process (device-wide deltas were
  polluted by model load timing).

## Dead ends

1. **Ditto stock PyTorch path is not realtime on this box**: paced 15 fps p50 / 11 p5, lag grows
   4.0 -> 5.7 s. Profile: the motion diffusion (LMDM) took 628 ms per call that yields 10 frames
   (eager, launch-bound: 522 ms for 10 DDIM steps in isolation). Fixed in our runner - see below.
2. LMDM fp16 autocast: slower (803 ms per call), dropped.
3. LMDM `torch.compile(mode="reduce-overhead")` (CUDA graphs): 42 ms isolated, but inside the DDIM
   loop "accessing tensor output of CUDAGraphs that has been overwritten by a subsequent run",
   with and without clone/mark_step - fell back to default inductor (134 ms isolated).
4. torch.compile first-called from the SDK's worker threads: deadlock (no frame after 10 min).
   Fixed by a full throw-away warm pass in the same threads.
5. `cudnn.benchmark=True`: peak VRAM 1.3 GB -> 17.7 GB with the compiled decoder, no fps gain.
6. InfiniteTalk fp8 (`--quant fp8`): optimum-quanto's Marlin fp8 kernel is a JIT CUDA extension
   with GCC inline asm (`identifier "__asm__" is undefined` under MSVC/nvcc 12.4) - cannot
   build on Windows. Routing around Marlin works but runs dequantised: without offload VRAM
   overflowed into shared memory (0 steps in 10 min at 112 W), with offload 117 s per step x 40
   steps x 3 CFG passes = ~2.6 h for 5 s. Abandoned for the LoRA path.
7. InfiniteTalk bf16 as shipped: the repo builds the 14B DiT in fp32 and merges 66 GB of fp32
   shards in RAM -> native crash 0xC0000005 on a 64 GB box. Fixed by bf16 construction +
   streaming shard load in our launcher.
8. transformers 5.x / diffusers 0.41 break InfiniteTalk (`output_attentions ... sdpa`,
   `resolve_revision`); pinned transformers 4.51.3, diffusers 0.34.0. flash-attn 2.8.3 rejected
   by diffusers (needs <= 2.8.0); 2.7.4.post1 wheel used.
9. Real-ESRGAN on FlashHead 512 output (x2plus 66 ms/frame, x4plus 237 ms/frame): crisper lashes
   and edges but waxy skin; plain lanczos looks more natural on skin. Kept as `--upscale`, off by
   default.
10. MuseTalk: not installed (see shortlist) - a still image gives no head motion.

## Lessons (proved in this run)

- When an audio-driven talking head is "not realtime", profile per stage before buying hardware,
  because here the bottleneck was a small diffusion transformer launch-bound in eager mode (10
  steps 522 ms eager -> 134 ms with torch.compile), not the renderer.
- When a pipeline runs stages in Python threads, warm compiled graphs with a full throw-away pass
  through those same threads, because a main-thread warm-up still left a 20 s first frame and a
  cold first call from two worker threads deadlocked.
- When measuring VRAM for a realtime renderer, leave cudnn.benchmark off unless it buys measured
  fps, because conv autotuning grew peak VRAM 13x (1.3 -> 17.7 GB) for nothing.
- When a model emits frames in chunks (24-28 at once), put a fixed-rate player with a queue
  between generator and display, because it turns bursts into a steady 25 fps clock; budget the
  latency as one chunk of audio (~1 s for FlashHead).
- When judging "realtime", feed audio at wall-clock pace and watch lag vs the audio clock, because
  throughput alone hid that stock Ditto's lag grew 4.0 -> 5.7 s over 5 s while the patched one
  stays flat at ~1.0 s.
- When the frame must be full-res but the model renders 512, prefer a face-crop + paste-back model
  (Ditto) for the live path, because everything outside the face stays pixel-exact at 1080p;
  whole-frame generators (FlashHead, InfiniteTalk) move hair/shoulders naturally but cap detail at
  their native resolution.
- When a Wan-family talking-head model is distilled for 512, it still holds identity at 768 and at
  non-square sizes (FlashHead Lite 768: 41 fps; 768x512: 65 fps), but mouth amplitude drops for
  Lite - check visemes, not just coherence, when going off-label.
- When a 14B video model must run on a 64 GB-RAM, 24 GB-VRAM Windows box, construct it in bf16
  and stream shards into it, because the stock fp32 build-and-merge needs > 120 GB RAM.

## Files

Repo (`spikes/avatar/t2-neural/`): `README.md`, `setup.sh`, `bench.py`, `common.py`,
`run_ditto.py`, `run_flashhead.py`, `run_infinitetalk.py`, `mjpeg.py`, `upscale.py`.
Outside the repo: `~/.athena-avatar/models/{ditto,flashhead,infinitetalk}/` (repos + weights,
~150 GB incl. the 14B bf16 shards; `models/realesrgan/` 128 MB), `~/.athena-avatar/venvs/t2-neural-{ditto,flashhead,infinitetalk}/`, smoke outputs in
`~/.athena-avatar/portraits/_smoke/t2-neural/<model>/` (repo sample images only).

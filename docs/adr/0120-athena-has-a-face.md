# 0120. Athena has a face: a light-being layer rig, moved by her voice and, where a GPU allows, by a motion model

Date: 2026-10-18

Builds on [0026](0026-athena-is-her-own-window-and-main-is-the-workhorse.md) (her window owns
her voice), [0027](0027-athena-is-ambient-a-halo-on-every-screen-and-the-summon-chord-held-is-push-to-talk.md)
(the five phases, the 30 Hz halo cap), [0089](0089-motion-is-transform-and-opacity-and-speed-is-a-gate-not-a-hope.md),
[0092](0092-the-voice-scene-has-one-frame-loop-and-reopens-a-finished-studio-on-arrival.md) and
[0094](0094-the-first-act-is-reshown-by-a-flag-and-calm-is-a-choice-in-look.md) (one loop, none
at rest, Calm is a choice).

## Context

Athena is drawn today as the halo, the Bell and the companion seal: light that pulses with her
phase and level, never a figure. The owner asked for a face that speaks with her voice on every
surface she appears on, without making a GPU or a cloud service a requirement (README law 5: no
provider is mandatory).

A spike (branch `worktree-spark-athena-avatar`, never merged; its code under `spikes/avatar/`)
benched three routes on one RTX 4090 against the same three Kokoro lines with exact viseme
timelines:

- **T1, a 2D layer rig.** The portrait is split once into layers and deformed per layer in a
  WebGL2 vertex shader; motion is procedural. Measured in headless Chromium on both forms: 59.9 fps
  at p50 and p5, 0.5-0.8 % of all CPU cores, about 130 MB of GPU memory, 1-1.2 % GPU, first frame
  226-258 ms.
- **T2, neural talking heads** (Ditto, FlashHead, InfiniteTalk). Ditto on the origami: 22 fps at
  p50, 1.6 GB of GPU memory, 57 % GPU, 2.4-3.1 s of lag streaming, a 34 s model load; the mouth
  slit was driven but small and smeared. Nothing worked on the owl: these models are trained on
  human faces and found none.
- **T4, hybrid.** JoyVASA (audio to motion, MIT) drives T1's rig: head drift, lids and nods from
  the audio, the mouth from the timeline. Playback costs what T1 costs (59.9 fps, 0.7 % CPU,
  130 MB); generating the motion costs about 1.3 GB of GPU memory in 4 s windows, about 0.6 s for a
  3.8 s sentence warm. Against T1's procedural motion it had about half the jerk and 4 of 5 nods
  on stressed syllables against 1 of 5.

Before the bench, the owner rejected human portraits ("lacks any creativity and style related to
the app's design ... realistic human body locks us") and chose two non-human forms made of light,
the fibre-optic owl (B04) and the origami crystal bust (D08). His verdict after the blinded bench:
"T4 seems to have superior movement without being GPU demanding. T1 fails to move with origami.
T2 seems to be comparable in origami but I don't like the resources usage. For Athena Portable I
would use T4."

## Decision

1. **Three forms, one setting.** `avatar` is `halo` (no face; today's look and the default),
   `b04-owl` or `d08-origami`. A rigged form ships in the app as its layers and a `layers.json`
   under `apps/desktop/public/avatars/<id>/` (about 1.6 MB each after a lossless recompress).
2. **The rig is T1's glow-being renderer, in the app.** `src/avatar/glow.ts` draws the layers in
   WebGL2: additive light layers, occluding solids, an analytic halo ring, bloom from the mip
   chain, head parallax by an orthographic sphere warp with per-layer depth, eye lights that close
   as an iris (owl) or dim as a facet (origami), the owl's seam and the ripple that runs along its
   fibre tips with her voice, the origami's hinged hex mouth with light in the slit, floating
   crest, shards and tufts, breathing.
   **She stands on the page, not in a box.** The canvas is transparent and premultiplied end to
   end: the art's black is the page. Each layer's light carries alpha equal to its brightest
   channel and is added, so her glow composites as light over the teal ground and over the light
   theme alike; a solid part first erases what is behind it by its coverage and then adds its own
   light (it hides the halo ring behind her head, never the page). The alpha is derived in the
   shader rather than baked into the PNGs, because the light layers need the same rule at run time
   and the art stays the spike's. The bodies were cut off at the bottom of both portraits, so the
   lower figure dissolves (by height, earlier toward the sides) into a ground line the renderer
   draws: a thin line of house cyan (#22d3ee core, #06b6d4 glow), a little wider than her base,
   tapering at both ends, with a soft bloom and a pool of light where she meets it. It breathes
   with her and brightens with her voice; under Calm it is still. Each form tunes it in its
   `layers.json` (`rig.ground`: y, half_width, fade, curve).
3. **Motion is layered.** `src/avatar/driver.ts` makes one pose a frame from the signal:
   procedural motion per phase (idle drifts and blinks, listening leans in and steadies, thinking
   slows and looks away with a soft pulse, speaking nods on stressed vowels, the gate holds still),
   at 0.7x on these forms as the spike ran it; speech opens the mouth from the current viseme
   scaled by the level, or from the level alone when no timeline exists; a neural motion track,
   when one covers the instant, takes the head, gaze and blinks over a 200 ms crossfade at 0.55x
   and hands them back the same way, while breathing and the floating parts stay procedural. The
   procedural layer is seeded and deterministic.
4. **One signal, mirrored.** The daemon sends `voice.visemes` before each sentence's audio and,
   when its face helper has a motion model, `voice.motion` for it (never after `voice.stopped`;
   without a helper neither is sent). The athena window turns them and her playback level into
   one `FaceSignal` a frame, draws her from it, and mirrors it to Main through `athena_face` at no
   more than 30 Hz; Main surfaces read `athena:face`. Previews in Main (the voice studio, Adopt)
   drive their face from the preview player's level.
5. **One loop, none at rest, still under Calm.** Every face in a window draws from the window's
   one frame clock. A face stops asking for frames when it has settled: idle or at the gate, silent,
   with no motion track, after a short linger it eases every motion to zero and holds its rest
   frame. It also stops while its canvas is out of view and while the document is hidden. Under
   Calm it is one still frame, eyes open, mouth shut. The renderer is a lazy chunk: `<Avatar>` in a
   window's first paint is an empty box and an `import()`; setup is cut into pieces so no one
   piece is a long task. The perf gate's `avatar` scene holds it.
6. **Fallbacks.** No WebGL2, or a form that fails to load: the face draws nothing, says why once in
   the console, and the surface shows what it shows today. A lost GPU context is waited out and
   rebuilt from the decoded pictures. No motion model: procedural motion. No viseme timeline:
   level-driven speech, which suits a seam or a hinge well.

## Alternatives rejected

- **Neural talking heads (T2).** A GPU-bound model per frame (1.6 GB, 57 % of a 4090, 22 fps), seconds
  of lag, and trained on human faces: it found no face on the owl.
- **Human portraits.** Rejected by the owner before the bench, for the design reason above; they
  also tie the look to a likeness the product would then have to own.
- **Procedural motion only.** Kept as the fallback, not the target: the owner judged the neural
  motion better, and the A/B numbers agree on smoothness and nods.
- **Generating your own form now.** Planned; it waits on automating the layer split and on access
  to image generation.

## Consequences

- The app carries about 3 MB of layer art. A third form is a folder and an id.
- The motion model runs in a separately configured Python env (the face helper, `face.python`);
  the daemon stays stdlib and talks to it over JSON lines. Without it nothing breaks.
- At rest a face costs nothing per frame; while she speaks it costs one WebGL2 draw per layer per
  frame (9 layers on the owl, 19 on the origami). The perf gate measured the origami speaking and
  settling at a 16.8 ms frame p95, one callback a frame, no long task, and no frame request in the
  quiet second after (Chrome 155 on Windows, 2026-10-18; the gate's default Edge was not installed).
- A window holds a WebGL2 context per visible face; Main shows at most one face at a time.

## Measured, 2026-10-18: her motion runs on a CPU, and turns itself on where it keeps up

"Where a GPU allows" turned out to be literal, by accident: JoyVASA's wrapper picks `cuda:0`
whenever MPS is absent, so on a machine without CUDA the helper's motion never loaded. The
follow-up spike, [`spikes/avatar-measure/README.md`](../../spikes/avatar-measure/README.md), timed
the shipped path on one machine (Ryzen 7 7800X3D, RTX 4090, Windows 11; the box was 92-100 % busy
with other work throughout, so its CPU figures lean pessimistic) and found the cost is a step
function of 4 s windows, so one warm window predicts every sentence. The share of her speech that
got neural motion in a 5-sentence line, Kokoro rendering live / rendering ahead:

| config | warm window, isolated | coverage, live / ahead |
|---|---|---|
| RTX 4090, 50 steps | 0.58 s | 82 / 96 % |
| CPU 4 threads, lean + 10 DDIM steps | 0.63 s (8 threads) | 80 / 96 % |
| CPU 16 threads, 50 steps | 1.32 s | 67 / 92 % |
| CPU 8 threads, 50 steps | 1.80 s | 44 / 77 % |
| CPU 4 threads, 50 steps | 2.64 s | 2 / 0 % |

A 10-step DDIM sampler over the model's own schedule (no retraining: it predicts the clean sample)
is 3.1x faster for a head error to the 50-step track of 0.66 deg, against 0.53 deg between two seeds
of the unchanged model, and some roll amplitude (0.66x). Not loading LivePortrait's renderer
modules saves 600 MB.

So the helper now:

- runs on CUDA when torch has it and on the CPU otherwise (`ATHENA_FACE_DEVICE` overrides it), loads
  only the motion generator, and leaves two logical cores to Kokoro;
- after its warm-up, times one window twice at 10, 25 and 50 steps, cheapest first, and keeps the
  **largest step count whose median window is at most 1.0 s**. Every configuration at or under
  that line covered at least 80 % of her speech live; the next one up covered 67 %, which reads as
  "sometimes neural, sometimes not", worse than consistent procedural motion. Nothing fits:
  motion is off and says why ("too slow here"), and the face keeps its visemes and procedural
  motion;
- reports the verdict (`motion_steps`, `motion_window_s`, `motion_device`, `motion_reason`) on the
  face's `engines` row of `GET /voice/config` (docs/daemon.md, "Her face on the socket").

The title's "where a GPU allows" now reads "where the machine keeps up". Not verified: a real 4-core
laptop (predicted to sit near the line, about 10 steps at 0.7-1.1 s), and how the 10-step motion
looks on the owl and origami next to the 50-step track.

## Measured, 2026-10-25: the producer owns the mouth, and a closure is held long enough to be seen

Her mouth was computed twice by two rules: the producer (`lib/face-signal.ts`) shaped `open` from
one copy of the viseme table with loudness normalised to `SPEECH_LEVEL` (0.7), and every face's
driver threw it away and re-derived the mouth from a second copy with the raw level and a 35 ms lag
(`aa` at level 0.5: 0.89 vs 0.79). Without a timeline the driver took the larger of its own level
knee and `open`, so breath at 0.15 opened a mouth the producer held shut. And the closures that make
speech read as speech never shut: the calm line's `PP` and `FF` last 40-50 ms, and the PP minimum on
Main's 30 Hz mirror was 0.08 / 0.10 / 0.31 (a scratch replica of the driver at 60 fps).

Decision 3's "speech opens the mouth" moves from the driver to the producer:

- **One table, one rule.** `VISEME_SHAPES` and `mouthTarget` live in `src/avatar/visemes.ts`;
  the producer, the preview face and the fixtures use them, and the second table is gone.
- **The driver follows.** With a viseme its target is `mouthTarget(viseme, level)`, the producer's
  rule on the signal it was sent; without one it is `open` as sent, floor included. The jaw opens
  over 35 ms and closes over the producer's 12 ms.
- **Closures carry a floor.** `face-timeline` holds each `PP` and `FF` for at least 60 ms when the
  sentence arrives, borrowing the time from its touching neighbours (each keeps one 60 Hz frame, a
  neighbouring closure its own floor), so the sentence keeps its ends, still tiles, and no sound is
  merged away.
- **A closure's first frame is news.** The mirror sends it at once, like a phase change, inside
  the 30 Hz cap (30.5 signals a second on the calm line, from 30.1).

After, on the calm fixture through the real producer and timeline: each of the 3 PPs holds at
<= 0.05 for two frames or more on Main's mirror; level-only breath at 0.15 keeps the mouth at 0.
Not reached: her window and Main agreeing within 0.05 at every segment's midpoint. Under the cap,
11 of 55 midpoints differ by more (max 0.118; before 10 of 55, max 0.126), every closure midpoint
agrees; the gap is a short vowel after a jump in level that the mirror sees a frame late. Sending
every shape change at once measured 1 of 55 at 32.7 signals a second, which loosens ADR 0027's
cap: left to the owner.

Decided 2026-10-25, owner-approved in triage: ADR 0027's amendment of that date raises the face
mirror's cap to 40 Hz and sends every shape change at once. All 55 midpoints now agree within
0.05, at 32.7 signals a second.

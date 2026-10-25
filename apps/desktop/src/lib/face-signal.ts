/**
 * Her face's one producer (ADR on Athena's face; ADR 0026, 0027, 0092).
 *
 * The `athena` window owns her voice, so it is the only place that knows what her face does. Each
 * frame while she listens or speaks, this file reduces the voice and run stores, the playback
 * level, the line's mouth timeline and its motion track to one `FaceSignal`; it hands every frame
 * to `localFaceSource` (her own window draws from it) and mirrors it to Main through `athenaFace`
 * at most `FACE_MIRROR_HZ` times a second. At rest it sends once per change and runs no loop.
 *
 * - **Phase** is the halo's (`haloPhase`, not a fork of it), with one addition: synthesis runs
 *   ahead of playback, so `voice.stopped` can arrive while the end of her line is still sounding.
 *   The face keeps `speaking` until the player has played that line's last sample, because a
 *   mouth that shuts while her voice goes on reads as a recording.
 * - **Viseme** is the segment covering the playback sample (`lib/voice.ts`'s `playbackSample`),
 *   looked up `VISEME_LEAD_S` ahead: the mouth leads the sound slightly, as a face does.
 * - **Open** follows the shape, scaled by the level; without a timeline, the level alone. This is
 *   the one mouth: every face's driver follows it rather than shaping its own (ADR 0120, Measured).
 * - **Motion** is the neural frame at that instant, interpolated, or `null`.
 *
 * The loop is the window's one frame clock (`lib/motion.ts`), not a loop of its own (ADR 0092),
 * and while the window is hidden the clock pauses, so a 34 ms timer stands in for it there: Main
 * still shows her speaking while her own window is out of sight.
 */
import type { FacePhase, FaceSignal } from "@/avatar/types";
import { CLOSURES, mouthTarget, smoothOpen } from "@/avatar/visemes";
import { FACE_MIRROR_HZ, athenaFace, publishLocalFace } from "@/lib/face";
import { FACE_LINE_SINK, clearLine, faceTimeline, motionAt, visemeAt, type FaceTimeline } from "@/lib/face-timeline";
import { LEVEL_FRAME_MS } from "@/lib/halo";
import { haloPhase } from "@/lib/halo-signal";
import { frames } from "@/lib/motion";
import { currentLevel, playbackSample, playbackSounding } from "@/lib/voice";
import { useRun, type RunPhase } from "@/stores/run";
import { setFaceLineSink, useVoice, type VoicePhase } from "@/stores/voice";

/** How far ahead of the sound the mouth shape is read: the spike's 35 ms. */
export const VISEME_LEAD_S = 0.035;

/** The mirror's period, and the slack a frame clock's jitter is allowed against it. */
export const MIRROR_PERIOD_MS = 1000 / FACE_MIRROR_HZ;
const MIRROR_JITTER_MS = 2;

/** What the producer reads from the stores. */
export interface FaceInputs {
  voice: VoicePhase;
  run: RunPhase;
  cards: number;
  /** The line playing, as the voice store says (`null` once its `voice.stopped` arrived). */
  generation: number | null;
}

export interface FaceDeps {
  inputs: () => FaceInputs;
  /** Called on every store change that might change a frame. Returns its unsubscribe. */
  subscribe: (onChange: () => void) => () => void;
  level: () => number;
  /** Samples of `generation` played so far, or `null`. */
  sample: (generation: number) => number | null;
  /** Is `generation` still sounding? */
  sounding: (generation: number) => boolean;
  timeline: () => FaceTimeline | null;
  /** Forget a finished line whose tail has played. */
  forget: (generation: number) => void;
  /** The frame loop: `fn` every frame until it returns `false` or the stop is called. */
  loop: (fn: (now: number) => boolean | void) => () => void;
  now: () => number;
  local: (signal: FaceSignal) => void;
  mirror: (signal: FaceSignal) => void;
}

const levelled = (phase: FacePhase) => phase === "listening" || phase === "speaking";
const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * The window's frame clock, or a 34 ms timer while the document is hidden (the clock pauses then).
 * One of the two at a time; `fn` returning `false` stops both.
 */
export function windowLoop(fn: (now: number) => boolean | void): () => void {
  if (typeof document === "undefined") {
    const timer = setInterval(() => fn(Date.now()) === false && clearInterval(timer), LEVEL_FRAME_MS);
    return () => clearInterval(timer);
  }
  let stopped = false;
  let off: (() => void) | null = null;
  const run = (now: number): boolean | void => {
    if (stopped) return false;
    if (fn(now) === false) {
      stop();
      return false;
    }
  };
  const attach = () => {
    off?.();
    if (document.hidden) {
      const timer = setInterval(() => run(performance.now()), LEVEL_FRAME_MS);
      off = () => clearInterval(timer);
    } else {
      off = frames().subscribe((time) => run(time));
    }
  };
  const onVisibility = () => {
    if (!stopped) attach();
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    off?.();
    off = null;
    document.removeEventListener("visibilitychange", onVisibility);
  };
  document.addEventListener("visibilitychange", onVisibility);
  attach();
  return stop;
}

/** The production wiring: the voice and run stores, the player, the timeline, `lib/face.ts`. */
export function liveFaceDeps(): FaceDeps {
  return {
    inputs: () => {
      const voice = useVoice.getState();
      const run = useRun.getState();
      return { voice: voice.phase, run: run.phase, cards: run.cards.length, generation: voice.generation };
    },
    subscribe: (onChange) => {
      const off = [useVoice.subscribe(onChange), useRun.subscribe(onChange)];
      return () => off.forEach((f) => f());
    },
    level: currentLevel,
    sample: playbackSample,
    sounding: playbackSounding,
    timeline: faceTimeline,
    forget: clearLine,
    loop: windowLoop,
    now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
    local: publishLocalFace,
    mirror: (signal) => void athenaFace(signal),
  };
}

let stopActive: (() => void) | null = null;

/**
 * Started by the `athena` window's root beside `startHalo`, and nothing else. Idempotent while
 * running; returns the stop, which the root's cleanup calls.
 */
export function startFace(deps: FaceDeps = liveFaceDeps()): () => void {
  if (stopActive) return stopActive;
  setFaceLineSink(FACE_LINE_SINK);

  /** The last line seen playing: its tail may still sound after the store has let it go. */
  let spoken: number | null = null;
  let open = 0;
  let lastAt: number | null = null;
  let lastPhase: FacePhase | null = null;
  let lastViseme: FaceSignal["viseme"] = null;
  let lastKey = "";
  let due = Number.NEGATIVE_INFINITY;
  let stopLoop: (() => void) | null = null;

  const phaseOf = (inputs: FaceInputs): FacePhase => {
    if (inputs.generation !== null) spoken = inputs.generation;
    const phase = haloPhase(inputs.voice, inputs.run, inputs.cards);
    if (phase !== "listening" && phase !== "speaking" && spoken !== null && deps.sounding(spoken)) return "speaking";
    return phase;
  };

  const build = (now: number): FaceSignal => {
    const inputs = deps.inputs();
    const phase = phaseOf(inputs);
    const generation = inputs.generation ?? spoken ?? 0;
    const level = levelled(phase) ? clamp01(deps.level()) : 0;
    let line = deps.timeline();
    if (line?.finished && !deps.sounding(line.generation)) {
      deps.forget(line.generation);
      line = null;
    }
    let viseme: FaceSignal["viseme"] = null;
    let motion: FaceSignal["motion"] = null;
    if (phase === "speaking" && line && line.generation === generation) {
      const sample = deps.sample(generation);
      if (sample !== null) {
        viseme = visemeAt(line, sample + Math.round(VISEME_LEAD_S * line.sampleRate));
        motion = motionAt(line, sample);
      }
    }
    open = phase === "speaking" ? smoothOpen(open, mouthTarget(viseme, level), lastAt === null ? 0 : now - lastAt) : 0;
    lastAt = levelled(phase) ? now : null;
    return {
      phase,
      level: r2(level),
      viseme,
      open: r3(open),
      motion: motion
        ? {
            yaw: r3(motion.yaw),
            pitch: r3(motion.pitch),
            roll: r3(motion.roll),
            blink: motion.blink === null ? null : r3(motion.blink),
            gazeX: r3(motion.gazeX),
            gazeY: r3(motion.gazeY),
          }
        : null,
      generation,
    };
  };

  /**
   * Mirror a frame: a phase change or a closure's first frame at once (a closure is shorter than two
   * mirror periods, so waiting for the cap can lose it), otherwise no faster than the cap; never
   * twice the same.
   */
  const mirror = (signal: FaceSignal, now: number) => {
    const onset = signal.viseme !== null && signal.viseme !== lastViseme && CLOSURES.has(signal.viseme);
    const changed = signal.phase !== lastPhase || onset;
    lastPhase = signal.phase;
    lastViseme = signal.viseme;
    const key = JSON.stringify(signal);
    if (key === lastKey) return;
    if (!changed && now < due - MIRROR_JITTER_MS) return;
    lastKey = key;
    // On schedule the next slot is one period on; a late or first frame restarts the schedule.
    due = !changed && now - due < MIRROR_PERIOD_MS ? Math.max(due + MIRROR_PERIOD_MS, now + MIRROR_PERIOD_MS / 2) : now + MIRROR_PERIOD_MS;
    deps.mirror(signal);
  };

  const frame = (now: number): FaceSignal => {
    const signal = build(now);
    deps.local(signal);
    mirror(signal, now);
    return signal;
  };

  const tick = (now: number): boolean | void => {
    const signal = frame(now);
    if (!levelled(signal.phase)) {
      stopLoop = null;
      return false;
    }
  };

  const onChange = () => {
    // While the loop runs, the next frame carries the change; at rest, it is sent now.
    if (stopLoop !== null) {
      const inputs = deps.inputs();
      if (levelled(phaseOf(inputs))) return;
      stopLoop();
      stopLoop = null;
    }
    const signal = frame(deps.now());
    if (levelled(signal.phase)) stopLoop = deps.loop(tick);
  };

  const unsubscribe = deps.subscribe(onChange);
  onChange();

  const stop = () => {
    unsubscribe();
    stopLoop?.();
    stopLoop = null;
    if (stopActive === stop) {
      stopActive = null;
      setFaceLineSink(null);
    }
  };
  stopActive = stop;
  return stop;
}

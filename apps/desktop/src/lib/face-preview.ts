/**
 * The mouth and the preview face (ADR on Athena's face).
 *
 * The mouth arithmetic is shared by the producer in the athena window (`lib/face-signal.ts`) and by
 * a preview face in Main. The preview face is what `previewFaceSource` in `lib/face.ts` loads on
 * first subscribe, in its own chunk: only the voice studio and Adopt play a preview, so Main's
 * first paint does not carry it.
 */
import { RESTING, type FaceSignal, type FaceSource, type Viseme } from "@/avatar/types";
import { hub } from "@/lib/face";
import type { FrameFn } from "@/lib/motion";

// -- the mouth ---------------------------------------------------------------------------------

/** How far each mouth shape opens the jaw, 0..1 (the spike's rig table, `web/src/visemes.js`). */
export const SHAPE_OPEN: Readonly<Record<Viseme, number>> = Object.freeze({
  sil: 0,
  PP: 0,
  FF: 0.12,
  TH: 0.2,
  DD: 0.28,
  kk: 0.33,
  CH: 0.26,
  SS: 0.14,
  nn: 0.2,
  RR: 0.24,
  aa: 0.9,
  E: 0.55,
  ih: 0.38,
  oh: 0.62,
  ou: 0.32,
});

/** Her speaking voice's usual level on `rms`'s scale: the loudness a shape opens to its table value at. */
export const SPEECH_LEVEL = 0.7;

/** Jaw inertia: opening follows in 22 ms (the spike's), closing faster so a closure reads. */
export const OPEN_TAU_MS = 22;
export const CLOSE_TAU_MS = 12;

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

/**
 * Where the mouth is heading: the shape's opening scaled by how loud she is (a stressed syllable
 * opens wider, a trailing one less), or, without a timeline, the level alone above a small floor,
 * so the breath between words closes it.
 */
export function mouthTarget(viseme: Viseme | null, level: number): number {
  const loud = Math.min(1.2, clamp01(level) / SPEECH_LEVEL);
  if (viseme !== null) return clamp01(SHAPE_OPEN[viseme] * (0.6 + 0.55 * loud));
  return clamp01((clamp01(level) - 0.2) / 0.6);
}

/** One step of the jaw toward `target` over `dtMs`. */
export function smoothOpen(previous: number, target: number, dtMs: number): number {
  if (!(dtMs > 0)) return previous;
  const tau = target < previous ? CLOSE_TAU_MS : OPEN_TAU_MS;
  return previous + (target - previous) * (1 - Math.exp(-Math.min(dtMs, 250) / tau));
}

// -- the preview face --------------------------------------------------------------------------

/** What a preview face reads; `watch`, when the player has it, says when playback starts or stops. */
export interface PreviewLike {
  level(): number;
  playing(): boolean;
  watch?(listener: () => void): () => void;
}

/** A frame loop: `fn` every frame until it returns `false` or the returned stop is called. */
export type FrameLoop = (fn: FrameFn) => () => void;

/** How often a player without `watch` is asked whether it started, while a face subscribes. */
export const PREVIEW_PROBE_MS = 250;

/**
 * The preview face, with its loop and its probe handed in (a test drives both). The loop runs only
 * while the player plays; when it stops, one idle signal is sent and the loop ends.
 */
export function createPreviewFaceSource(
  player: PreviewLike,
  loop: FrameLoop,
  every: (ms: number, f: () => void) => () => void = (ms, f) => {
    const timer = setInterval(f, ms);
    return () => clearInterval(timer);
  },
): FaceSource {
  const fan = hub();
  let stopLoop: (() => void) | null = null;
  let unwatch: (() => void) | null = null;
  let open = 0;

  const rest = (): FaceSignal => ({ ...RESTING });

  const tick: FrameFn = (_time, delta) => {
    if (!player.playing()) {
      stopLoop = null;
      open = 0;
      fan.publish(rest());
      return false;
    }
    const level = clamp01(player.level());
    open = smoothOpen(open, mouthTarget(null, level), delta);
    fan.publish({
      phase: "speaking",
      level: Math.round(level * 100) / 100,
      viseme: null,
      open: Math.round(open * 1000) / 1000,
      motion: null,
      generation: 0,
    });
  };

  const check = () => {
    if (player.playing() && stopLoop === null && fan.listeners.size > 0) stopLoop = loop(tick);
  };

  return {
    subscribe(listener) {
      const off = fan.add(listener);
      if (unwatch === null) unwatch = player.watch ? player.watch(check) : every(PREVIEW_PROBE_MS, check);
      check();
      return () => {
        off();
        if (fan.listeners.size > 0) return;
        unwatch?.();
        unwatch = null;
        stopLoop?.();
        stopLoop = null;
      };
    },
  };
}

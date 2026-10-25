/**
 * The mouth and the preview face (ADR on Athena's face).
 *
 * The mouth arithmetic is shared by the producer in the athena window (`lib/face-signal.ts`) and by
 * a preview face in Main. The preview face is what `previewFaceSource` in `lib/face.ts` loads on
 * first subscribe, in its own chunk: only the voice studio and Adopt play a preview, so Main's
 * first paint does not carry it.
 */
import { RESTING, type FaceSignal, type FaceSource } from "@/avatar/types";
import { mouthTarget, smoothOpen } from "@/avatar/visemes";
import { hub } from "@/lib/face";
import type { FrameFn } from "@/lib/motion";

// -- the mouth ---------------------------------------------------------------------------------

// The one mouth rule lives beside the one viseme table (`avatar/visemes.ts`); re-exported for the
// producer and the preview face, so no second table can drift from it.
export { CLOSE_TAU_MS, OPEN_TAU_MS, SPEECH_LEVEL, mouthTarget, smoothOpen } from "@/avatar/visemes";

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

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

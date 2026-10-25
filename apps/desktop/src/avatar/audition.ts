/**
 * The audition - a face speaks the calm sample line, silently, while a person chooses her form
 * (ADR 0120). The line is the preview harness's own scripted timeline (`fixtures.ts`), so the
 * mouth shapes are the real ones a spoken sentence gives.
 *
 * One audition at a time: playing a form ends the one before it with an idle signal. It runs on the
 * window's one frame clock and only between `play` and its end or `stop`; it never starts on its own
 * (a picker plays it on focus or the pointer), and under Calm it does not play at all - the face
 * stays its still rest frame. Each form has one source; a face subscribed to it hears the form's
 * last signal at once, a rest signal before any play.
 */
import { frames, systemPrefersReduced, type Clock } from "@/lib/motion";

import { CALM_DURATION, fixtureSignal } from "./fixtures";
import { RESTING, type FaceAvatarId, type FaceSignal, type FaceSource } from "./types";

export interface Audition {
  /** The form's source: what a face card's `<Avatar>` reads. Stable per form. */
  source(form: FaceAvatarId): FaceSource;
  /** Speak the sample line in `form` from its start, ending any other audition. Nothing under Calm. */
  play(form: FaceAvatarId): void;
  /** End the audition playing, if any, with one idle signal. */
  stop(): void;
}

/** Calm as the face runtime reads it: the root's `data-motion`, else the OS preference. */
function calmNow(): boolean {
  const mode = typeof document === "undefined" ? null : document.documentElement.getAttribute("data-motion");
  return mode ? mode === "calm" : systemPrefersReduced();
}

export function createAudition(opts: { clock?: () => Clock; calm?: () => boolean } = {}): Audition {
  const clock = opts.clock ?? frames;
  const calm = opts.calm ?? calmNow;
  const listeners = new Map<FaceAvatarId, Set<(signal: FaceSignal) => void>>();
  const last = new Map<FaceAvatarId, FaceSignal>();
  let playing: FaceAvatarId | null = null;
  let unsubscribe: (() => void) | null = null;

  const emit = (form: FaceAvatarId, signal: FaceSignal) => {
    last.set(form, signal);
    for (const l of listeners.get(form) ?? []) l(signal);
  };
  const idle = () => fixtureSignal("calm", CALM_DURATION, "idle");

  const stop = () => {
    const form = playing;
    if (form === null) return;
    playing = null;
    const u = unsubscribe;
    unsubscribe = null;
    u?.();
    emit(form, idle());
  };

  return {
    source(form) {
      return {
        subscribe(listener) {
          let set = listeners.get(form);
          if (!set) listeners.set(form, (set = new Set()));
          set.add(listener);
          listener(last.get(form) ?? RESTING);
          return () => void set.delete(listener);
        },
      };
    },
    play(form) {
      stop();
      if (calm()) return;
      playing = form;
      let t = 0;
      emit(form, fixtureSignal("calm", 0, "idle"));
      unsubscribe = clock().subscribe((_time, delta) => {
        if (playing !== form) return false;
        t += delta / 1000;
        if (t >= CALM_DURATION) {
          playing = null;
          unsubscribe = null;
          emit(form, idle());
          return false;
        }
        emit(form, fixtureSignal("calm", t, "idle"));
        return true;
      });
    },
    stop,
  };
}

/** The window's one audition: every picker in it shares it, so two faces never speak at once. */
export const audition: Audition = createAudition();

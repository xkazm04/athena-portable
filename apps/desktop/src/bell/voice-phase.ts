/**
 * The Bell's mirror of her voice — README section 3.1, ADR 0026, 0087 and 0222.
 *
 * Her window mirrors her face to Main on `athena:face`, up to 30 frames a second while she listens
 * or speaks (`lib/face.ts`). A face avatar needs every frame; a Bell needs only the phase. This
 * reduces the stream to the phase and says it on a change only, so neither the console nor the
 * surface re-renders per frame.
 *
 * The producer sends no rest frame when her window dies or reloads, so a phase that comes in a
 * stream (listening, speaking) lapses to `null` once `STALE_MS` passes without a frame: a closed
 * window cannot leave the Bell speaking forever. A rest phase is sent once per change and holds.
 *
 * It is first-frame code (both Bells read it), so it listens on `athena:face` itself, phase only,
 * through `lib/ipc`: `lib/face` and its validation are no part of Main's first paint (ADR 0095).
 */
import { useEffect, useState } from "react";

import type { FacePhase, FaceSignal } from "@/avatar/types";
import { hasShell, on } from "@/lib/ipc";

/** `lib/face.ts`'s `FACE_EVENT`, spelled here so the first frame does not carry `lib/face` (a test pins it). */
export const FACE_EVENT = "athena:face";

/** How long a streamed phase holds without a frame: some 45 mirrored frames. */
export const STALE_MS = 1500;

/** What a Bell reads of a face source: the phase of each signal, nothing else. */
export interface PhaseSource {
  subscribe(listener: (signal: Pick<FaceSignal, "phase"> | null) => void): () => void;
}

/** Follow `source`'s phase, telling `onPhase` of each change. Returns the stop. */
export function createVoicePhase(source: PhaseSource, onPhase: (phase: FacePhase | null) => void): () => void {
  let phase: FacePhase | null = null;
  let lapse: ReturnType<typeof setTimeout> | undefined;
  const set = (next: FacePhase | null) => {
    if (next !== phase) onPhase((phase = next));
  };
  const off = source.subscribe((signal) => {
    const next = signal?.phase ?? null;
    clearTimeout(lapse);
    set(next);
    if (next === "listening" || next === "speaking") lapse = setTimeout(set, STALE_MS, null);
  });
  return () => {
    clearTimeout(lapse);
    off();
  };
}

/**
 * The running app's mirror: `athena:face`, read for its phase alone. The frame's other fields are
 * the faces' to check (`mainFaceSource`); a phase that is neither listening nor speaking moves no
 * pose (`poseOf`), so a malformed one is at worst no news.
 */
const shell: PhaseSource = {
  subscribe(listener) {
    const off = on<Pick<FaceSignal, "phase"> | null>(FACE_EVENT, listener);
    return () => void off.then((f) => f());
  },
};

/** Her mirrored face phase, for a Bell: `null` until `athena:face` says one, and outside the shell. */
export function useVoicePhase(): FacePhase | null {
  const [phase, setPhase] = useState<FacePhase | null>(null);
  useEffect(() => (hasShell() ? createVoicePhase(shell, setPhase) : undefined), []);
  return phase;
}

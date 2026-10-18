/**
 * The face signal across windows. CONTRACT STUB: names and shapes are final.
 *
 * The athena window owns her voice, so it produces the `FaceSignal` and calls `athenaFace` (the
 * Rust command `athena_face`, at most 30 times a second while she listens or speaks, once on every
 * phase change otherwise); Rust re-emits it to Main as the `athena:face` event. Main surfaces read
 * it through `mainFaceSource()`. WP-4 adds the Rust command and capability; WP-3 fills these in.
 */
import type { FaceSignal, FaceSource } from "../avatar/types";

/** The Tauri event Main receives. */
export const FACE_EVENT = "athena:face";

/** The most frames per second the athena window mirrors (ADR 0027's halo cap). */
export const FACE_MIRROR_HZ = 30;

/** Mirror one signal to Main (athena window only). */
export async function athenaFace(signal: FaceSignal): Promise<void> {
  void signal;
}

/** Main's view of her face, fed by `athena:face`. */
export function mainFaceSource(): FaceSource {
  return { subscribe: () => () => {} };
}

/**
 * The athena window's own view of her face: the producer's signals, every frame, without the
 * 30 Hz cap (her companion window draws from this, not from the mirror).
 */
export function localFaceSource(): FaceSource {
  return { subscribe: () => () => {} };
}

/**
 * A face driven by a preview played inside Main (the voice studio, Adopt): `level` is polled from
 * the preview player's analyser while it plays, the phase is `speaking` while it plays and `idle`
 * otherwise. No visemes or motion in v1.
 */
export function previewFaceSource(player: { level(): number; playing(): boolean }): FaceSource {
  void player;
  return { subscribe: () => () => {} };
}

/**
 * Athena's face - the shapes every part of it agrees on (ADR on Athena's face).
 *
 * The daemon sends a sentence's mouth shapes (`voice.visemes`) and, when a motion model is set up,
 * its head and eye motion (`voice.motion`). The athena window, which owns her voice, turns those
 * and the playback level into one `FaceSignal` a frame, draws it in her own window, and mirrors it
 * to Main at most `FACE_MIRROR_HZ` (40) times a second (ADR 0027's face cap, `lib/face.ts`). Every surface that shows her renders an `<Avatar>` fed by a
 * `FaceSource`, so the face is the same wherever she appears.
 */

/** The forms she can take. `halo` means no face: the Bell and the seal stay as they are today. */
export const AVATAR_IDS = ["halo", "b04-owl", "d08-origami"] as const;
export type AvatarId = (typeof AVATAR_IDS)[number];

/** The rigged forms, i.e. every id that draws a face. */
export type FaceAvatarId = Exclude<AvatarId, "halo">;

/** The Oculus 15 mouth shapes the daemon's timeline uses. */
export const VISEMES = ["sil", "PP", "FF", "TH", "DD", "kk", "CH", "SS", "nn", "RR", "aa", "E", "ih", "oh", "ou"] as const;
export type Viseme = (typeof VISEMES)[number];

/**
 * One frame of rig motion (RigParams v1). Head in degrees (yaw right-positive, pitch down-positive,
 * roll clockwise-positive), blink 0 open .. 1 closed, gaze and brow -1..1, mouth open 0..1, viseme
 * weights 0..1 summing to at most 1. A channel nobody drives is omitted, never zero.
 */
export interface RigFrame {
  t: number;
  head?: { yaw?: number; pitch?: number; roll?: number };
  eyes?: { blinkL?: number; blinkR?: number; gazeX?: number; gazeY?: number };
  brow?: { raise?: number };
  mouth?: { open?: number; visemes?: Partial<Record<Viseme, number>> };
}

/** Her phase, the same five the halo shows (ADR 0027). */
export type FacePhase = "idle" | "listening" | "thinking" | "speaking" | "gate";

/**
 * Her head and eyes for one frame, from a motion track. Each channel is `null` when the track does
 * not drive it: "no say", so the face keeps its own motion there (procedural drift, saccades,
 * blinks). `null` is never rest: a track that sends gaze 0 centres her eyes on purpose.
 */
export interface FaceMotion {
  yaw: number | null;
  pitch: number | null;
  roll: number | null;
  blink: number | null;
  gazeX: number | null;
  gazeY: number | null;
}

/**
 * What a face shows this frame. Produced in the athena window, mirrored to Main.
 * `viseme` is the current mouth shape when a timeline exists, else `null` (drive from `level`);
 * `motion` is the neural head/eye pose when a motion track covers this instant, else `null`
 * (the avatar's own procedural motion applies). `generation` is the spoken line it belongs to.
 */
export interface FaceSignal {
  phase: FacePhase;
  level: number;
  viseme: Viseme | null;
  /**
   * The producer's mouth opening 0..1 (smoothed; closures dip). The producer is the one mouth
   * authority: with a viseme a face aims where the producer's rule (`visemes.ts` `mouthTarget`)
   * aims on `viseme` and `level`; without one it follows `open` as sent, floor included.
   */
  open: number;
  /** A channel is `null` when the motion track does not drive it: the face keeps its own motion there. */
  motion: FaceMotion | null;
  generation: number;
}

/** Where an `<Avatar>` reads its signal from: a subscription that hands it every new signal. */
export interface FaceSource {
  subscribe(listener: (signal: FaceSignal) => void): () => void;
}

/** A face at rest: what a surface shows before any signal arrives. */
export const RESTING: FaceSignal = Object.freeze({
  phase: "idle",
  level: 0,
  viseme: null,
  open: 0,
  motion: null,
  generation: 0,
}) as FaceSignal;

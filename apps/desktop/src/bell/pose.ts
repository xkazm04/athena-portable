/**
 * How Athena is carrying herself — README section 3.1 (surfaces), ADR 0026 and 0087.
 *
 * Main holds no run and no microphone (ADR 0026): it sees two mirrors her window reports. One is
 * `athena:status` (her form, how many cards wait, the one line she is on); the other is her face's
 * phase on `athena:face`, the signal every face avatar speaks from (`lib/face.ts`), reduced to its
 * phase by `./voice-phase.ts`. A pose is a function of exactly those and of nothing else, and only
 * the poses that can be told apart from them exist: a pose the data cannot back would be a
 * decoration pretending to be a status. Speaking is one since the face mirror says when her voice
 * is playing (ADR 0222).
 *
 * Precedence is the halo's, for the same reason: what the person must act on wins over what she
 * is doing, and what she is doing wins over rest. A waiting card still wins over her voice here;
 * whether the halo's order (her voice first) should reach the Bell is an open question.
 */
import type { FacePhase } from "@/avatar/types";
import { isResting } from "@/stores/athena";

export const POSES = ["resting", "working", "hearing", "asking", "speaking"] as const;

export type Pose = (typeof POSES)[number];

export interface PoseInput {
  /** Her form (`seal`, `tape`, `hear`, `slip`, ...), as `athena:status` reports it. */
  state: string;
  /** Cards waiting on the person. */
  cards: number;
  /** The one line a running turn is on, or empty. */
  line: string;
  /** Her face's phase as `athena:face` mirrors it (`./voice-phase.ts`), or nothing known. */
  voice?: FacePhase | null;
}

/**
 * A card waiting is asking; a held key or her mirrored listening is hearing; her voice playing is
 * speaking; any other work is working; the rest is rest.
 */
export function poseOf({ state, cards, line, voice }: PoseInput): Pose {
  if (cards > 0) return "asking";
  if (state === "hear" || voice === "listening") return "hearing";
  if (voice === "speaking") return "speaking";
  return isResting(state, line) ? "resting" : "working";
}

/** The words for a screen reader and the dock, one per pose. */
export const POSE_WORDS: Readonly<Record<Pose, string>> = {
  resting: "resting",
  working: "working",
  hearing: "listening",
  asking: "waiting on you",
  speaking: "speaking",
};

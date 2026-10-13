/**
 * How Athena is carrying herself — README section 3.1 (surfaces), ADR 0026 and 0087.
 *
 * Main holds no run and no microphone (ADR 0026): it sees the mirror her window reports, which is
 * her form, how many cards wait and the one line she is on. So a pose is a function of exactly
 * that and of nothing else, and only the poses that can be told apart from it exist. Speaking is
 * not one of them yet: the mirror does not say her voice is playing, and a pose the data cannot
 * back would be a decoration pretending to be a status.
 *
 * Precedence is the halo's, for the same reason: what the person must act on wins over what she
 * is doing, and what she is doing wins over rest.
 */
import { isResting } from "@/stores/athena";

export const POSES = ["resting", "working", "hearing", "asking"] as const;

export type Pose = (typeof POSES)[number];

export interface PoseInput {
  /** Her form (`seal`, `tape`, `hear`, `slip`, ...), as `athena:status` reports it. */
  state: string;
  /** Cards waiting on the person. */
  cards: number;
  /** The one line a running turn is on, or empty. */
  line: string;
}

/** A card waiting is asking; a held key is hearing; any other work is working; the rest is rest. */
export function poseOf({ state, cards, line }: PoseInput): Pose {
  if (cards > 0) return "asking";
  if (state === "hear") return "hearing";
  return isResting(state, line) ? "resting" : "working";
}

/** The words for a screen reader and the dock, one per pose. */
export const POSE_WORDS: Readonly<Record<Pose, string>> = {
  resting: "resting",
  working: "working",
  hearing: "listening",
  asking: "waiting on you",
};

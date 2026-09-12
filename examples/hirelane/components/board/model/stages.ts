/**
 * What a stage IS, beyond its name.
 *
 * Two facts about each of the five, and both are load-bearing. `STAGE_ROLE`
 * says what kind of place it is, which is what decides the one figure a column
 * prints. `STAGE_WAIT` says what a candidate standing in it is waiting for,
 * which is the sentence L1 opens with. A stage with neither is just a label,
 * and a label cannot tell a reader what to do next.
 */

import type { Stage } from "@/lib/constants";

/**
 * What a stage MEANS, independent of what it is called.
 *
 *   entry      — the application arrived; nobody has looked yet
 *   screening  — being read against the rubric
 *   interview  — a real look, with a person's time booked
 *   offer      — the decision is made and being made real
 *   closed     — the process ended here
 */
export type StageRole = "entry" | "screening" | "interview" | "offer" | "closed";

export const STAGE_ROLE: Record<Stage, StageRole> = {
  applied: "entry",
  screening: "screening",
  interview: "interview",
  offer: "offer",
  rejected: "closed",
};

/** What a candidate standing in this column is waiting for. */
export const STAGE_WAIT: Record<Stage, string> = {
  applied: "Waiting to be read. Nothing has been scored yet.",
  screening: "Being read against the rubric. This is where the arguable ones sit.",
  interview: "Has a real look booked, or is waiting for a slot.",
  offer: "Decided. What is left is the paperwork and the conversation.",
  rejected: "Closed. Kept so the decision has a record.",
};

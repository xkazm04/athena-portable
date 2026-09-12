/** The Strip's motion: springs for anything that moves in space, short fades for the rest. */
import type { Transition } from "motion/react";

export const settle: Transition = { type: "spring", stiffness: 380, damping: 34 };
export const stage: Transition = { type: "spring", stiffness: 220, damping: 28 };
export const fade: Transition = { duration: 0.18, ease: "easeOut" };

/** Reveal delay for a card on day `d`: falls in from the left, never more than ~0.9s late. */
export function revealDelay(day: number): number {
  return Math.min(day * 0.012, 0.9);
}

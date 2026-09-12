/**
 * The motion vocabulary of The Lanes. Three entries, used everywhere.
 *
 * Springs for anything that moves in space (a lane opening, a node becoming a
 * card) and a plain fade for anything that only appears. Nothing here loops:
 * this direction has no perpetual animation at all, because a thing that pulses
 * forever reads as "working", and Athena is not connected to this app.
 */
import type { Transition } from "motion/react";

/** A lane opening or closing: heavy, settles once, does not wobble. */
export const zoom: Transition = { type: "spring", stiffness: 210, damping: 30 };

/** A node becoming a card, and back. Slightly quicker than a lane. */
export const lift: Transition = { type: "spring", stiffness: 320, damping: 32 };

export const fade: Transition = { duration: 0.18, ease: "easeOut" };

/** Arrival stagger, capped so a 40-invoice lane does not take a second to land. */
export function revealDelay(index: number): number {
  return Math.min(index, 14) * 0.022;
}

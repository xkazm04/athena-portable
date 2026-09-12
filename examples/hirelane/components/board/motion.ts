/**
 * The motion vocabulary of The Board. Three gestures and no more, as the brief
 * declares: the zoom into a group, the throw when the filter changes, and the
 * lift from a carousel card into the dossier.
 *
 * Nothing here loops. This direction has no perpetual animation at all, because
 * a thing that pulses forever reads as work being done, and Athena is not
 * connected to this app.
 */
import type { Transition, TargetAndTransition } from "motion/react";

/** Anything settling into a new position: a re-flow, a level arriving. */
export const settle: Transition = { type: "spring", stiffness: 260, damping: 30 };

/** A card growing into the dossier, and back. Quicker than a re-flow. */
export const lift: Transition = { type: "spring", stiffness: 320, damping: 34 };

/** The zoom between levels. Heavy, settles once, does not wobble. */
export const zoom: Transition = { type: "spring", stiffness: 200, damping: 30 };

export const fade: Transition = { duration: 0.18, ease: "easeOut" };

/**
 * A candidate leaving because the filter no longer keeps them.
 *
 * The direction of the throw is derived from the id rather than randomised, so
 * the same filter change plays the same way twice — a filter that scatters
 * differently on every press reads as chaos, not as sorting. The card spins,
 * shrinks and drops, which is the shape of something being taken off a table.
 */
export function throwOut(id: string): TargetAndTransition {
  const hash = [...id].reduce((n, c) => n + c.charCodeAt(0), 0);
  const left = hash % 2 === 0;
  return {
    opacity: 0,
    scale: 0.55,
    x: left ? -70 : 70,
    y: 60,
    rotate: left ? -28 : 28,
    transition: { duration: 0.34, ease: "easeIn" },
  };
}

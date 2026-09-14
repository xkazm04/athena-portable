/**
 * The motion vocabulary of The Board — and the JS half of the token block.
 *
 * Three gestures and no more, as the brief declares: the zoom into a group, the
 * throw when the filter changes, and the lift from a carousel card into the
 * dossier. Nothing here loops. This direction has no perpetual animation at
 * all, because a thing that pulses forever reads as work being done, and Athena
 * is not connected to this app.
 *
 * WHY THE NUMBERS LIVE HERE AND NOWHERE ELSE (DESIGN-LAW §1, LAW ONE).
 *
 * §1 forbids typing a raw number, and until this pass the rule was enforced on
 * CSS only: `design/check-law.mjs` read stylesheets, so five hand-tuned spring
 * constants and two durations sat in this file for three rounds without a red
 * run. A duration is a scale value exactly as a spacing step is, and a motion
 * curve typed into a component is the same defect as a hex typed into one.
 *
 * So this module is to TypeScript what `style/base/tokens.css` is to CSS: the
 * ONE place a number may be written, and the checker exempts it by name for
 * that reason. `test/motion.test.ts` parses `design/hl-scales.css` and asserts
 * every step below is the value that file declares, so the two cannot drift —
 * the alias is checked rather than promised. `--bd-dur-*` in
 * `style/base/tokens.css` alias the same `--hl-*` steps, so a component that
 * animates in CSS and a component that animates in JS move at the same speeds.
 *
 * WHY DURATIONS AND NOT SPRINGS. A spring has no budget. The zoom is this
 * direction's signature and the round asks it to land inside 400ms, which is a
 * claim you can only make about a curve with an end. `stiffness: 200,
 * damping: 30` was a guess that settled somewhere near half a second and could
 * not be stated in the brief; `--hl-dur-3 + --hl-dur-1` is 350ms and can.
 */
import type { Transition, TargetAndTransition, Variants } from "motion/react";

/**
 * The duration scale (§1.3), in milliseconds. Mirrors `--hl-dur-1..6` in
 * `design/hl-scales.css`; `test/motion.test.ts` asserts it against that file.
 */
export const DUR = {
  1: 90,
  2: 160,
  3: 260,
  4: 420,
  5: 700,
  6: 1200,
} as const;

/** `--hl-stagger`. One list stagger in the scale, and this is it. */
export const STAGGER = 40;

type Bezier = [number, number, number, number];

/** The easing scale (§1.3). Mirrors `--hl-ease-*`, asserted by the same test. */
export const EASE: {
  standard: Bezier;
  entrance: Bezier;
  exit: Bezier;
  snap: Bezier;
} = {
  standard: [0.2, 0, 0, 1],
  entrance: [0.05, 0.7, 0.1, 1],
  exit: [0.3, 0, 0.8, 0.15],
  snap: [0.85, 0, 0.15, 1],
};

/** Milliseconds to the seconds `motion/react` takes. */
export const secs = (ms: number): number => ms / 1000;

/**
 * THE ZOOM'S BUDGET: `--hl-dur-3` plus `--hl-dur-1`, 350ms.
 *
 * Not `--hl-dur-4` (420ms), which is over the 400ms the round budgets for a
 * level change, and not `--hl-dur-3` alone, which is the entrance duration for
 * a panel rather than for a camera move across the whole surface. A sum of two
 * steps is still a scale value; a third literal would not be.
 */
export const ZOOM_MS = DUR[3] + DUR[1];

/** How far the outgoing board pushes past the reader, and how far the outgoing
 *  carousel falls back into the sheet. Ratios, not lengths. */
export const PUSH = 1.16;
export const PULL = 0.74;

/** The floor a receding group row scales to while the board leaves. Shallower
 *  than its fade on purpose: a row that shrinks as far as it dims reads as
 *  falling off the board rather than as standing further back on it. */
export const SHRINK = 0.94;

/** The scale a face arrives from when a filter lets it back onto the board. */
export const ARRIVE = 0.7;

/** The rise on a staged entrance: `--hl-space-2`, the one spacing step small
 *  enough to read as settling rather than as flying in. Not exported: nothing
 *  outside this file has business typing a distance into a transition. */
const RISE = 8;

/** The signature. One gesture, used once per level change, in both directions. */
export const zoom: Transition = { duration: secs(ZOOM_MS), ease: EASE.standard };

/** Anything settling into a new position: a re-flow, a card returning to its pose. */
export const settle: Transition = { duration: secs(DUR[3]), ease: EASE.standard };

/** A card growing into the dossier, and back. The box, not what is written on it. */
export const lift: Transition = { duration: secs(DUR[3]), ease: EASE.standard };

/** Entrance of new content that is not moving: the scrim, a panel's own ink. */
export const fade: Transition = { duration: secs(DUR[2]), ease: EASE.standard };

/** Removal — §1.3 gives it a shorter step and a different curve than entrance. */
export const leave: Transition = { duration: secs(DUR[2]), ease: EASE.exit };

/** The reduced-motion branch: land on the final state, never a faster animation
 *  (DESIGN-LAW §1.3, §9.16). */
export const instant: Transition = { duration: 0 };

/**
 * THE DOSSIER OPENS IN TWO BEATS, and the second one waits.
 *
 * The box morphs from the card (shared layout, `lift`) while the scrim darkens
 * beside it; only once the box has LANDED does what is written in it arrive.
 * The old sequence faded the whole pane in over 180ms while the box was still
 * travelling, so for about six frames the dossier's prose and the carousel card
 * under it were both legible through the scrim's blur — two texts overprinting,
 * which reads as a flash rather than as a thing growing.
 *
 * `delayChildren` is the box's own duration, so the two beats abut exactly.
 */
export const DOSSIER_SHELL: Variants = {
  hidden: {},
  shown: {
    transition: { delayChildren: secs(DUR[3]), staggerChildren: secs(STAGGER) },
  },
};

/** One region of the dossier, arriving after the box. */
export const DOSSIER_PART: Variants = {
  hidden: { opacity: 0, y: RISE },
  shown: { opacity: 1, y: 0, transition: fade },
};

/** The same two beats collapsed onto the final state, for `prefers-reduced-motion`. */
export const DOSSIER_STILL: Variants = {
  hidden: { opacity: 1, y: 0 },
  shown: { opacity: 1, y: 0 },
};

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
    scale: THROW.scale,
    x: left ? -THROW.x : THROW.x,
    y: THROW.y,
    rotate: left ? -THROW.spin : THROW.spin,
    transition: { duration: secs(DUR[3]), ease: EASE.exit },
  };
}

/** Where a thrown card lands. Off-table geometry, not a scale value — the only
 *  reason it is written here is that this file is where a number may be typed. */
const THROW = { scale: 0.55, x: 70, y: 60, spin: 28 };

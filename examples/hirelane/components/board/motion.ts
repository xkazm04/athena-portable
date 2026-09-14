"use client";

/**
 * The motion vocabulary of The Board — read out of the cascade, not declared here.
 *
 * Three gestures and no more, as the brief declares: the zoom into a group, the
 * throw when the filter changes, and the lift from a carousel card into the
 * dossier. Nothing here loops. This direction has no perpetual animation at
 * all, because a thing that pulses forever reads as work being done, and Athena
 * is not connected to this app.
 *
 * WHAT THE CONSOLIDATION ROUND CHANGED. This module used to BE the scale: a
 * `DUR` map and an `EASE` map typed in TypeScript, with `test/motion.test.ts`
 * parsing `design/hl-scales.css` to keep the two from drifting. That was the
 * best answer available while the reading was the app's own problem, and the
 * kit's note on `zoom/tokens.ts` is blunt about what it cost: three apps wrote
 * three parsers for `"260ms"`, and this one "gave up on reading the cascade and
 * declared the numbers in TypeScript with a test parsing the stylesheet to keep
 * the two in step".
 *
 * A test that keeps two copies honest is a worse answer than one copy. So the
 * numbers are gone: `useTokens` reads `--bd-dur-*` and `--bd-ease*` off the
 * cascade — the same declarations `style/base/tokens.css` hands the stylesheet —
 * and there is not a millisecond typed below. Formula §1 rule 4, with the kit
 * holding the reader.
 *
 * WHY DURATIONS AND NOT SPRINGS, unchanged. A spring has no budget. The zoom is
 * this direction's signature and the round asks it to land inside 400ms, which
 * is a claim you can only make about a curve with an end.
 *
 * WHAT IS STILL WRITTEN HERE. Geometry: how far the outgoing board pushes past
 * the reader, where a thrown card lands, how far a face arrives from. Those are
 * ratios and off-table distances rather than scale values, and `design/check-law.mjs`
 * exempts this file by name for exactly that reason.
 */
import { useMemo } from "react";
import type { Transition, TargetAndTransition, Variants } from "motion/react";
import { parseBezier, secs, useTokens } from "@athena/demo-kit/zoom";

/**
 * The tokens this direction animates with, named once.
 *
 * `--bd-dur-*` and `--bd-ease*` are aliases of the `--hl-*` scale in
 * `design/hl-scales.css` (§1.3); `--hl-stagger` is read directly because the scale
 * declares exactly one list stagger and the direction does not rename it.
 *
 * NOT `--bd-zoom`. It is a `calc()` of two steps, and a custom property that is not
 * registered with `@property` keeps its `calc(...)` through computed style — so it
 * reads as a string no duration parser can take. The sum is done here instead, off
 * the two steps it is a sum of, which is the same arithmetic the stylesheet does.
 */
const TOKENS = [
  "--bd-dur-1",
  "--bd-dur-2",
  "--bd-dur-3",
  "--bd-ease",
  "--bd-ease-out",
  "--hl-stagger",
] as const;

/** How far the outgoing board pushes past the reader, and how far the outgoing
 *  carousel falls back into the sheet. Ratios, not lengths. */
export const PUSH = 1.16;
export const PULL = 0.74;

/** The scale a face arrives from when a filter lets it back onto the board. */
export const ARRIVE = 0.7;

/** The rise on a staged entrance: `--hl-space-2`, the one spacing step small
 *  enough to read as settling rather than as flying in. Not exported: nothing
 *  outside this file has business typing a distance into a transition. */
const RISE = 8;

/** Where a thrown card lands. Off-table geometry, not a scale value — the only
 *  reason it is written here is that this file is where a number may be typed. */
const THROW = { scale: 0.55, x: 70, y: 60, spin: 28 };

/** The reduced-motion branch: land on the final state, never a faster animation
 *  (DESIGN-LAW §1.3, §9.16). A constant, because zero is not a scale value. */
export const instant: Transition = { duration: 0 };

export interface BoardMotion {
  /**
   * THE ZOOM'S BUDGET: `--bd-dur-3` plus `--bd-dur-1`, 350ms.
   *
   * Not `--bd-dur-4` (420ms), which is over the 400ms the round budgets for a level
   * change, and not `--bd-dur-3` alone, which is the entrance duration for a panel
   * rather than for a camera move across the whole surface. A sum of two steps is
   * still a scale value; a third literal would not be.
   */
  zoomMs: number;
  /**
   * HOW LONG THE ROW YOU CAME BACK TO STAYS LIT.
   *
   * Coming out of a group the board arrives whole, in one piece, and nothing on it
   * says which of its eight rows the reader was just inside — the echo is a picture
   * of the carousel, not of the row, and it is gone by 350ms. So the row keeps the
   * kit's `highlight` for the zoom plus one more step: lit while the echo is still
   * on screen, and held for `--bd-dur-3` after it clears so the eye has somewhere to
   * land in a frame where nothing else is moving.
   */
  landMs: number;
  /** The signature. One gesture, used once per level change, in both directions. */
  zoom: Transition;
  /** Anything settling into a new position: a re-flow, a card returning to its pose. */
  settle: Transition;
  /** A card growing into the dossier, and back. The box, not what is written on it. */
  lift: Transition;
  /** Entrance of new content that is not moving: the scrim, a panel's own ink. */
  fade: Transition;
  /** Removal — §1.3 gives it a shorter step and a different curve than entrance. */
  leave: Transition;
  /**
   * THE DOSSIER OPENS IN TWO BEATS, and the second one waits.
   *
   * The box morphs from the card (shared layout, `lift`) while the scrim darkens
   * beside it; only once the box has LANDED does what is written in it arrive. The
   * old sequence faded the whole pane in over 180ms while the box was still
   * travelling, so for about six frames the dossier's prose and the carousel card
   * under it were both legible through the scrim's blur — two texts overprinting,
   * which reads as a flash rather than as a thing growing.
   *
   * `delayChildren` is the box's own duration, so the two beats abut exactly.
   */
  dossierShell: Variants;
  /** One region of the dossier, arriving after the box. */
  dossierPart: Variants;
  /**
   * A candidate leaving because the filter no longer keeps them.
   *
   * The direction of the throw is derived from the id rather than randomised, so the
   * same filter change plays the same way twice — a filter that scatters differently
   * on every press reads as chaos, not as sorting. The card spins, shrinks and
   * drops, which is the shape of something being taken off a table.
   */
  throwOut: (id: string) => TargetAndTransition;
}

/** The same two beats collapsed onto the final state, for `prefers-reduced-motion`. */
export const DOSSIER_STILL: Variants = {
  hidden: { opacity: 1, y: 0 },
  shown: { opacity: 1, y: 0 },
};

/**
 * The direction's clock, read once per element per name set and memoised by the kit.
 *
 * Called by every component that animates rather than threaded down as props: the
 * read is cached in a `WeakMap` inside `useTokens`, so four call sites are one
 * `getComputedStyle`, and a transition that arrives as a prop is a transition some
 * intermediate component can quietly swap.
 *
 * `el` is the scope the tokens are declared on. The board declares them twice —
 * on its own wrapper and at document root when the direction is present
 * (`style/base/tokens.css`) — so the default, `document.documentElement`, answers.
 * Before there is a cascade to read (the server, the first paint of a scope that is
 * not mounted) every token answers 0, which is the final state, which is the branch
 * reduced motion takes and never a second set of numbers.
 */
export function useBoardMotion(el?: Element | null): BoardMotion {
  const t = useTokens(TOKENS, el);

  return useMemo(() => {
    const d1 = t["--bd-dur-1"].ms;
    const d2 = t["--bd-dur-2"].ms;
    const d3 = t["--bd-dur-3"].ms;
    const stagger = t["--hl-stagger"].ms;
    /* A named curve is a token, and motion takes it as the four numbers. `easeOut`
       is the answer only when there is no cascade to read — the server, or a scope
       that is not mounted — and in that case every duration above is 0 as well, so
       the curve is a formality on an animation that lands at frame zero. */
    const ease = parseBezier(t["--bd-ease"].ease) ?? "easeOut";
    const exit = parseBezier(t["--bd-ease-out"].ease) ?? "easeOut";

    const zoomMs = d3 + d1;
    const settle: Transition = { duration: secs(d3), ease };
    const fade: Transition = { duration: secs(d2), ease };

    return {
      zoomMs,
      landMs: zoomMs + d3,
      zoom: { duration: secs(zoomMs), ease },
      settle,
      lift: { duration: secs(d3), ease },
      fade,
      leave: { duration: secs(d2), ease: exit },
      dossierShell: {
        hidden: {},
        shown: { transition: { delayChildren: secs(d3), staggerChildren: secs(stagger) } },
      },
      dossierPart: {
        hidden: { opacity: 0, y: RISE },
        shown: { opacity: 1, y: 0, transition: fade },
      },
      throwOut: (id: string) => {
        const hash = [...id].reduce((n, c) => n + c.charCodeAt(0), 0);
        const left = hash % 2 === 0;
        return {
          opacity: 0,
          scale: THROW.scale,
          x: left ? -THROW.x : THROW.x,
          y: THROW.y,
          rotate: left ? -THROW.spin : THROW.spin,
          transition: { duration: secs(d3), ease: exit },
        };
      },
    };
  }, [t]);
}

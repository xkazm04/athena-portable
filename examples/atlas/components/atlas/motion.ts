"use client";

/**
 * The clock, read out of the cascade. Formula §1 rule 4, and there is not a millisecond typed
 * below this line.
 *
 * `components/atlas/style/base/tokens.css` is the authority for all four durations and both
 * easings; `design/check-tokens.mjs` fails lint on a raw `ms` anywhere else, including here. The
 * kit's `useTokens` reads them (SSR-safe: with no cascade every token answers `0`, which lands on
 * the final state — the same branch reduced motion takes, and never a second set of numbers).
 *
 * WHAT EACH ONE IS FOR, so a call site does not have to choose by feel:
 *
 *   hair   a rule changing weight under the pointer. CSS only; no JS reads it.
 *   ink    the SECOND beat of a staged move (rule 3: box, then ink).
 *   lens   vermilion arriving on the bands. CSS only; the bar's width transitions.
 *   move   the level change, and the only one with a budget (≤ 400 ms).
 *
 * A spring has no budget, so a level change cannot use one; every transition here is a duration.
 */
import { useMemo } from "react";
import { useReducedMotion, type Transition } from "motion/react";
import { parseBezier, secs, useTokens } from "@athena/demo-kit/zoom";

/** The token names this surface's motion is made of. The whole vocabulary. */
export const TOKENS = [
  "--at-dur-ink",
  "--at-dur-move",
  "--at-dur-beat",
  "--at-ease",
  "--at-ease-out",
] as const;

/** Reduced motion: the final state at frame zero, never a faster animation (rule 8). */
export const INSTANT: Transition = { duration: 0 };

/**
 * The beat's value when the cascade has not answered yet — during the server render, and on the
 * first client frame before `useTokens` has measured. It is read OUT of the token file by the
 * lint check rather than typed twice: `design/check-tokens.mjs` asserts it equals `--at-dur-beat`.
 */
export const FALLBACK_BEAT = 620;

export interface AtlasMotion {
  /** True when the reader has asked for reduced motion. The echo is not rendered at all then. */
  reduced: boolean;
  /** The level change. */
  move: Transition;
  /** Ink arriving after its box has landed — delayed by a whole `move`. */
  inkIn: Transition;
  /** Ink leaving. Not delayed: it goes first, which is the other half of rule 3. */
  inkOut: Transition;
  /** The duration of `move`, in seconds, for a call site that needs to stagger by hand. */
  moveSecs: number;
  /** The same, in milliseconds, for the camera rig — the contract takes `ms`, not a `Transition`. */
  moveMs: number;
  /**
   * WHAT ONE BEAT OF THE TURN COSTS.
   *
   * The turn is scored in beats (`scene/beats.ts`) and this is the only place a beat becomes a
   * duration. It is deliberately NOT zeroed under reduced motion: the turn is content — twelve
   * stops that together are README §3.2 — and a reader who asked for no motion should get the
   * stops as stills on the same clock, not an empty machine. The transport takes the reduced
   * branch by snapping between stops instead of interpolating.
   */
  beatMs: number;
}

export function useAtlasMotion(): AtlasMotion {
  const reduced = useReducedMotion() === true;
  /* The tokens live on `<html data-variant="plate">`, so the document element answers them. */
  const t = useTokens(TOKENS);

  return useMemo<AtlasMotion>(() => {
    const ease = parseBezier(t["--at-ease"].ease) ?? "easeOut";
    const easeOut = parseBezier(t["--at-ease-out"].ease) ?? ease;
    const moveMs = t["--at-dur-move"].ms;
    const moveSecs = secs(moveMs);
    const inkSecs = secs(t["--at-dur-ink"].ms);
    /* A token that never resolved reads as zero (SSR, or a name nobody declared), and a turn on a
       zero clock is a turn nobody can watch. The floor is the token's own declared value, so it
       is still not a millisecond typed here. */
    const beatMs = t["--at-dur-beat"].ms || FALLBACK_BEAT;
    if (reduced) {
      return {
        reduced,
        move: INSTANT,
        inkIn: INSTANT,
        inkOut: INSTANT,
        moveSecs: 0,
        moveMs: 0,
        beatMs,
      };
    }
    return {
      reduced,
      move: { duration: moveSecs, ease },
      inkIn: { duration: inkSecs, ease: easeOut, delay: moveSecs },
      inkOut: { duration: inkSecs, ease },
      moveSecs,
      moveMs,
      beatMs,
    };
  }, [reduced, t]);
}

/*
 * THE SHARED IDS ARE GONE, and their absence is a round-3 finding rather than an omission.
 *
 * Round 2 had two: the band at L0 became the head at L1, and the component row at L1 became the
 * pane at L2. Both were `layoutId` morphs and both were correct for a surface made of rectangles
 * laid out by the document. In a scene, the thing a pane grows out of is a face of a box carrying
 * a `matrix3d`, and `getBoundingClientRect` on it returns the axis-aligned box of a projected
 * quadrilateral — a rectangle the reader can see is not where the part is. So rule 2 has nothing
 * to claim here, and L2 grows from a PROJECTED POINT instead (`machine/Pane.tsx`). Logged in
 * KIT-GAPS round 3: the formula's shared-identity rule assumes a 2D layout and says so nowhere.
 */

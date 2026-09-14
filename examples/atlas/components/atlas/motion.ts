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
export const TOKENS = ["--at-dur-ink", "--at-dur-move", "--at-ease", "--at-ease-out"] as const;

/** Reduced motion: the final state at frame zero, never a faster animation (rule 8). */
export const INSTANT: Transition = { duration: 0 };

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
}

export function useAtlasMotion(): AtlasMotion {
  const reduced = useReducedMotion() === true;
  /* The tokens live on `<html data-variant="plate">`, so the document element answers them. */
  const t = useTokens(TOKENS);

  return useMemo<AtlasMotion>(() => {
    const ease = parseBezier(t["--at-ease"].ease) ?? "easeOut";
    const easeOut = parseBezier(t["--at-ease-out"].ease) ?? ease;
    const moveSecs = secs(t["--at-dur-move"].ms);
    const inkSecs = secs(t["--at-dur-ink"].ms);
    if (reduced) {
      return { reduced, move: INSTANT, inkIn: INSTANT, inkOut: INSTANT, moveSecs: 0 };
    }
    return {
      reduced,
      move: { duration: moveSecs, ease },
      inkIn: { duration: inkSecs, ease: easeOut, delay: moveSecs },
      inkOut: { duration: inkSecs, ease },
      moveSecs,
    };
  }, [reduced, t]);
}

/* --------------------------------------------------------------------------------------
 * The shared ids. Two of them, and both are declared here rather than at their call sites,
 * because rule 2 is "ONE claimant per id" and two files inventing the same template string is
 * exactly how a second claimant appears.
 * ------------------------------------------------------------------------------------ */

/** The band at L0 becomes the head at L1. */
export const bandId = (layer: string): string => `band-${layer}`;

/** The component row at L1 becomes the pane at L2. */
export const partId = (component: string): string => `part-${component}`;

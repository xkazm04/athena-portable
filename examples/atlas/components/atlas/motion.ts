"use client";

/**
 * The clock, read out of the cascade. Formula §1 rule 4, and there is not a millisecond typed
 * below this line.
 *
 * `components/atlas/style/base/tokens.css` is the authority for all five durations and both
 * easings; `design/check-tokens.mjs` fails lint on a raw `ms` anywhere else, including here. The
 * kit's `useTokens` reads them (SSR-safe: with no cascade every token answers `0`, which lands on
 * the final state — the same branch reduced motion takes, and never a second set of numbers).
 *
 * WHAT EACH ONE IS FOR, so a call site does not have to choose by feel:
 *
 *   hair   a rule changing weight under the pointer. CSS only; no JS reads it.
 *   ink    the SECOND beat of a staged move (rule 3: box, then ink).
 *   lens   the accent spreading through the drawing. CSS only.
 *   move   the level change, and the camera's flight to a focus. The one with a budget.
 *   view   THE SIGNATURE MOTION: the same blocks travelling to a new arrangement.
 *
 * `--at-dur-view` is longer than `--at-dur-move` and that is deliberate. A level change is a move
 * the reader asked for toward one thing, and the rubric gives it 400 ms; a view switch is
 * nineteen blocks each going somewhere different, and a reader has to be able to FOLLOW a block
 * they were looking at to where it ended up. It is not a level change, so it does not spend the
 * level change's budget — and it is CSS on `transform` only, so it is interruptible by the next
 * switch at any point and lands on the final state under reduced motion.
 *
 * ROUND 3'S BEAT IS GONE. The turn was a light on a clock; it is now twelve stops a reader steps
 * through, so there is no duration to own and no "content, not a transition" exception to argue.
 */
import { useMemo } from "react";
import { useReducedMotion, type Transition } from "motion/react";
import { parseBezier, secs, useTokens } from "@athena/demo-kit/zoom";

/** The token names this surface's motion is made of. The whole vocabulary. */
export const TOKENS = [
  "--at-dur-ink",
  "--at-dur-move",
  "--at-dur-view",
  "--at-ease",
  "--at-ease-out",
] as const;

/** Reduced motion: the final state at frame zero, never a faster animation (rule 8). */
export const INSTANT: Transition = { duration: 0 };

export interface AtlasMotion {
  /** True when the reader has asked for reduced motion. */
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
  /* The tokens live on `<html data-variant="blueprint">`, so the document element answers them. */
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

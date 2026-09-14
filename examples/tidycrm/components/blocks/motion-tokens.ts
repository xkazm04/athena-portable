"use client";

/**
 * The direction's motion tokens, for the one thing CSS cannot animate.
 *
 * WHY THIS EXISTS. `motion`'s shared-layout morph (the cell growing into the
 * dossier) is the one move on this sheet that a stylesheet cannot express: it
 * measures two boxes in two different stacking contexts and interpolates between
 * them in script. Everything else here is a CSS transition off a `--bk-*` token,
 * and the app's law is that there are no raw durations or easings anywhere. So
 * rather than typing `0.42` into a component — a second copy of `--bk-dur-4`,
 * with nothing to keep the two in step — the numbers are read OUT of the
 * cascade and handed to `MotionConfig`.
 *
 * THE READER IS THE KIT'S NOW (formula §1 rule 4). This module used to carry its
 * own duration and bezier regexes, its own seconds conversion and its own
 * `useSyncExternalStore` cache — one of three such readers in the repo, which is
 * three places for `"0.26s"` to be mishandled. `@athena/demo-kit/zoom` ships the
 * parsing (`cssMs`, `cssEase`, `parseBezier`, `secs`) and the memoised read
 * (`useTokens`), all pinned under `node --test` there. What is left here is the
 * only part that is this direction's: WHICH four tokens the morph is made of,
 * and the one derived delay under them.
 *
 * THE SCOPE. The tokens are declared on `[data-variant="blocks"]`, which is not
 * the document element, so the read has to be pointed at the direction's own
 * wrapper. `useTokens` answers its documented default — an empty raw value, and
 * therefore `null` here — for the server render and for the first client render,
 * before that wrapper exists. That is correct rather than unfortunate: nothing
 * that uses these can be mid-move during either, because every move on this
 * sheet starts from an interaction.
 */
import { parseBezier, secs, useTokens, type TokenValue } from "@athena/demo-kit/zoom";

/** A cubic-bezier as `motion` wants it. */
export type Ease = [number, number, number, number];

export interface Transition {
  duration: number;
  ease: Ease;
  delay?: number;
}

export interface MotionTokens {
  /** `--bk-dur-2` — press feedback. */
  quick: Transition;
  /** `--bk-dur-3` — a fade that has to be noticed. */
  medium: Transition;
  /**
   * `--bk-dur-4` — the morph itself. The one duration on the sheet long enough
   * to be FOLLOWED (DESIGN §8): the cluster and the name have to be watchable
   * travelling out of the cell, or the dossier is a cut with extra machinery.
   */
  morph: Transition;
  /**
   * The body, behind the box. It arrives after the card has landed rather than
   * with it, so what the reader watches is one object growing and then filling,
   * not a whole page fading up.
   */
  body: Transition;
}

/** The four values the morph is made of. Named once, read once. */
export const MOTION_TOKENS = ["--bk-dur-2", "--bk-dur-3", "--bk-dur-4", "--bk-ease"] as const;

/**
 * The direction's wrapper, which is the scope the tokens are declared on.
 *
 * Looked up on every render rather than captured, because it does not exist on
 * the first one: a stale `null` handed to `useTokens` would make it read the
 * document element forever, where these tokens are not declared.
 */
function scope(): Element | null {
  if (typeof document === "undefined") return null;
  return document.querySelector('[data-variant="blocks"]');
}

/**
 * The four tokens as `motion` transitions, or `null` when the cascade does not
 * carry them.
 *
 * Null rather than a guessed number: a fallback constant here would be exactly
 * the duplicated value this module exists to avoid. Pure over the kit's token
 * record, and exported, so the direction's own decision can be pinned without a
 * browser — the parsing underneath it is the kit's and is pinned there.
 */
export function motionFrom(
  t: { readonly [K in (typeof MOTION_TOKENS)[number]]: TokenValue },
): MotionTokens | null {
  const ease = parseBezier(t["--bk-ease"].ease);
  const quick = t["--bk-dur-2"].ms;
  const medium = t["--bk-dur-3"].ms;
  const morph = t["--bk-dur-4"].ms;
  if (!ease || quick === 0 || medium === 0 || morph === 0) return null;
  return {
    quick: { duration: secs(quick), ease },
    medium: { duration: secs(medium), ease },
    morph: { duration: secs(morph), ease },
    // Held until the box has all but landed. `--bk-dur-4` minus `--bk-dur-2` is
    // not arithmetic for its own sake: it is "one press-feedback before the
    // travel ends", which is what makes the fill read as belonging to the move
    // rather than following it.
    body: { duration: secs(medium), ease, delay: secs(Math.max(0, morph - quick)) },
  };
}

/** The tokens as this direction's wrapper declares them, read once and memoised. */
export function useMotionTokens(): MotionTokens | null {
  return motionFrom(useTokens(MOTION_TOKENS, scope()));
}

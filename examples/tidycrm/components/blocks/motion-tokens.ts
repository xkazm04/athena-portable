"use client";

/**
 * The direction's motion tokens, read once, for the things CSS cannot animate.
 *
 * WHY THIS EXISTS. `motion`'s shared-layout morph (the cell growing into the
 * dossier) is the one move on this sheet that a stylesheet cannot express: it
 * measures two boxes in two different stacking contexts and interpolates between
 * them in script. Everything else here is a CSS transition off a `--bk-*` token,
 * and the app's law is that there are no raw durations or easings anywhere. So
 * rather than typing `0.42` into a component — a second copy of `--bk-dur-4`,
 * with nothing to keep the two in step — the numbers are read OUT of the
 * cascade, from the direction's own wrapper, and handed to `MotionConfig`.
 *
 * ONCE. `getComputedStyle` is a layout read and these values cannot change while
 * the page is up (the tokens are static, and the reduced-motion preference is
 * `MotionConfig`'s own business through `reducedMotion="user"`), so the answer is
 * cached for the life of the document.
 *
 * The default until the wrapper exists is `null`, not a guessed number: on the
 * first render there is nothing on screen to morph, and a fallback constant here
 * would be exactly the duplicated value the module exists to avoid.
 */
import { useSyncExternalStore } from "react";

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

const DURATION = /^([\d.]+)(ms|s)$/;
const BEZIER = /^cubic-bezier\(([^)]+)\)$/;

/** A `--bk-dur-*` value in seconds, which is the unit `motion` counts in. */
function seconds(value: string): number | null {
  const m = DURATION.exec(value.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return m[2] === "s" ? n : n / 1000;
}

/** A `--bk-ease*` value as four numbers. */
function bezier(value: string): Ease | null {
  const m = BEZIER.exec(value.trim());
  if (!m) return null;
  const parts = m[1]!.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p))) return null;
  return parts as Ease;
}

/**
 * Read the tokens off an element inside the direction.
 *
 * Exported for the test, which runs it against a stub rather than a browser: the
 * parsing is the part that can be wrong, and it does not need a DOM to be wrong
 * in.
 */
export function readMotionTokens(style: { getPropertyValue: (p: string) => string }): MotionTokens | null {
  const quick = seconds(style.getPropertyValue("--bk-dur-2"));
  const medium = seconds(style.getPropertyValue("--bk-dur-3"));
  const morph = seconds(style.getPropertyValue("--bk-dur-4"));
  const ease = bezier(style.getPropertyValue("--bk-ease"));
  if (quick === null || medium === null || morph === null || ease === null) return null;
  return {
    quick: { duration: quick, ease },
    medium: { duration: medium, ease },
    morph: { duration: morph, ease },
    // Held until the box has all but landed. `--bk-dur-4` minus `--bk-dur-2` is
    // not arithmetic for its own sake: it is "one press-feedback before the
    // travel ends", which is what makes the fill read as belonging to the move
    // rather than following it.
    body: { duration: medium, ease, delay: Math.max(0, morph - quick) },
  };
}

let cache: MotionTokens | null = null;

function read(): MotionTokens | null {
  if (cache) return cache;
  if (typeof document === "undefined") return null;
  const root = document.querySelector<HTMLElement>('[data-variant="blocks"]');
  if (!root) return null;
  cache = readMotionTokens(getComputedStyle(root));
  return cache;
}

/** The cascade does not change under us, so there is nothing to subscribe to. */
function subscribe(): () => void {
  return () => {};
}

function absent(): null {
  return null;
}

/**
 * The tokens, or `null` until the direction's wrapper is on the page.
 *
 * Read as the external state it is, for the reason `cube/Turntable.tsx` gives
 * about the reduced-motion query: an effect that mirrors the platform into
 * component state is a setState inside an effect and a second render behind the
 * first. `useSyncExternalStore` re-reads the snapshot once the tree is mounted —
 * by which time the wrapper the values are scoped to exists — and the cache
 * makes that read return the same object every time, so it settles after exactly
 * one change.
 *
 * Null for the server render and the first client render. Nothing that uses
 * these can be mid-move during either, because every move on this sheet starts
 * from an interaction.
 */
export function useMotionTokens(): MotionTokens | null {
  return useSyncExternalStore(subscribe, read, absent);
}

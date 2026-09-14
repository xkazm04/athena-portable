/**
 * The motion vocabulary of The Lanes.
 *
 * Springs for anything that moves in space (a node becoming a card) and a
 * tokenised tween for the level change itself. Nothing here loops: this
 * direction has no perpetual animation at all, because a thing that pulses
 * forever reads as "working", and Athena is not connected to this app.
 *
 * THE DURATIONS ARE NOT WRITTEN HERE. `--ln-dur-*`, `--ln-ease*` and the
 * stagger step are declared once, in `style/base/tokens.css`, and read back off
 * the live root. A duration therefore has exactly one spelling in the whole
 * direction and the stylesheet and the TypeScript cannot drift apart — which is
 * what the raw `700` this file used to sit beside was a symptom of. Springs stay
 * in TS because a spring has no CSS spelling.
 */
import type { Transition } from "motion/react";

/** The element the tokens are declared on. */
const ROOT = '[data-variant="lanes"]';

/** Token values are static for the life of the page, so one read each is enough. */
const cache = new Map<string, string>();

function token(name: string): string {
  const hit = cache.get(name);
  if (hit !== undefined) return hit;
  if (typeof document === "undefined") return "";
  const el = document.querySelector(ROOT);
  // Before the first paint there is no root to read and nothing has moved yet;
  // the miss is deliberately not cached, so the next call gets the real value.
  if (!el) return "";
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  if (value) cache.set(name, value);
  return value;
}

/**
 * A `--ln-dur-*` token in motion's unit.
 *
 * An unreadable token answers 0, which lands on the final state — the same
 * thing the reduced-motion branch does, and never a second set of numbers.
 */
function seconds(name: string): number {
  const raw = token(name);
  if (raw.endsWith("ms")) return Number.parseFloat(raw) / 1000;
  if (raw.endsWith("s")) return Number.parseFloat(raw);
  return 0;
}

/** `cubic-bezier(0.2, 0, 0, 1)` — the four numbers motion wants. */
function easing(name: string): [number, number, number, number] | undefined {
  const found = /cubic-bezier\(([^)]+)\)/.exec(token(name));
  if (!found) return undefined;
  const [a, b, c, d] = (found[1] ?? "").split(",").map((n) => Number.parseFloat(n));
  if ([a, b, c, d].some((n) => n === undefined || Number.isNaN(n))) return undefined;
  return [a as number, b as number, c as number, d as number];
}

/**
 * The level change: the camera move between L0, L1 and L2.
 *
 * Read fresh rather than frozen at module load, because the first call can
 * happen before `.ln-root` is in the document.
 */
export function move(): Transition {
  return { duration: seconds("--ln-dur-move"), ease: easing("--ln-ease") ?? "easeOut" };
}

/** Anything that only appears or disappears in place. */
export function fade(): Transition {
  return { duration: seconds("--ln-dur-2"), ease: easing("--ln-ease-out") ?? "easeOut" };
}

/** Reduced motion: land on the final state, rather than play a faster animation. */
export const instant: Transition = { duration: 0 };

/** A lane opening or closing: heavy, settles once, does not wobble. */
export const zoom: Transition = { type: "spring", stiffness: 210, damping: 30 };

/** A node becoming a card, and back. Slightly quicker than a lane. */
export const lift: Transition = { type: "spring", stiffness: 320, damping: 32 };

/**
 * Arrival stagger, in seconds, capped so a 40-invoice lane does not take a
 * second to land. Both the step and the cap are `--ln-*` tokens, so the tail is
 * budgeted in the same place as the move it follows.
 */
export function revealDelay(index: number): number {
  const cap = Number.parseFloat(token("--ln-stagger-cap"));
  return Math.min(index, Number.isNaN(cap) ? 0 : cap) * seconds("--ln-stagger");
}

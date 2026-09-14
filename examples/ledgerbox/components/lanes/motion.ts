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
 *
 * THE READER IS THE KIT'S. This file used to carry its own `token()`,
 * `seconds()` and `easing()` — a module-level cache keyed on
 * `[data-variant="lanes"]`, a millisecond/second parser and a `cubic-bezier`
 * regex, about fifty lines of it. All three round-1 apps wrote that same reader
 * differently, which is three places for `"0.26s"` to be mishandled; the
 * consolidation round moved it to `@athena/demo-kit/zoom` (`cssMs`, `secs`,
 * `parseBezier`, `cssEase`) and this file now only says what the direction's
 * moves ARE. The SSR and unreadable-token branches came with it: `cssMs`
 * answers its fallback with no window, and a 0-length transition lands on the
 * final state, which is the same branch reduced motion takes.
 */
import { cssEase, cssMs, parseBezier, secs } from "@athena/demo-kit/zoom";
import type { Transition } from "motion/react";

/** The element the tokens are declared on. Re-read per call; before the first
 *  paint there is nothing to read and nothing has moved yet. */
const root = (): Element | null =>
  typeof document === "undefined" ? null : document.querySelector('[data-variant="lanes"]');

/** A `--ln-dur-*` token in motion's unit. */
const duration = (name: string): number => secs(cssMs(name, root()));

/** `cubic-bezier(0.2, 0, 0, 1)` as the four numbers motion wants, or a keyword. */
const ease = (name: string, fallback: string): Transition["ease"] =>
  parseBezier(cssEase(name, root())) ?? (fallback as Transition["ease"]);

/**
 * The level change: the camera move between L0, L1 and L2.
 *
 * Read fresh rather than frozen at module load, because the first call can
 * happen before `.ln-root` is in the document.
 */
export function move(): Transition {
  return { duration: duration("--ln-dur-move"), ease: ease("--ln-ease", "easeOut") };
}

/** Anything that only appears or disappears in place. */
export function fade(): Transition {
  return { duration: duration("--ln-dur-2"), ease: ease("--ln-ease-out", "easeOut") };
}

/** Reduced motion: land on the final state, rather than play a faster animation. */
export const instant: Transition = { duration: 0 };

/*
 * WHAT ROUND 3 DELETED FROM THIS FILE, and why it is a good sign.
 *
 * `zoom` and `lift` were two springs — a lane opening, a node becoming a card — and
 * `revealDelay` was the staggered arrival of a spread's forty cards. All three existed because a
 * level change was a set of elements appearing, and something had to choreograph the appearing.
 * A camera over one persistent world has nothing to choreograph: the objects were already there,
 * at those positions, and the only thing that moved is the point of view. The flight between two
 * poses is the rig's, on `--ln-dur-move`; the crossfade between two bands is the stylesheet's, on
 * the same token. A direction with a camera needs exactly two transitions in TypeScript, and
 * they are the two above.
 */

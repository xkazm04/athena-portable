/**
 * Who owns the Escape key, decided in one pure function.
 *
 * The zoom nav binds `keydown` on `window` so Escape leaves the current level from anywhere on the
 * surface. That is right for the canvas and wrong for everything drawn on top of it: an overlay's
 * dismiss would also throw the user out of the level they were reading, on one keypress. Consumers
 * were paying for it by hand — two `stopPropagation()` sites in clonedeck, each with a comment
 * naming the kit — and the pattern that cannot work around it (an overlay with its OWN `window`
 * listener) is already in the tree.
 *
 * `preventDefault()` on a key the page has not decided about is the wrong default for a library,
 * so the listener now asks first. Three ways a consumer keeps the key, in the order they are
 * checked:
 *
 *   1. it called `preventDefault()` — React's root listener runs before a `window` listener, so a
 *      component's own `onKeyDown` has already spoken by the time this runs;
 *   2. the event came from inside a modal subtree — a dialog, alertdialog or `aria-modal` element
 *      owns its own dismiss;
 *   3. the consumer took an explicit hold (`nav.holdEscape()`), which is the only option open to
 *      an overlay that listens on `window` itself, where neither of the above can reach.
 *
 * No DOM and no React here on purpose: `test/escape.test.ts` runs it under `node --test`.
 */

/** An element in one of these is a modal, and a modal owns Escape. */
export const MODAL_SELECTOR = '[role="dialog"],[role="alertdialog"],[aria-modal="true"]';

/** The shape this decision needs from a `KeyboardEvent`. */
export interface EscapeEvent {
  key: string;
  defaultPrevented: boolean;
  target?: unknown;
}

function insideModal(target: unknown): boolean {
  const el = target as { closest?: (selector: string) => unknown } | null | undefined;
  if (!el || typeof el.closest !== "function") return false;
  return Boolean(el.closest(MODAL_SELECTOR));
}

/**
 * True when this Escape is the nav's to act on.
 *
 * @param level the level the nav is on now; L0 has nowhere to go and never claims the key
 * @param holds how many consumers are currently holding Escape (`nav.holdEscape()`)
 */
export function escapeLeavesLevel(event: EscapeEvent, level: number, holds = 0): boolean {
  if (event.key !== "Escape") return false;
  if (level === 0) return false;
  if (event.defaultPrevented) return false;
  if (holds > 0) return false;
  return !insideModal(event.target);
}

/**
 * The other half of the rule: this Escape abandons a move that is still in flight.
 *
 * `escapeLeavesLevel` answers "is this key the nav's". This answers "and what does the nav do
 * with it" — because those are two questions, and round 1 found the second one missing in every
 * app. A level change is a move the reader can follow, which means it is a move the reader can
 * change their mind about (formula §1 rule 6): Escape a tenth of a second into a zoom should put
 * them back where they were standing, not one level above a place they never arrived at.
 * Tidycrm carried the same shape locally as `escapeAbortsArrival`, for the window before its
 * hand-off; this is the general case.
 *
 * ASK IT AFTER `escapeLeavesLevel`, not instead of it. Ownership first (a modal, a hold, a
 * consumer that already called `preventDefault` all keep the key), then this to choose between
 * `nav.abort()` and `nav.up()`. `nav.ts` does exactly that, and an app with its own listener
 * should too:
 *
 *     if (!escapeLeavesLevel(e, level, holds)) return;
 *     e.preventDefault();
 *     if (escapeAbortsFlight(e, moving, level)) nav.abort();
 *     else nav.up();
 *
 * @param moving whether a level change is in flight (`useLevelFlight`'s `moving`)
 * @param level the level the nav is on now — L0 has no arrival to abandon
 */
export function escapeAbortsFlight(event: EscapeEvent, moving: boolean, level: number): boolean {
  if (event.key !== "Escape") return false;
  if (event.defaultPrevented) return false;
  if (!moving) return false;
  return level >= 1;
}

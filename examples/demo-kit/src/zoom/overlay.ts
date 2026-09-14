/**
 * The two decisions an L2 overlay has to make, without a DOM to make them in.
 *
 * Formula §1 rule 5: an overlay owns its own Escape and returns focus to its opener. The kit's
 * window rule correctly declines any Escape raised inside a modal subtree (`escape.ts`), which
 * left every round-1 app's L2 pane answering to nothing at all while its footer went on
 * advertising the key. All three then wrote the same two answers by hand.
 *
 * `useOverlayEscape.ts` is the hook; these are the parts worth pinning.
 */
import type { EscapeEvent } from "./escape";

/**
 * Is this Escape the overlay's to act on?
 *
 * Asked BEFORE `preventDefault`, for the reason the kit's own rule gives: calling
 * `preventDefault` on a key the page has not decided about is what makes a listener impossible
 * to compose with. An overlay nested inside another overlay therefore still works — the inner
 * one speaks first and the outer one declines.
 *
 * Note what is NOT checked: the modal subtree. This handler is spread on the dialog root, so it
 * only ever sees keys from inside it; the subtree test is the window listener's job.
 */
export function escapeClosesOverlay(event: EscapeEvent): boolean {
  if (event.key !== "Escape") return false;
  return !event.defaultPrevented;
}

/** The shape this decision needs from an element. */
export interface FocusCandidate {
  isConnected?: boolean;
}

/**
 * Where focus goes when the overlay closes, best answer first.
 *
 * The opener is preferred because it is where the reader actually was. It may be gone — an agent
 * opened the overlay so nothing on the sheet had focus, or the level underneath re-rendered, or
 * the opener belonged to a level that has since left — so the caller's fallback is taken
 * instead: the object the overlay grew out of, or the one control present at every level (a back
 * button). `document.body` is not an answer; it is what "focus was dropped" looks like.
 *
 * `body` is a parameter rather than a global read so this stays pure.
 */
export function focusReturnTarget<T extends FocusCandidate>(
  opener: T | null | undefined,
  fallback: T | null | undefined,
  body?: unknown,
): T | null {
  if (opener && opener !== body && opener.isConnected !== false) return opener;
  return fallback ?? null;
}

/**
 * Should this element be recorded as the opener?
 *
 * Mounting an overlay moves focus into it, and React StrictMode runs a mount effect, its
 * cleanup, and the effect again — so on the second pass `document.activeElement` is a control
 * inside the overlay, and an unguarded read records something that is about to be unmounted with
 * it. Two guards, both of which round-1 apps arrived at: never overwrite an opener already
 * recorded, and never record the body.
 */
export function isOpener(active: unknown, recorded: unknown, body?: unknown): boolean {
  if (recorded) return false;
  if (!active || active === body) return false;
  return true;
}

"use client";

/**
 * An L2 overlay's own Escape, and the focus it owes its opener. Formula §1 rule 5.
 *
 * THE PROBLEM IT SOLVES, from round 1: Escape was dead at L2 in all three apps. Every L2 pane is
 * `aria-modal`, the kit's window listener correctly declines an Escape raised inside a modal
 * subtree (a dialog's dismiss is the dialog's business), no pane handled the key itself, and all
 * three footers went on advertising `Esc`. The second half was the same everywhere: a pane that
 * moves focus into itself and never hands it back leaves the reader at the top of the document,
 * with the thing they had been reading three hundred pixels down and no way back but the mouse.
 *
 *     const overlay = useOverlayEscape({ onClose, returnFocusTo: () => cellFor(id) });
 *     <div role="dialog" aria-modal="true" tabIndex={-1} {...overlay} ref={paneRef}>
 *
 * WHAT IT DOES, and deliberately no more:
 *
 *   · Escape on the dialog root → `preventDefault()` then `onClose()`. `preventDefault` IS the
 *     protocol: the kit's window rule checks it first (escape.ts, rule 1), and React's root
 *     listener runs before a window listener, so one press leaves one level rather than two.
 *     No `stopPropagation` anywhere, and no second window listener.
 *   · on unmount, focus goes back to whatever held it when the overlay mounted; if that element
 *     is gone, to `returnFocusTo()`; if that is null too, nowhere — never to `document.body`,
 *     which is what a dropped focus looks like.
 *
 * WHAT IT DOES NOT DO: move focus INTO the overlay (the pane decides whether that is itself or
 * its first control — tidycrm's note on why the close button is the wrong target is worth
 * reading), trap Tab, lock body scroll, or draw a scrim. Those are the pane's, and they differ.
 */
import { useCallback, useEffect, useRef, type KeyboardEvent } from "react";

import {
  escapeClosesOverlay,
  focusReturnTarget,
  isOpener,
  type FocusPreference,
} from "./overlay";

export interface OverlayEscapeOptions {
  /** What Escape means. Usually `nav.up`. */
  onClose: () => void;
  /**
   * Where focus goes if the opener is gone — an agent opened the overlay and nothing on the
   * sheet had focus, or the level underneath re-rendered. Called at unmount, so it can look the
   * element up then rather than capture one that may not survive.
   */
  returnFocusTo?: () => HTMLElement | null;
  /**
   * Which candidate wins when both are available. Default `"opener"`.
   *
   * Round 2's gap, raised by hirelane and tidycrm in the same words: a pane that GREW OUT OF a
   * card wants the card to win, because the morph the reader just watched came from there and
   * the opener may have been a toolbar three hundred pixels away. `"origin"` makes
   * `returnFocusTo()` the first answer and the opener the fallback; the rule that neither may be
   * the body, and that a disconnected element is not an answer, is unchanged either way.
   */
  prefer?: FocusPreference;
}

export interface OverlayEscape {
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

export function useOverlayEscape({
  onClose,
  returnFocusTo,
  prefer = "opener",
}: OverlayEscapeOptions): OverlayEscape {
  /* The two callbacks are read at unmount and at keydown, i.e. always after a commit, so they
     are mirrored into refs after every render rather than captured in the mount effect's
     closure — otherwise a pane that re-creates its `onClose` closes a stale level. */
  const close = useRef(onClose);
  const fallback = useRef(returnFocusTo);
  const preference = useRef(prefer);
  useEffect(() => {
    close.current = onClose;
    fallback.current = returnFocusTo;
    preference.current = prefer;
  });

  const opener = useRef<HTMLElement | null>(null);
  const pending = useRef<number | null>(null);

  useEffect(() => {
    /*
     * A restore scheduled by a cleanup that has just been followed by a mount is StrictMode
     * taking the effect apart and putting it back, not the overlay closing. Cancelling it here
     * is the generic version of the round-1 apps' "is my pane still in the document" check, and
     * it needs no selector to do it with.
     */
    if (pending.current !== null) {
      cancelAnimationFrame(pending.current);
      pending.current = null;
    }

    /* Read at the TOP of the effect, which is the last moment it is still true: mounting an
       overlay moves nothing, so whatever holds focus now is what opened it. Recorded once and
       never overwritten — see `isOpener`. */
    const active = document.activeElement;
    if (isOpener(active, opener.current, document.body) && active instanceof HTMLElement) {
      opener.current = active;
    }

    return () => {
      const target = focusReturnTarget(
        opener.current,
        fallback.current?.() ?? null,
        document.body,
        preference.current,
      );
      /* Next frame, not this one: React is still committing the unmount, and the level
         underneath has not been painted for the fallback to exist in yet. */
      pending.current = requestAnimationFrame(() => {
        pending.current = null;
        target?.focus({ preventScroll: true });
      });
    };
  }, []);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (!escapeClosesOverlay(event)) return;
    event.preventDefault();
    close.current();
  }, []);

  return { onKeyDown };
}

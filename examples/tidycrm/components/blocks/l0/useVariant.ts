"use client";

/**
 * Which L0 prototype is on the page, and where that choice is kept.
 *
 * Two places, in this order: the URL wins, because a link is how the owner sends
 * one of these to somebody else, and `localStorage` is the fallback, because a
 * reader who picked one should not have to pick it again on the next load. The
 * default is `plate` — the cheapest of the three, and the one that works without
 * WebGL at all.
 *
 * READ AS THE EXTERNAL STATE IT IS, for the reason `useReduced.ts` gives about
 * the motion query: the URL and `localStorage` are not React's, and an effect
 * that mirrors them into component state is a setState inside an effect and a
 * second render behind the first. `useSyncExternalStore` reads the real answer
 * on the client and `plate` on the server, which is also the hydration-safe
 * pair: neither the search string nor storage exists during the server render.
 *
 * The URL is written with `replaceState` rather than pushed. Switching
 * prototypes is not a place a reader navigated to; it is which drawing of the
 * same place they are looking at, and a back button that walks back through
 * three of them before leaving the page is a back button that lies. `popstate`
 * is still subscribed to, because a reader may arrive at a `?l0=` link through
 * history.
 */

import { useCallback, useSyncExternalStore } from "react";

import { isL0Variant, type L0Variant } from "./contract";

const KEY = "tidycrm.l0";
const PARAM = "l0";

/** `replaceState` fires no event, so the one writer tells the readers itself. */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("popstate", onChange);
  };
}

function snapshot(): L0Variant {
  const fromUrl = new URLSearchParams(window.location.search).get(PARAM);
  if (isL0Variant(fromUrl)) return fromUrl;
  try {
    const stored = window.localStorage.getItem(KEY);
    if (isL0Variant(stored)) return stored;
  } catch {
    // A browser with storage denied still gets to look at the page.
  }
  return "plate";
}

function onServer(): L0Variant {
  return "plate";
}

export function useL0Variant(): [L0Variant, (next: L0Variant) => void] {
  const variant = useSyncExternalStore(subscribe, snapshot, onServer);

  const choose = useCallback((next: L0Variant) => {
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      /* see above */
    }
    const url = new URL(window.location.href);
    url.searchParams.set(PARAM, next);
    window.history.replaceState(window.history.state, "", url);
    for (const listener of listeners) listener();
  }, []);

  return [variant, choose];
}

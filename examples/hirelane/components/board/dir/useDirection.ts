"use client";

/**
 * Which spatial direction is on the page, and where that choice is kept.
 *
 * Two places, in this order: the URL wins, because a link is how the owner
 * sends one of these to somebody else, and `localStorage` is the fallback,
 * because a reader who picked one should not have to pick it again on the next
 * load. The default is `board` — the control variant, the one that is already
 * reviewed, and the only one that costs nothing beyond what the app already
 * paid for.
 *
 * READ AS THE EXTERNAL STATE IT IS. The URL and `localStorage` are not React's,
 * and an effect that mirrors them into component state is a `setState` inside
 * an effect and a second render behind the first.
 * `useSyncExternalStore` reads the real answer on the client and `board` on the
 * server, which is also the hydration-safe pair: neither the search string nor
 * storage exists during the server render.
 *
 * The URL is written with `replaceState` rather than pushed. Switching
 * directions is not a place a reader navigated to; it is which drawing of the
 * same place they are looking at, and a back button that walks back through
 * three of them before leaving the page is a back button that lies. `popstate`
 * is still subscribed to, because a reader may arrive at a `?dir=` link through
 * history.
 *
 * The shape is `examples/tidycrm/components/blocks/l0/useVariant.ts` — the same
 * question, answered the same way, one round earlier. It is copied rather than
 * shared because the two apps share a kit and not a URL vocabulary, and the one
 * thing worth noticing is that this is the THIRD copy in the repo: a
 * `useChoice(key, param, values, fallback)` is a kit gap, logged as one.
 */

import { useCallback, useSyncExternalStore } from "react";

import { isDirection, type Direction } from "./contract";

const KEY = "hirelane.dir";
const PARAM = "dir";
const FALLBACK: Direction = "board";

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

function snapshot(): Direction {
  const fromUrl = new URLSearchParams(window.location.search).get(PARAM);
  if (isDirection(fromUrl)) return fromUrl;
  try {
    const stored = window.localStorage.getItem(KEY);
    if (isDirection(stored)) return stored;
  } catch {
    /* A browser with storage denied still gets to look at the page. */
  }
  return FALLBACK;
}

function onServer(): Direction {
  return FALLBACK;
}

export function useDirection(): [Direction, (next: Direction) => void] {
  const direction = useSyncExternalStore(subscribe, snapshot, onServer);

  const choose = useCallback((next: Direction) => {
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

  return [direction, choose];
}

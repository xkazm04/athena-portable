"use client";

/**
 * WHICH ARRANGEMENT IS ON THE SHEET — `?view=`, remembered, and shareable.
 *
 * Three rounds of the formula have carried "URL sync (still nowhere)" as an open item. It lands
 * here, in the smallest honest form: the view is in the query string, so a link to the trust view
 * is a link to the trust view, and it falls back to what the reader chose last time.
 *
 * WRITTEN IN THE APP AGAIN, WHICH IS THE POINT. Round 3's gap 4 named `useChoice(key, param,
 * values)` as a hook that "exists in three copies"; this is the fourth, and it is logged rather
 * than worked around silently. The kit has `useZoomNav` for the level and nothing at all for the
 * orthogonal choice every one of these surfaces has turned out to need — including the part below
 * that is genuinely fiddly and that all four copies will get wrong differently.
 *
 * THE FIDDLY PART: the value is not knowable on the server. The URL is, but `localStorage` is not,
 * so a lazy `useState` initialiser would render one thing on the server and another on the client
 * and React would throw the tree away. `useSyncExternalStore` is the sanctioned answer — a server
 * snapshot of the default, a client snapshot of the real choice, and React reconciles the
 * difference itself instead of an effect chasing it with a `setState`.
 *
 * `history.replaceState`, not `push`: a view switch is not a place, it is a way of looking at the
 * place you are already standing in, and a reader who pressed Back after four switches should
 * leave the page rather than walk back through their own opinions. The level model owns Back's
 * meaning through Escape; this must not compete with it.
 */
import { useCallback, useSyncExternalStore } from "react";

import { VIEWS, isView, type ViewId } from "./plan";

const PARAM = "view";
const KEY = "atlas:view";
const FALLBACK: ViewId = "layers";

function fromEnvironment(): ViewId {
  const asked = new URLSearchParams(window.location.search).get(PARAM);
  if (isView(asked)) return asked;
  try {
    const kept = window.localStorage.getItem(KEY);
    if (isView(kept)) return kept;
  } catch {
    /* Private mode, or storage disabled. The default is a perfectly good answer. */
  }
  return FALLBACK;
}

/** Module-level, because the choice is a fact about the page and not about one component. */
const listeners = new Set<() => void>();
let current: ViewId | null = null;

const subscribe = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

const snapshot = (): ViewId => {
  if (current === null) current = fromEnvironment();
  return current;
};

const serverSnapshot = (): ViewId => FALLBACK;

export function useView(): [ViewId, (next: ViewId) => void] {
  const view = useSyncExternalStore(subscribe, snapshot, serverSnapshot);

  const choose = useCallback((next: ViewId) => {
    if (!isView(next) || next === current) return;
    current = next;
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      /* see above */
    }
    const url = new URL(window.location.href);
    url.searchParams.set(PARAM, next);
    window.history.replaceState(null, "", url);
    for (const cb of listeners) cb();
  }, []);

  return [view, choose];
}

export { VIEWS };

/**
 * Where Main is — README section 3.5, ADR 0087.
 *
 * The depth reducer in a store, and the URL hash that mirrors it, so a depth is a link and a
 * reload lands where you were. Started by the app root with the other app-wide stores, because
 * where the window is must stay true while a scene is being left. A scene reads it and never
 * starts it. The hash is written with `replaceState`: this is a window, not a site, and a back
 * button that walks through every dive would be a second, worse Escape.
 */
import { create } from "zustand";

import {
  INITIAL,
  formatHash,
  parseHash,
  reduce,
  samePath,
  type DepthAction,
  type DepthState,
  type Path,
} from "./model";

export interface DepthStore extends DepthState {
  go: (to: Path) => void;
  rise: () => void;
  surface: () => void;
  settle: (seq: number) => void;
}

function pick(s: DepthStore): DepthState {
  return { path: s.path, from: s.from, move: s.move, seq: s.seq };
}

export const useDepth = create<DepthStore>((set, get) => {
  const apply = (action: DepthAction) => {
    const current = pick(get());
    const next = reduce(current, action);
    if (next !== current) set(next); // `reduce` hands back its input when it ignores an action
  };
  return {
    ...INITIAL,
    go: (to) => apply({ type: "go", to }),
    rise: () => apply({ type: "rise" }),
    surface: () => apply({ type: "surface" }),
    settle: (seq) => apply({ type: "settle", seq }),
  };
});

let started = false;

/**
 * Take the place the hash names (no move: the window is simply there), then keep the hash and the
 * store agreeing. Returns the stop function. With no `window` it does nothing.
 */
export function startDepth(): () => void {
  if (started || typeof window === "undefined") return () => {};
  started = true;

  const fromHash = parseHash(window.location.hash);
  // The stage is already on screen at the surface when this runs (the app root starts it from an
  // effect), and the stage redraws its layers when `seq` changes, so a new place counts as a change
  // of place, with no move to play. Without the count the bar would name the depth over the
  // surface's scene.
  const now = useDepth.getState();
  if (!samePath(fromHash, now.path)) {
    useDepth.setState({ path: fromHash, from: null, move: "none", seq: now.seq + 1 });
  }
  // A hash the grammar did not write (a stale link, a typo, odd case) is rewritten to the place it
  // resolved to, so the bar's URL and the store never disagree about where the window is. No hash at
  // all is the surface already and is left alone.
  const canonical = formatHash(fromHash);
  if (window.location.hash !== "" && window.location.hash !== canonical) {
    window.history.replaceState(null, "", canonical);
  }

  const onHash = () => {
    const to = parseHash(window.location.hash);
    if (!samePath(to, useDepth.getState().path)) useDepth.getState().go(to);
  };
  window.addEventListener("hashchange", onHash);

  const unsubscribe = useDepth.subscribe((s, prev) => {
    if (samePath(s.path, prev.path)) return;
    const hash = formatHash(s.path);
    if (window.location.hash !== hash) window.history.replaceState(null, "", hash);
  });

  return () => {
    window.removeEventListener("hashchange", onHash);
    unsubscribe();
    started = false;
  };
}

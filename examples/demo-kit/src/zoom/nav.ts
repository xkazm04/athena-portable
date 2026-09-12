/**
 * The three-level navigation model every world shares.
 *
 *   L0  the whole population — one glance, "where is the trouble"
 *   L1  one group — the working set, laid out so its members compare
 *   L2  one item — the thing you act on, with the evidence and the buttons
 *
 * Written once and imported by all nine worlds, so a click means the same thing
 * everywhere and the round compares metaphors rather than interaction models.
 *
 * Pure reducer plus a hook. No three, no DOM beyond the Escape key.
 */
"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

import { escapeLeavesLevel } from "./escape";

export type Level = 0 | 1 | 2;

export interface Focus {
  level: Level;
  /** Lane / rack / quadrant id. */
  group: string | null;
  /** The single item at L2. */
  item: string | null;
}

export const HOME: Focus = { level: 0, group: null, item: null };

export interface NavState {
  focus: Focus;
  /** Hovered node id — `group` or `group:item`. */
  hover: string | null;
  /** Nodes something is pointing at (a scripted agent run, a filter). */
  highlight: ReadonlySet<string>;
  /** Monotonic — every focus change bumps it so the rig re-flies even when the
   *  computed pose happens to be identical to the last one. */
  flight: number;
}

export type NavAction =
  | { type: "open-group"; group: string }
  | { type: "open-item"; group: string; item: string }
  | { type: "up" }
  | { type: "home" }
  | { type: "hover"; id: string | null }
  | { type: "highlight"; ids: string[] };

export const nodeId = (group: string, item?: string | null): string => (item ? `${group}:${item}` : group);

export const initialNavState = (): NavState => ({
  focus: HOME,
  hover: null,
  highlight: new Set<string>(),
  flight: 0,
});

export function navReducer(s: NavState, a: NavAction): NavState {
  switch (a.type) {
    case "open-group":
      return { ...s, focus: { level: 1, group: a.group, item: null }, flight: s.flight + 1 };
    case "open-item":
      return { ...s, focus: { level: 2, group: a.group, item: a.item }, flight: s.flight + 1 };
    case "up": {
      if (s.focus.level === 0) return s;
      const focus: Focus =
        s.focus.level === 2 ? { level: 1, group: s.focus.group, item: null } : HOME;
      return { ...s, focus, flight: s.flight + 1 };
    }
    case "home":
      return s.focus.level === 0 && s.highlight.size === 0
        ? s
        : { ...s, focus: HOME, highlight: new Set<string>(), flight: s.flight + 1 };
    case "hover":
      return s.hover === a.id ? s : { ...s, hover: a.id };
    case "highlight":
      return { ...s, highlight: new Set(a.ids) };
    default:
      return s;
  }
}

/**
 * Presence of a node given the focus: 1 fully there, 0 gone.
 *
 * The one rule all nine worlds obey, so "what recedes when I drill in" is a
 * property of the model and not of whoever wrote the world. Worlds read it and
 * decide what to DO with it — fade, sink, unlight — but never re-derive it.
 */
export function emphasis(focus: Focus, group: string, item: string | null): number {
  if (focus.level === 0) return item ? 0.45 : 1;
  const mine = focus.group === group;
  if (focus.level === 1) {
    if (!mine) return item ? 0.05 : 0.22;
    return 1;
  }
  if (!mine) return item ? 0.02 : 0.12;
  if (!item) return 0.4;
  return item === focus.item ? 1 : 0.14;
}

export interface Nav {
  state: NavState;
  openGroup: (group: string) => void;
  openItem: (group: string, item: string) => void;
  up: () => void;
  home: () => void;
  hover: (id: string | null) => void;
  highlight: (ids: string[]) => void;
  /**
   * Take Escape for as long as the returned function has not been called. For an overlay that
   * cannot rely on `preventDefault()` reaching the nav first — one that listens on `window`
   * itself, where both listeners fire on the same dispatch. Holds are counted, so nesting is
   * safe; releasing twice is a no-op.
   *
   *     useEffect(() => nav.holdEscape(), []);
   */
  holdEscape: () => () => void;
}

export function useWorldNav(): Nav {
  const [state, dispatch] = useReducer(navReducer, undefined, initialNavState);
  // Escape reads the CURRENT level, and re-binding a window listener on every
  // hover would be wasteful — so the handler is bound once and reads the level
  // through a ref, kept up to date in an effect rather than during render.
  const level = useRef(state.focus.level);
  useEffect(() => {
    level.current = state.focus.level;
  }, [state.focus.level]);

  // Consumers currently holding the key. A count, not a flag: two overlays open at once must not
  // have the inner one's release hand Escape back to the nav while the outer is still up.
  const holds = useRef(0);
  const holdEscape = useCallback(() => {
    holds.current += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      holds.current = Math.max(0, holds.current - 1);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // `escapeLeavesLevel` is the whole rule, and it is asked BEFORE preventDefault: calling
      // preventDefault on a key the page has not decided about is what made this listener
      // impossible to compose with. See ./escape.ts.
      if (!escapeLeavesLevel(e, level.current, holds.current)) return;
      e.preventDefault();
      dispatch({ type: "up" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return useMemo<Nav>(
    () => ({
      state,
      openGroup: (group) => dispatch({ type: "open-group", group }),
      openItem: (group, item) => dispatch({ type: "open-item", group, item }),
      up: () => dispatch({ type: "up" }),
      home: () => dispatch({ type: "home" }),
      hover: (id) => dispatch({ type: "hover", id }),
      highlight: (ids) => dispatch({ type: "highlight", ids }),
      holdEscape,
    }),
    [state, holdEscape],
  );
}

/** Stable no-op nav, for rendering a world in a story or a test. */
export function useStaticNav(focus: Focus): Nav {
  const noop = useCallback(() => {}, []);
  return useMemo<Nav>(
    () => ({
      state: { focus, hover: null, highlight: new Set<string>(), flight: 0 },
      openGroup: noop,
      openItem: noop,
      up: noop,
      home: noop,
      hover: noop,
      highlight: noop,
      // Nothing listens, so there is nothing to hold; the release is the same no-op.
      holdEscape: () => noop,
    }),
    [focus, noop],
  );
}

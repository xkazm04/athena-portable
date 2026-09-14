/**
 * The three-level navigation model every world shares — the React half.
 *
 *   L0  the whole population — one glance, "where is the trouble"
 *   L1  one group — the working set, laid out so its members compare
 *   L2  one item — the thing you act on, with the evidence and the buttons
 *
 * Written once and imported by all nine worlds, so a click means the same thing
 * everywhere and the round compares metaphors rather than interaction models.
 *
 * The state, the actions and the reducer are `./state.ts`, which imports nothing; `emphasis()`
 * is `./presence.ts` for the same reason. This file is the hook: a reducer, one `window`
 * listener, and the two refs that listener reads. No three, no DOM beyond the Escape key.
 */
"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

import { escapeAbortsFlight, escapeLeavesLevel } from "./escape";
import { initialNavState, navReducer, type Focus, type NavState } from "./state";

export { emphasis } from "./presence";
export {
  HOME,
  initialNavState,
  navReducer,
  nodeId,
  sameFocus,
  type Focus,
  type Level,
  type NavAction,
  type NavState,
} from "./state";

export interface Nav {
  state: NavState;
  openGroup: (group: string) => void;
  openItem: (group: string, item: string) => void;
  up: () => void;
  home: () => void;
  /**
   * Abandon the level change in flight: back to the focus it left, with a flight of its own.
   *
   * Dispatched by this hook's own Escape listener while a move is in flight (see `setMoving`),
   * and callable directly by anything else that means "not that one after all" — a scrim, a
   * cancel control, an agent tool.
   */
  abort: () => void;
  /**
   * Tell the nav whether a level change is in flight.
   *
   * The nav owns the Escape listener and cannot see the surface's clock; the surface owns the
   * clock and does not see the key. This is the one wire between them, and `useLevelFlight`
   * keeps it up to date for you — an app that calls that hook never calls this. It writes a ref
   * rather than state: nothing renders differently because of it, and a level change must not
   * cost a render of the whole nav tree.
   */
  setMoving: (moving: boolean) => void;
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

  // Whether a level change is in flight, written by the surface (`useLevelFlight`). A ref for
  // the same reason `level` is one: the listener is bound once and this changes twice per move.
  const moving = useRef(false);
  const setMoving = useCallback((next: boolean) => {
    moving.current = next;
  }, []);

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
      // `escapeLeavesLevel` is the whole OWNERSHIP rule, and it is asked BEFORE preventDefault:
      // calling preventDefault on a key the page has not decided about is what made this
      // listener impossible to compose with. See ./escape.ts.
      if (!escapeLeavesLevel(e, level.current, holds.current)) return;
      e.preventDefault();
      // ...and then what the key MEANS, which depends on whether the move the reader is watching
      // has landed. Mid-flight it is "not that one after all", which is the focus they were
      // standing on — never the level above a place they never arrived at.
      dispatch({ type: escapeAbortsFlight(e, moving.current, level.current) ? "abort" : "up" });
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
      abort: () => dispatch({ type: "abort" }),
      setMoving,
      hover: (id) => dispatch({ type: "hover", id }),
      highlight: (ids) => dispatch({ type: "highlight", ids }),
      holdEscape,
    }),
    [state, holdEscape, setMoving],
  );
}

/** Stable no-op nav, for rendering a world in a story or a test. */
export function useStaticNav(focus: Focus): Nav {
  const noop = useCallback(() => {}, []);
  return useMemo<Nav>(
    () => ({
      state: { focus, prev: focus, hover: null, highlight: new Set<string>(), flight: 0 },
      openGroup: noop,
      openItem: noop,
      up: noop,
      home: noop,
      abort: noop,
      setMoving: noop,
      hover: noop,
      highlight: noop,
      // Nothing listens, so there is nothing to hold; the release is the same no-op.
      holdEscape: () => noop,
    }),
    [focus, noop],
  );
}

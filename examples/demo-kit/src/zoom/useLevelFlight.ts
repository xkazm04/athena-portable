"use client";

/**
 * The level change, as the surface sees it: where from, where to, and is it over.
 *
 * Every round-1 app re-derived this from the nav's `flight` counter, and the derivation has one
 * hard requirement: the level being LEFT has to be known on the very frame the level changes,
 * because that is the frame the outgoing layer must still be mounted for and the frame the
 * arriving layer measures its morph against. An effect is one frame late, which is a cut with
 * extra steps — so the advance is an adjust-during-render, which is React's one sanctioned way
 * to read "what changed", and it settles in a single extra pass because the guard is the nav's
 * monotonic counter.
 *
 * The reducer is `./flight.ts` and is pinned by `test/flight.test.ts`; this is the wiring.
 *
 *     const { from, to, moving, flight, settle } = useLevelFlight(nav, { fallbackToken: "--ln-dur-4" });
 *     …
 *     <motion.span key={flight} transition={move} onAnimationComplete={settle} />
 *
 * WHO ENDS A FLIGHT. `settle()` — normally from the completion of the move itself, so the flight
 * ends when the motion does rather than at a number somebody typed (ledgerbox's `.ln-flight`
 * element replaced a bare `setTimeout(…, 700)` that way). The fallback duration is a safety net
 * for the surface that has no completion signal, or whose animation was never allowed to run at
 * all: read from `fallbackToken` off the cascade (rule 4 — JS reads tokens and never types a
 * millisecond), or given as `fallbackMs`, or `FLIGHT_FALLBACK_MS`.
 *
 * IT ALSO TELLS THE NAV. `moving` is pushed into `nav.setMoving`, which is what lets the nav's
 * Escape listener abort a move in flight instead of stepping up out of it (§1 rule 6, and
 * `escapeAbortsFlight`). An app that calls this hook gets that for free.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  FLIGHT_FALLBACK_MS,
  advanceFlight,
  initialFlight,
  isMoving,
  settleFlight,
} from "./flight";
import type { Nav } from "./nav";
import type { Focus } from "./state";
import { cssMs } from "./tokens";

export interface LevelFlight {
  /** The focus the move came from. Equal to `to` when nothing is in flight. */
  from: Focus;
  /** The focus now. */
  to: Focus;
  /** True from the frame the level changes until the flight is settled. */
  moving: boolean;
  /** The nav's monotonic counter. Key the move's completion element on it. */
  flight: number;
  /** This flight has landed. Pass an id to settle a specific flight; stale ids are dropped. */
  settle: (flight?: number) => void;
  /**
   * "Something is moving for this flight, wait for it." Returns a release, and releasing settles
   * the flight if it is still the current one — a mover that unmounts mid-move has ended it.
   *
   * Calling this AT ALL (with any id, including `ARMING_FLIGHT`) tells the hook that this
   * surface speaks the protocol, after which a flight nobody claims settles itself one frame
   * later instead of waiting out the fallback. That is round 2's "this move had no camera"
   * gap, and the arming is what keeps a surface that never claims behaving exactly as before.
   * `useEcho` does both halves for you.
   */
  claim: (flight?: number) => () => void;
  /** The resolved safety-net budget in ms — the sum of `fallbackToken`, or `fallbackMs`. */
  readonly fallbackMs: number;
}

export interface LevelFlightOptions {
  /**
   * A `--*` duration token naming this surface's level-change budget, e.g. `"--ln-dur-4"`.
   * Read once per flight, off `el`, so the fallback and the CSS move cannot drift.
   *
   * A LIST is SUMMED, which is the answer to round 2's `calc()` gap: an unregistered custom
   * property comes back from the cascade unresolved, so `--x: calc(var(--a) + var(--b))` reads
   * as the literal string and parses as nothing. Declare the budget as its steps —
   * `["--bd-dur-box", "--bd-dur-ink"]` — and the staged move's total is read, not typed.
   * A token the cascade cannot answer contributes nothing; if NONE of them can be read, the
   * whole list falls back to `FLIGHT_FALLBACK_MS`.
   */
  fallbackToken?: string | readonly string[];
  /** The same thing as a number, for a surface whose clock is not in the cascade. */
  fallbackMs?: number;
  /**
   * Where the token is declared. Defaults to `document.documentElement`.
   *
   * May be a FUNCTION, which is the answer to round 2's "needs an element that does not exist on
   * first render": a `ref.current` read during the first render is null, and a hook that
   * captured that null would read the document for the life of the surface. The function is
   * called inside the effect, by which time the scope is mounted.
   */
  el?: Element | null | (() => Element | null);
}

/** `nav` is usually the whole `ZoomNav`; only these two members are touched. */
export type FlightNav = Pick<Nav, "state" | "setMoving">;

export function useLevelFlight(nav: FlightNav, opts: LevelFlightOptions = {}): LevelFlight {
  const { fallbackToken, fallbackMs, el } = opts;
  const focus = nav.state.focus;
  const flight = nav.state.flight;
  const setMoving = nav.setMoving;

  const [state, setState] = useState(() => initialFlight(focus, flight));
  // Adjusted during render, not in an effect: see the note at the top of this file. `state.flight`
  // is the guard, and it is monotonic, so this cannot loop.
  const current = advanceFlight(state, flight, focus);
  if (current !== state) setState(current);

  const moving = isMoving(current);

  const settle = useCallback((at?: number) => {
    setState((s) => settleFlight(s, at ?? s.flight));
  }, []);

  /* Who has said they are moving for which flight, and whether this surface speaks the protocol
     at all. Refs, because a claim must not render anything: see `ARMING_FLIGHT`. */
  const claimed = useRef(new Set<number>());
  const armed = useRef(false);
  const currentFlight = useRef(flight);
  currentFlight.current = flight;

  const claim = useCallback(
    (at?: number) => {
      armed.current = true;
      const id = at ?? currentFlight.current;
      claimed.current.add(id);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        claimed.current.delete(id);
        if (id === currentFlight.current) settle(id);
      };
    },
    [settle],
  );

  /* The budget, resolved where the cascade exists. A ref so `fallbackMs` on the returned object
     can answer without a render, which is what `Echo`'s own safety net reads. */
  const budget = useRef(fallbackMs ?? FLIGHT_FALLBACK_MS);

  /*
   * The safety net. Started per flight, cleared when the flight changes or settles, so a second
   * nav action mid-move replaces the net rather than stacking one behind it — which is the
   * interruption case, and the one thing an "is it still moving" flag must survive.
   *
   * The token is read inside the effect and not during render: there is no cascade on the
   * server, and by the time an effect runs the scope the token is declared on is mounted.
   */
  useEffect(() => {
    if (!moving) return;

    const node = typeof el === "function" ? el() : (el ?? null);
    let ms = fallbackMs;
    if (ms === undefined && fallbackToken) {
      const names = typeof fallbackToken === "string" ? [fallbackToken] : fallbackToken;
      let total = 0;
      let read = false;
      for (const name of names) {
        const value = cssMs(name, node, -1);
        if (value >= 0) {
          total += value;
          read = true;
        }
      }
      if (read) ms = total;
    }
    if (ms === undefined) ms = FLIGHT_FALLBACK_MS;
    budget.current = ms;

    /* Nobody has said they are moving for this one. Give it a frame — a claim from a layout
       effect in the same commit has already landed, and one from a child's effect lands before
       the callback runs — and then call it landed. */
    if (armed.current && !claimed.current.has(flight)) {
      const id = requestAnimationFrame(() => {
        if (!claimed.current.has(flight)) settle(flight);
      });
      return () => cancelAnimationFrame(id);
    }

    const id = window.setTimeout(() => settle(flight), Math.max(0, ms));
    return () => window.clearTimeout(id);
  }, [moving, flight, fallbackMs, fallbackToken, el, settle]);

  /* The one wire to the nav's Escape listener. False on unmount, so a surface that leaves
     mid-move does not leave the nav believing something is still in flight. */
  useEffect(() => {
    setMoving(moving);
    return () => setMoving(false);
  }, [moving, setMoving]);

  return useMemo(
    () => ({
      from: current.from,
      to: current.to,
      moving,
      flight,
      settle,
      claim,
      get fallbackMs() {
        return budget.current;
      },
    }),
    [current.from, current.to, moving, flight, settle, claim],
  );
}

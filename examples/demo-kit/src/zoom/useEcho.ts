"use client";

/**
 * Rule 1, as a primitive. `docs/kit-camera-contract.md` §4, the wiring.
 *
 *   *The level you leave carries the camera; the level you arrive at carries the continuity.*
 *
 * It is the headline rule of the formula and after two rounds it was still ~30 lines of app code
 * plus a stylesheet in every app — atlas logged it as the gap that matters most: "there is no
 * echo container". This hook is the decision half (which changes get one, where it came from,
 * which way it goes); `Echo.tsx` is the twenty lines of element around it.
 *
 * WHEN THE MEASUREMENT HAPPENS, which is the whole difficulty. The origin is the middle of the
 * node the reader is leaving, and by the time React has committed the level change that node is
 * gone. So the hook keeps a snapshot: a layout effect, one per flight, measures the focus that
 * is CURRENT on that commit and stores it. On the next flight that stored rect is, by
 * construction, the measurement of the focus being left — taken while it was still on screen and
 * before anything moved. `measure(from)` is tried first anyway, because a surface whose outgoing
 * layer is still mounted (most of them, for one commit) can answer more precisely than a
 * snapshot from the commit before.
 *
 * It is a LAYOUT effect on both counts: a passive effect runs after paint, so a measurement
 * taken there is a measurement of the new level, and an echo mounted there is an echo the reader
 * sees appear a frame late.
 *
 * WHAT IT DOES WITH THE FLIGHT. It claims the flight while an echo is live and settles it when
 * the echo reports done, so `flight.moving` — and therefore the nav's "a move is in flight, and
 * Escape aborts it" — lasts exactly as long as the move the reader can see. Claiming also arms
 * the flight's self-settle, which closes round 2's other gap: a change that gets NO echo is
 * unclaimed, and an unclaimed flight is over within a frame instead of pretending to move for
 * the length of the fallback.
 *
 * The three decisions — `echoStages`, `echoOrigin`, `echoDirection` — are pure in `./echo-rule.ts`
 * and pinned by `test/echo.test.ts`, including which unit the origin is in.
 */
import { useLayoutEffect, useRef, useState } from "react";

import { ARMING_FLIGHT } from "./flight";
import {
  echoDirection,
  echoKey,
  echoOrigin,
  echoStages,
  levelChanged,
  type EchoDirection,
  type EchoOriginUnit,
  type RectLike,
} from "./echo-rule";
import type { Nav } from "./nav";
import { sameFocus, type Focus } from "./state";
import type { LevelFlight } from "./useLevelFlight";

/** What `useEcho` hands to `<Echo>`. */
export interface EchoState {
  /** Stable for the life of one echo, and different for the next. Key `<Echo>` on it. */
  key: string;
  /** The focus being left — what the consumer renders inside `<Echo>`, id-free. */
  from: Focus;
  /** The focus arriving. */
  to: Focus;
  /** Where the move came from. Fraction of the container by default; see `unit`. */
  origin: { x: number; y: number };
  direction: EchoDirection;
  /** The echo's animation has finished. Settles the flight. Idempotent. */
  onDone(): void;
  /** Which unit `origin` is in, so `<Echo>` writes the right CSS. */
  unit: EchoOriginUnit;
  /** The flight's safety-net budget, so a missing CSS animation cannot strand the echo. */
  fallbackMs: number;
}

export interface EchoOptions {
  /**
   * Where the opened/closed node is, measured before the change. Usually one
   * `getBoundingClientRect` off a `[data-group="…"]` lookup. Return `null` when the focus has no
   * node on screen (L0 itself usually does not) and the origin falls back to the centre.
   */
  measure(focus: Focus): DOMRect | RectLike | null;
  /** Which changes get an echo. Default: the level changed. */
  stages?: (from: Focus, to: Focus) => boolean;
  /**
   * The element `origin` is relative to — the echo's own container.
   *
   * NOT IN THE CONTRACT; without it there is nothing to take a fraction OF. A function, because
   * a ref is null on the first render. Omitted, the origin is relative to the VIEWPORT, which is
   * right for a full-bleed scene and wrong for a scene in a column.
   */
  container?: () => Element | null;
  /** `"fraction"` (default, 0..1 of the container) or `"px"`. See `./echo-rule.ts`. */
  origin?: EchoOriginUnit;
}

export interface EchoHandle {
  echo: EchoState | null;
  /** Spread on the ARRIVING layer: `[data-arriving]` is the hook for rule 3's second beat. */
  liveProps: { "data-arriving": "" | undefined };
}

const viewportRect = (): RectLike | null =>
  typeof window === "undefined"
    ? null
    : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };

const rectOf = (el: Element | null | undefined): RectLike | null =>
  el ? el.getBoundingClientRect() : null;

export function useEcho(
  nav: Pick<Nav, "state">,
  flight: Pick<LevelFlight, "flight" | "from" | "to" | "settle" | "claim" | "fallbackMs">,
  options: EchoOptions,
): EchoHandle {
  const opts = useRef(options);
  opts.current = options;
  const live = useRef(flight);
  live.current = flight;

  const [echo, setEcho] = useState<EchoState | null>(null);

  /** The last measurement of the focus that was current when it was taken. */
  const snapshot = useRef<{ focus: Focus; rect: RectLike | null } | null>(null);
  /** The claim holding the current flight open, and which flight it is for. */
  const held = useRef<{ flight: number; release: () => void } | null>(null);

  /* Arm the flight's self-settle for the life of this surface. `ARMING_FLIGHT` is never a real
     flight, so this claims nothing and releasing it settles nothing. */
  useLayoutEffect(() => flight.claim(ARMING_FLIGHT), []);

  /* --------------------------------------------------------------- the change, and its echo */

  useLayoutEffect(() => {
    const o = opts.current;
    const { flight: id, from, to } = live.current;

    const close = () => {
      held.current?.release();
      held.current = null;
    };

    if (!echoStages(from, to, o.stages ?? levelChanged)) {
      close();
      setEcho(null);
      return;
    }

    const measured = o.measure(from) ?? null;
    const remembered =
      snapshot.current && sameFocus(snapshot.current.focus, from) ? snapshot.current.rect : null;
    const container = o.container ? rectOf(o.container()) : viewportRect();
    const unit = o.origin ?? "fraction";
    const origin = echoOrigin(measured ?? remembered, container, unit);

    close();
    const release = live.current.claim(id);
    held.current = { flight: id, release };

    const key = echoKey(id, from, to);
    let done = false;
    const onDone = () => {
      if (done) return;
      done = true;
      if (held.current?.flight === id) {
        held.current.release();
        held.current = null;
      }
      live.current.settle(id);
      setEcho((current) => (current && current.key === key ? null : current));
    };

    setEcho({
      key,
      from,
      to,
      origin,
      direction: echoDirection(from, to),
      onDone,
      unit,
      fallbackMs: live.current.fallbackMs,
    });

    return () => {
      // The next flight, or the surface leaving. Either way this echo is over; the claim must go
      // with it or the nav believes a move nobody can see is still playing.
      if (held.current?.flight === id) {
        held.current.release();
        held.current = null;
      }
    };
  }, [flight.flight]);

  /* --------------------------------------------------------------- the snapshot for NEXT time */

  /* Declared AFTER the effect above, so on the commit where the level changed that one still
     reads the previous focus's measurement before this one overwrites it. One layout read per
     level change, not per render. */
  useLayoutEffect(() => {
    const focus = nav.state.focus;
    snapshot.current = { focus, rect: opts.current.measure(focus) ?? null };
  }, [flight.flight, nav.state.focus]);

  return { echo, liveProps: { "data-arriving": echo ? "" : undefined } };
}

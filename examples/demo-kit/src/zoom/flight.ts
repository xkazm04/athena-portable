/**
 * A level change, as state: where it came from, where it is going, and whether it is over.
 *
 * WHY THE KIT OWNS THIS NOW. All three round-1 apps derived the same thing from the nav's
 * monotonic `flight` counter, and all three wrote it differently: ledgerbox adjusted a
 * `{id, from, to}` during render and kept a second `settled` counter beside it; hirelane kept a
 * `prev` ref and compared inside a dep-less layout effect; tidycrm ran a chain of timers and had
 * to invent `arrivalAbandoned` to notice the move had been walked out of. The QUESTION is the
 * same in all three — the level being left has to be known on the very frame the level changes,
 * because that is the frame the outgoing layer must still be mounted for — so the answer belongs
 * in one place.
 *
 * Nothing here is React. The rule is: `from`/`to` advance exactly when the nav's counter does,
 * and `moving` is true from that moment until the flight that is CURRENT is settled. A stale
 * settle — an animation from the previous level change completing after a new one started — is
 * ignored, which is the bug this shape exists to make impossible.
 *
 * `test/flight.test.ts` pins it.
 */
import type { Focus } from "./state";

export interface FlightState {
  /** The nav's `flight` counter this state was computed for. */
  flight: number;
  /** The focus before the last change. */
  from: Focus;
  /** The focus now. */
  to: Focus;
  /** The last flight that reported itself finished. */
  settled: number;
}

/**
 * The fallback budget, in milliseconds, when no token is given and none can be read.
 *
 * 400ms is the rubric's budget for a DOM level change ("a level change is interruptible, never
 * blocks input, has a duration budget ≤ 400 ms"), so a move with no clock of its own is assumed
 * to be one that fits it. A move that stages longer — tidycrm's arrival is about 1.2s — passes
 * `fallbackToken` or `fallbackMs`. The fallback is a SAFETY NET, not the clock: `settle()` from
 * the move's own completion is what normally ends a flight.
 */
export const FLIGHT_FALLBACK_MS = 400;

/** At rest at `focus`, with nothing in flight. */
export const initialFlight = (focus: Focus, flight = 0): FlightState => ({
  flight,
  from: focus,
  to: focus,
  settled: flight,
});

/**
 * The nav's counter moved: the focus we were going to is now the focus we came from.
 *
 * Returns the same object when the counter has not moved, so this is safe to call during render
 * (which is where it has to be called — an effect is one frame late, and one frame late is a cut
 * with extra steps).
 */
export function advanceFlight(s: FlightState, flight: number, focus: Focus): FlightState {
  if (s.flight === flight) return s;
  return { flight, from: s.to, to: focus, settled: s.settled };
}

/**
 * This flight has finished.
 *
 * A settle for anything but the current flight is DROPPED. The keyed completion element of a
 * level change that has already been superseded must not be able to declare the level change
 * that replaced it finished — which is the interruption case, i.e. the one the rule about
 * abortable moves is about.
 */
export function settleFlight(s: FlightState, flight: number): FlightState {
  if (flight !== s.flight || s.settled === flight) return s;
  return { ...s, settled: flight };
}

/** Is a level change in flight? */
export const isMoving = (s: FlightState): boolean => s.settled !== s.flight;

/**
 * A claim id that is never a real flight.
 *
 * Round 2's gap: "`settle()` has no 'this move had no camera' spelling; an unclaimed flight
 * should count as settled within a frame" — hirelane found it as a second Escape aborting back
 * INTO the dossier, because the flight that had no animation was still officially moving.
 * `useLevelFlight` can only act on that once it knows the surface speaks the claim protocol at
 * all; a surface that never claims must keep the old behaviour or every app in the repo would
 * have its echo unmounted a frame after it mounted.
 *
 * So claiming this id ARMS the self-settle without claiming any actual flight, and releasing it
 * settles nothing (the counter is monotonic from 0, so `-1` is never current). `useEcho` claims
 * it at mount; nothing else needs to.
 */
export const ARMING_FLIGHT = -1;

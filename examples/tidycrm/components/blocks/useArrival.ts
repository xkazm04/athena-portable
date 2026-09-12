"use client";

/**
 * The clock the L0-to-L1 move runs on.
 *
 * The move is four named beats and about three seconds, and the reason it is a
 * clock rather than a chain of transition-end listeners is that the beats have
 * to keep their order even when a transition is cancelled or was never allowed
 * to run at all. `style/` draws what each beat looks like; this decides when
 * each one starts.
 *
 * It lives apart from the shell because the shell's job is to lay out a sheet
 * and this is a state machine with three timers in it. Reading either one used
 * to mean reading both.
 *
 * The clock also has to survive being walked out on. A move is abandoned the
 * moment the focus stops being the one it is dressing — Escape out of L1, a
 * jump to another zone — and an abandoned move reads as no move at all, because
 * a held `opening` is what disables the plate's controls. See
 * `arrivalAbandoned`.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { Focus, ZoomNav } from "@athena/demo-kit/zoom";

import type { FieldPhase } from "./Field";

/**
 * How long each beat is given, in milliseconds.
 *
 * These are long on purpose. The first cut ran the whole hand-off in seventy
 * milliseconds and the review was that the level had simply been replaced —
 * correctly, because a move nobody can follow is indistinguishable from a cut.
 * A reader has to be able to watch the plate of dots come apart, watch each
 * block walk to its place, and watch the blocks acquire their names, as three
 * separate things.
 *
 * `LAND` is the invisible one: the cells are already on top of the canvas's
 * clusters, and this is only the room the canvas needs to fade out from under
 * them.
 *
 * `DRESS` is the longest because it is three things and not one: every cell
 * grows its ground and its rule, then its ident and its name, then its figures,
 * each offset behind the last inside its own cell and behind its neighbour
 * across the grid. The stylesheet owns those offsets (`--bk-stagger` and the
 * `data-phase` rules); this number only has to be long enough for the last cell
 * in the wave to finish its last part.
 */
const LAND = 300;
const SPREAD = 800;
const DRESS = 860;

const MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Has the move been abandoned — is the level the arrival is dressing no longer
 * the level on screen?
 *
 * The beats run on timers rather than on the focus, so nothing in the clock
 * notices when the reader leaves in the middle of one. Escape inside the
 * arrival window drops L1 back to L0 while `opening` is still set, and `opening`
 * is what disables every zone key and unmounts every quadrant's hit volume — so
 * an abandoned move that is never cleaned up is a plate nobody can click and a
 * level nobody can leave.
 *
 * `settled` is the resting phase at BOTH ends: before the hand-off the cube is
 * still flattening at L0 with `opening` set, which is the move working
 * correctly. Only once a beat is running has the arrival taken a level of its
 * own to be abandoned from.
 *
 * Pure, and exported, so the decision can be pinned without a renderer.
 */
export function arrivalAbandoned(
  focus: Pick<Focus, "level" | "group">,
  opening: string | null,
  phase: FieldPhase,
): boolean {
  if (opening === null || phase === "settled") return false;
  return !(focus.level >= 1 && focus.group === opening);
}

export function useArrival(nav: ZoomNav) {
  /**
   * The zone whose records are mid-flight.
   *
   * Opening a zone is not one beat but four, and the level does not change
   * until the cube has finished flattening. Holding the id here is what lets
   * the scene finish its move before the DOM arrives on top of it.
   */
  const [held, setOpening] = useState<string | null>(null);
  /**
   * Which beat of the arrival L1 is in. See `Field`'s header for what each one
   * draws; this component only owns the clock.
   */
  const [beat, setPhase] = useState<FieldPhase>("settled");
  const timers = useRef<number[]>([]);

  /**
   * The reader left in the middle of the move — Escape out of L1, or a jump to
   * another zone — so the move is over whatever the timers still believe, and
   * an abandoned arrival is read as no arrival rather than being written back
   * into state. (Writing it back would be a setState inside an effect, which is
   * the cascading render this hook exists to avoid.)
   *
   * `held` is not decoration: it disables every zone key and unmounts every
   * quadrant's hit volume in `Cube3D`. Left standing after Escape it gives back
   * an L0 with nothing on it that can be pressed, no rung to climb and no way
   * out but a reload.
   */
  const lapsed = arrivalAbandoned(nav.state.focus, held, beat);
  const opening = lapsed ? null : held;
  const phase: FieldPhase = lapsed ? "settled" : beat;

  // A move abandoned halfway — the reader hits back, or leaves — must not have
  // its later beats fire into a level that is no longer on screen.
  const clearTimers = useCallback(() => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  /**
   * The cube has finished flattening; run the rest of the move.
   *
   * The level changes here and the canvas does NOT leave: `opening` stays set,
   * so the dots hold their flattened pose while the cells are measured onto
   * them, and the scene is only unmounted once the blocks have places of their
   * own to be. Each beat is a timer rather than a transition-end listener,
   * because the beats have to keep their order even when a transition is
   * cancelled or was never allowed to run.
   */
  const flattened = useCallback(() => {
    const id = opening;
    if (!id) return;
    clearTimers();
    nav.openGroup(id);

    // With motion turned down there is nothing to watch, so there is nothing to
    // wait for either: the grid is simply there.
    if (window.matchMedia(MOTION_QUERY).matches) {
      setPhase("settled");
      setOpening(null);
      return;
    }

    setPhase("land");
    const at = (ms: number, run: () => void) => timers.current.push(window.setTimeout(run, ms));
    at(LAND, () => setPhase("spread"));
    at(LAND + SPREAD, () => {
      setPhase("dress");
      setOpening(null);
    });
    at(LAND + SPREAD + DRESS, () => setPhase("settled"));
  }, [clearTimers, nav, opening]);

  /** Opening a second zone from L1 has no cube to come out of, so it has no
      arrival to stage either — the cells simply change. */
  const openZone = useCallback(
    (id: string) => {
      clearTimers();
      setPhase("settled");
      // The cube may still be held for the zone being left, if the jump lands
      // inside its arrival window. Nothing is coming out of it now.
      setOpening(null);
      nav.openGroup(id);
    },
    [clearTimers, nav],
  );

  /**
   * Opening a zone FROM the plate.
   *
   * With motion turned down this does not hand the request to the scene at all.
   * It used to: `setOpening` started the cube's flatten, the flatten ran its
   * full duration, and only when it reported back did `flattened` notice the
   * preference and skip the beats — so a reader who had asked for less motion
   * waited more than a second in front of an animation they were never going to
   * be shown. The preference is checked before the move starts, not after.
   */
  const openFromPlate = useCallback(
    (id: string) => {
      // A second request for the zone already arriving is not a new move. The
      // cube has no second flatten to run for it, so nothing would call back to
      // restart the beats — and clearing them would leave the arrival stopped
      // where it stood, with `opening` set and no timer left to release it.
      if (id === opening) return;
      clearTimers();
      // Whatever beat a lapsed arrival died on, this move starts from rest.
      setPhase("settled");
      if (window.matchMedia(MOTION_QUERY).matches) {
        setOpening(null);
        nav.openGroup(id);
        return;
      }
      setOpening(id);
    },
    [clearTimers, nav, opening],
  );

  return { opening, phase, openFromPlate, openZone, flattened };
}

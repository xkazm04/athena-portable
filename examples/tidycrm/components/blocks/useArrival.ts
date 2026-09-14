"use client";

/**
 * The clock the L0-to-L1 move runs on.
 *
 * The move is four named beats and about a second and a fifth, and the reason it
 * is a clock rather than a chain of transition-end listeners is that the beats
 * have to keep their order even when a transition is cancelled or was never
 * allowed to run at all. `style/` draws what each beat looks like; this decides
 * when each one starts. The numbers are not here: they are `./beats.ts`, which
 * the tokens and the advertised cost also read.
 *
 * It lives apart from the shell because the shell's job is to lay out a sheet
 * and this is a state machine with three timers in it. Reading either one used
 * to mean reading both.
 *
 * THE MOVE CAN BE WALKED OUT OF, in two different ways, and both are here.
 *
 *   · After the hand-off, the level has already changed, so the kit's Escape and
 *     the back button both work and the clock only has to NOTICE — see
 *     `arrivalAbandoned`. A held `opening` is what disables the plate, so an
 *     abandoned move that is never cleaned up is a plate nobody can click.
 *   · BEFORE the hand-off the level is still 0, and `escapeLeavesLevel` never
 *     claims Escape at L0 — correctly, there is nowhere above it to go. So for
 *     the length of the cube's flatten there was no way out at all: Escape a
 *     tenth of a second in was swallowed and the reader arrived at L1 anyway.
 *     `escapeAbortsArrival` is the missing half, and `abort` is what it runs.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { Focus, ZoomNav } from "@athena/demo-kit/zoom";

import { DRESS, LAND, SPREAD } from "./beats";
import type { FieldPhase } from "./Field";

const MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Is this Escape the arrival's to cancel?
 *
 * The kit owns Escape from L1 upward and declines it at L0 (`escape.ts`), which
 * leaves exactly one window uncovered: the cube is flattening, `opening` is set,
 * and the level has not changed yet. Nothing else on the sheet wants the key
 * there, and a move that cannot be stopped for its first four hundred
 * milliseconds is a move the reader does not control.
 *
 * Asked BEFORE `preventDefault`, and declining an event somebody else has
 * already claimed, for the same reason the kit does: a listener that calls
 * `preventDefault` on a key the page has not decided about cannot be composed
 * with.
 *
 * Pure, and exported, so the decision can be pinned without a renderer.
 */
export function escapeAbortsArrival(
  event: { key: string; defaultPrevented: boolean },
  level: number,
  opening: string | null,
): boolean {
  if (event.key !== "Escape") return false;
  if (event.defaultPrevented) return false;
  if (opening === null) return false;
  return level === 0;
}

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
   * Stop the move and give the plate back.
   *
   * Dropping `opening` is the whole act: the scene reads it every frame, so the
   * records walk back out of the plate and into the lattice over `UNFLATTEN`,
   * the quadrants get their hit volumes back, the zone keys come out of their
   * stepped-back state and the caption stops claiming a zone is opening. There
   * is nothing to unwind, because nothing was committed — the level has not
   * changed yet, which is exactly the window this is for.
   */
  const abort = useCallback(() => {
    clearTimers();
    setPhase("settled");
    setOpening(null);
  }, [clearTimers]);

  /**
   * Escape, for the one window the kit cannot cover. See `escapeAbortsArrival`.
   *
   * Bound on `window` rather than on the plate because the reader may have
   * pressed a zone key, clicked a quadrant on the canvas, or asked an agent —
   * in the last two cases nothing on the sheet holds focus, so a React handler
   * would never see the key.
   */
  const level = nav.state.focus.level;
  useEffect(() => {
    if (held === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (!escapeAbortsArrival(event, level, held)) return;
      event.preventDefault();
      abort();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [abort, held, level]);

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

  return { opening, phase, openFromPlate, openZone, flattened, abort };
}

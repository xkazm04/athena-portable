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
 * IT IS THE KIT'S FLIGHT NOW, and that is what deleted half of this file.
 *
 * Round 1 left this hook holding two predicates nobody else should have needed:
 * `escapeAbortsArrival`, because the kit declined Escape at L0 and the flatten
 * happened at L0, so for four hundred milliseconds the key reached nobody; and
 * `arrivalAbandoned`, because the beats ran on timers that had no idea the
 * reader had walked out from under them. Both were symptoms of the same thing —
 * the move was committed to the nav only at its halfway point, so for its first
 * half there was no move as far as the model was concerned.
 *
 * So the nav is told at the START. `openFromPlate` dispatches `openGroup`
 * immediately and the flatten runs inside the flight that creates: `moving` is
 * true from that frame, which is what makes the nav's own Escape listener
 * `abort()` (back to the focus the move left) rather than `up()` (out of a level
 * nobody arrived at) — formula §1 rule 6, `escapeAbortsFlight` in the kit. And
 * because the beats are keyed to the database the nav is actually on, a move
 * that has been abandoned or replaced stops being this hook's business without
 * anyone having to notice: `beat` derives to `settled` the moment the focus is
 * no longer the one the beats were staged over.
 *
 * WHAT THE SHEET DRAWS IS STILL L0 UNTIL THE HAND-OFF. The nav being at L1 for
 * the length of the flatten is the truth — the reader has chosen, and Escape
 * now means "put me back" rather than "go up" — but the picture is still the
 * plate, so `level` below is what the SHEET reads. That is rule 1 in its
 * smallest form: the level you leave carries the camera.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useLevelFlight, type ZoomNav } from "@athena/demo-kit/zoom";

import { DRESS, LAND, SPREAD } from "./beats";
import type { FieldPhase } from "./Field";

const MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * The beats, including the one the DOM never sees.
 *
 * `flatten` is the picture's own: the dots leaving their cells for the plane,
 * before any of L1 is mounted. The other four are `FieldPhase`, because they are
 * what the arriving level is drawn in.
 */
export type ArrivalBeat = "flatten" | FieldPhase;

/** The beats during which the L0 picture is still holding the pose. */
const HOLDING: ReadonlySet<ArrivalBeat> = new Set<ArrivalBeat>(["flatten", "land", "spread"]);

/**
 * The beats, and the database they were staged over.
 *
 * Keyed by the database rather than kept as a bare beat, which is the whole of
 * what `arrivalAbandoned` used to compute: if the nav is no longer on the
 * database these beats belong to — Escape, an abort, a jump to another one —
 * they are not this move's beats any more and the derivation below says so.
 * A timer that fires afterwards writes a beat for a database nobody is on, and
 * is ignored rather than having to be cancelled correctly.
 */
export interface Staged {
  database: string | null;
  at: ArrivalBeat;
}

/**
 * Which beat this move is actually in.
 *
 * The staged beat counts only while the nav is still on the database it was
 * staged over AND the flight carrying it is still in the air. Anything else — an
 * abort back to the plate, a jump to another database, a flight that has already
 * settled — is rest, and a timer that fires afterwards writes a beat for a
 * database nobody is on and is ignored rather than having to be cancelled
 * correctly. This is the whole of what `arrivalAbandoned` used to compute, and
 * it is pure and exported for the same reason that was: so the decision can be
 * pinned without a renderer.
 */
export function beatOf(
  staged: Staged,
  group: string | null,
  moving: boolean,
): ArrivalBeat {
  if (!moving) return "settled";
  if (staged.database === null || staged.database !== group) return "settled";
  return staged.at;
}

/** The database whose tables are mid-flight: the picture is still holding a pose for it. */
export function openingOf(beat: ArrivalBeat, group: string | null): string | null {
  return HOLDING.has(beat) ? group : null;
}

/**
 * The level the SHEET draws, given the level the nav is on.
 *
 * They differ for exactly one window — the flatten — because the reader has
 * chosen but the picture has not handed over yet. Only L1 is held back: an
 * `open_item` that lands mid-flatten still draws its dossier, because the reader
 * (or the agent) asked for a place two levels in and the plate is not it.
 */
export function drawnLevel(beat: ArrivalBeat, level: number): number {
  return beat === "flatten" && level === 1 ? 0 : level;
}

export interface Arrival {
  /** The database whose tables are mid-flight, or null at rest. */
  opening: string | null;
  /** Which beat the arriving level is drawn in. */
  phase: FieldPhase;
  /**
   * The level the SHEET draws, which is not always the level the nav is on: the
   * plate is still the plate for the length of the flatten.
   */
  level: number;
  openFromPlate: (id: string) => void;
  openDatabase: (id: string) => void;
  /** The picture has finished flattening. Called by whichever L0 is mounted. */
  flattened: () => void;
}

export function useArrival(nav: ZoomNav): Arrival {
  /*
   * `--bk-dur-5` is the safety net, not the clock: `beats.ts` is the clock and
   * `settle()` below is what normally ends the flight. The net only matters for
   * a move whose completion never arrives — a picture that failed to report, or
   * a reduced-motion cut whose beats never ran.
   */
  const flight = useLevelFlight(nav, { fallbackToken: "--bk-dur-5" });
  const [staged, setStaged] = useState<Staged>({ database: null, at: "settled" });
  const timers = useRef<number[]>([]);

  const focus = nav.state.focus;
  const settle = flight.settle;

  const beat = beatOf(staged, focus.group, flight.moving);
  const opening = openingOf(beat, focus.group);
  const phase: FieldPhase = beat === "flatten" ? "settled" : beat;
  // Rule 1, in its smallest form: the level being left carries the camera.
  const level = drawnLevel(beat, focus.level);

  const clearTimers = useCallback(() => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  /*
   * A flight with no beats staged over it has already landed.
   *
   * Every other level change on this sheet is immediate — a jump between
   * databases, a table opening into its dossier, an abort back to the plate — so
   * the flight that carries it ends on the frame it started. Only the arrival
   * holds one open, and it holds it exactly until its last beat sets `settled`.
   */
  useEffect(() => {
    if (flight.moving && beat === "settled") settle();
  }, [beat, flight.moving, settle]);

  /**
   * The picture has finished flattening; run the rest of the move.
   *
   * The level does not change here any more — the nav has been at L1 since the
   * reader chose — but the SHEET's does: `land` is the first beat in which L1
   * exists, and it exists on top of the pose the picture is still holding. Each
   * beat is a timer rather than a transition-end listener, because the beats
   * have to keep their order even when a transition is cancelled or was never
   * allowed to run.
   */
  const flattened = useCallback(() => {
    if (beat !== "flatten") return;
    const database = focus.group;
    if (database === null) return;
    clearTimers();

    // With motion turned down there is nothing to watch, so there is nothing to
    // wait for either: the grid is simply there.
    if (window.matchMedia(MOTION_QUERY).matches) {
      setStaged({ database, at: "settled" });
      return;
    }

    setStaged({ database, at: "land" });
    const at = (ms: number, next: ArrivalBeat) =>
      timers.current.push(window.setTimeout(() => setStaged({ database, at: next }), ms));
    at(LAND, "spread");
    at(LAND + SPREAD, "dress");
    at(LAND + SPREAD + DRESS, "settled");
  }, [beat, clearTimers, focus.group]);

  /**
   * Opening a database FROM the plate.
   *
   * The nav is told first, which is the whole of the migration: the flatten now
   * happens inside a flight, so Escape a tenth of a second in is the nav's abort
   * and puts the reader back on the plate rather than being swallowed.
   *
   * With motion turned down this stages nothing at all. It used to hand the
   * request to the scene regardless, let the flatten run its full duration, and
   * only notice the preference when the scene reported back — so a reader who
   * had asked for less motion waited more than a second in front of an animation
   * they were never going to be shown.
   */
  const openFromPlate = useCallback(
    (id: string) => {
      // A second request for the database already arriving is not a new move.
      // The picture has no second flatten to run for it, so nothing would call
      // back to restart the beats.
      if (id === opening) return;
      clearTimers();
      const reduced = window.matchMedia(MOTION_QUERY).matches;
      setStaged({ database: id, at: reduced ? "settled" : "flatten" });
      nav.openGroup(id);
    },
    [clearTimers, nav, opening],
  );

  /** Opening a second database from L1 has no picture to come out of, so it has
      no arrival to stage either — the cells simply change. */
  const openDatabase = useCallback(
    (id: string) => {
      clearTimers();
      setStaged({ database: id, at: "settled" });
      nav.openGroup(id);
    },
    [clearTimers, nav],
  );

  return useMemo(
    () => ({ opening, phase, level, openFromPlate, openDatabase, flattened }),
    [flattened, level, openDatabase, openFromPlate, opening, phase],
  );
}

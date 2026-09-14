"use client";

/**
 * The clock the L0-to-L1 move runs on.
 *
 * TWO BEATS NOW, NOT FOUR, and the deletion is the concept. Rounds 1 and 2 had a
 * WebGL L0 that flattened its dots onto a published plane and a DOM L1 that was
 * measured onto that plane and then walked to its grid; three of the four beats
 * existed to make that hand-off invisible. Round 3 has one scene at two camera
 * distances, so there is no hand-off: the camera flies (`flight`), and when it
 * has stopped the tables write on what they only carry at this depth (`dress`).
 * `beats.ts` is why each number is what it is.
 *
 * THE CAMERA IS THE FLIGHT, AND THE KIT OWNS IT. `useSemanticZoom` calls
 * `rig.flyTo(poseFor(focus))` on every nav change, whatever caused it — a click,
 * an agent's `open_group`, Escape, an abort — and claims the level flight for the
 * length of it. So this hook moves nothing. It says what the DOM may draw while
 * the camera is doing it (nothing, until it has landed), and it holds the flight
 * open for one beat longer than the camera needs, because the move is not over
 * when the camera stops: the words have still to be written.
 *
 * That is rule 3 across two technologies — the slab is the box, the projected
 * label is the ink — and it is also the only honest answer: a label projected
 * through a moving perspective camera is type sliding and rescaling every frame,
 * which nobody can read.
 *
 * WHAT IT KEPT FROM ROUND 2. The beats are staged AGAINST A DATABASE rather than
 * held as a bare beat, so a move that has been abandoned or replaced stops being
 * this hook's business without anyone having to notice: `beatOf` derives to
 * `settled` the moment the nav is no longer on the database they were staged
 * over. A timer that fires afterwards writes a beat for a database nobody is on
 * and is ignored rather than having to be cancelled correctly.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { type LevelFlight, type ZoomNav } from "@athena/demo-kit/zoom";

import { DRESS, FLIGHT } from "./beats";
import { useReducedMotionQuery } from "./l0/useReduced";

/**
 * The beats of the arrival.
 *
 *   flight   the camera is travelling. The scene is the only thing moving; the
 *            projected labels are not drawn at all.
 *   dress    the camera has landed. Each table's cluster, name and figures write
 *            on, staggered across the octant.
 *   settled  an ordinary level, with nothing left animating.
 */
export type FieldPhase = "flight" | "dress" | "settled";

/** The beats, and the database they were staged over. */
export interface Staged {
  database: string | null;
  at: FieldPhase;
}

/**
 * Which beat this move is actually in.
 *
 * The staged beat counts only while the nav is still on the database it was
 * staged over AND the flight carrying it is still in the air. Anything else — an
 * abort back to the cube, a jump to another database, a flight that has already
 * settled — is rest. Pure and exported so the decision can be pinned without a
 * renderer.
 */
export function beatOf(staged: Staged, group: string | null, moving: boolean): FieldPhase {
  if (!moving) return "settled";
  if (staged.database === null || staged.database !== group) return "settled";
  return staged.at;
}

/**
 * Whether the projected labels may be drawn at all.
 *
 * They may not while the camera is flying. There is no equivalent of round 2's
 * `drawnLevel` any more — the SHEET's level and the NAV's level are the same
 * number, because the picture the reader is looking at is the same picture at
 * both levels and it never has to be held back.
 */
export function inkable(beat: FieldPhase): boolean {
  return beat !== "flight";
}

export interface Arrival {
  /** Which beat the arriving level is drawn in. */
  phase: FieldPhase;
  /** Open a database: tell the nav, and stage the beats over it. */
  openDatabase: (id: string) => void;
}

export function useArrival(nav: ZoomNav, flight: LevelFlight): Arrival {
  const reduced = useReducedMotionQuery();
  const [staged, setStaged] = useState<Staged>({ database: null, at: "settled" });

  const focus = nav.state.focus;
  const group = focus.level >= 1 ? focus.group : null;

  /*
   * WHICH DATABASE THE BEATS BELONG TO, DERIVED DURING RENDER rather than set in
   * an effect — React's own recipe for state that follows a prop, and here the
   * one that is also correct: the beats have to be staged in the SAME commit the
   * level changes, or the labels are painted once at full ink before the camera
   * has started moving, which is the single frame the whole beat exists to
   * remove. `database` is the guard and it cannot loop.
   *
   * A database can be arrived at without anybody calling `openDatabase` — a
   * wheel that crossed the band, an agent's `open_item` two levels in, an abort
   * — so this watches the NAV rather than the opener. And it deliberately does
   * NOT restage when the dossier opens over a database already arrived at: the
   * group has not changed, so neither has the move.
   *
   * With motion turned down nothing is staged at all. The rig lands the flight
   * on its final state at frame zero (`reducedMotion: "user"`), so there is
   * nothing to wait for and the level is simply there.
   */
  if (staged.database !== group) {
    setStaged({ database: group, at: group === null || reduced ? "settled" : "flight" });
  }

  const phase = beatOf(staged, focus.group, flight.moving);

  /**
   * The two beats, on one timer chain.
   *
   * Keyed on the DATABASE alone, so the beat changing does not tear its own
   * chain down. Each beat is a timer rather than a transition-end listener,
   * because the beats have to keep their order even when a transition is
   * cancelled or was never allowed to run.
   *
   * THE FLIGHT IS HELD FOR THE DRESSING. The kit settles the level flight when
   * the CAMERA stops, and the camera stopping is not the end of the move — the
   * words have still to be written. `claim()` is the kit's word for "something
   * is moving for this flight, wait for it", and releasing it is what lets the
   * flight, and therefore `moving`, and therefore what Escape means, land.
   */
  const flightNo = flight.flight;
  const claim = flight.claim;
  useEffect(() => {
    if (staged.database === null || reduced) return;
    const database = staged.database;
    const release = claim(flightNo);
    let settle = 0;
    const dress = window.setTimeout(() => {
      setStaged({ database, at: "dress" });
      settle = window.setTimeout(() => {
        setStaged({ database, at: "settled" });
        release();
      }, DRESS);
    }, FLIGHT);
    return () => {
      window.clearTimeout(dress);
      window.clearTimeout(settle);
      release();
    };
    // NOTE: `staged.at` is written BY this effect and is deliberately not a
    // dependency; depending on it would have the chain tear itself down one
    // beat in.
  }, [claim, flightNo, reduced, staged.database]);

  /**
   * Opening a database.
   *
   * The nav is told, and that is all: the flight it creates is what the camera
   * flies and what the beats above key off. Telling the nav FIRST is the whole
   * of round 2's migration — Escape a tenth of a second in is `nav.abort()` and
   * flies the camera back out rather than being swallowed (formula §1 rule 6).
   */
  const openDatabase = useCallback((id: string) => nav.openGroup(id), [nav]);

  return useMemo(() => ({ phase, openDatabase }), [openDatabase, phase]);
}

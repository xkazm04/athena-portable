"use client";

/**
 * THE TURN AS A GUIDED STORY — twelve stops that dim the drawing down to the one being told.
 *
 * ROUND 4 MADE THE TURN A SCRUBBER: twelve numbered stops, all drawn at once, one lit. That is
 * strictly better than round 3's light travelling through a machine, and it is still not a story —
 * a reader looking at stop 7 sees eleven other numbered blocks with equal weight and has to hold
 * the sequence in their head. The archify study §4's guided views are the missing half: a beat has
 * a STATE relative to where the reader is (`past` / `active` / `next`), everything that is not part
 * of the beat is dimmed to spatial reference, and the trail the story has travelled is drawn as an
 * OVERLAY on top of the authored runs — which keep their own style, because the story is a way of
 * reading the drawing and not an edit to it (study §7.11).
 *
 * THE THREE OPACITIES ARE THE STUDY'S: past 0.72, active 1, next 0.5, and they live in the token
 * file like every other value. What is *not* the study's is the interval: archify plays at 3200 ms
 * and this plays at `--at-dur-beat`, because a beat here is one short label rather than a chapter.
 *
 * FINITE MOTION (study §4, §7.9). The story runs ONCE, from wherever it is started to the last
 * stop, and then stops — there is no loop, and the static frame at every beat carries the whole
 * meaning. Under reduced motion it does not animate at all: it lands on the final beat at frame
 * zero, with every past state shown, which is the same branch rule 8 asks of every other move in
 * the app rather than a special case for content.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { cssMs } from "@athena/demo-kit/zoom";

import { TURN } from "./turn";

/** What a beat is, relative to where the reader is standing in the story. */
export type BeatState = "past" | "active" | "next";

export const beatOf = (index: number, at: number): BeatState | null =>
  index === at ? "active" : index < at ? "past" : index === at + 1 ? "next" : null;

/**
 * A block's beat state: the strongest one among the stops it holds.
 *
 * A block can hold several stops (the gate's three moments are in three systems, but `sys-record`
 * holds both the approval and the ledger row), so "which beat is this block" has to be decided
 * rather than looked up. Active beats past beats next: the block the story is IN is the one the
 * reader is meant to look at, whatever else has happened there.
 */
export function blockBeat(block: string, at: number): BeatState | null {
  let best: BeatState | null = null;
  for (const s of TURN) {
    if (s.block !== block) continue;
    const state = beatOf(s.index, at);
    if (state === "active") return "active";
    if (state === "past") best = "past";
    else if (state === "next" && best === null) best = "next";
  }
  return best;
}

/** A leg's beat state. A leg's number is the stop it ARRIVES at, 1-based — the run's own weight. */
export const legBeat = (arrivesAt: number, at: number): BeatState | null =>
  beatOf(arrivesAt - 1, at);

/** Every block the story touches at all. Everything else is dimmed to spatial reference. */
export const STORY_BLOCKS: ReadonlySet<string> = new Set(TURN.map((s) => s.block));

export interface Story {
  /** True while the story is being told rather than merely scrubbed. */
  on: boolean;
  playing: boolean;
  at: number;
  start: () => void;
  stop: () => void;
  toggle: () => void;
  /** Play from here to the last beat, once. */
  play: () => void;
  pause: () => void;
  go: (index: number) => void;
}

/**
 * The story's clock. ONE timer, one owner, and it cancels itself at the last beat.
 *
 * The duration is read out of the cascade with the kit's `cssMs` (rule 4: no millisecond is typed
 * in JavaScript), so the reduced-motion branch of the token file turns the interval to zero — and
 * the hook reads that zero as "do not animate" rather than as "animate very fast", which is the
 * wrong branch every law document in this repository names.
 */
export function useStory(at: number, go: (index: number) => void, reduced: boolean): Story {
  const [on, setOn] = useState(false);
  const [running, setRunning] = useState(false);
  const goRef = useRef(go);
  useEffect(() => {
    goRef.current = go;
  });

  const last = TURN.length - 1;

  /**
   * PLAYING IS DERIVED, NOT STORED, and that is what makes the clock finite without a setState
   * inside an effect. A story that has reached its last beat is not playing — there is nothing
   * left to play — so the effect never has to turn itself off, and the compiler's cascading-render
   * rule has nothing to object to. The one piece of state is "did the reader ask for it".
   */
  const playing = running && at < last;

  useEffect(() => {
    if (!playing) return;
    const beat = cssMs("--at-dur-beat", null, 0);
    /* Zero is the reduced-motion branch of the token file. `play` has already landed on the final
       beat in that case, so there is nothing to schedule and nothing to animate faster. */
    if (beat <= 0) return;
    const id = window.setTimeout(() => goRef.current(at + 1), beat);
    return () => window.clearTimeout(id);
  }, [at, playing]);

  const start = useCallback(() => setOn(true), []);
  const stopStory = useCallback(() => {
    setOn(false);
    setRunning(false);
  }, []);
  const toggle = useCallback(() => {
    setRunning(false);
    setOn((v) => !v);
  }, []);

  const play = useCallback(() => {
    setOn(true);
    if (reduced) {
      /* The final state at frame zero, with every past beat shown (rule 8). */
      goRef.current(last);
      return;
    }
    if (at >= last) goRef.current(0);
    setRunning(true);
  }, [at, last, reduced]);

  const pause = useCallback(() => setRunning(false), []);

  const goTo = useCallback((index: number) => {
    setRunning(false);
    goRef.current(index);
  }, []);

  return { on, playing, at, start, stop: stopStory, toggle, play, pause, go: goTo };
}

"use client";

/**
 * THE TRANSPORT: one beat, played, paused and scrubbed.
 *
 * The turn is the only thing in Atlas that moves on its own, so it is the only thing that needs a
 * clock of its own, and it has exactly one number — the beat. Play advances it, the scrubber sets
 * it, the stop buttons snap it, and `turnAt(beat)` turns it into a light. Every renderer reads
 * the same beat, which is what makes "the same turn, judged on three renderings" a true sentence.
 *
 * THE BEAT NEVER ENTERS REACT STATE. A rAF loop that called `setState` sixty times a second would
 * re-render the rails, the mast and the pane on every frame of a turn, and the webgl variant
 * would have no way to be cheaper than the DOM ones. So the beat lives in a ref with a subscriber
 * set, exactly like the camera pose, and React state holds only what a human reads: whether it is
 * playing, and which stop the light is at. A stop changes eleven times in a turn, not six hundred.
 *
 * REDUCED MOTION IS A SEQUENCE OF STILLS, not a faster animation and not a dead control. The beat
 * snaps to the middle of each stop's dwell and steps one stop at a time, so a reader who asked for
 * no motion still gets the whole argument — eleven stills, one label each, on the same clock.
 * `--at-dur-beat` is deliberately NOT zeroed in the reduced block of `tokens.css`: the turn is
 * content, not a transition, and zeroing it would show the reader a blank machine and call it
 * accessibility.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { TURN, TURN_BEATS, beatOfStop, turnAt, type TurnFrame } from "./turn";

export interface Transport {
  /** Live beat, read outside React. Renderers call this in their own frame loop. */
  beat: () => number;
  /** The current frame, for a renderer that wants the whole answer. */
  frame: () => TurnFrame;
  playing: boolean;
  /** Which stop the light is at or heading for. React state — it changes eleven times, not 600. */
  stop: number;
  /** True when the light is parked at the gate, waiting. The surface may say so. */
  waiting: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  /** Absolute seek, in beats. The scrubber's onChange. */
  seek: (beat: number) => void;
  /** Snap to a stop's reading position. The transport's step buttons and the tools. */
  goTo: (index: number) => void;
  step: (delta: number) => void;
  rewind: () => void;
  /** Subscribe to every frame of the beat. Renderers use this; humans use `stop`. */
  subscribe: (cb: (beat: number) => void) => () => void;
  total: number;
  stops: typeof TURN;
}

export function useTurnTransport(opts: { beatMs: number; reduced: boolean }): Transport {
  const { beatMs, reduced } = opts;
  const beat = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [stop, setStop] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const subs = useRef(new Set<(b: number) => void>());
  const raf = useRef(0);
  const last = useRef(0);
  /* The beat's length is read inside two loops that must not be torn down and rebuilt every time
     the cascade is re-measured, so it is mirrored into a ref — from an effect, because writing a
     ref during render is a write React cannot see. */
  const beatMsRef = useRef(beatMs);
  useEffect(() => {
    beatMsRef.current = beatMs;
  }, [beatMs]);

  const publish = useCallback((next: number) => {
    beat.current = next;
    for (const cb of subs.current) cb(next);
    const f = turnAt(next);
    /* React only hears about the parts a human reads. */
    setStop((s) => (s === f.stop.index ? s : f.stop.index));
    setWaiting((w) => (w === f.waiting ? w : f.waiting));
  }, []);

  const stopLoop = useCallback(() => {
    if (raf.current !== 0) cancelAnimationFrame(raf.current);
    raf.current = 0;
  }, []);

  /* --------------------------------- the moving branch --------------------------------- */

  /* The loop calls itself, so it is reached through a ref rather than by name: a `useCallback`
     that closes over itself closes over the version that existed when it was created, which is
     the classic stale-frame bug and is exactly what the compiler's rule is pointing at. */
  const tickRef = useRef<(now: number) => void>(() => {});
  const tick = useCallback(
    (now: number) => {
      const dt = Math.min(64, now - last.current);
      last.current = now;
      const per = Math.max(1, beatMsRef.current);
      const next = beat.current + dt / per;
      if (next >= TURN_BEATS) {
        publish(TURN_BEATS);
        raf.current = 0;
        setPlaying(false);
        return;
      }
      publish(next);
      raf.current = requestAnimationFrame((t) => tickRef.current(t));
    },
    [publish],
  );
  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  /* --------------------------------- the stills branch --------------------------------- */

  const stills = useRef(0);
  const holdRef = useRef<(index: number) => void>(() => {});
  const holdStill = useCallback(
    (index: number) => {
      window.clearTimeout(stills.current);
      if (index >= TURN.length) {
        setPlaying(false);
        return;
      }
      publish(beatOfStop(index));
      const dwell = TURN[index]!;
      stills.current = window.setTimeout(
        () => holdRef.current(index + 1),
        Math.max(1, beatMsRef.current) * (dwell.end - dwell.arrive),
      );
    },
    [publish],
  );
  useEffect(() => {
    holdRef.current = holdStill;
  }, [holdStill]);

  /* ------------------------------------- the verbs ------------------------------------- */

  const pause = useCallback(() => {
    stopLoop();
    window.clearTimeout(stills.current);
    setPlaying(false);
  }, [stopLoop]);

  const play = useCallback(() => {
    setPlaying(true);
    if (beat.current >= TURN_BEATS) publish(0);
    if (reduced) {
      holdStill(turnAt(beat.current).stop.index);
      return;
    }
    last.current = performance.now();
    stopLoop();
    raf.current = requestAnimationFrame(tick);
  }, [holdStill, publish, reduced, stopLoop, tick]);

  const toggle = useCallback(() => (playing ? pause() : play()), [pause, play, playing]);

  const seek = useCallback(
    (to: number) => {
      pause();
      const clamped = Math.min(TURN_BEATS, Math.max(0, to));
      /* Under reduced motion a scrub lands on the nearest still rather than between two. */
      publish(reduced ? beatOfStop(turnAt(clamped).stop.index) : clamped);
    },
    [pause, publish, reduced],
  );

  const goTo = useCallback(
    (index: number) => {
      pause();
      publish(beatOfStop(Math.min(TURN.length - 1, Math.max(0, index))));
    },
    [pause, publish],
  );

  const stepBy = useCallback(
    (delta: number) => goTo(turnAt(beat.current).stop.index + delta),
    [goTo],
  );

  const rewind = useCallback(() => {
    pause();
    publish(0);
  }, [pause, publish]);

  useEffect(
    () => () => {
      if (raf.current !== 0) cancelAnimationFrame(raf.current);
      window.clearTimeout(stills.current);
    },
    [],
  );

  return useMemo<Transport>(
    () => ({
      beat: () => beat.current,
      frame: () => turnAt(beat.current),
      playing,
      stop,
      waiting,
      play,
      pause,
      toggle,
      seek,
      goTo,
      step: stepBy,
      rewind,
      subscribe: (cb) => {
        subs.current.add(cb);
        cb(beat.current);
        return () => subs.current.delete(cb);
      },
      total: TURN_BEATS,
      stops: TURN,
    }),
    [goTo, pause, play, playing, rewind, seek, stepBy, stop, toggle, waiting],
  );
}

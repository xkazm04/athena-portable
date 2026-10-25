/**
 * One mouth (ADR 0120, "Measured"): the producer in the athena window shapes the opening from the
 * one viseme table, and every face's driver follows it, so her own window (every frame) and Main
 * (the 30 Hz mirror) draw the same mouth, and a closure shuts on both.
 *
 * The line is the calm fixture run through the real producer (`startFace`) and the real timeline
 * (`addVisemes`, closure floor included) on a stepped 60 fps clock, then through two drivers.
 */
import { afterEach, describe, expect, it } from "vitest";

import * as preview from "@/lib/face-preview";
import { mouthTarget } from "@/lib/face-preview";
import { startFace, VISEME_LEAD_S, type FaceDeps, type FaceInputs } from "@/lib/face-signal";
import { addVisemes, beginLine, faceTimeline, resetFaceTimelineForTests, type FaceTimeline } from "@/lib/face-timeline";

import { createDriver } from "./driver";
import { CALM_DURATION, CALM_VISEMES, calmLevel } from "./fixtures";
import { RESTING, VISEMES, type FaceSignal } from "./types";

const FRAME_MS = 1000 / 60;
const FRAME = 1 / 60;
const RATE = 24_000;

let stopFace: (() => void) | null = null;
afterEach(() => {
  stopFace?.();
  stopFace = null;
  resetFaceTimelineForTests();
});

/**
 * Speak `seconds` through the producer on a 60 fps clock. Frame 0 is the change that started her
 * speaking; `mirrored[i]` is the signal Main received on frame `i`, or `null` when the cap held it.
 */
function speak(seconds: number, line: FaceTimeline | null, level: (t: number) => number) {
  let fn: ((now: number) => boolean | void) | null = null;
  let now = 0;
  let listener: (() => void) | null = null;
  const local: FaceSignal[] = [];
  const mirrored: (FaceSignal | null)[] = [];
  let sent: FaceSignal | null;
  const inputs: FaceInputs = { voice: "idle", run: "idle", cards: 0, generation: null };
  const deps: FaceDeps = {
    inputs: () => inputs,
    subscribe: (f) => {
      listener = f;
      return () => {
        listener = null;
      };
    },
    level: () => level(now / 1000),
    sample: () => Math.round((now / 1000) * RATE),
    sounding: () => true,
    timeline: () => line,
    forget: () => {},
    loop: (f) => {
      fn = f;
      return () => {
        fn = null;
      };
    },
    now: () => now,
    local: (s) => void local.push(s),
    mirror: (s) => {
      sent = s;
    },
  };
  stopFace = startFace(deps);
  inputs.voice = "speaking";
  inputs.generation = 1;
  sent = null;
  local.length = 0;
  listener!();
  mirrored.push(sent);
  for (let k = 1; k * FRAME_MS < seconds * 1000; k += 1) {
    now = k * FRAME_MS;
    sent = null;
    if (fn) (fn as (now: number) => boolean | void)(now);
    mirrored.push(sent);
  }
  return { local, mirrored };
}

function calmLine(): FaceTimeline {
  beginLine(1, RATE);
  addVisemes({
    kind: "voice.visemes",
    generation: 1,
    sentence: 0,
    offset: 0,
    sample_rate: RATE,
    visemes: CALM_VISEMES.map(([v, a, b]) => [v, Math.round(a * RATE), Math.round(b * RATE)]),
  });
  return faceTimeline()!;
}

/** Step a driver at 60 fps, handing it `feed[i]` (when not null) before frame `i`. */
function drive(feed: (FaceSignal | null)[]): number[] {
  const d = createDriver({ seed: 1 });
  return feed.map((s) => {
    if (s) d.setSignal(s);
    return d.step(FRAME).open;
  });
}

describe("one mouth table", () => {
  it("the producer's mouthTarget is the driver's target for every viseme and level; SHAPE_OPEN is gone", () => {
    expect(Object.keys(preview)).not.toContain("SHAPE_OPEN");
    for (const v of VISEMES) {
      for (const level of [0.2, 0.5, 0.9]) {
        const open = Math.round(mouthTarget(v, level) * 1000) / 1000;
        const d = createDriver({ seed: 1 });
        d.setSignal({ ...RESTING, phase: "speaking", viseme: v, level, open });
        let pose = d.pose;
        for (let i = 0; i < 60; i += 1) pose = d.step(FRAME);
        expect(pose.open, `${v} at ${level}`).toBeCloseTo(mouthTarget(v, level), 3);
      }
    }
  });
});

describe("closures shut on every surface", () => {
  it("Main, fed the 30 Hz mirror of the calm line: each PP holds <= 0.05 for two frames running", () => {
    const { local, mirrored } = speak(CALM_DURATION, calmLine(), calmLevel);
    const main = drive(mirrored);
    const runs: number[][] = [];
    local.forEach((s, i) => {
      if (s.viseme !== "PP") return;
      if (local[i - 1]?.viseme === "PP") runs[runs.length - 1].push(i);
      else runs.push([i]);
    });
    expect(runs).toHaveLength(3);
    for (const frames of runs) {
      let best = 0;
      let streak = 0;
      for (const i of frames) {
        streak = main[i] <= 0.05 ? streak + 1 : 0;
        best = Math.max(best, streak);
      }
      expect(best, `PP at frame ${frames[0]}: ${frames.map((i) => main[i].toFixed(3)).join(" ")}`).toBeGreaterThanOrEqual(2);
    }
  });

  it("her window (every frame) and Main (the mirror) agree at every closure's midpoint, and nowhere drift past the mirror's staleness", () => {
    const line = calmLine();
    const { local, mirrored } = speak(CALM_DURATION, line, calmLevel);
    const own = drive(local);
    const main = drive(mirrored);
    const lead = Math.round(VISEME_LEAD_S * RATE);
    let closures = 0;
    let compared = 0;
    for (const [v, a, b] of line.shapes[0].segments) {
      const i = Math.round(((a + b) / 2 - lead) / RATE / FRAME);
      if (i < 1 || i >= local.length) continue;
      compared += 1;
      const gap = Math.abs(own[i] - main[i]);
      // Measured 2026-10-25 on this line: max 0.118 across 55 midpoints (a 3-frame vowel after a
      // jump in level, which the 30 Hz mirror sees one frame late).
      expect(gap, `${v} at frame ${i}`).toBeLessThanOrEqual(0.15);
      if (v !== "PP" && v !== "FF") continue;
      closures += 1;
      expect(gap, `${v} at frame ${i}`).toBeLessThanOrEqual(0.05);
    }
    expect(compared).toBeGreaterThan(50);
    expect(closures).toBe(7);
  });

  // The card's full case: <= 0.05 at EVERY midpoint. Not reachable under the 30 Hz mirror cap
  // (11 of 55 midpoints over, the same order as before the change); mirroring every shape change
  // at once measured 1 of 55 at 32.7 signals a second, which loosens ADR 0027's cap: owner's call.
  it.todo("her window and Main differ by <= 0.05 at every segment's midpoint (needs every shape change mirrored at once)");

  it("a level-only line: breath at 0.15 held 300 ms keeps the mouth shut, as the producer says", () => {
    const { local } = speak(0.3, null, () => 0.15);
    expect(local.every((s) => s.phase === "speaking" && s.open === 0)).toBe(true);
    const open = drive(local);
    expect(Math.max(...open)).toBeLessThanOrEqual(0.02);
  });
});

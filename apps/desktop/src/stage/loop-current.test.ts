/** The loop current's water, without a canvas — README section 3.1, ADR 0142. */
import { expect, test } from "vitest";

import { LOOPS, POSE_SPEED, ease, flowsAtRest, moteCount, place, seedMotes } from "./loop-current";

test("the field is the same every launch, and every loop gets about its share", () => {
  const a = seedMotes(400);
  const b = seedMotes(400);
  expect(a).toEqual(b);
  for (const loop of LOOPS) {
    const share = a.filter((m) => m.loop === loop).length / a.length;
    expect(share, `loop at ${loop.cx},${loop.cy}`).toBeGreaterThan(loop.w - 0.05);
    expect(share, `loop at ${loop.cx},${loop.cy}`).toBeLessThan(loop.w + 0.05);
  }
});

test("a mote stays near the water: the floor swell may run off the edges, as the prototype's did, but not far", () => {
  const [w, h] = [1440, 900];
  for (const m of seedMotes(moteCount(w, h))) {
    for (let th = 0; th < Math.PI * 2; th += 0.4) {
      const [x, y] = place(m, th, w, h);
      expect(x).toBeGreaterThan(-0.3 * w);
      expect(x).toBeLessThan(1.3 * w);
      expect(y).toBeGreaterThan(-0.05 * h);
      expect(y).toBeLessThan(1.05 * h);
    }
  }
});

test("the field is sized by the stage and capped, so a large monitor costs no more than 560 motes", () => {
  expect(moteCount(1440, 900)).toBe(405);
  expect(moteCount(3840, 2160)).toBe(560);
  expect(moteCount(0, 0)).toBe(0);
});

test("the current keeps flowing on its own only while she is busy, at the bell's pace for the pose", () => {
  expect(flowsAtRest("resting")).toBe(false);
  for (const pose of ["working", "hearing", "asking"] as const) expect(flowsAtRest(pose)).toBe(true);
  expect(POSE_SPEED.working).toBeGreaterThan(POSE_SPEED.hearing);
  expect(POSE_SPEED.hearing).toBeGreaterThan(POSE_SPEED.asking);
  expect(POSE_SPEED.asking).toBeGreaterThan(POSE_SPEED.resting);
});

test("the speed eases towards its target and never overshoots, even on a long frame", () => {
  expect(ease(0, 1, 0.016)).toBeGreaterThan(0);
  expect(ease(0, 1, 0.016)).toBeLessThan(0.1);
  expect(ease(0, 2.2, 5)).toBe(2.2);
  expect(ease(2, 0, 0.5)).toBeLessThan(2);
});

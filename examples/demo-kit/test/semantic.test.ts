// Semantic zoom: camera distance IS the level — `docs/kit-camera-contract.md` §3.
//
// The part that can be wrong is the hysteresis. A bare threshold flaps: a trackpad emits a dozen
// wheel events per flick, a zoom that lands within a rounding error of a band opens and closes
// the group several times in one gesture, and every one of those bumps the nav's flight counter
// and starts a level change that the next one aborts.

import assert from "node:assert/strict";
import { test } from "node:test";

import { SEMANTIC_HYSTERESIS, bandProgress, levelForZoom } from "../src/zoom/semantic.ts";

const BANDS = [2, 6] as const;

test("with no hysteresis the bands are the plain thresholds the contract states", () => {
  assert.equal(levelForZoom(1.9, BANDS, 0, 0), 0);
  assert.equal(levelForZoom(2, BANDS, 0, 0), 1);
  assert.equal(levelForZoom(5.9, BANDS, 0, 0), 1);
  assert.equal(levelForZoom(6, BANDS, 0, 0), 2);
});

test("entering a level costs an overshoot", () => {
  // 8% of a band at 2 is 0.16, so 2.1 is inside the dead zone and does not open the group yet.
  assert.equal(levelForZoom(2.1, BANDS, SEMANTIC_HYSTERESIS, 0), 0);
  assert.equal(levelForZoom(2.2, BANDS, SEMANTIC_HYSTERESIS, 0), 1);
});

test("leaving a level costs an undershoot — which is the same band, from the other side", () => {
  assert.equal(levelForZoom(1.9, BANDS, SEMANTIC_HYSTERESIS, 1), 1);
  assert.equal(levelForZoom(1.8, BANDS, SEMANTIC_HYSTERESIS, 1), 0);
});

test("a camera sitting exactly on a band stays where it is, whichever side it came from", () => {
  assert.equal(levelForZoom(2, BANDS, SEMANTIC_HYSTERESIS, 0), 0);
  assert.equal(levelForZoom(2, BANDS, SEMANTIC_HYSTERESIS, 1), 1);
  assert.equal(levelForZoom(6, BANDS, SEMANTIC_HYSTERESIS, 1), 1);
  assert.equal(levelForZoom(6, BANDS, SEMANTIC_HYSTERESIS, 2), 2);
});

test("the wobble a trackpad actually produces changes the level once, not six times", () => {
  // A flick that overshoots the band and settles back onto it.
  const flick = [1.9, 2.3, 2.05, 1.98, 2.02, 1.95, 2.01];
  let level = levelForZoom(flick[0] as number, BANDS, SEMANTIC_HYSTERESIS, 0);
  let changes = 0;
  for (const zoom of flick.slice(1)) {
    const next = levelForZoom(zoom, BANDS, SEMANTIC_HYSTERESIS, level);
    if (next !== level) changes += 1;
    level = next;
  }
  assert.equal(changes, 1);
  assert.equal(level, 1);
});

test("the same wobble with no hysteresis is the flapping this exists to stop", () => {
  const flick = [1.9, 2.3, 2.05, 1.98, 2.02, 1.95, 2.01];
  let level = levelForZoom(flick[0] as number, BANDS, 0, 0);
  let changes = 0;
  for (const zoom of flick.slice(1)) {
    const next = levelForZoom(zoom, BANDS, 0, level);
    if (next !== level) changes += 1;
    level = next;
  }
  assert.ok(changes >= 4, `expected flapping, got ${changes} changes`);
});

test("hysteresis is a FRACTION of the band, so it reads the same at any scale", () => {
  const small = [1.5, 4] as const;
  const large = [150, 400] as const;
  assert.equal(levelForZoom(1.5 * 1.05, small, 0.08, 0), 0);
  assert.equal(levelForZoom(150 * 1.05, large, 0.08, 0), 0);
  assert.equal(levelForZoom(1.5 * 1.2, small, 0.08, 0), 1);
  assert.equal(levelForZoom(150 * 1.2, large, 0.08, 0), 1);
});

test("a camera pulled all the way out from L2 lands at L0, not at L1", () => {
  assert.equal(levelForZoom(0.5, BANDS, SEMANTIC_HYSTERESIS, 2), 0);
});

test("a shove all the way in from L0 lands at L2", () => {
  assert.equal(levelForZoom(40, BANDS, SEMANTIC_HYSTERESIS, 0), 2);
});

test("the default is the documented 8%", () => {
  assert.equal(SEMANTIC_HYSTERESIS, 0.08);
  assert.equal(levelForZoom(2.1, BANDS, undefined, 0), 0);
});

test("a zoom that is not a number does not answer a level", () => {
  assert.equal(levelForZoom(NaN, BANDS, SEMANTIC_HYSTERESIS, 0), 0);
});

test("band progress is where in the level the camera stands", () => {
  assert.equal(bandProgress(0, BANDS, 0), 0);
  assert.equal(bandProgress(2, BANDS, 0), 1);
  assert.equal(bandProgress(4, BANDS, 1), 0.5);
  assert.equal(bandProgress(99, BANDS, 2), 1);
});

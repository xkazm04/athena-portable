// The echo container's three decisions — `docs/kit-camera-contract.md` §4.
//
// Rule 1 is the headline rule of the formula ("the level you leave carries the camera") and
// after two rounds it was still ~30 lines of app code plus a stylesheet in every app. The three
// lines that were never the same twice — which changes get an echo, where the move came from,
// and which way it goes — are pure in `src/zoom/echo-rule.ts` and pinned here.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  echoDirection,
  echoKey,
  echoOrigin,
  echoOriginVars,
  echoStages,
  levelChanged,
} from "../src/zoom/echo-rule.ts";
import { HOME, type Focus } from "../src/zoom/state.ts";

const L1: Focus = { level: 1, group: "a", item: null };
const L1b: Focus = { level: 1, group: "b", item: null };
const L2: Focus = { level: 2, group: "a", item: "a1" };
const L2b: Focus = { level: 2, group: "a", item: "a2" };

/* ------------------------------------------------------------------ which changes get an echo */

test("the default is the rule as written: the level changed", () => {
  assert.equal(echoStages(HOME, L1), true);
  assert.equal(echoStages(L1, L2), true);
  assert.equal(echoStages(L2, L1), true);
  assert.equal(levelChanged(HOME, L1), true);
});

test("a change of subject at the same depth is not a change of depth", () => {
  // L2 → L2 between two items of one group. An echo of it reads as a stutter, which is the
  // exception every app discovered for itself.
  assert.equal(echoStages(L2, L2b), false);
  assert.equal(echoStages(L1, L1b), false);
});

test("a surface can say otherwise, and `stages` is asked", () => {
  assert.equal(echoStages(L2, L2b, () => true), true);
  assert.equal(echoStages(HOME, L1, () => false), false);
});

test("a move that did not happen never gets one, whatever `stages` says", () => {
  // An abort can produce the same focus twice; an echo of it is a flash.
  assert.equal(echoStages(L1, { ...L1 }, () => true), false);
  assert.equal(echoStages(HOME, HOME), false);
});

/* ------------------------------------------------------------------------------- which way */

test("down is in, back up is out", () => {
  assert.equal(echoDirection(HOME, L1), "in");
  assert.equal(echoDirection(L1, L2), "in");
  assert.equal(echoDirection(L2, L1), "out");
  assert.equal(echoDirection(L1, HOME), "out");
});

test("a same-depth change reads as a move inwards", () => {
  assert.equal(echoDirection(L2, L2b), "in");
});

/* ------------------------------------------------------------------------------ the origin */

const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  height,
});

test("the origin is the MIDDLE of the node being left, in the container's coordinates", () => {
  // A 100×40 node at (150, 100) inside an 800×600 container at (100, 50): its centre is
  // (200, 120) on the page, which is (100, 70) inside the container, which is 12.5% / 11.67%.
  const origin = echoOrigin(rect(150, 100, 100, 40), rect(100, 50, 800, 600));
  assert.equal(origin.x, 100 / 800);
  assert.equal(origin.y, 70 / 600);
});

test("the documented unit is a FRACTION of the container, and px is opt-in", () => {
  const node = rect(150, 100, 100, 40);
  const box = rect(100, 50, 800, 600);
  assert.deepEqual(echoOrigin(node, box, "px"), { x: 100, y: 70 });
  assert.deepEqual(echoOrigin(node, box), echoOrigin(node, box, "fraction"));
});

test("a node we could not measure is the middle — the honest reading of 'we do not know'", () => {
  assert.deepEqual(echoOrigin(null, rect(0, 0, 800, 600)), { x: 0.5, y: 0.5 });
  assert.deepEqual(echoOrigin(undefined, null), { x: 0.5, y: 0.5 });
  assert.deepEqual(echoOrigin(null, rect(0, 0, 800, 600), "px"), { x: 400, y: 300 });
});

test("a container that has not been laid out cannot make a fraction, so it answers the middle", () => {
  assert.deepEqual(echoOrigin(rect(10, 10, 4, 4), rect(0, 0, 0, 0)), { x: 0.5, y: 0.5 });
});

test("the fraction is NOT clamped — a zoom out of a point off-screen is a real move", () => {
  const origin = echoOrigin(rect(-200, 0, 100, 40), rect(0, 0, 800, 600));
  assert.ok(origin.x < 0);
});

test("the CSS the origin becomes is the same line either way", () => {
  assert.deepEqual(echoOriginVars({ x: 0.125, y: 0.5 }), {
    "--echo-ox": "12.5%",
    "--echo-oy": "50%",
  });
  assert.deepEqual(echoOriginVars({ x: 100, y: 70 }, "px"), {
    "--echo-ox": "100px",
    "--echo-oy": "70px",
  });
});

/* ----------------------------------------------------------------------------------- the key */

test("the key is different for every move and stable within one", () => {
  assert.equal(echoKey(3, HOME, L1), echoKey(3, HOME, L1));
  assert.notEqual(echoKey(3, HOME, L1), echoKey(4, HOME, L1));
  assert.notEqual(echoKey(3, HOME, L1), echoKey(3, HOME, L1b));
});

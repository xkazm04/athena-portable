// `emphasis()` drawn: one mapping from presence to opacity and scale, so apps stop inventing it.
//
// Formula §1 rule 7 says presence comes from the model. Round 1 ended with two apps mapping it
// onto opacity and scale with their own depth constant, arrived at by eye, in a component — which
// is the same defect one layer down. These tests pin the mapping and the reason for its shape.

import assert from "node:assert/strict";
import { test } from "node:test";

import { PRESENCE_DEPTH, emphasis, presenceOf, presenceStyle } from "../src/zoom/presence.ts";
import { HOME, type Focus } from "../src/zoom/state.ts";

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !== ${b}`);

test("fully present is untouched; gone is invisible and shrunk by the whole depth", () => {
  assert.deepEqual(presenceStyle(1), { opacity: 1, scale: 1 });
  const gone = presenceStyle(0);
  assert.equal(gone.opacity, 0);
  near(gone.scale, 1 - PRESENCE_DEPTH);
});

test("opacity IS the presence, and scale is the shallower reading of it", () => {
  const half = presenceStyle(0.5);
  assert.equal(half.opacity, 0.5);
  near(half.scale, 1 - 0.5 * PRESENCE_DEPTH);
  // The whole point of the depth: a row that shrinks as far as it dims reads as falling off the
  // board rather than as standing further back on it (hirelane, round 1).
  assert.ok(1 - half.scale < 1 - half.opacity);
});

test("depth is the option and six percent is the default", () => {
  assert.equal(PRESENCE_DEPTH, 0.06);
  near(presenceStyle(0, { depth: 0.2 }).scale, 0.8);
  assert.deepEqual(presenceStyle(1, { depth: 0.2 }), { opacity: 1, scale: 1 });
});

test("a floor keeps a receding node legible without changing the curve's ends", () => {
  assert.equal(presenceStyle(0, { floor: 0.2 }).opacity, 0.2);
  assert.equal(presenceStyle(1, { floor: 0.2 }).opacity, 1);
});

test("out-of-range input is clamped rather than producing a negative scale", () => {
  assert.deepEqual(presenceStyle(-3), presenceStyle(0));
  assert.deepEqual(presenceStyle(4), presenceStyle(1));
  assert.deepEqual(presenceStyle(Number.NaN), presenceStyle(0));
});

test("presenceOf is the model's answer, drawn — never a second derivation", () => {
  const atL1: Focus = { level: 1, group: "a", item: null };
  assert.deepEqual(presenceOf(atL1, "a"), presenceStyle(emphasis(atL1, "a", null)));
  assert.deepEqual(presenceOf(atL1, "b"), presenceStyle(emphasis(atL1, "b", null)));
  assert.deepEqual(presenceOf(atL1, "b", "b1"), presenceStyle(emphasis(atL1, "b", "b1")));
});

test("drilling in makes the groups you left recede, and L0 leaves everything present", () => {
  assert.equal(presenceOf(HOME, "a").opacity, 1);
  const atL1: Focus = { level: 1, group: "a", item: null };
  assert.equal(presenceOf(atL1, "a").opacity, 1);
  assert.ok(presenceOf(atL1, "b").opacity < presenceOf(atL1, "a").opacity);
  assert.ok(presenceOf(atL1, "b").scale < 1);
});

/* ------------------------------------------------- round 3: presence composed with a transform */

test("`{ scale: false }` emits NO scale key — not a scale of 1", () => {
  // Round 2, ledgerbox: a lane that carries a translateZ as DATA cannot take a scale from the
  // navigation channel, and `scale: 1` is not a way of declining it — motion writes the key and
  // it composes into the same transform, overwriting the lane's own.
  const flat = presenceStyle(0.4, { scale: false });
  assert.deepEqual(flat, { opacity: 0.4 });
  assert.equal("scale" in flat, false);
});

test("the opacity is the same number with or without the scale key", () => {
  assert.equal(presenceStyle(0.3, { scale: false }).opacity, presenceStyle(0.3).opacity);
  assert.equal(
    presenceStyle(0.3, { scale: false, floor: 0.2 }).opacity,
    presenceStyle(0.3, { floor: 0.2 }).opacity,
  );
});

test("presenceOf declines the scale the same way", () => {
  const focus = { level: 1, group: "a", item: null } as const;
  const flat = presenceOf(focus, "b", null, { scale: false });
  assert.deepEqual(flat, { opacity: 0.22 });
});

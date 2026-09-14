// Arrow keys over a row or a grid — the index arithmetic, third copy in the repo made the
// kit's. Round 1 left "no arrow-key navigation at L1" on two apps; round 2 saw ledgerbox write
// `useRoving(selector)` again. `useRoving.ts` is the twenty lines of DOM around this.

import assert from "node:assert/strict";
import { test } from "node:test";

import { isRovingKey, rovingIndex } from "../src/zoom/roving.ts";

test("a key that is not ours is not ours — the handler must not preventDefault it", () => {
  assert.equal(rovingIndex(0, "Enter", 5), null);
  assert.equal(rovingIndex(0, "Tab", 5), null);
  assert.equal(rovingIndex(0, " ", 5), null);
  assert.equal(isRovingKey("ArrowDown"), true);
  assert.equal(isRovingKey("PageDown"), false);
});

test("one column is one dimension: both pairs of arrows step by one", () => {
  // A lane of cards and a table of rows are the same arithmetic, so the caller does not have to
  // declare which it has. The walls appear the moment there IS a second axis.
  assert.equal(rovingIndex(1, "ArrowRight", 5), 2);
  assert.equal(rovingIndex(1, "ArrowLeft", 5), 0);
  assert.equal(rovingIndex(1, "ArrowDown", 5), 2);
  assert.equal(rovingIndex(1, "ArrowUp", 5), 0);
});

test("the edges are walls, not wraps — the answer equals the index it was given", () => {
  assert.equal(rovingIndex(4, "ArrowRight", 5), 4);
  assert.equal(rovingIndex(0, "ArrowLeft", 5), 0);
  assert.equal(rovingIndex(4, "ArrowDown", 5), 4);
  assert.equal(rovingIndex(0, "ArrowUp", 5), 0);
});

test("Home and End are absolute", () => {
  assert.equal(rovingIndex(3, "Home", 5), 0);
  assert.equal(rovingIndex(3, "End", 5), 4);
  assert.equal(rovingIndex(0, "Home", 5), 0);
});

test("a grid moves by a whole row", () => {
  // 3 columns, 7 items:  0 1 2 / 3 4 5 / 6
  assert.equal(rovingIndex(1, "ArrowDown", 7, 3), 4);
  assert.equal(rovingIndex(4, "ArrowUp", 7, 3), 1);
});

test("a column move with no row below it stays — clamping would move focus SIDEWAYS", () => {
  assert.equal(rovingIndex(6, "ArrowDown", 7, 3), 6);
  assert.equal(rovingIndex(5, "ArrowDown", 7, 3), 5);
  assert.equal(rovingIndex(1, "ArrowUp", 7, 3), 1);
});

test("the end of a row in a grid is a wall, not a door into the next row", () => {
  // Reading order is Tab's job. ArrowRight from index 2 in a 3-column grid stays at 2.
  assert.equal(rovingIndex(2, "ArrowRight", 7, 3), 2);
  assert.equal(rovingIndex(3, "ArrowLeft", 7, 3), 3);
  assert.equal(rovingIndex(3, "ArrowRight", 7, 3), 4);
});

test("nothing focused yet enters at the near end for a forward key and the far end for a back one", () => {
  assert.equal(rovingIndex(-1, "ArrowRight", 5), 0);
  assert.equal(rovingIndex(-1, "ArrowDown", 5), 0);
  assert.equal(rovingIndex(-1, "ArrowLeft", 5), 4);
  assert.equal(rovingIndex(-1, "ArrowUp", 5), 4);
});

test("an empty collection answers nothing at all", () => {
  assert.equal(rovingIndex(-1, "ArrowRight", 0), null);
  assert.equal(rovingIndex(0, "Home", 0), null);
});

test("one item is every edge at once", () => {
  for (const key of ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Home", "End"]) {
    assert.equal(rovingIndex(0, key, 1), 0, key);
  }
});

test("a nonsense column count is one column, not a division by zero", () => {
  assert.equal(rovingIndex(1, "ArrowRight", 5, 0), 2);
  assert.equal(rovingIndex(1, "ArrowRight", 5, NaN), 2);
});

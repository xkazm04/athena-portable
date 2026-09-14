/**
 * The arrival clock knows whose move it is running, and what the sheet draws
 * while it runs.
 *
 * ROUND 1 shipped two predicates here — `escapeAbortsArrival` and
 * `arrivalAbandoned` — and both existed because the move was committed to the
 * nav only at its halfway point. For the length of the picture's flatten the
 * level was still 0, so the kit declined Escape (correctly: there is nowhere
 * above L0 to go) and the key reached nobody; and the beats ran on timers that
 * had no idea the reader had walked out from under them, which left `opening`
 * standing against a level that was gone and a plate nobody could click.
 *
 * THE CONSOLIDATION ROUND deleted both. `openFromPlate` tells the nav first, so
 * the flatten runs inside a real flight: `escapeAbortsFlight` and `nav.abort()`
 * are the kit's now and are pinned there, and "has this move been walked out
 * of" stops being a question because the beats are keyed to the database the nav
 * is actually on.
 *
 * What is left here is what is still this direction's, in the same three
 * situations the round-1 file covered:
 *
 *   1. a beat belongs to a move only while the nav is on its database and the
 *      flight is still in the air (`beatOf`);
 *   2. the picture holds its pose through `flatten`, `land` and `spread`, and
 *      lets go at `dress` (`openingOf`);
 *   3. the sheet goes on drawing the plate for the length of the flatten, and
 *      for nothing else (`drawnLevel`).
 *
 *   node --experimental-transform-types --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { test } from "node:test";

const { beatOf, drawnLevel, openingOf } = await import("../components/blocks/useArrival");

const BILLING = { database: "billing", at: "flatten" } as const;
const staged = (at: "flatten" | "land" | "spread" | "dress" | "settled") =>
  ({ database: "billing", at }) as const;

/* 1. Whose beat is this? */

test("a beat runs while the nav is on the database it was staged over", () => {
  for (const at of ["flatten", "land", "spread", "dress"] as const) {
    assert.equal(beatOf(staged(at), "billing", true), at, at);
  }
});

test("Escape inside the arrival window ends the move", () => {
  // `nav.abort()` puts the reader back on the plate: focus.group is null, and
  // whatever the timers still believe, this move is over. Round 1 needed
  // `arrivalAbandoned` to notice; now the derivation cannot help noticing.
  assert.equal(beatOf(staged("flatten"), null, true), "settled");
  assert.equal(beatOf(staged("land"), null, true), "settled");
  assert.equal(beatOf(staged("spread"), null, true), "settled");
});

test("jumping to another database mid-arrival abandons the move it left", () => {
  assert.equal(beatOf(staged("land"), "crm-eu", true), "settled");
});

test("a settled flight has no beat left to run", () => {
  // The last beat settles the flight; a timer that fires afterwards writes a
  // beat nobody is in.
  assert.equal(beatOf(staged("dress"), "billing", false), "settled");
});

test("with nothing staged there is nothing to run", () => {
  assert.equal(beatOf({ database: null, at: "settled" }, "billing", true), "settled");
  assert.equal(beatOf({ database: null, at: "settled" }, null, false), "settled");
});

test("a dossier opened out of the arriving database is still that database's move", () => {
  // `open_item` does not change the group, so the beats go on running under the
  // card — which is what the round-1 file pinned, in the same words.
  assert.equal(beatOf(staged("dress"), "billing", true), "dress");
});

/* 2. When does the picture let go? */

test("the picture holds its pose until the cells have travelled", () => {
  assert.equal(openingOf("flatten", "billing"), "billing");
  assert.equal(openingOf("land", "billing"), "billing");
  assert.equal(openingOf("spread", "billing"), "billing");
  // `dress` is the beat where the cells acquire what was never in the picture,
  // so the picture has nothing left to hold and unmounts.
  assert.equal(openingOf("dress", "billing"), null);
  assert.equal(openingOf("settled", "billing"), null);
});

/* 3. What does the sheet draw? */

test("the sheet draws the plate for the length of the flatten, and nothing else", () => {
  assert.equal(drawnLevel("flatten", 1), 0, "the reader has chosen; the picture has not handed over");
  assert.equal(drawnLevel("land", 1), 1, "L1 exists from the hand-off");
  assert.equal(drawnLevel("spread", 1), 1);
  assert.equal(drawnLevel("dress", 1), 1);
  assert.equal(drawnLevel("settled", 1), 1);
});

test("a dossier asked for mid-flatten is still drawn", () => {
  // Only L1 is held back. An agent that calls open_item during the flatten asked
  // for a place two levels in, and the plate is not it.
  assert.equal(drawnLevel("flatten", 2), 2);
  assert.equal(drawnLevel("flatten", 0), 0);
});

test("the staged shape is what the hook stages", () => {
  // A guard against the fixture drifting from the type: `at` is an ArrivalBeat
  // and `database` is the group id the nav will be on.
  assert.equal(BILLING.database, "billing");
  assert.equal(beatOf(BILLING, BILLING.database, true), "flatten");
});

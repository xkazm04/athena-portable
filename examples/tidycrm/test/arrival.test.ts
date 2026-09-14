/**
 * The arrival clock knows whose move it is running, and what the page may draw
 * while it runs.
 *
 * ROUND 1 shipped two predicates here — `escapeAbortsArrival` and
 * `arrivalAbandoned` — and both existed because the move was committed to the
 * nav only at its halfway point. The consolidation round deleted both by telling
 * the nav first.
 *
 * ROUND 3 DELETED A THIRD, `drawnLevel`, and its deletion is the concept test's
 * clearest result. It existed because the SHEET's level and the NAV's level
 * disagreed for four hundred milliseconds: the reader had chosen a database but
 * the picture was still the whole plate, because the picture at L0 and the page
 * at L1 were two different things and one had to be held back while the other
 * assembled. There is one picture now — the camera flies from the cube into an
 * octant and the octant was always there — so the two levels are the same
 * number and there is nothing to hold back.
 *
 * What is left is what is still this direction's:
 *
 *   1. a beat belongs to a move only while the nav is on its database and the
 *      flight is still in the air (`beatOf`);
 *   2. the labels are not drawn while the camera is moving, and are drawn the
 *      moment it stops (`inkable`).
 *
 *   node --experimental-transform-types --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { test } from "node:test";

const { beatOf, inkable } = await import("../components/blocks/useArrival");

const staged = (at: "flight" | "dress" | "settled") => ({ database: "billing", at }) as const;

/* 1. Whose beat is this? */

test("a beat runs while the nav is on the database it was staged over", () => {
  for (const at of ["flight", "dress"] as const) {
    assert.equal(beatOf(staged(at), "billing", true), at, at);
  }
});

test("Escape inside the arrival window ends the move", () => {
  // `nav.abort()` puts the reader back outside the cube: focus.group is null,
  // and whatever the timers still believe, this move is over. Round 1 needed
  // `arrivalAbandoned` to notice; the derivation cannot help noticing.
  assert.equal(beatOf(staged("flight"), null, true), "settled");
  assert.equal(beatOf(staged("dress"), null, true), "settled");
});

test("jumping to another database mid-arrival abandons the move it left", () => {
  assert.equal(beatOf(staged("flight"), "crm-eu", true), "settled");
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

/* 2. What may the page draw? */

test("no ink while the camera is moving, and ink the moment it stops", () => {
  // Type projected through a moving perspective camera slides and rescales
  // every frame. There is no size at which it can be read, so it is not drawn
  // at all: the slab is what the reader follows into the database.
  assert.equal(inkable("flight"), false);
  assert.equal(inkable("dress"), true);
  assert.equal(inkable("settled"), true);
});

test("the sheet's level is the nav's level, with nothing held back", async () => {
  // The whole of round 2's `drawnLevel`, asserted as an absence: there is no
  // longer any function in this module that can make the two disagree.
  const clock = await import("../components/blocks/useArrival");
  assert.equal("drawnLevel" in clock, false, "the picture no longer lags the nav");
  assert.equal("openingOf" in clock, false, "nothing holds a pose for a level any more");
});

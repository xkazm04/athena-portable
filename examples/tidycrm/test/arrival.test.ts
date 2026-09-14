/**
 * The arrival clock knows when its move has been abandoned.
 *
 * Escape inside the L0-to-L1 window used to leave `opening` set against a level
 * that was gone, and `opening` steps every legend key back and stops the L0
 * picture answering a click - so L0 came back frozen, with nothing clickable, no
 * rung to climb and only a reload to get out of.
 *
 * Round 2 replaced the four lettered zones with nine named databases. The clock
 * is unchanged - it never knew what a group id meant - so what moved here is the
 * fixtures and the words, which is the whole reason to write it down.
 *
 *   node --experimental-transform-types --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { test } from "node:test";

const { arrivalAbandoned, escapeAbortsArrival } = await import("../components/blocks/useArrival");

const ESC = { key: "Escape", defaultPrevented: false };

const PLATE = { level: 0, group: null } as const;
const BILLING = { level: 1, group: "billing" } as const;

test("the picture flattening at L0 is the move working, not a move abandoned", () => {
  assert.equal(arrivalAbandoned(PLATE, "billing", "settled"), false);
});

test("a beat running over the database it opened is not abandoned", () => {
  for (const phase of ["land", "spread", "dress"] as const) {
    assert.equal(arrivalAbandoned(BILLING, "billing", phase), false, phase);
  }
});

test("Escape inside the arrival window abandons the move", () => {
  // The reader is back on the plate while the beats still believe they are
  // dressing billing. This is the freeze: `opening` must be released.
  assert.equal(arrivalAbandoned(PLATE, "billing", "land"), true);
  assert.equal(arrivalAbandoned(PLATE, "billing", "spread"), true);
});

test("jumping to another database mid-arrival abandons the move it left", () => {
  assert.equal(arrivalAbandoned({ level: 1, group: "crm-eu" } as const, "billing", "land"), true);
});

test("a dossier opened out of the arriving database is still that database's move", () => {
  assert.equal(arrivalAbandoned({ level: 2, group: "billing" } as const, "billing", "dress"), false);
});

test("with nothing opening there is nothing to abandon", () => {
  assert.equal(arrivalAbandoned(PLATE, null, "settled"), false);
  assert.equal(arrivalAbandoned(BILLING, null, "dress"), false);
});

/*
 * The other half: the window BEFORE the hand-off, where the level is still 0.
 * `escapeLeavesLevel` declines Escape at L0 — there is nowhere above it to go —
 * so for the length of the picture's flatten the key reached nobody and the move
 * could not be stopped at all. This is what claims it, and only there.
 */

test("Escape while the picture is flattening abandons the move", () => {
  assert.equal(escapeAbortsArrival(ESC, 0, "billing"), true);
});

test("from L1 up the kit owns Escape, not the arrival", () => {
  // The level has already changed, so `escapeLeavesLevel` claims the key and
  // `arrivalAbandoned` cleans up behind it. Two claims on one keypress would
  // take the reader out of two levels at once.
  assert.equal(escapeAbortsArrival(ESC, 1, "billing"), false);
  assert.equal(escapeAbortsArrival(ESC, 2, "billing"), false);
});

test("with no move running Escape at L0 is nobody's", () => {
  assert.equal(escapeAbortsArrival(ESC, 0, null), false);
});

test("a key somebody else has already decided about is left alone", () => {
  assert.equal(escapeAbortsArrival({ key: "Escape", defaultPrevented: true }, 0, "billing"), false);
  assert.equal(escapeAbortsArrival({ key: "Enter", defaultPrevented: false }, 0, "billing"), false);
});

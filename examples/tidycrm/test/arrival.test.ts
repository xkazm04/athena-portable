/**
 * The arrival clock knows when its move has been abandoned.
 *
 * Escape inside the L0-to-L1 window used to leave `opening` set against a level
 * that was gone, and `opening` disables every zone key and unmounts every
 * quadrant's hit volume - so L0 came back frozen, with nothing clickable, no
 * rung to climb and only a reload to get out of.
 *
 *   node --experimental-transform-types --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { test } from "node:test";

const { arrivalAbandoned } = await import("../components/blocks/useArrival");

const PLATE = { level: 0, group: null } as const;
const ZONE_A = { level: 1, group: "A" } as const;

test("the cube flattening at L0 is the move working, not a move abandoned", () => {
  assert.equal(arrivalAbandoned(PLATE, "A", "settled"), false);
});

test("a beat running over the zone it opened is not abandoned", () => {
  for (const phase of ["land", "spread", "dress"] as const) {
    assert.equal(arrivalAbandoned(ZONE_A, "A", phase), false, phase);
  }
});

test("Escape inside the arrival window abandons the move", () => {
  // The reader is back on the plate while the beats still believe they are
  // dressing zone A. This is the freeze: `opening` must be released.
  assert.equal(arrivalAbandoned(PLATE, "A", "land"), true);
  assert.equal(arrivalAbandoned(PLATE, "A", "spread"), true);
});

test("jumping to another zone mid-arrival abandons the move it left", () => {
  assert.equal(arrivalAbandoned({ level: 1, group: "B" } as const, "A", "land"), true);
});

test("a dossier opened out of the arriving zone is still that zone's move", () => {
  assert.equal(arrivalAbandoned({ level: 2, group: "A" } as const, "A", "dress"), false);
});

test("with nothing opening there is nothing to abandon", () => {
  assert.equal(arrivalAbandoned(PLATE, null, "settled"), false);
  assert.equal(arrivalAbandoned(ZONE_A, null, "dress"), false);
});

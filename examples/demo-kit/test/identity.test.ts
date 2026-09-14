// One claimant per shared id, and the key that makes the handover a remount.
//
// The rule is formula §1 rule 2 and the round-1 evidence is in `src/zoom/identity.ts`: two
// mounted claimants animate neither, and motion reads `layoutId` only when an element mounts, so
// an id acquired later never registers and the morph silently never plays (tidycrm's L1 -> L2
// morph had been dead since it was written). Both halves are pinned here.

import assert from "node:assert/strict";
import { test } from "node:test";

import { UNCLAIMED, sharedIdentity } from "../src/zoom/identity.ts";
import { nodeId } from "../src/zoom/state.ts";

test("the claimant gets the id; everyone else gets undefined", () => {
  assert.equal(sharedIdentity("candidate-7", true).layoutId, "candidate-7");
  assert.equal(sharedIdentity("candidate-7", false).layoutId, undefined);
});

test("THE KEY FLIPS WITH OWNERSHIP, which is what forces the remount", () => {
  const held = sharedIdentity("candidate-7", true);
  const given = sharedIdentity("candidate-7", false);
  assert.notEqual(held.key, given.key);
  assert.equal(given.key, `candidate-7${UNCLAIMED}`);
});

test("the key is stable while ownership is, so nothing remounts for free", () => {
  assert.equal(sharedIdentity("a", true).key, sharedIdentity("a", true).key);
  assert.equal(sharedIdentity("a", false).key, sharedIdentity("a", false).key);
});

test("two ids stay distinct in both states", () => {
  assert.notEqual(sharedIdentity("a", true).key, sharedIdentity("b", true).key);
  assert.notEqual(sharedIdentity("a", false).key, sharedIdentity("b", false).key);
});

test("an unclaimed key cannot collide with a real node id", () => {
  // `nodeId` joins a group and an item with a single ':', so a single-colon suffix would make
  // the unclaimed key of group `a` and the claimed key of item `a:unclaimed` the same string —
  // and those two are siblings on more than one of these surfaces. Hence the doubled separator.
  assert.notEqual(sharedIdentity("a", false).key, nodeId("a", "unclaimed"));
  assert.equal(sharedIdentity("a", false).key.endsWith(UNCLAIMED), true);
});

test("the pair is what goes on ONE element: the id it claims and the key it lives by", () => {
  const box = sharedIdentity("table-INV-9", true);
  assert.deepEqual(box, { layoutId: "table-INV-9", key: "table-INV-9" });
});

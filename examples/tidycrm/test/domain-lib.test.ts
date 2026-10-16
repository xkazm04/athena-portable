/**
 * The domain library's stored flags and write door, pinned against the reads that depend on them.
 *
 * Each case drives a real write against a freshly seeded database in a scratch directory and then
 * asks the read side what it now believes. Cases pick disjoint pairs and domains, because they
 * share one database.
 *
 *   node --experimental-transform-types --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { tempHome } from "./tmp-home";

tempHome("tidycrm-test-");

const { getContact, listOpenPairs, segmentRows } = await import("../lib/db");
const { mergeContacts } = await import("../lib/mutations");

test("a merge that carries a recent activity date over clears the survivor's stale flag", () => {
  // The seed holds pairs whose keeper went quiet while its duplicate stayed in touch.
  const pair = listOpenPairs(200).find((p) => {
    const keep = getContact(p.keep_id);
    const drop = getContact(p.drop_id);
    return keep?.is_stale === 1 && drop?.is_stale === 0;
  });
  assert.ok(pair, "the seed pairs a stale keeper with a fresh duplicate");

  assert.equal(mergeContacts(pair.keep_id, pair.drop_id).ok, true);
  const keep = getContact(pair.keep_id);
  const drop = getContact(pair.drop_id);
  assert.equal(keep?.last_activity_at, drop?.last_activity_at, "the newer date was carried over");
  // `is_stale` is stored, like `phone_ok`, so the write that moves its input owes it a restamp.
  // Without one the survivor sits in the stale segment with a date from last month, and the
  // block's "delete stale" gate offers it for deletion.
  assert.equal(keep?.is_stale, 0, "a record active last month is not stale");
  assert.ok(
    !segmentRows("stale").some((c) => c.id === pair.keep_id),
    "and it has left the stale segment",
  );
});

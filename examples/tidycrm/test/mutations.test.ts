/**
 * The gated, irreversible writes, pinned.
 *
 * `merge_contacts` is the one action in this app that cannot be undone, so its
 * preconditions are the ones worth a test rather than a reading. Everything here
 * runs against a freshly seeded database in a scratch directory.
 *
 *   node --import ./test/register.mjs --test test/
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// `openDb` resolves the file from `process.cwd()/data`, so a scratch cwd gives this
// run its own seeded copy and never touches the one committed under `data/`.
process.chdir(mkdtempSync(join(tmpdir(), "tidycrm-test-")));

const { countSegment, getContact, listOpenPairs, segmentRows } = await import("../lib/db");
const { mergeContacts } = await import("../lib/mutations");

test("a merge cannot be pointed back the other way", () => {
  const pair = listOpenPairs(1)[0];
  assert.ok(pair, "the seed carries open identity pairs");

  const before = countSegment("all");
  assert.equal(mergeContacts(pair.keep_id, pair.drop_id).ok, true);
  assert.equal(countSegment("all"), before - 1, "one record leaves the working list");

  // The same adjudication, arguments swapped. Accepting it would set
  // merged_into on both rows and remove BOTH from every working segment.
  const back = mergeContacts(pair.drop_id, pair.keep_id);
  assert.equal(back.ok, false);
  assert.match(back.error ?? "", /already merged/);
  assert.equal(countSegment("all"), before - 1, "the survivor stays in the working list");
  assert.equal(getContact(pair.keep_id)?.merged_into, null, "the survivor survives");
});

test("a merge needs an identity pair that proposed it, in that orientation", () => {
  const free = segmentRows("all").filter((c) => c.in_open_pair === 0);
  const [a, b] = free;
  assert.ok(a && b, "the seed leaves records in no pair at all");

  const before = countSegment("all");
  const invented = mergeContacts(a.id, b.id);
  assert.equal(invented.ok, false, "two ids a caller made up are not an adjudication");
  assert.match(invented.error ?? "", /No open identity pair/);

  // An open pair adjudicated keep->drop does not authorise drop->keep: that is a
  // different verdict about which record survives.
  const pair = listOpenPairs(1)[0];
  assert.ok(pair);
  const swapped = mergeContacts(pair.drop_id, pair.keep_id);
  assert.equal(swapped.ok, false);
  assert.match(swapped.error ?? "", /No open identity pair/);

  assert.equal(countSegment("all"), before, "no record left the working list");

  // The orientation the rule set did propose still merges.
  assert.equal(mergeContacts(pair.keep_id, pair.drop_id).ok, true);
  assert.equal(countSegment("all"), before - 1);
});

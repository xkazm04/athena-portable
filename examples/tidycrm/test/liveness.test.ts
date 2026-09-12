/**
 * One liveness rule for the four write paths in lib/mutations.ts.
 *
 * `flagStale` and `deleteContacts` filtered for it and `planNormalize` and `mergeContacts` did
 * not, so edits landed on records the user had already removed.
 *
 *   node --experimental-transform-types --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.chdir(mkdtempSync(join(tmpdir(), "tidycrm-test-")));

const { getContact, listOpenPairs, listRevisions, segmentRows } = await import("../lib/db");
const { deleteContacts, mergeContacts, normalizeFields } = await import("../lib/mutations");

test("a deleted record is not a normalise target", () => {
  const victim = segmentRows("all").find((c) => c.phone_ok === 0 && c.in_open_pair === 0);
  assert.ok(victim, "the seed carries badly formatted numbers");
  assert.equal(deleteContacts([victim.id]).ok, true);

  const result = normalizeFields([victim.id], ["phone_e164"]);
  assert.match(result.summary, /Nothing to normalise/);
  assert.equal(
    listRevisions(victim.id).length,
    0,
    "no revision is written against a record nobody can see",
  );
  assert.equal(getContact(victim.id)?.phone, victim.phone, "and its fields are untouched");
});

test("a merge says which precondition failed when the keeper is gone", () => {
  const pair = listOpenPairs(1)[0];
  assert.ok(pair);
  assert.equal(deleteContacts([pair.keep_id]).ok, true);

  const result = mergeContacts(pair.keep_id, pair.drop_id);
  assert.equal(result.ok, false);
  // Liveness is checked before the identity pair, so the message names the real cause
  // rather than the pair the delete happened to close on its way out.
  assert.match(result.error ?? "", /One of those contacts is gone/);
  assert.equal(getContact(pair.drop_id)?.merged_into, null);
});

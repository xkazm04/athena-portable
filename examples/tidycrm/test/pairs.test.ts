/**
 * Removing a contact closes the open pairs that depend on it - from either removal path - and the
 * sheet head's pair count agrees with the pairs the blocks can actually show.
 *
 *   node --experimental-transform-types --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.chdir(mkdtempSync(join(tmpdir(), "tidycrm-test-")));

const { countOpenPairs, db, getPair, listOpenPairs } = await import("../lib/db");
const { mergeContacts } = await import("../lib/mutations");
const { buildSheet } = await import("../lib/blocks");

/** Open pairs the sheet managed to attach to a block, which is what the blocks can show. */
function attached(): number {
  return buildSheet()
    .zones.flatMap((z) => z.tables)
    .reduce((n, t) => n + (t.deviations.find((d) => d.kind === "duplicate")?.count ?? 0), 0);
}

test("a merge closes the other open pairs its dropped record stood in", () => {
  const [first, second] = listOpenPairs(2);
  assert.ok(first && second);
  assert.equal(countOpenPairs(), attached(), "the seed is consistent to begin with");

  // The seed gives each contact exactly one pair, so the case has to be built: a second
  // proposal between the two records the first two pairs are about to fold away.
  db().run(
    `INSERT INTO merge_pairs (id, keep_id, drop_id, confidence, evidence_json, status)
     VALUES ('pair_extra', ?, ?, 0.5, '[]', 'open')`,
    [first.drop_id, second.drop_id],
  );
  assert.equal(countOpenPairs(), attached(), "and still consistent with the extra pair open");

  assert.equal(mergeContacts(first.keep_id, first.drop_id).ok, true);

  assert.equal(getPair("pair_extra")?.status, "skipped", "the dependent pair was closed");
  assert.equal(getPair(first.id)?.status, "merged", "and the settled one kept its own verdict");
  assert.equal(
    countOpenPairs(),
    attached(),
    "the sheet head and the blocks still count the same pairs",
  );
});

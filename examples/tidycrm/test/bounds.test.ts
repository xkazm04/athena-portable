/**
 * Bounded outputs announce their bound (AGENTS.md), and a figure that is not a list does not
 * need one - it needs to be uncapped.
 *
 *   node --experimental-transform-types --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.chdir(mkdtempSync(join(tmpdir(), "tidycrm-test-")));

const { countActivity, countOpenPairs, db } = await import("../lib/db");
const { buildSheet } = await import("../lib/blocks");
const { sheetRead } = await import("../components/blocks/tools/read");

test("the sheet head reports the true open-pair count and how many it shows", () => {
  const sheet = buildSheet();
  assert.equal(sheet.unadjudicated, countOpenPairs());
  assert.ok(sheet.unadjudicatedShown <= sheet.unadjudicated);
  const read = sheetRead(sheet);
  assert.equal(read.records_awaiting_a_person, sheet.unadjudicated);
  assert.equal(read.records_awaiting_a_person_shown, sheet.unadjudicatedShown);
});

test("the revision number keeps advancing past the 200-row activity cap", () => {
  const handle = db();
  const start = countActivity();
  for (let i = 0; i < 260; i += 1) {
    handle.run(
      `INSERT INTO activity (ts, actor, action, target, summary, reversible)
       VALUES (?, 'user', 'flag_stale', 'contacts:1', 'filler', 0)`,
      [new Date().toISOString()],
    );
  }
  assert.ok(start + 260 > 200, "we are past the cap the sheet used to read through");
  assert.equal(buildSheet().revision, start + 260, "not frozen at 200");
});

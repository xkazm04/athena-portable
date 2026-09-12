/**
 * The sheet's deviation counts, in the units their own clauses print.
 *
 *   node --experimental-transform-types --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.chdir(mkdtempSync(join(tmpdir(), "tidycrm-test-")));

const { domainSpellings, segmentRows } = await import("../lib/db");
const { deleteContacts } = await import("../lib/mutations");
const { buildSheet } = await import("../lib/blocks");

const DOMAIN = "verdant-supply.example";
const blocks = () => buildSheet().zones.flatMap((z) => z.tables);

test("a conflict deviation counts spellings, which is what its clause says", () => {
  for (const block of blocks()) {
    const deviation = block.deviations.find((d) => d.kind === "conflict");
    if (!deviation) {
      assert.ok(block.spellings.length <= 1, `${block.ident} is spelled one way`);
      continue;
    }
    assert.equal(deviation.count, block.spellings.length, `${block.ident} count is in spellings`);
    assert.match(deviation.clause, new RegExp(`spelled ${deviation.count} ways`));
  }
});

test("repairing a domain clears its conflict deviation", () => {
  const consensus = domainSpellings(DOMAIN)[0]?.company;
  assert.ok(consensus);
  const before = blocks().find((b) => b.domain === DOMAIN);
  assert.equal(
    before?.deviations.find((d) => d.kind === "conflict")?.count,
    domainSpellings(DOMAIN).length,
    "the deviation counts the spellings the domain actually carries",
  );

  const odd = segmentRows("all")
    .filter((c) => c.domain === DOMAIN && c.company.trim() !== consensus)
    .map((c) => c.id);
  assert.equal(deleteContacts(odd).ok, true);

  const after = blocks().find((b) => b.domain === DOMAIN);
  assert.equal(
    after?.deviations.find((d) => d.kind === "conflict"),
    undefined,
    "the deviation is gone, not stuck at `spelled 1 ways`",
  );
  // A record is checked when it carries NO outstanding deviation, so clearing the conflict can
  // only raise the block's coverage - it cannot settle a stale date or a hand-typed phone number
  // the survivors still carry. The claim is that the repair counted, not that it was the last one.
  assert.ok(
    (after?.coverage ?? 0) > (before?.coverage ?? 0),
    "and the records it marked are that much closer to checked",
  );
});

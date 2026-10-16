/**
 * The domain lib's own agreements, pinned (scan-sweep stabilize, 2026-10-16).
 *
 * Each test here stands for two statements of one rule that had drifted apart inside `lib/`: a
 * figure the close prints beside another it should add up with, a total the lanes print beside
 * the total the mast prints, an amount the gate reads differently from the person who typed it.
 * Each one was seen red on the tree before its fix.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { tempHome } from "./tmp-home";

// Own scratch cwd, own seeded copy: `openDb` resolves the file from `process.cwd()/data`.
tempHome("ledgerbox-domain-lib-");

const { PERIODS } = await import("../lib/constants");
const { summarize } = await import("../lib/db");

test("on every period, what was invoiced is what was collected plus what is still owed", () => {
  // All three figures describe one set of invoices (issued in the period, drafts and voids out),
  // so the close cannot print an Invoiced line that the two under it do not add up to. Counting
  // only the payments that ALSO landed inside the period dropped every June invoice paid in July
  // from June's Collected without adding it back anywhere.
  for (const period of PERIODS) {
    const s = summarize(period);
    assert.equal(
      s.invoiced_cents,
      s.collected_cents + s.outstanding_cents,
      `${period}: invoiced ${s.invoiced_cents} vs collected ${s.collected_cents} + outstanding ${s.outstanding_cents}`,
    );
  }
});

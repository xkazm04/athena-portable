/**
 * `conflict` is a stored flag, so the writes that change a domain's spelling set owe it a
 * refresh - the same contract `phone_ok` has after a phone write. Its own file because each
 * test file gets its own process, and therefore its own freshly seeded database.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.chdir(mkdtempSync(join(tmpdir(), "tidycrm-test-")));

const { domainSpellings, segmentRows } = await import("../lib/db");
const { deleteContacts, normalizeFields } = await import("../lib/mutations");

const DOMAIN = "verdant-supply.example";
const live = () => segmentRows("all").filter((c) => c.domain === DOMAIN);

test("collapsing a domain to one spelling clears its conflict flag", () => {
  // Derived, not written down: the seed's own figures move when the registry gains a person, and
  // a test that pins them fails for the wrong reason. What must hold is that the two agree.
  assert.ok(domainSpellings(DOMAIN).length > 1, "the seed spells this domain more than one way");
  assert.equal(
    live().filter((c) => c.conflict === 1).length,
    live().length,
    "and marks every record on it",
  );

  const consensus = domainSpellings(DOMAIN)[0]?.company;
  assert.ok(consensus);
  const odd = live()
    .filter((c) => c.company.trim() !== consensus)
    .map((c) => c.id);
  assert.equal(deleteContacts(odd).ok, true);

  // The read path and the stored flag are two drawings of one fact and must agree.
  assert.equal(domainSpellings(DOMAIN).length, 1, "one spelling left");
  assert.equal(
    live().filter((c) => c.conflict === 1).length,
    0,
    "so no survivor is still marked, and the deviation can clear",
  );
});

test("a company rewrite restamps the flag for its domain", () => {
  const dirty = segmentRows("all").find((c) => c.company !== c.company.trim().replace(/\s{2,}/g, " "));
  if (!dirty) return; // the seed carries no whitespace-dirty company; nothing to exercise.

  const spelled = domainSpellings(dirty.domain).length;
  assert.equal(normalizeFields([dirty.id], ["trim_whitespace"]).ok, true);
  const now = domainSpellings(dirty.domain).length;
  const marked = segmentRows("all").filter((c) => c.domain === dirty.domain && c.conflict === 1).length;
  assert.equal(marked > 0, now > 1, "the flag says what the spelling count says");
  assert.ok(now <= spelled);
});

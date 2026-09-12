/**
 * The memory beat: a spelling learned in another app, spent here (design 4.6.4, act 3).
 *
 * In act 1 a payment lands in Ledgerbox from "PINEGROVE COOP" and a person confirms it is
 * Pinegrove Collective. In act 3 the same alias is one of the ways this app's contacts spell that
 * client, and Athena settles the domain on the real name without being told what it is. That only
 * works if the row is HERE, on every machine, with that exact spelling - which is a property of
 * the seed and therefore a test, not a hope. Both spellings come from `PINEGROVE_ALIAS`, so the
 * two apps cannot drift apart without this failing.
 *
 * The rest is the write itself: a rewrite that `undo` puts back is what makes `resolve_company`
 * AUTO, so "reversible" is checked rather than declared.
 *
 *   node --experimental-transform-types --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { COMPANIES, PINEGROVE_ALIAS } from "@athena/demo-kit/seed";

process.chdir(mkdtempSync(join(tmpdir(), "tidycrm-test-")));

const { listActivity, undoActivity } = await import("@athena/demo-kit/activity");
const { db, domainContacts, domainSpellings, listConflicts, readConflicts } = await import("../lib/db");
const { applyUndo, planCompany, resolveCompany } = await import("../lib/mutations");
const { MAX_DOMAINS } = await import("../lib/constants");

const PINEGROVE = COMPANIES[0]!;

test("Pinegrove is one of the conflicted domains, spelled the way act 1 learned it", () => {
  assert.equal(PINEGROVE.name, "Pinegrove Collective", "the registry's first client");

  const conflicted = listConflicts();
  assert.equal(conflicted.length, 10, "ten domains carry more than one spelling");
  const pinegrove = conflicted.find((c) => c.domain === PINEGROVE.domain);
  assert.ok(pinegrove, "and Pinegrove's is deterministically one of them");

  const spellings = pinegrove.spellings.map((s) => s.company);
  assert.ok(spellings.includes(PINEGROVE_ALIAS.crm), `the alias is carried: ${spellings.join(" / ")}`);
  assert.ok(spellings.includes(PINEGROVE.name), "and so is the real name");
  assert.ok(spellings.length >= 3, "with the usual drift around them");
  assert.ok(pinegrove.client, "it is a client domain, so the campaign goes to it");
});

test("read_conflicts is bounded, announces the bound, and answers about one domain", () => {
  const all = readConflicts(undefined, 0);
  assert.equal(all.total, 10);
  assert.equal(all.showing, all.domains.length);
  assert.equal(all.footer, `(showing ${all.showing} of ${all.total})`);
  assert.ok(all.showing <= MAX_DOMAINS);

  const cut = readConflicts(undefined, 3);
  assert.equal(cut.showing, 3);
  assert.equal(cut.total, 10, "the total is the total, not what was returned");
  assert.equal(cut.footer, "(showing 3 of 10)");

  const one = readConflicts(PINEGROVE.domain, 0);
  assert.equal(one.showing, 1);
  assert.equal(one.domains[0]?.domain, PINEGROVE.domain);
  assert.equal(
    one.domains[0]?.contacts,
    domainContacts(PINEGROVE.domain).length,
    "the count is the live contacts on the domain",
  );
});

test("resolve_company rewrites every contact on the domain, and undo puts them back", () => {
  const before = domainContacts(PINEGROVE.domain);
  const alias = before.filter((c) => c.company.trim() === PINEGROVE_ALIAS.crm);
  assert.ok(alias.length > 0, "the alias is on real records, not only in the spelling list");

  // The preview promises exactly what the write does.
  const plan = planCompany(PINEGROVE.domain, PINEGROVE.name);
  assert.ok(typeof plan !== "string", plan as string);
  assert.equal(plan.canonical_name, PINEGROVE.name);
  assert.equal(plan.contacts, before.length);
  assert.equal(plan.rewrites, before.filter((c) => c.company !== PINEGROVE.name).length);
  assert.equal(plan.footer, `(showing ${plan.showing} of ${plan.total})`);
  assert.ok(plan.showing <= plan.total, "the sample never exceeds the work");
  assert.ok(
    plan.changes.every((c) => c.to === PINEGROVE.name),
    "every change files the record under the one name",
  );

  const rewrites = plan.rewrites;
  const result = resolveCompany(PINEGROVE.domain, PINEGROVE.name);
  assert.equal(result.ok, true, result.error);

  const after = domainContacts(PINEGROVE.domain);
  assert.equal(after.length, before.length, "nobody left the list");
  assert.deepEqual(
    [...new Set(after.map((c) => c.company))],
    [PINEGROVE.name],
    "one spelling, and it is the one act 1 learned",
  );
  assert.equal(domainSpellings(PINEGROVE.domain).length, 1);
  assert.equal(after.filter((c) => c.conflict === 1).length, 0, "the stored flag was restamped");
  assert.equal(
    listConflicts().find((c) => c.domain === PINEGROVE.domain),
    undefined,
    "and the domain is off the conflict list",
  );

  // AUTO is a claim about reversibility, so the claim is exercised.
  const entry = listActivity(db(), 1)[0];
  assert.ok(entry && entry.action === "resolve_company");
  assert.equal(entry.reversible, true);
  assert.match(entry.summary, new RegExp(`${rewrites} contacts?`));

  assert.equal(undoActivity(db(), entry.id, applyUndo).ok, true);
  const restored = domainContacts(PINEGROVE.domain);
  assert.deepEqual(
    restored.map((c) => `${c.id}:${c.company}`),
    before.map((c) => `${c.id}:${c.company}`),
    "every record carries the spelling it had, drift and all",
  );
  assert.ok(domainSpellings(PINEGROVE.domain).length > 1, "the conflict is back");
  assert.equal(
    restored.filter((c) => c.conflict === 1).length,
    restored.length,
    "and so is the flag",
  );
});

test("resolve_company refuses what it cannot settle, and says why", () => {
  const blank = resolveCompany(PINEGROVE.domain, "   ");
  assert.equal(blank.ok, false);
  assert.match(blank.error ?? "", /Name the spelling to keep/);

  const nowhere = resolveCompany("not-a-client.example", "Anything");
  assert.equal(nowhere.ok, false);
  assert.match(nowhere.error ?? "", /No live contacts/);

  // Settling a domain that is already settled is not an error; it is a no-op that says so.
  assert.equal(resolveCompany(PINEGROVE.domain, PINEGROVE.name).ok, true);
  const again = resolveCompany(PINEGROVE.domain, PINEGROVE.name);
  assert.equal(again.ok, true);
  assert.match(again.summary, /already/);
});

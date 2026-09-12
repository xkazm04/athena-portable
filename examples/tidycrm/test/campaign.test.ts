/**
 * One studio's contact list, and the page the campaign is signed off on (design 4.6.4, act 3).
 *
 * Two properties, and both are about the demo reading as three tabs rather than three products:
 *
 *   1. the people the sibling apps hold by name - every registry company's billing contact, and
 *      the applicant Hirelane sees - are the SAME people here, verbatim, so a fact remembered in
 *      one tab is checkable in the next. They are copied from the registry, not drawn, and
 *      `injectDefects` is never pointed at them;
 *   2. `export` answers with enough for a person to act on: the row count, what changed, and which
 *      companies the rows belong to. The quiet client is IN that list like any other - the
 *      decision to leave them out of a campaign is the reader's, and an app that hardcoded it
 *      would be making a judgement it has no basis for.
 *
 *   node --experimental-transform-types --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { COMPANIES, KESTREL_APPLICANT, QUIET_CLIENT, STUDIO } from "@athena/demo-kit/seed";

process.chdir(mkdtempSync(join(tmpdir(), "tidycrm-test-")));

const { countSegment, defectCounts, segmentRows } = await import("../lib/db");
const { resolveCompany } = await import("../lib/mutations");
const { exportSummary } = await import("../lib/summary");
const { TOTAL_CONTACTS, ANCHOR_COUNT } = await import("../lib/seed-data");
const { MAX_COMPANIES } = await import("../lib/constants");

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");

test("the seed is 800 contacts, 60 pairs, and the 43/17 split the decision card is about", () => {
  const counts = defectCounts();
  assert.equal(counts.total, TOTAL_CONTACTS);
  assert.equal(counts.total, 800, "the figure the demo says out loud");
  assert.equal(counts.pairs_total, 60);
  assert.equal(counts.confident_open, 43, "43 confident merges");
  assert.equal(counts.uncertain_open, 17, "17 a person must judge");
  assert.equal(counts["phone-format"], 120, "120 hand-typed phone numbers");
  assert.equal(ANCHOR_COUNT, COMPANIES.length + 1, "fifteen billing contacts and the applicant");
});

test("every person the sibling apps hold by name is in this list, verbatim", () => {
  const rows = segmentRows("all");
  const byEmail = new Map(rows.map((r) => [r.email, r]));

  for (const company of COMPANIES) {
    const row = byEmail.get(company.contact.email);
    assert.ok(row, `${company.contact.email} is missing from the contact list`);
    assert.equal(`${row.first_name} ${row.last_name}`, company.contact.name);
    assert.equal(row.title, company.contact.title);
    assert.equal(row.domain, company.domain);
    assert.equal(row.company, company.name, "filed under the canonical spelling");
  }

  const wren = byEmail.get(KESTREL_APPLICANT.email);
  assert.ok(wren, "the Kestrel applicant is a Kestrel contact here too");
  assert.equal(`${wren.first_name} ${wren.last_name}`, KESTREL_APPLICANT.name);
  assert.equal(wren.title, KESTREL_APPLICANT.title);
  assert.equal(wren.domain, "kestrel-labs.example");
});

test("the sheet says whose list this is", () => {
  assert.match(read("components/blocks/sheet/Head.tsx"), /STUDIO\.name/);
  assert.equal(STUDIO.name, "Halden Studio");
});

test("the clients segment is the registry, and nothing else", () => {
  const clients = segmentRows("clients");
  const domains = new Set(COMPANIES.map((c) => c.domain));
  assert.ok(clients.length > 0);
  assert.equal(clients.length, countSegment("clients"));
  assert.ok(
    clients.every((c) => domains.has(c.domain)),
    "every exported row is on a registry domain",
  );
  const covered = new Set(clients.map((c) => c.domain));
  assert.equal(covered.size, COMPANIES.length, "and every client has someone on it");
});

test("export returns a title and a markdown summary of what changed", () => {
  const before = exportSummary("clients");
  assert.equal(before.segment, "clients");
  assert.equal(before.title, "TidyCRM cleanup — Client contacts");
  assert.equal(before.contacts, countSegment("clients"));
  assert.equal(before.resolved_companies, 0, "nothing settled yet");

  // Do one of act 3's writes, then ask again: the figures are counted from the database, so they
  // move because the data moved and not because anything was accumulated in a variable.
  const pinegrove = COMPANIES[0]!;
  assert.equal(resolveCompany(pinegrove.domain, pinegrove.name).ok, true);

  const after = exportSummary("clients");
  assert.equal(after.resolved_companies, 1);
  assert.ok(after.resolved_contacts > 0);
  assert.equal(after.contacts, before.contacts, "settling a name moves nobody out of the segment");

  assert.match(after.markdown, /^## TidyCRM cleanup — Client contacts$/m);
  assert.match(after.markdown, new RegExp(`Settled 1 company name across ${after.resolved_contacts} contacts`));
  assert.match(after.markdown, /\| Company \| Domain \| Contacts \|/);
  assert.match(after.markdown, new RegExp(`\\(showing ${after.companies.showing} of ${after.companies.total}\\)`));
});

test("the export names every company and its domain, and excludes nobody for the reader", () => {
  const summary = exportSummary("clients");
  assert.equal(summary.companies.showing, summary.companies.items.length);
  assert.ok(summary.companies.showing <= MAX_COMPANIES);
  assert.equal(
    summary.companies.footer,
    `(showing ${summary.companies.showing} of ${summary.companies.total})`,
  );
  assert.ok(
    summary.companies.items.every((i) => i.domain.endsWith(".example") && i.contacts > 0),
    "each row carries the domain, which is the key the other apps join on",
  );

  // The client who paid 80% and went quiet is in the export like everyone else. Leaving them out
  // of the campaign is a judgement, and the app does not make it - it just says who is there.
  const quiet = COMPANIES.find((c) => c.name === QUIET_CLIENT);
  assert.ok(quiet);
  assert.ok(
    summary.companies.items.some((i) => i.domain === quiet.domain),
    `${QUIET_CLIENT} is listed, with the domain that identifies their rows`,
  );
  assert.doesNotMatch(
    read("lib/summary.ts") + read("lib/db.ts") + read("lib/constants.ts"),
    new RegExp(QUIET_CLIENT),
    "and no module names them: the exclusion is the reader's, never the app's",
  );
});

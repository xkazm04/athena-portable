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
import type { Contact } from "../lib/types";

tempHome("tidycrm-test-");

const { getActivity } = await import("@athena/demo-kit/activity");
const {
  countOpenPairs,
  db,
  defectCounts,
  domainSpellings,
  getContact,
  getPair,
  listConflicts,
  listOpenPairs,
  segmentRows,
} = await import("../lib/db");
const { CSV_COLUMNS, toCsv } = await import("../lib/csv");
const { exportSummary } = await import("../lib/summary");
const { deleteContacts, mergeContacts, normalizeFields, resolveCompany, resolvePair, undoWrite } =
  await import("../lib/mutations");

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

test("a record merged away no longer counts as a spelling, so settling the domain clears it", () => {
  const conflicted = new Set(listConflicts().map((c) => c.domain));
  const pair = listOpenPairs(200).find((p) => {
    const keep = getContact(p.keep_id);
    return keep !== undefined && conflicted.has(keep.domain) && getContact(p.drop_id)?.domain === keep.domain;
  });
  assert.ok(pair, "the seed holds identity pairs on domains spelled more than one way");
  const drop = getContact(pair.drop_id);
  assert.ok(drop);
  const domain = drop.domain;

  // The demo's own order: clear the duplicates, then settle the name. The merged-away record is
  // out of every working segment and out of `resolve_company`'s write set, so it keeps its
  // spelling - and must not keep the domain in conflict with it.
  assert.equal(mergeContacts(pair.keep_id, pair.drop_id).ok, true);
  const other = domainSpellings(domain).find((s) => s.company !== drop.company.trim());
  assert.ok(other, "a second spelling to settle on");
  assert.equal(resolveCompany(domain, other.company).ok, true);

  assert.deepEqual(
    domainSpellings(domain).map((s) => s.company),
    [other.company],
    "one spelling among the records still in the list",
  );
  assert.equal(
    segmentRows("all").filter((c) => c.domain === domain && c.conflict === 1).length,
    0,
    "so no survivor is still marked",
  );
  assert.ok(!listConflicts().some((c) => c.domain === domain), "and read_conflicts drops the domain");
});

/** The newest activity row's id: the entry a write just logged. */
function lastActivityId(): number {
  const row = db().get<{ id: number }>("SELECT MAX(id) AS id FROM activity");
  assert.ok(row);
  return row.id;
}

test("undo refuses to put back a field a later write has changed since", () => {
  const dirty = segmentRows("all").find((c) => c.company !== c.company.trim());
  assert.ok(dirty, "the seed carries a whitespace-dirty company");
  const original = dirty.company;

  assert.equal(normalizeFields([dirty.id], ["trim_whitespace"]).ok, true);
  const tidied = lastActivityId();
  assert.equal(resolveCompany(dirty.domain, "Undo Probe Ltd").ok, true);
  const settled = lastActivityId();

  // Replaying the older write would hand the field back its pre-tidy value over the newer
  // decision, and leave that decision's revision counted as live in the export summary.
  const refused = undoWrite(tidied);
  assert.equal(refused.ok, false);
  assert.match(refused.reason ?? "", /changed again/);
  assert.equal(getContact(dirty.id)?.company, "Undo Probe Ltd", "the newer write stands");
  assert.equal(getActivity(db(), tidied)?.undone, false, "and the refused entry can still be undone later");

  // Newest first, both go back, and the record ends where it started.
  assert.equal(undoWrite(settled).ok, true);
  assert.equal(undoWrite(tidied).ok, true);
  assert.equal(getContact(dirty.id)?.company, original);
});

test("undo does not reopen a pair whose record has left the working list", () => {
  const pair = listOpenPairs(200)[5];
  assert.ok(pair);
  assert.equal(resolvePair(pair.id, "skipped").ok, true);
  const skipped = lastActivityId();
  assert.equal(deleteContacts([pair.drop_id]).ok, true);

  const refused = undoWrite(skipped);
  assert.equal(refused.ok, false, "a pair with a deleted member cannot be adjudicated again");
  assert.match(refused.reason ?? "", /no longer in the list/);
  assert.equal(getPair(pair.id)?.status, "skipped");
  assert.equal(getContact(pair.keep_id)?.in_open_pair, 0, "so the survivor is not held in the duplicates segment");
  assert.equal(defectCounts().pairs_open, countOpenPairs(), "and the two open-pair figures agree");
});

/** RFC 4180 alone, the encoder before the formula guard: the ordinary rows must not move from it. */
function rfcOnly(rows: Contact[]): string {
  const cell = (v: unknown): string => {
    const text = v === null || v === undefined ? "" : String(v);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const body = rows.map((r) => CSV_COLUMNS.map((c) => cell(r[c as keyof Contact])).join(","));
  return [CSV_COLUMNS.join(","), ...body].join("\r\n") + "\r\n";
}

test("the CSV export opens a formula-shaped cell as text and leaves every ordinary cell alone", () => {
  // The ordinary set: every seeded row, signed E.164 phones and all, byte for byte.
  const ordinary = segmentRows("all");
  assert.ok(ordinary.some((c) => c.phone.startsWith("+")), "the seed's phones lead with a plus");
  assert.equal(toCsv(ordinary), rfcOnly(ordinary));

  // The hostile set, written through the one door an agent can name a company by.
  const sample = ordinary.find((c) => c.in_open_pair === 0 && c.conflict === 0);
  assert.ok(sample);
  const hostile = [
    '=HYPERLINK("http://evil.example","open")',
    "@SUM(1+1)",
    "+cmd|' /C calc'!A0",
    "-2+3",
    "\t=1+1",
    "＝1+1",
  ];
  for (const name of hostile) {
    const line = toCsv([{ ...sample, company: name }]).split("\r\n")[1] ?? "";
    const company = line.split(",")[CSV_COLUMNS.indexOf("company")] ?? "";
    assert.ok(company.replace(/^"/, "").startsWith("'"), `${JSON.stringify(name)} exports as text: ${company}`);
  }
  // A formatted phone and a signed number are data, not formulas.
  const kept = toCsv([{ ...sample, phone: "+1 870 555 8230", city: "-40" }]).split("\r\n")[1] ?? "";
  assert.match(kept, /,\+1 870 555 8230,/);
  assert.match(kept, /,-40,/);

  assert.equal(resolveCompany(sample.domain, hostile[0]!).ok, true);
  assert.match(toCsv(segmentRows("all").filter((c) => c.domain === sample.domain)), /,"'=HYPERLINK\(/);
});

test("the write door checks at run time what the types only promise", () => {
  // A server action is an HTTP endpoint: its TypeScript signature is advice to the caller, not a
  // check on what arrives. The tool layer filters, but the library is the door every caller shares.
  const pair = listOpenPairs(200)[0];
  assert.ok(pair);
  for (const status of ["merged", "open", "deleted"]) {
    const result = resolvePair(pair.id, status as never);
    assert.equal(result.ok, false, `resolve_pair does not write status "${status}"`);
    assert.equal(getPair(pair.id)?.status, "open");
  }

  const odd = segmentRows("phone-format")[0];
  assert.ok(odd);
  assert.equal(normalizeFields([odd.id], ["phone_e164", "drop_everything"] as never).ok, true);
  const logged = getActivity(db(), lastActivityId())?.summary ?? "";
  assert.match(logged, /phone_e164/);
  assert.doesNotMatch(logged, /drop_everything/, "the log names only the rules that were applied");

  const target = segmentRows("all").find((c) => c.in_open_pair === 0);
  assert.ok(target);
  for (const name of ["Acme\n# Signed off", "Acme\u0000Ltd", "Acme\tLtd"]) {
    const result = resolveCompany(target.domain, name);
    assert.equal(result.ok, false, `${JSON.stringify(name)} is refused`);
    assert.match(result.error ?? "", /line break|control/);
  }
});

test("a company name prints as one Markdown table cell, whatever punctuation it carries", () => {
  // Every seeded company is plain words, so the escape is the identity on the demo's own page.
  assert.ok(
    segmentRows("all").every((c) => !/[\\|`*_[\]<>]/.test(c.company)),
    "the seed spells no company with Markdown punctuation",
  );

  const target = segmentRows("all").find((c) => c.in_open_pair === 0 && c.conflict === 0);
  assert.ok(target);
  const name = "Acme | [Pay here](http://evil.example) *now* \\";
  assert.equal(resolveCompany(target.domain, name).ok, true);

  const row = exportSummary("all").markdown.split("\n").find((l) => l.includes("Acme"));
  assert.ok(row, "the company is in the table");
  // The row is `| company | domain | contacts |`: three cells between unescaped pipes, the domain
  // in the middle one, and the bracket that would open a link escaped.
  const cells = row.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
  assert.equal(cells.length, 3, row);
  assert.equal(cells[1], target.domain);
  assert.match(cells[0] ?? "", /\\\[Pay here\\\]/, "the link is text, not a link");
  assert.match(cells[0] ?? "", /\\\*now\\\*/, "and the emphasis is text");
});

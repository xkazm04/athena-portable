/**
 * The nine databases replaced the four zones and MOVED NOTHING ELSE.
 *
 * That is the whole claim of round 2's model change, and it is the one a
 * regrouping can silently break: the grouping above the blocks changed, so the
 * seed underneath it must be provably identical. The four demo acts in the
 * README all depend on it — the 120 hand-typed phones, the 60 open pairs, the
 * ten conflicted domains and `pinegrove-collective.example` in particular — and
 * a sheet that quietly dropped a table on the way to nine buckets would still
 * look right on screen.
 *
 * So this file asserts the regrouping against the DATABASE rather than against
 * the previous shape of the code, which is the only comparison that survives the
 * old code being deleted:
 *
 *   1. every live record is in exactly one table of exactly one database, and
 *      the set of record ids is the set `segmentRows("all")` returns;
 *   2. every open pair the sheet attaches to a table is an open pair the
 *      database has, with the same id and the same orientation;
 *   3. the conflicted domains and their spellings are the ones `lib/db` has,
 *      and the act-3 domain is one of them;
 *   4. the mapping rule is a pure function of the idents, balanced, and pinned
 *      to the exact assignment it produces — so a change to it is a deliberate
 *      edit here and not a surprise on somebody's screen.
 *
 *   node --experimental-transform-types --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.chdir(mkdtempSync(join(tmpdir(), "tidycrm-test-")));

const { COMPANIES, PINEGROVE_ALIAS } = await import("@athena/demo-kit/seed");
const { allDomainSpellings, listOpenPairs, segmentRows } = await import("../lib/db");
const { buildSheet } = await import("../lib/blocks");
const { DATABASE_IDS, assignDatabases, identHash } = await import(
  "../components/blocks/model/databases"
);

/** The registry's first client: the one act 1 learned a spelling for. */
const PINEGROVE = COMPANIES[0]!;

const sheet = buildSheet();
const tables = sheet.databases.flatMap((d) => d.tables);

test("the nine databases partition the tables, four to seven each", () => {
  assert.equal(sheet.databases.length, 9, "nine databases");
  assert.deepEqual(
    sheet.databases.map((d) => d.id),
    [...DATABASE_IDS],
    "and they are the nine the data file names, in its order",
  );
  assert.equal(tables.length, sheet.tableCount, "every table is in exactly one database");
  assert.equal(new Set(tables.map((t) => t.ident)).size, tables.length, "no table twice");
  for (const db of sheet.databases) {
    assert.ok(
      db.tables.length >= 4 && db.tables.length <= 7,
      `${db.id} holds ${db.tables.length} tables, outside the four-to-seven band`,
    );
  }
});

test("the records did not move: same ids, same count, same domains", () => {
  const live = segmentRows("all");
  const onSheet = tables.flatMap((t) => t.ids);
  assert.equal(onSheet.length, live.length, "the sheet carries every live record");
  assert.equal(onSheet.length, 800, "and there are still eight hundred of them");
  assert.deepEqual(
    [...onSheet].sort(),
    live.map((c) => c.id).sort(),
    "the set of record ids is unchanged by the regrouping",
  );
  // A table is still one email domain. That is the vocabulary the whole
  // direction rests on, and nine databases sit ABOVE it rather than inside it.
  assert.deepEqual(
    tables.map((t) => t.domain).sort(),
    [...new Set(live.map((c) => c.domain))].sort(),
    "one table per domain, still",
  );
});

test("the identity pairs did not move: same ids, same orientation", () => {
  const open = listOpenPairs(200);
  const onSheet = tables.flatMap((t) => t.pairs);
  const byId = new Map(open.map((p) => [p.id, p]));
  for (const pair of onSheet) {
    const real = byId.get(pair.id);
    assert.ok(real, `pair ${pair.id} is on the sheet but not open in the database`);
    assert.equal(pair.keep.id, real.keep_id, `${pair.id} keeps the same record`);
    assert.equal(pair.drop.id, real.drop_id, `${pair.id} drops the same record`);
  }
  // The per-table duplicate counts are pairs, not records, and they still add up
  // to the queue — capped where the sheet caps it, which `sheetRead` announces.
  const counted = tables.reduce(
    (n, t) => n + (t.deviations.find((d) => d.kind === "duplicate")?.count ?? 0),
    0,
  );
  assert.equal(counted, sheet.unadjudicatedShown, "every attached pair is counted once");
});

test("the conflicted domains did not move, act 3's included", () => {
  const spellings = allDomainSpellings();
  const conflicted = Object.entries(spellings)
    .filter(([, list]) => list.length > 1)
    .map(([domain]) => domain)
    .sort();
  const onSheet = tables
    .filter((t) => t.spellings.length > 1)
    .map((t) => t.domain)
    .sort();
  assert.deepEqual(onSheet, conflicted, "the sheet's conflicted domains are the database's");
  assert.equal(conflicted.length, 10, "and there are still exactly ten of them");
  assert.ok(
    conflicted.includes(PINEGROVE.domain),
    `act 3 needs ${PINEGROVE.domain} to be conflicted`,
  );
  const pinegrove = tables.find((t) => t.domain === PINEGROVE.domain);
  assert.ok(
    pinegrove?.spellings.some((s) => s.company === PINEGROVE_ALIAS.crm),
    `and it has to still be spelled "${PINEGROVE_ALIAS.crm}" somewhere on it`,
  );
});

/*
 * The rule itself, without a database behind it. `assignDatabases` is the whole
 * mapping: hash the idents, put them in hash order, deal that order round-robin
 * into the nine. The hash is what stops the grouping being a size band — idents
 * are assigned by descending record count, so a SLICE of them would have put the
 * ten largest domains in one database and reproduced exactly the zone banding
 * this replaced — and the round-robin deal is what keeps the nine within one
 * table of each other.
 */

const IDENTS = [...Array(46)].map((_, i) => `BLK-${String(i + 1).padStart(2, "0")}`);

test("the mapping is deterministic and balanced", () => {
  const once = assignDatabases(IDENTS);
  const twice = assignDatabases([...IDENTS].reverse());
  assert.deepEqual(once, twice, "the input order does not change the answer");

  const sizes = DATABASE_IDS.map((id) => Object.values(once).filter((v) => v === id).length);
  assert.equal(
    sizes.reduce((a, b) => a + b, 0),
    IDENTS.length,
    "every ident is assigned exactly once",
  );
  assert.ok(
    Math.max(...sizes) - Math.min(...sizes) <= 1,
    `the deal is unbalanced: ${sizes.join(", ")}`,
  );
});

test("the mapping is not a size band", () => {
  const map = assignDatabases(IDENTS);
  // BLK-01 to BLK-09 are the nine largest domains. A slice of the ident order
  // would have put them in one or two databases; the hash spreads them.
  const homes = new Set(IDENTS.slice(0, 9).map((ident) => map[ident]));
  assert.ok(homes.size >= 7, `the nine largest tables landed in only ${homes.size} databases`);
});

test("the assignment is pinned, so changing it is a decision", () => {
  const map = assignDatabases(IDENTS);
  const by: Record<string, string[]> = {};
  for (const [ident, db] of Object.entries(map)) (by[db] ??= []).push(ident);
  for (const list of Object.values(by)) list.sort();
  assert.deepEqual(by, {
    billing: ["BLK-05", "BLK-10", "BLK-20", "BLK-26", "BLK-39", "BLK-40"],
    "crm-eu": ["BLK-04", "BLK-08", "BLK-11", "BLK-31", "BLK-34"],
    "crm-us": ["BLK-07", "BLK-16", "BLK-25", "BLK-35", "BLK-43"],
    support: ["BLK-06", "BLK-17", "BLK-29", "BLK-32", "BLK-42"],
    marketing: ["BLK-01", "BLK-14", "BLK-24", "BLK-36", "BLK-45"],
    partners: ["BLK-03", "BLK-15", "BLK-28", "BLK-33", "BLK-44"],
    events: ["BLK-02", "BLK-18", "BLK-23", "BLK-37", "BLK-46"],
    archive: ["BLK-12", "BLK-19", "BLK-22", "BLK-27", "BLK-41"],
    ops: ["BLK-09", "BLK-13", "BLK-21", "BLK-30", "BLK-38"],
  });
});

test("the hash is FNV-1a and stays inside 32 bits", () => {
  // The one value worth pinning: an implementation that drifts to a signed
  // result or to a different prime reshuffles every database silently.
  assert.equal(identHash(""), 0x811c9dc5);
  for (const ident of IDENTS) {
    const h = identHash(ident);
    assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff, `${ident} hashed to ${h}`);
  }
});

test("the sheet's own figures still add up over the new grouping", () => {
  assert.equal(
    sheet.databases.reduce((n, d) => n + d.tables.length, 0),
    sheet.tableCount,
  );
  assert.equal(sheet.databases.reduce((n, d) => n + d.records, 0), sheet.records);
  assert.equal(
    sheet.databases.reduce((n, d) => n + d.deviationTotal, 0),
    sheet.deviationTotal,
  );
  // `faulty` is what washes a cell red at L0, and it has to be the count of
  // tables carrying something outstanding — not of deviations, and not of the
  // tables awaiting a person, which no rule may clear.
  for (const db of sheet.databases) {
    assert.equal(db.faulty, db.tables.filter((t) => t.deviationTotal > 0).length, db.id);
    assert.equal(db.clear, db.tables.length - db.faulty, `${db.id} clear + faulty = all`);
  }
});

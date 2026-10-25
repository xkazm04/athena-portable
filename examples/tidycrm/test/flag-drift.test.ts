/**
 * The four stored defect flags are caches of four rules, and this file is the check that the cache
 * equals the rule (lib/flags.ts, ADR 0163). `flagDrift()` recomputes every flag from
 * its rule and names any row where the stored value disagrees; the cases below pin that it is
 * empty on the seed, that it catches a corrupted row, and that no sequence of writes and undos the
 * app can make leaves one behind. Its own file, so the walk has a freshly seeded database to itself.
 *
 *   node --experimental-transform-types --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { tempHome } from "./tmp-home";

tempHome("tidycrm-test-");

const { db, domainSpellings, listOpenPairs, segmentRows } = await import("../lib/db");
const { deleteContacts, flagStale, mergeContacts, normalizeFields, resolveCompany, resolvePair, undoWrite } =
  await import("../lib/mutations");
const { RULES } = await import("../lib/normalize");
/** Loaded inside each case, so one missing export fails the cases that need it and not the guard. */
const flagDrift = async () => (await import("../lib/flags")).flagDrift(db());

test("flagDrift on a freshly seeded database is empty: the seed stamps through the rules", async () => {
  assert.deepEqual(await flagDrift(), []);
});

test("flagDrift names a row whose stored flag a raw write corrupted, and only that row", async () => {
  // A phone stored like `(415) 555-0134`: its rule says 0, so a cache claiming 1 is drift.
  const badPhone = segmentRows("phone-format")[0];
  assert.ok(badPhone, "the seed carries a badly formatted phone");
  assert.doesNotMatch(badPhone.phone, /^\+1\d{10}$/);
  db().run("UPDATE contacts SET phone_ok = 1 WHERE id = ?", [badPhone.id]);
  assert.deepEqual(await flagDrift(), [{ id: badPhone.id, flag: "phone_ok", stored: 1, derived: 0 }]);
  db().run("UPDATE contacts SET phone_ok = 0 WHERE id = ?", [badPhone.id]);
  assert.deepEqual(await flagDrift(), []);

  const unpaired = segmentRows("all").find((c) => c.in_open_pair === 0);
  assert.ok(unpaired, "the seed leaves records in no pair");
  db().run("UPDATE contacts SET in_open_pair = 1 WHERE id = ?", [unpaired.id]);
  assert.deepEqual(await flagDrift(), [{ id: unpaired.id, flag: "in_open_pair", stored: 1, derived: 0 }]);
  db().run("UPDATE contacts SET in_open_pair = 0 WHERE id = ?", [unpaired.id]);
  assert.deepEqual(await flagDrift(), []);
});

/** mulberry32: a seeded, repeatable stream, so a failing walk can be replayed from its seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("a seeded random walk over every write and undo never leaves a flag drifted from its rule", async () => {
  for (const seed of [7, 1301, 90210]) {
    const r = rng(seed);
    const pick = <T>(xs: readonly T[]): T | undefined => xs[Math.floor(r() * xs.length)];
    const sample = <T>(xs: readonly T[], n: number): T[] => Array.from({ length: n }, () => pick(xs)).filter(
      (x): x is T => x !== undefined,
    );
    for (let step = 0; step < 150; step += 1) {
      // Ids come from every row, dead ones included, and from the activity log as it stands.
      const all = db().all<{ id: string; domain: string }>("SELECT id, domain FROM contacts");
      const working = segmentRows("all");
      const roll = r();
      let what = "";
      if (roll < 0.2) {
        const rules = RULES.filter(() => r() < 0.5);
        const ids = sample(r() < 0.7 ? working : all, 1 + Math.floor(r() * 6)).map((c) => c.id);
        what = `normalizeFields(${ids.join(",")}, ${rules.join(",")})`;
        normalizeFields(ids, rules);
      } else if (roll < 0.3) {
        const ids = sample(all, 1 + Math.floor(r() * 3)).map((c) => c.id);
        what = `flagStale(${ids.join(",")})`;
        flagStale(ids);
      } else if (roll < 0.45) {
        const row = pick(working) ?? pick(all);
        if (!row) continue;
        const spellings = domainSpellings(row.domain);
        const name = pick(spellings)?.company ?? `${row.domain} Ltd`;
        what = `resolveCompany(${row.domain}, ${name})`;
        resolveCompany(row.domain, name);
      } else if (roll < 0.6) {
        const pair = pick(listOpenPairs(200));
        const [a, b] = r() < 0.8 && pair ? [pair.keep_id, pair.drop_id] : sample(all, 2).map((c) => c.id);
        if (!a || !b) continue;
        what = `mergeContacts(${a}, ${b})`;
        mergeContacts(a, b);
      } else if (roll < 0.66) {
        const ids = sample(all, 1 + Math.floor(r() * 2)).map((c) => c.id);
        what = `deleteContacts(${ids.join(",")})`;
        deleteContacts(ids);
      } else if (roll < 0.8) {
        const pair = pick(listOpenPairs(200));
        if (!pair) continue;
        const verdict = r() < 0.5 ? "kept_both" : "skipped";
        what = `resolvePair(${pair.id}, ${verdict})`;
        resolvePair(pair.id, verdict);
      } else {
        const ids = db().all<{ id: number }>("SELECT id FROM activity").map((a) => a.id);
        const id = pick(ids);
        if (id === undefined) continue;
        what = `undoWrite(${id})`;
        undoWrite(id);
      }
      assert.deepEqual(await flagDrift(), [], `seed ${seed}, step ${step}: ${what}`);
    }
  }
  // The walk did work, not 450 refusals: some records left the list and some fields changed.
  assert.ok(db().get<{ n: number }>("SELECT COUNT(*) AS n FROM contacts WHERE merged_into IS NOT NULL")!.n > 0);
  assert.ok(db().get<{ n: number }>("SELECT COUNT(*) AS n FROM revisions")!.n > 0);
});

test("source guard: lib/flags.ts is the only file that writes a stored flag", () => {
  const libDir = fileURLToPath(new URL("../lib/", import.meta.url));
  const FLAG_WRITE = /UPDATE\s+contacts\s+SET[^;`"]*\b(phone_ok|is_stale|conflict|in_open_pair)\b/;
  const DYNAMIC_WRITE = /UPDATE\s+contacts\s+SET\s+\$\{/;
  const FLAG_INSERT = /INSERT\s+INTO\s+contacts[^;`"]*\b(phone_ok|is_stale|conflict|in_open_pair)\b/;
  const offenders = readdirSync(libDir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts") && f.replace(/\\/g, "/") !== "flags.ts")
    .filter((f) => {
      const src = readFileSync(libDir + f, "utf8");
      // A column chosen at run time could be a flag too, so only the door may build one.
      return FLAG_WRITE.test(src) || FLAG_INSERT.test(src) || DYNAMIC_WRITE.test(src);
    });
  assert.deepEqual(offenders, [], "a flag written outside lib/flags.ts is a flag that can drift");
  const door = readFileSync(libDir + "flags.ts", "utf8");
  assert.match(door, DYNAMIC_WRITE, "and lib/flags.ts is where they are written");
});

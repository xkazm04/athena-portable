/**
 * The dossier offers exactly what the writes accept: one act-availability module, pinned (ADR 0149).
 *
 * The gate used to decide from predicates of its own. Its tidy act labelled every live row although
 * `normalize_fields` changes only the rows its planner finds a change on, and its gated delete was
 * offered on the unflagged stale rows only, so flagging them - the reversible alternative the gate
 * recommends - took the delete away although `delete_contacts` accepts a flagged row. `lib/acts.ts`
 * is now the one answer, built by `buildSheet` from the writes' own planner, and these cases hold
 * the sheet, the writes and the gate's source to it.
 *
 *   node --experimental-transform-types --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { tempHome } from "./tmp-home";

tempHome("tidycrm-acts-test-");

const { countActivity, db } = await import("../lib/db");
const { deleteContacts, flagStale, mergeContacts, normalizeFields, planNormalize, resolvePair } =
  await import("../lib/mutations");
const { buildSheet } = await import("../lib/blocks");
const { REFUSAL } = await import("../lib/acts");

type Sheet = ReturnType<typeof buildSheet>;
type Table = Sheet["databases"][number]["tables"][number];
type ActName = "tidy" | "phone" | "flag" | "keep_both" | "merge" | "delete";
interface ActView {
  enabled: boolean;
  count: number;
  ids: string[];
  label: string;
  reason?: string;
}

const tables = (): Table[] => buildSheet().databases.flatMap((d) => d.tables);
const tableOf = (ident: string): Table => {
  const t = tables().find((x) => x.ident === ident);
  assert.ok(t, `${ident} is on the sheet`);
  return t;
};
/**
 * The act as the sheet carries it. Before the sheet carried acts, the gate decided inline, so a
 * table without them reads as the gate drew it then - which is what makes these cases red on that
 * tree for the reason the card names, and not merely because a field is missing.
 */
const actOf = (table: Table, name: ActName): ActView => {
  const acts = (table as Table & { acts?: Record<ActName, ActView> }).acts;
  if (acts) return acts[name];
  const inline = (ids: string[], label: string): ActView => ({ enabled: ids.length > 0, count: ids.length, ids, label });
  const pairs = table.pairs.map((p) => p.id);
  return {
    tidy: inline(table.ids, `Tidy whitespace and email case · ${table.ids.length} rows`),
    phone: inline(table.phoneIds, "phone"),
    flag: inline(table.staleIds, "flag"),
    keep_both: { ...inline(pairs, "Keep both records"), count: pairs.length > 0 ? 1 : 0 },
    merge: { ...inline(pairs, "Merge the identity pair"), count: pairs.length > 0 ? 1 : 0 },
    delete: inline(table.staleIds, "delete"),
  }[name];
};

/**
 * Every table a write touches, parents first. A write commits in its own transaction and SQLite
 * will not BEGIN inside an open SAVEPOINT, so each call is undone by putting these back as they
 * were (the form hirelane's test/acts.test.ts uses).
 */
const WRITTEN = ["contacts", "merge_pairs", "revisions", "activity"] as const;
const rolledBack = <T,>(body: () => T): T => {
  const raw = db().raw;
  for (const t of WRITTEN) raw.exec(`CREATE TEMP TABLE kept_${t} AS SELECT * FROM main.${t}`);
  try {
    return body();
  } finally {
    for (const t of [...WRITTEN].reverse()) raw.exec(`DELETE FROM main.${t}`);
    for (const t of WRITTEN) {
      raw.exec(`INSERT INTO main.${t} SELECT * FROM kept_${t}`);
      raw.exec(`DROP TABLE kept_${t}`);
    }
  }
};

/** How many records the newest activity row says the write changed: `contacts:N`, or 1 for a pair or a merge. */
const reportedChange = (): number => {
  const target = db().get<{ target: string }>("SELECT target FROM activity ORDER BY id DESC LIMIT 1")!.target;
  const m = /^contacts:(\d+)$/.exec(target);
  return m ? Number(m[1]) : 1;
};

/* Run in order, on one database: the fresh-seed cases first, the matrix (rolled back) next, and the
 * two cases that leave a write behind last. */

test("case 0: every tidy act counts the contacts the planner would change, not every live row", () => {
  const all = tables();
  assert.equal(all.length, 46, "the seed carries 46 tables");
  const wrong: string[] = [];
  let labelled = 0;
  let planned = 0;
  for (const t of all) {
    const want = planNormalize(t.ids, ["trim_whitespace", "lowercase_email"]).length;
    const tidy = actOf(t, "tidy");
    labelled += tidy.count;
    planned += want;
    if (tidy.count !== want) wrong.push(`${t.ident}: ${tidy.count} vs ${want}`);
    if (tidy.enabled) assert.match(tidy.label, new RegExp(`· ${want} rows?$`), `${t.ident}: the label prints it`);
  }
  assert.deepEqual(wrong, [], "the tidy count is the planned count on every table");
  assert.equal(labelled, planned);
  assert.ok(planned < 800, "and that is fewer than every live row");
});

test("case 4 (guard): on the fresh seed the phone act counts every row whose phone is not +1XXXXXXXXXX", () => {
  let total = 0;
  for (const t of tables()) {
    const printed = actOf(t, "phone").count;
    assert.equal(printed, t.phoneIds.length, `${t.ident}`);
    total += printed;
  }
  assert.equal(total, 120, "the seed's 120 hand-typed phones");
});

test("case 5 (guard): merge and keep both are offered exactly when the table carries an open pair", () => {
  for (const t of tables()) {
    const has = t.pairs.length > 0;
    assert.equal(actOf(t, "merge").enabled, has, `${t.ident}: merge`);
    assert.equal(actOf(t, "keep_both").enabled, has, `${t.ident}: keep both`);
  }
});

test("case 3: every act on every table is offered exactly when its write accepts it, and prints the count it changes", () => {
  const mismatches: string[] = [];
  const reasons = new Set<string>();
  for (const t of tables()) {
    const pair = t.pairs[0];
    const calls: Record<ActName, (a: ActView) => { ok: boolean }> = {
      tidy: (a) => normalizeFields(a.enabled ? a.ids : t.ids, ["trim_whitespace", "lowercase_email"]),
      phone: (a) => normalizeFields(a.enabled ? a.ids : t.ids, ["phone_e164"]),
      flag: (a) => flagStale(a.ids),
      keep_both: (a) => resolvePair(a.ids[0] ?? "pair_none", "kept_both"),
      merge: () => mergeContacts(pair?.keep.id ?? t.ids[0]!, pair?.drop.id ?? t.ids[1] ?? t.ids[0]!),
      delete: (a) => deleteContacts(a.ids),
    };
    for (const name of Object.keys(calls) as ActName[]) {
      const a = actOf(t, name);
      if (a.reason) reasons.add(`${name}:${a.reason}`);
      rolledBack(() => {
        const before = countActivity();
        const result = calls[name](a);
        const changed = result.ok && countActivity() > before;
        if (changed !== a.enabled) {
          mismatches.push(`${t.ident} ${name}: offered ${a.enabled}, write changed ${changed}`);
        } else if (changed && reportedChange() !== a.count) {
          mismatches.push(`${t.ident} ${name}: prints ${a.count}, write reports ${reportedChange()}`);
        }
      });
    }
  }
  assert.deepEqual(mismatches, [], "no act offers what its write refuses, refuses what it accepts, or miscounts");
  for (const r of ["merge:no_pair", "keep_both:no_pair"]) assert.ok(reasons.has(r), `the matrix met ${r}`);
});

test("case 1: once a table is tidied its tidy act is shut, with the refusal sentence", () => {
  const target = tables().find((t) => t.ident !== "BLK-05" && planNormalize(t.ids, ["trim_whitespace", "lowercase_email"]).length > 0);
  assert.ok(target, "the seed has a table with something to tidy");
  assert.equal(normalizeFields(target.ids, ["trim_whitespace", "lowercase_email"]).ok, true);
  const tidy = actOf(tableOf(target.ident), "tidy");
  assert.equal(tidy.enabled, false);
  assert.equal(tidy.reason, "nothing_to_tidy");
  assert.equal(tidy.count, 0);
  assert.equal(tidy.label, REFUSAL.nothing_to_tidy(), "the control prints the refusal, not 'Tidy ... N rows'");
});

test("case 2: flagging BLK-05's stale rows leaves the gated delete on offer for them, and the write accepts it", () => {
  const before = tableOf("BLK-05");
  const flagged = [...before.staleIds];
  assert.equal(flagged.length, 5, "BLK-05 starts with five unflagged stale rows");
  assert.equal(flagStale(flagged).ok, true);

  const after = tableOf("BLK-05");
  const del = actOf(after, "delete");
  assert.equal(del.enabled, true, "the delete is still offered");
  assert.equal(del.count, 5);
  for (const id of flagged) assert.ok(del.ids.includes(id), `${id}: the flagged row is still a delete target`);
  const flag = actOf(after, "flag");
  assert.equal(flag.enabled, false);
  assert.equal(flag.reason, "all_flagged");
  assert.equal(deleteContacts(del.ids).ok, true, "and delete_contacts accepts them");
});

test("case 6: the gate decides nothing for itself and reads every control from table.acts", () => {
  const source = readFileSync(new URL("../components/blocks/dossier/Gate.tsx", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  assert.doesNotMatch(source, /\.length === 0/, "no emptiness check of its own");
  assert.doesNotMatch(source, /staleIds|phoneIds|\bids\.length/, "no record list of its own");
  for (const name of ["tidy", "phone", "flag", "keep_both", "merge", "delete"]) {
    assert.match(source, new RegExp(`acts\\.${name}\\.enabled`), `${name}: enabled from the act`);
    assert.match(source, new RegExp(`acts\\.${name}\\.label`), `${name}: label from the act`);
  }
});

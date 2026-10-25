/**
 * The sheet walked worst first, from inside the dossier, across databases (`model/worklist.ts`).
 *
 * The order is the one `search_blocks` already used - the tables a person is waiting on, then the
 * most outstanding deviations - moved out of the agent's search into the model so the dossier's
 * next/previous keys, the agent's `next_table` and `search_blocks` read one comparator. A step is
 * pure: it names the next focus and its place in the list, crosses databases, never wraps, and
 * when the table just repaired has left the refreshed list it continues from the slot it held.
 *
 *   node --experimental-transform-types --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { tempHome } from "./tmp-home";

tempHome("tidycrm-worklist-test-");

const { buildSheet } = await import("../lib/blocks");
const { searchBlocks } = await import("../components/blocks/tools/search");

type Sheet = ReturnType<typeof buildSheet>;
interface Entry {
  database: string;
  ident: string;
  attention: boolean;
  deviationTotal: number;
}
interface Place {
  ident: string;
  at: number;
}
interface Step {
  group: string;
  item: string;
  at: number;
  of: number;
}

/** The module, or a failing assertion on a tree that has none, so each case fails on its own. */
const model = (await import("../components/blocks/model")) as Record<string, unknown>;
const worklistOf = (sheet: Sheet): Entry[] => {
  const fn = model.worklistOf as ((s: Sheet) => Entry[]) | undefined;
  assert.ok(typeof fn === "function", "model exports worklistOf");
  return fn(sheet);
};
const stepWorklist = (list: Entry[], from: Place | null, dir: "next" | "previous"): Step | null => {
  const fn = model.stepWorklist as ((l: Entry[], f: Place | null, d: string) => Step | null) | undefined;
  assert.ok(typeof fn === "function", "model exports stepWorklist");
  return fn(list, from, dir);
};

const sheet = buildSheet();
const tables = sheet.databases.flatMap((d) => d.tables.map((t) => ({ db: d.id, t })));

test("worklistOf holds every table with work and nothing else, worst first as search_blocks ranks it", () => {
  const list = worklistOf(sheet);
  const idle = tables.filter(({ t }) => t.deviationTotal === 0 && !t.attention).map(({ t }) => t.ident);
  for (const e of list) assert.ok(!idle.includes(e.ident), `${e.ident} has no work and is listed`);
  assert.equal(list.length, tables.length - idle.length);
  assert.ok(list.length > 1, "the seed has work in more than one table");
  const top = searchBlocks(sheet, {}).items[0] as { id: string; database: string };
  assert.deepEqual({ ident: list[0]!.ident, database: list[0]!.database }, { ident: top.id, database: top.database });
  // Each entry names the database its table really lives in.
  for (const e of list) assert.equal(tables.find(({ t }) => t.ident === e.ident)!.db, e.database);
});

test("worklistOf order is total: attention first, then most deviations, then ident", () => {
  const list = worklistOf(sheet);
  const wrong: string[] = [];
  for (let i = 1; i < list.length; i += 1) {
    const a = list[i - 1]!;
    const b = list[i]!;
    const ok =
      a.attention !== b.attention
        ? a.attention
        : a.deviationTotal !== b.deviationTotal
          ? a.deviationTotal > b.deviationTotal
          : a.ident < b.ident;
    if (!ok) wrong.push(`${a.ident} before ${b.ident}`);
  }
  assert.deepEqual(wrong, []);
  // Deterministic: the same sheet, shuffled, gives the same list.
  const shuffled = { ...sheet, databases: [...sheet.databases].reverse().map((d) => ({ ...d, tables: [...d.tables].reverse() })) };
  assert.deepEqual(worklistOf(shuffled as Sheet).map((e) => e.ident), list.map((e) => e.ident));
});

test("stepWorklist from nowhere opens the head of the list", () => {
  const list = worklistOf(sheet);
  assert.deepEqual(stepWorklist(list, null, "next"), {
    group: list[0]!.database,
    item: list[0]!.ident,
    at: 1,
    of: list.length,
  });
});

test("stepWorklist crosses into another database", () => {
  const list = worklistOf(sheet);
  const k = list.findIndex((e, i) => i + 1 < list.length && list[i + 1]!.database !== e.database);
  assert.ok(k >= 0, "the seed's list changes database somewhere");
  const step = stepWorklist(list, { ident: list[k]!.ident, at: k + 1 }, "next");
  assert.deepEqual(step, { group: list[k + 1]!.database, item: list[k + 1]!.ident, at: k + 2, of: list.length });
  assert.notEqual(step!.group, list[k]!.database);
});

test("stepWorklist does not wrap at either end", () => {
  const list = worklistOf(sheet);
  const last = list.length - 1;
  assert.equal(stepWorklist(list, { ident: list[last]!.ident, at: last + 1 }, "next"), null);
  assert.equal(stepWorklist(list, { ident: list[0]!.ident, at: 1 }, "previous"), null);
  // And previous is the inverse of next in the middle.
  const back = stepWorklist(list, { ident: list[2]!.ident, at: 3 }, "previous");
  assert.deepEqual(back, { group: list[1]!.database, item: list[1]!.ident, at: 2, of: list.length });
});

test("stepWorklist continues from the slot a cleared table held, not from the head", () => {
  const list = worklistOf(sheet);
  const k = 3;
  const cleared = list.filter((_, i) => i !== k);
  const step = stepWorklist(cleared, { ident: list[k]!.ident, at: k + 1 }, "next");
  assert.deepEqual(step, { group: list[k + 1]!.database, item: list[k + 1]!.ident, at: k + 1, of: cleared.length });
  const back = stepWorklist(cleared, { ident: list[k]!.ident, at: k + 1 }, "previous");
  assert.deepEqual(back, { group: list[k - 1]!.database, item: list[k - 1]!.ident, at: k, of: cleared.length });
  // The last table cleared: there is nothing after the slot it held.
  const tail = list.slice(0, -1);
  assert.equal(stepWorklist(tail, { ident: list[list.length - 1]!.ident, at: list.length }, "next"), null);
});

test("guard: search_blocks ranks every table where it did before the comparator moved into the model", () => {
  // The order as tools/search.ts ranked it before the move: attention, then most deviations, the
  // sheet's own deal order breaking ties (a stable sort over databases then tables). The move adds
  // ident as the last tie-break, so within a run of equal rank the order may change and nothing
  // else may: every place holds the same rank, and every complete run the same tables.
  const rank = (t: { attention: boolean; deviationTotal: number }) => `${t.attention ? "A" : "-"}${t.deviationTotal}`;
  const before = tables
    .slice()
    .sort((a, b) =>
      a.t.attention !== b.t.attention ? (a.t.attention ? -1 : 1) : b.t.deviationTotal - a.t.deviationTotal,
    )
    .slice(0, 25)
    .map(({ t }) => ({ id: t.ident, rank: rank(t) }));
  const now = (searchBlocks(sheet, {}).items as { id: string; deviations: number; awaiting_a_person: boolean }[]).map(
    (i) => ({ id: i.id, rank: rank({ attention: i.awaiting_a_person, deviationTotal: i.deviations }) }),
  );
  assert.deepEqual(
    now.map((e) => e.rank),
    before.map((e) => e.rank),
  );
  // The last run may be cut by the page, so its members may differ; every earlier run may not.
  const last = before[before.length - 1]!.rank;
  const runs = (xs: { id: string; rank: string }[]) =>
    [...new Set(xs.map((e) => e.rank))]
      .filter((r) => r !== last)
      .map((r) => xs.filter((e) => e.rank === r).map((e) => e.id).sort());
  assert.deepEqual(runs(now), runs(before));
});

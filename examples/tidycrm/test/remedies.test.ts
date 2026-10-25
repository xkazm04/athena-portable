/**
 * Every act the dossier's buttons fire is readable by the agent, from one module (ADR 0174).
 *
 * The dossier's AUTO bar fires `normalize_fields` and `flag_stale` on the id lists `table.acts`
 * carries (lib/acts.ts, ADR 0149), but no read handed those lists out: `read_view` at L2 sent six
 * sample rows, so an agent could only repair what a sample happened to show. `model/remedies.ts`
 * projects the same acts into the tool calls an agent sends, and `dossierRead` and `plan_repairs`
 * both serve it, so the button and the agent fire on one list.
 *
 *   node --experimental-transform-types --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { tempHome } from "./tmp-home";

tempHome("tidycrm-remedies-test-");

const { buildSheet } = await import("../lib/blocks");
const { MAX_IDS } = await import("../lib/constants");
const { PHONE_RULES, TIDY_RULES } = await import("../lib/acts");
const { dossierRead, tableRead } = await import("../components/blocks/tools/read");

type Sheet = ReturnType<typeof buildSheet>;
type Table = Sheet["databases"][number]["tables"][number];
interface Call {
  tool: string;
  args: Record<string, unknown>;
}
interface RemedyView {
  kind: string;
  by: string;
  count?: number;
  batch?: number;
  batches?: number;
  preview?: Call | null;
  act?: Call;
  pairs?: string[];
}

/** The module, or undefined on a tree that has none: each case then fails on its own. */
const model = (await import("../components/blocks/model")) as Record<string, unknown>;
const remediesOf = (table: Table): RemedyView[] => {
  const fn = model.remediesOf as ((t: Table) => RemedyView[]) | undefined;
  assert.ok(typeof fn === "function", "model exports remediesOf");
  return fn(table);
};

const sheet = buildSheet();
const tables: Table[] = sheet.databases.flatMap((d) => d.tables);
const of = (table: Table, kind: string): RemedyView[] => remediesOf(table).filter((r) => r.kind === kind);
const idsOf = (rs: RemedyView[]): unknown[] => rs.flatMap((r) => (r.act?.args.ids as unknown[]) ?? []);

test("phone remedy: preview_normalize then normalize_fields on exactly the ids the phone button fires", () => {
  const withPhone = tables.filter((t) => t.acts.phone.enabled);
  assert.ok(withPhone.length > 0, "the seed has phone work");
  for (const t of withPhone) {
    const [r, ...rest] = of(t, "phone");
    assert.equal(rest.length, 0, `${t.ident}: one batch`);
    const args = { ids: t.acts.phone.ids, rules: [...PHONE_RULES] };
    assert.deepEqual(r, {
      kind: "phone",
      by: "rule",
      count: t.acts.phone.ids.length,
      batch: 1,
      batches: 1,
      preview: { tool: "preview_normalize", args },
      act: { tool: "normalize_fields", args },
    });
    assert.deepEqual(r!.act!.args.rules, ["phone_e164"]);
  }
  for (const t of tables.filter((x) => !x.acts.phone.enabled)) assert.deepEqual(of(t, "phone"), []);
});

test("stale and tidy remedies carry the same argument sets the dossier's flag and tidy buttons send", () => {
  let stale = 0;
  for (const t of tables) {
    const flag = of(t, "stale");
    if (t.acts.flag.enabled) {
      assert.equal(flag.length, 1);
      assert.deepEqual(flag[0]!.act, { tool: "flag_stale", args: { ids: t.acts.flag.ids } });
      assert.equal(flag[0]!.by, "rule");
      // The flag's targets are the sheet's own stale-and-unflagged list.
      assert.deepEqual([...flag[0]!.act!.args.ids as string[]].sort(), [...t.staleIds].sort());
      stale += 1;
    } else assert.deepEqual(flag, []);
    const tidy = of(t, "tidy");
    if (t.acts.tidy.enabled) {
      assert.equal(tidy.length, 1);
      const args = { ids: t.acts.tidy.ids, rules: [...TIDY_RULES] };
      assert.deepEqual(tidy[0]!.act, { tool: "normalize_fields", args });
      assert.deepEqual(tidy[0]!.preview, { tool: "preview_normalize", args });
      assert.deepEqual(args.rules, ["trim_whitespace", "lowercase_email"]);
    } else assert.deepEqual(tidy, []);
  }
  assert.ok(stale > 0, "the seed has stale work");
});

test("a duplicate is a person's remedy: pair ids and no act, and no remedy ever names merge or delete", () => {
  let seen = 0;
  for (const t of tables) {
    const dup = of(t, "duplicate");
    if (t.attention && t.acts.merge.enabled) {
      assert.equal(dup.length, 1, `${t.ident}: one duplicate remedy`);
      assert.equal(dup[0]!.by, "person");
      assert.deepEqual(dup[0]!.pairs, t.acts.merge.ids);
      assert.equal("act" in dup[0]!, false, "no act on a person's remedy");
      assert.equal("preview" in dup[0]!, false);
      seen += 1;
    }
    const text = JSON.stringify(remediesOf(t));
    assert.ok(!text.includes("merge_contacts"), `${t.ident} names merge_contacts`);
    assert.ok(!text.includes("delete_contacts"), `${t.ident} names delete_contacts`);
    assert.ok(!text.includes("resolve_pair"), `${t.ident} names a verdict`);
  }
  assert.ok(seen > 0, "the seed has open pairs");
});

test("1,201 stale ids batch at MAX_IDS: 500, 500, 201, in order", () => {
  const base = tables.find((t) => t.acts.flag.enabled)!;
  const ids = Array.from({ length: 1201 }, (_, i) => `c_${String(i).padStart(5, "0")}`);
  const big = { ...base, staleIds: ids, acts: { ...base.acts, flag: { ...base.acts.flag, ids, count: ids.length } } };
  const flag = of(big as Table, "stale");
  assert.deepEqual(
    flag.map((r) => (r.act!.args.ids as string[]).length),
    [500, 500, 201],
  );
  assert.equal(MAX_IDS, 500);
  assert.ok(flag.every((r) => (r.act!.args.ids as string[]).length <= MAX_IDS));
  assert.deepEqual(idsOf(flag), ids);
  assert.deepEqual(flag.map((r) => [r.batch, r.batches]), [[1, 3], [2, 3], [3, 3]]);
});

test("dossierRead's remedies are remediesOf, for every seed table, so the L2 read and plan_repairs cannot disagree", () => {
  for (const t of tables) {
    assert.deepEqual((dossierRead(t) as { remedies?: unknown }).remedies, remediesOf(t), t.ident);
  }
});

test("guard: tableRead keeps its keys, and awaiting_a_person stays a boolean apart from deviations", () => {
  for (const t of tables) {
    const read = tableRead(t);
    assert.deepEqual(Object.keys(read), [
      "id",
      "name",
      "domain",
      "records",
      "checked",
      "coverage",
      "changed",
      "deviations",
      "by_kind",
      "awaiting_a_person",
      "why",
    ]);
    assert.equal(typeof read.awaiting_a_person, "boolean");
    assert.equal(read.deviations, t.deviationTotal);
  }
});

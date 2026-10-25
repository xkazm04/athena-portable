/**
 * The fourth check gets its repair: settling a company spelling from the dossier.
 *
 * Three of the dossier's four checks had a repair in the AUTO bar. The company-spelling conflict
 * printed its competing spellings and offered nothing, although `resolve_company` exists, is
 * reversible and is AUTO. `components/blocks/dossier/settle.ts` is the pure state machine the
 * dossier now runs it through - none | choosing | previewing | ready | refused - and these cases
 * hold it to the real planner, the real write and the real undo.
 *
 *   node --experimental-transform-types --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { tempHome } from "./tmp-home";

tempHome("tidycrm-settle-test-");

const { db } = await import("../lib/db");
const { planCompany, resolveCompany, undoWrite } = await import("../lib/mutations");
const { buildSheet } = await import("../lib/blocks");
/*
 * Loaded softly, so the two guard cases (0 and 6) state what already holds on a tree without the
 * module, and every other case is red there because the repair does not exist.
 */
const settle = await import("../components/blocks/dossier/settle").catch(() => null);
const S = () => {
  assert.ok(settle, "components/blocks/dossier/settle.ts exists");
  return settle;
};

type Table = ReturnType<typeof buildSheet>["databases"][number]["tables"][number];
type Plan = Exclude<ReturnType<typeof planCompany>, string>;

const tables = (): Table[] => buildSheet().databases.flatMap((d) => d.tables);
const conflicted = (): Table[] => tables().filter((t) => t.spellings.length > 1);
const hasConflict = (t: Table) => t.deviations.some((d) => d.kind === "conflict");
const plan = (t: Table, spelling: string): Plan => {
  const p = planCompany(t.domain, spelling);
  assert.ok(typeof p !== "string", `${t.ident}: the planner answers for "${spelling}": ${String(p)}`);
  return p;
};

/** `resolve_company`'s tables and the pairs that point at its contacts, put back after the body (test/acts.test.ts's form). */
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

const newestActivity = () =>
  db().get<{ id: number; action: string; summary: string }>(
    "SELECT id, action, summary FROM activity ORDER BY id DESC LIMIT 1",
  )!;

/** How many contacts the write says it filed: its activity row, "Filed N contact(s) on ...". */
const reportedFiled = (): number => {
  const row = newestActivity();
  assert.equal(row.action, "resolve_company");
  const m = /^Filed (\d+) contacts? on /.exec(row.summary);
  assert.ok(m, `the activity row reports a count: ${row.summary}`);
  return Number(m[1]);
};

test("case 0 (guard): a table spelled one way offers no chooser and no act", () => {
  const plain = tables().filter((t) => t.spellings.length < 2);
  assert.ok(plain.length > 0, "the seed has tables spelled one way");
  for (const t of plain) {
    assert.equal(hasConflict(t), false, `${t.ident}: one spelling carries no conflict deviation`);
    if (settle) assert.deepEqual(settle.settleState(t), { kind: "none" }, `${t.ident}`);
  }
});

test("case 1: a conflicted table lists every spelling, consensus first, with nothing chosen", () => {
  const { settleState } = S();
  const all = conflicted();
  assert.equal(all.length, 10, "the seed has 10 tables spelled more than one way");
  for (const t of all) {
    const state = settleState(t);
    assert.equal(state.kind, "choosing", `${t.ident}`);
    assert.ok(state.kind === "choosing");
    assert.deepEqual(state.spellings, t.spellings, `${t.ident}: every spelling, in the sheet's consensus-first order`);
    assert.ok(state.spellings[0]!.n >= state.spellings[1]!.n, `${t.ident}: consensus first`);
    assert.equal("spelling" in state, false, `${t.ident}: nothing is pre-selected`);
  }
});

test("case 2: choose previews, a plan readies the act with its label, a refusal says why", () => {
  const { settleState, reduce, choose, previewed, settleAct } = S();
  const t = conflicted()[0]!;
  const spelling = t.spellings[1]!.company;
  const start = settleState(t);

  const previewing = reduce(start, choose(spelling));
  assert.deepEqual(
    { kind: previewing.kind, spelling: "spelling" in previewing ? previewing.spelling : null },
    { kind: "previewing", spelling },
  );
  assert.equal(settleAct(previewing).enabled, false, "no act while the preview is out");

  const p = plan(t, spelling);
  const ready = reduce(previewing, previewed(spelling, p));
  assert.equal(ready.kind, "ready");
  assert.ok(ready.kind === "ready");
  assert.equal(ready.plan, p);
  const act = settleAct(ready);
  assert.equal(act.enabled, true);
  assert.equal(act.label, `File ${p.rewrites} contact${p.rewrites === 1 ? "" : "s"} under "${spelling}"`);

  const refused = reduce(previewing, previewed(spelling, "That company name is too long."));
  assert.equal(refused.kind, "refused");
  assert.ok(refused.kind === "refused");
  assert.equal(refused.reason, "That company name is too long.");
  assert.equal(settleAct(refused).enabled, false);
  assert.equal(settleAct(refused).label, "That company name is too long.");
});

test("case 3: the act prints the planner's rewrites, which is what the write reports filing", () => {
  const { settleState, reduce, choose, previewed, settleAct } = S();
  let naiveWrong = 0;
  for (const t of conflicted()) {
    const consensus = t.spellings[0]!;
    const p = plan(t, consensus.company);
    const naive = t.records - consensus.n;
    if (naive !== p.rewrites) naiveWrong += 1;

    const ready = reduce(reduce(settleState(t), choose(consensus.company)), previewed(consensus.company, p));
    const act = settleAct(ready);
    assert.match(act.label, new RegExp(`^File ${p.rewrites} contacts? under `), `${t.ident}: ${act.label}`);

    const filed = rolledBack(() => {
      const result = resolveCompany(t.domain, consensus.company);
      assert.equal(result.ok, true, `${t.ident}: ${result.error ?? ""}`);
      return reportedFiled();
    });
    assert.equal(filed, p.rewrites, `${t.ident}: the act printed ${p.rewrites}, the write filed ${filed}`);
  }
  assert.equal(naiveWrong, 4, "records - n would have printed the wrong count on 4 of the 10");
});

test("case 4: a preview for a spelling the person moved off cannot ready the act", () => {
  const { settleState, reduce, choose, previewed, settleAct } = S();
  const t = conflicted()[0]!;
  const [a, b] = [t.spellings[0]!.company, t.spellings[1]!.company];

  const onB = reduce(reduce(settleState(t), choose(a)), choose(b));
  const late = reduce(onB, previewed(a, plan(t, a)));
  assert.equal(late.kind, "previewing", "A's late answer is dropped");
  assert.ok(late.kind === "previewing");
  assert.equal(late.spelling, b, "and the state stays on B");
  assert.equal(settleAct(late).enabled, false);

  const lateRefusal = reduce(onB, previewed(a, "No live contacts on nowhere."));
  assert.equal(lateRefusal.kind, "previewing", "a late refusal for A is dropped too");

  const ready = reduce(late, previewed(b, plan(t, b)));
  assert.ok(ready.kind === "ready");
  assert.equal(ready.spelling, b);
  assert.equal(ready.plan.canonical_name, b);
});

test("case 5: once the act runs and the sheet is rebuilt, the conflict check passes and the chooser goes", () => {
  const { settleState, reduce, choose, previewed } = S();
  const t = conflicted()[0]!;
  assert.equal(hasConflict(t), true);
  const spelling = t.spellings[1]!.company;
  const ready = reduce(reduce(settleState(t), choose(spelling)), previewed(spelling, plan(t, spelling)));
  assert.ok(ready.kind === "ready");

  const result = resolveCompany(t.domain, ready.spelling);
  assert.equal(result.ok, true, result.error ?? "");
  const after = tables().find((x) => x.ident === t.ident)!;
  assert.equal(hasConflict(after), false, "no conflict deviation left");
  assert.equal(after.spellings.length, 1);
  assert.equal(after.spellings[0]!.company, spelling);
  assert.deepEqual(settleState(after), { kind: "none" });
});

test("case 6 (guard): undoing the settle restores the spellings and the conflict deviation", () => {
  const t = conflicted().at(-1)!;
  const before = { spellings: t.spellings, conflict: hasConflict(t) };
  assert.equal(before.conflict, true);

  const result = resolveCompany(t.domain, t.spellings[0]!.company);
  assert.equal(result.ok, true, result.error ?? "");
  const activity = newestActivity();
  assert.equal(activity.action, "resolve_company");
  assert.equal(tables().find((x) => x.ident === t.ident)!.spellings.length, 1);

  assert.deepEqual(undoWrite(activity.id), { ok: true });
  const after = tables().find((x) => x.ident === t.ident)!;
  assert.deepEqual(after.spellings, before.spellings, "every spelling is back, with its count");
  assert.equal(hasConflict(after), true, "and the conflict deviation with them");
});

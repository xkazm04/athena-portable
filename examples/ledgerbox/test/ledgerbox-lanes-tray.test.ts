/**
 * The tick as a working set: the tray's count, its plans and its one batch (scan-sweep challenge,
 * 2026-10-25, ledgerbox-lanes-ui/B).
 *
 * `select` rings invoices on the sheet; the tray is what lets the person act on that ring. Every
 * rule it follows lives in `components/lanes/shell/tray-plan.ts`, a plain module this runner loads,
 * driven here against a scratch copy of the seeded books where the rule is about the books.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { tempHome } from "./tmp-home";

// Own scratch cwd, own seeded copy: `openDb` resolves the file from `process.cwd()/data`.
const home = tempHome("ledgerbox-lanes-tray-");

/*
 * Every import is awaited before the first `test()`: `tempHome`'s `after` hook puts the working
 * directory back when the declared tests have run, and a top-level await between two tests would
 * let the rest run against the app's own books (see test/ledgerbox-lanes-ui.test.ts).
 */
const { buildSheet } = await import("../lib/lanes");
const actions = await import("../app/actions");
const { db, settlingCredits } = await import("../lib/db");
const { SELECT_MAX } = await import("../lib/constants");
const { TOOL_CLASSES } = await import("../lib/tool-classes");
const { isAuto } = await import("../lib/manifest");
const { actRefusal, NOT_A_DEBT } = await import("../components/lanes/card/read");
const tray = await import("../components/lanes/shell/tray-plan");

type Sheet = ReturnType<typeof buildSheet>;
type Mark = Sheet["lanes"][number]["marks"][number];

/** The scratch books, or a failed test - never the app's own database. */
function books(): Sheet {
  assert.equal(process.cwd(), home, "the books under test are the scratch copy");
  assert.ok(db().file.startsWith(home), `writing to ${db().file}`);
  return buildSheet();
}

const marksOf = (sheet: Sheet): Mark[] => sheet.lanes.flatMap((l) => l.marks);
const markIn = (sheet: Sheet, id: string) => marksOf(sheet).find((m) => m.id === id)!;
const unsentDrafts = (id: string) =>
  db().get<{ n: number }>("SELECT COUNT(*) AS n FROM reminders WHERE invoice_id = ? AND sent_at IS NULL", [id])!.n;

/**
 * Open invoices the books would draft for, with nothing paid (so they can also be voided). Not one
 * the statement looks to have paid: the books refuse that chase (lib/chase.ts) and the card does
 * not predict it yet, so it is held out here rather than read as a press that failed.
 */
function chaseable(sheet: Sheet): Mark[] {
  const settled = settlingCredits();
  return marksOf(sheet).filter(
    (m) => m.paidCents === 0 && !settled.has(m.id) && actRefusal("draft_reminder", m, sheet.details[m.id]) === null,
  );
}

/* ------------------------------------------------------------------------ the tests */

test("case 1: trayFor counts the tick, leaves a void out of what is owed, and groups it by lane", async () => {
  let sheet = books();
  // A void invoice in the tick: void one that is owed today, so its balance is a real number.
  const owed = chaseable(sheet);
  const doomed = owed.find((m) => m.balanceCents > 0)!;
  assert.ok((await actions.voidInvoiceAction(doomed.id)).ok);
  sheet = books();
  const voided = markIn(sheet, doomed.id);
  assert.equal(voided.state, "void");
  const others = chaseable(sheet).filter((m) => m.category !== voided.category).slice(0, 2);
  const ids = [others[0]!.id, voided.id, others[1]!.id];

  const t = tray.trayFor(sheet, ids);
  assert.equal(t.count, 3);
  const expected = ids
    .map((id) => markIn(sheet, id))
    .reduce((s, m) => (NOT_A_DEBT.has(m.state) ? s : s + m.balanceCents), 0);
  assert.equal(t.owedCents, expected, "owed is the open balance of what is a debt");
  assert.equal(t.owedCents, others[0]!.balanceCents + others[1]!.balanceCents, "the void is not in it");
  assert.equal(t.lanes.reduce((n, l) => n + l.n, 0), 3, "the lane groups sum to the count");
  for (const group of t.lanes) {
    const lane = sheet.lanes.find((l) => l.id === group.laneId)!;
    assert.equal(group.label, lane.label);
    assert.equal(group.n, ids.filter((id) => markIn(sheet, id).category === group.laneId).length);
  }
});

test("case 2: trayFor drops an id the sheet does not hold and re-derives the count from the sheet", () => {
  const sheet = books();
  const [a, b] = marksOf(sheet);
  const t = tray.trayFor(sheet, [a!.id, b!.id, "inv_nope"]);
  assert.equal(t.count, 2);
  assert.deepEqual(t.items.map((i) => i.id), [a!.id, b!.id]);
  assert.equal(tray.trayFor(sheet, [a!.id, a!.id]).count, 1, "a repeated id is one invoice");
});

test("case 3: draftPlan holds the disputed and the unsent invoice back, grouped by the reason actRefusal gives", () => {
  const sheet = books();
  const marks = marksOf(sheet);
  const disputed = marks.find((m) => m.state === "disputed")!;
  const unsent = marks.find((m) => m.state === "draft")!;
  assert.ok(disputed && unsent, "the seed holds a disputed and a draft-state invoice");
  const fine = chaseable(sheet).slice(0, 3);
  const ids = [fine[0]!.id, disputed.id, fine[1]!.id, unsent.id, fine[2]!.id];

  const t = tray.trayFor(sheet, ids);
  const plan = tray.draftPlan(t, sheet);
  assert.deepEqual(plan.eligible, fine.map((m) => m.id));
  assert.ok(!plan.eligible.includes(disputed.id) && !plan.eligible.includes(unsent.id));
  for (const group of plan.held) {
    for (const id of group.ids) {
      assert.equal(group.reason, actRefusal("draft_reminder", markIn(sheet, id), sheet.details[id]));
    }
  }
  assert.equal(new Set(plan.held.map((g) => g.reason)).size, plan.held.length, "one group per reason");
  assert.equal(plan.eligible.length + plan.held.reduce((n, g) => n + g.ids.length, 0), t.count);
});

test("case 4: runBatch drafts for every eligible invoice it still can, says N-1 of N, and ticks the one that failed", async () => {
  let sheet = books();
  const picks = chaseable(sheet).filter((m) => !m.hasDraft).slice(0, 4);
  assert.equal(picks.length, 4);
  const plan = tray.draftPlan(tray.trayFor(sheet, picks.map((m) => m.id)), sheet);
  assert.equal(plan.eligible.length, 4);
  const before = new Map(plan.eligible.map((id) => [id, unsentDrafts(id)]));

  // Between the plan and the press, one of them is voided elsewhere.
  const gone = plan.eligible[1]!;
  assert.ok((await actions.voidInvoiceAction(gone)).ok);

  const runBatch = tray.createBatch();
  const out = await runBatch(plan.eligible, (id) => actions.draftReminderAction(id, "gentle"), "Drafted");
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.match(out.summary, /^Drafted 3 of 4\b/);
  assert.deepEqual(out.next, [gone], "the next tick is exactly the failed id");
  sheet = books();
  for (const id of plan.eligible) {
    const grew = unsentDrafts(id) - before.get(id)!;
    assert.equal(grew, id === gone ? 0 : 1, `${markIn(sheet, id).number}: ${grew} new drafts`);
  }
});

test("case 5: a second runBatch while one is in flight is refused before it calls anything", async () => {
  const sheet = books();
  const plan = tray.draftPlan(tray.trayFor(sheet, chaseable(sheet).slice(5, 8).map((m) => m.id)), sheet);
  assert.equal(plan.eligible.length, 3);
  const calls = new Map<string, number>();
  const issue = (id: string) => {
    calls.set(id, (calls.get(id) ?? 0) + 1);
    return actions.draftReminderAction(id, "firm");
  };
  const runBatch = tray.createBatch();
  const first = runBatch(plan.eligible, issue, "Drafted");
  assert.equal(runBatch.busy(), true);
  const second = await runBatch(plan.eligible, issue, "Drafted");
  assert.equal(second.ok, false, "the second press is refused");
  const done = await first;
  assert.equal(done.ok, true);
  assert.equal(runBatch.busy(), false, "the guard opens when the batch settles");
  assert.deepEqual(
    plan.eligible.map((id) => calls.get(id) ?? 0),
    plan.eligible.map(() => 1),
    "each eligible invoice was issued exactly once across both presses",
  );
});

test("case 6: refilePlan names only the ids not already in the lane, and the refile lands every one there", async () => {
  let sheet = books();
  const inside = sheet.lanes.find((l) => l.id === "retainer")!.marks[0]!;
  const outside = marksOf(sheet).filter((m) => m.category !== "retainer").slice(0, 3);
  const ids = [outside[0]!.id, inside.id, outside[1]!.id, outside[2]!.id];

  const plan = tray.refilePlan(tray.trayFor(sheet, ids), "retainer");
  assert.deepEqual(plan, outside.map((m) => m.id), "the invoice already there is left alone");
  assert.ok((await actions.categorizeAction(plan, "retainer")).ok);
  sheet = books();
  const t = tray.trayFor(sheet, ids);
  assert.deepEqual(t.items.map((i) => i.laneId), ids.map(() => "retainer"));
  assert.deepEqual(t.lanes.map((l) => [l.laneId, l.n]), [["retainer", 4]]);
  assert.deepEqual(tray.refilePlan(t, "retainer"), [], "nothing left to refile");
  await actions.categorizeAction([outside[0]!.id], outside[0]!.category);
  await actions.categorizeAction([outside[1]!.id], outside[1]!.category);
  await actions.categorizeAction([outside[2]!.id], outside[2]!.category);
});

test("case 7: toggleTick adds and removes one id, and refuses past the select cap with the list unchanged", () => {
  const full = Array.from({ length: SELECT_MAX }, (_, i) => `inv_${i}`);
  const over = tray.toggleTick(full, "inv_new");
  assert.equal(over.ok, false);
  assert.equal(over.list, full, "the list is unchanged, not a copy");
  if (!over.ok) assert.equal(over.reason, tray.TICK_CAP_SAY);
  assert.match(tray.TICK_CAP_SAY, new RegExp(`\\b${SELECT_MAX}\\b`), "the sentence names the cap");

  const out = tray.toggleTick(full, "inv_7");
  assert.equal(out.ok, true);
  assert.equal(out.list.length, SELECT_MAX - 1);
  assert.ok(!out.list.includes("inv_7"));
  const added = tray.toggleTick(["a"], "b");
  assert.deepEqual(added.list, ["a", "b"]);
});

test("case 8 (guard): the tray offers only AUTO acts in bulk, and the gated three stay gated", () => {
  const acts = tray.trayActs();
  assert.ok(acts.length > 0);
  for (const tool of acts) assert.equal(isAuto(TOOL_CLASSES[tool]), true, `${tool} is AUTO`);
  for (const tool of ["send_reminder", "mark_paid", "void_invoice"] as const) {
    assert.equal(isAuto(TOOL_CLASSES[tool]), false, `${tool} is GATED`);
    assert.ok(!acts.includes(tool), `${tool} is never offered in bulk`);
  }
});

/**
 * The lanes UI's own agreements, pinned (scan-sweep stabilize, 2026-10-16).
 *
 * The components under `components/lanes/` hold JSX, which this runner cannot load, so what is
 * pinned here is the part of each rule that lives in a plain module beside them (`useRun.ts`,
 * `card/read.ts`, `swarm/marks.ts`) - driven against a scratch copy of the seeded books where the
 * rule is about the books - plus, where the rule is only that a component USES that part, a
 * source check with the comments stripped first. Each test was seen red on the tree before its fix.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { tempHome } from "./tmp-home";

// Own scratch cwd, own seeded copy: `openDb` resolves the file from `process.cwd()/data`.
tempHome("ledgerbox-lanes-ui-");

/* ------------------------------------------------------------------- the stand-ins */

/** What one `run` reached: the toast (with its tone), the router's refresh, the `after` callback. */
let reached: string[] = [];
/** The transition body `run` handed to `startTransition`, so a test can await it. */
let started: Promise<unknown> | null = null;

const RECORDER = Symbol.for("ledgerbox.lanes-ui.recorder");
(globalThis as Record<symbol, unknown>)[RECORDER] = {
  start(fn: () => Promise<unknown>) {
    started = fn();
  },
  router: { refresh: () => reached.push("router.refresh") },
  toaster: { toast: (_text: string, tone: string) => reached.push(`toast:${tone}`) },
};
const recorder = `globalThis[Symbol.for("ledgerbox.lanes-ui.recorder")]`;
const moduleOf = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;

(globalThis as Record<symbol, unknown>)[Symbol.for("ledgerbox.test.standIns")] = {
  scope: new URL("../components/lanes/useRun.ts", import.meta.url).href,
  modules: {
    react: moduleOf(
      [
        `export const useCallback = (fn) => fn;`,
        `export const useTransition = () => [false, (fn) => ${recorder}.start(fn)];`,
      ].join("\n"),
    ),
    "next/navigation": moduleOf(`export const useRouter = () => ${recorder}.router;`),
    "@athena/demo-kit/ui": moduleOf(`export const useToast = () => ${recorder}.toaster;`),
  },
};

// Renamed: it is called here as a plain function over stand-ins, not as a hook inside a render.
const { ACT_THREW, useRun: cardRun } = await import("../components/lanes/useRun");

/** A source file under `components/lanes/`, comments stripped, so prose about a rule cannot pass for it. */
const source = (path: string) =>
  readFileSync(new URL(`../components/lanes/${path}`, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/** Run one act through the card's `run`, the way a button does, and wait for its transition. */
async function press(act: () => Promise<{ ok: boolean; message: string }>): Promise<string[]> {
  reached = [];
  started = null;
  const { run } = cardRun();
  run(act, () => reached.push("after"));
  await started;
  return reached;
}

/* ------------------------------------------------------------------------ the tests */

test("an act that throws under a person's click still tells them, re-reads the sheet and closes the gate", async () => {
  // The tool path (`tools/BooksTools.tsx` settle) learned this in cb124b4; the card's own path is
  // the other implementation of the same rule. A server action that throws - a locked database, a
  // dropped connection - used to reject out of the transition with no toast, no refresh, and the
  // gate still armed over an outcome nobody knows.
  const original = console.error;
  console.error = () => {};
  try {
    const seen = await press(() => Promise.reject(new Error("database is locked")));
    assert.deepEqual(seen, ["toast:error", "router.refresh", "after"], `the person saw: ${seen.join(", ") || "nothing"}`);
  } finally {
    console.error = original;
  }
  // One sentence for one event, whichever path the act came down.
  assert.ok(source("tools/BooksTools.tsx").includes(JSON.stringify(ACT_THREW)), "the tool path says the same words");
});

test("an act that answers is toasted in its own tone, and leaves the refresh to its own revalidatePath", async () => {
  assert.deepEqual(await press(async () => ({ ok: true, message: "Done." })), ["toast:success", "after"]);
  assert.deepEqual(await press(async () => ({ ok: false, message: "Refused." })), ["toast:error", "after"]);
});

/* ------------------------------------------- a gate is armed on what it showed, not on the row */

const { buildSheet } = await import("../lib/lanes");
const actions = await import("../app/actions");
const { gateSubject, stillArmed } = await import("../components/lanes/card/read");

type Sheet = ReturnType<typeof buildSheet>;
const markIn = (sheet: Sheet, id: string) => sheet.lanes.flatMap((l) => l.marks).find((m) => m.id === id)!;

test("an armed gate closes when what it disclosed changes under it, and when its act becomes refused", async () => {
  // hitl-approval/gate-state-machines, "approved content swapped before execution": a person arms
  // Send it having read one letter; an agent redrafts in the meantime; `sendReminderAction` sends
  // the NEWEST draft. Approval of version N is not approval of version N+1.
  let sheet = buildSheet();
  const marks = sheet.lanes.flatMap((l) => l.marks);
  const chase = marks.find((m) => m.state === "overdue" && !m.hasDraft && m.candidateCount === 0)!;
  assert.ok((await actions.draftReminderAction(chase.id, "gentle")).ok);
  sheet = buildSheet();
  const read = gateSubject("send_reminder", markIn(sheet, chase.id), sheet.details[chase.id]);
  assert.ok(stillArmed(read, read, false), "nothing moved: the gate stays armed");
  assert.ok((await actions.draftReminderAction(chase.id, "firm")).ok);
  sheet = buildSheet();
  const now = gateSubject("send_reminder", markIn(sheet, chase.id), sheet.details[chase.id]);
  assert.equal(stillArmed(read, now, false), false, "a redrafted letter re-closes the send gate");

  // Record it is armed on an amount; a credit applied meanwhile moves the balance it would write.
  const owed = marks.find(
    (m) => m.balanceCents > 0 && m.paidCents === 0 && (sheet.details[m.id]?.candidates.length ?? 0) > 0,
  )!;
  const credit = sheet.details[owed.id]!.candidates[0]!;
  const paidOn = gateSubject("mark_paid", markIn(sheet, owed.id), sheet.details[owed.id]);
  const voidOn = gateSubject("void_invoice", markIn(sheet, owed.id), sheet.details[owed.id]);
  assert.ok((await actions.matchAction(owed.id, credit.lineId)).ok);
  sheet = buildSheet();
  const after = markIn(sheet, owed.id);
  assert.equal(stillArmed(paidOn, gateSubject("mark_paid", after, sheet.details[owed.id]), false), false);
  // Void it is refused once a credit is applied, and the row says so; an armed confirm must not outlive that.
  assert.equal(stillArmed(voidOn, voidOn, after.paidCents > 0), false, "a refused act cannot stay armed");
  assert.equal(stillArmed(null, paidOn, false), false, "unarmed is unarmed");
});

test("every gate on the card is armed through stillArmed, on the subject of its own act", () => {
  const gate = source("Gate.tsx");
  assert.match(gate, /stillArmed\(/, "Gate derives `armed` from what it was armed on");
  const decide = source("card/Decide.tsx");
  const gates = decide.match(/<Gate\b/g)?.length ?? 0;
  const bound = [...decide.matchAll(/subject=\{gateSubject\("(\w+)"/g)].map((m) => m[1]);
  assert.equal(gates, 3, "the three gated acts");
  assert.deepEqual(bound.sort(), ["mark_paid", "send_reminder", "void_invoice"]);
});

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
const home = tempHome("ledgerbox-lanes-ui-");

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

/*
 * EVERY IMPORT IS AWAITED HERE, before the first `test()`. `tempHome`'s `after` hook puts the
 * working directory back and closes the books when the file's tests have run - and a top-level
 * `await` between two `test()` calls lets the runner finish the tests declared so far, fire that
 * hook, and run the rest in the APP's directory, on the dev server's own `data/ledgerbox.sqlite`.
 * An earlier version of this file did exactly that. `books()` below refuses to run a write
 * anywhere but the scratch home.
 */
// Renamed: it is called here as a plain function over stand-ins, not as a hook inside a render.
const { ACT_THREW, useRun: cardRun } = await import("../components/lanes/useRun");
const { buildSheet } = await import("../lib/lanes");
const actions = await import("../app/actions");
const { db, COUNTED_OUT } = await import("../lib/db");
const { CATEGORIES } = await import("../lib/constants");
const { actRefusal, gateSubject, stillArmed, NOT_A_DEBT } = await import("../components/lanes/card/read");
const { tabStop } = await import("../components/lanes/swarm/marks");
const { TOOL_CLASSES } = await import("../lib/tool-classes");
const { isAuto } = await import("../lib/manifest");

/** The scratch books, or a failed test - never the app's own database. */
function books(): ReturnType<typeof buildSheet> {
  assert.equal(process.cwd(), home, "the books under test are the scratch copy");
  assert.ok(db().file.startsWith(home), `writing to ${db().file}`);
  return buildSheet();
}

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

type Sheet = ReturnType<typeof buildSheet>;
const markIn = (sheet: Sheet, id: string) => sheet.lanes.flatMap((l) => l.marks).find((m) => m.id === id)!;

test("an armed gate closes when what it disclosed changes under it, and when its act becomes refused", async () => {
  // hitl-approval/gate-state-machines, "approved content swapped before execution": a person arms
  // Send it having read one letter; an agent redrafts in the meantime; `sendReminderAction` sends
  // the NEWEST draft. Approval of version N is not approval of version N+1.
  let sheet = books();
  const marks = sheet.lanes.flatMap((l) => l.marks);
  const chase = marks.find((m) => m.state === "overdue" && !m.hasDraft && m.candidateCount === 0)!;
  assert.ok((await actions.draftReminderAction(chase.id, "gentle")).ok);
  sheet = books();
  const read = gateSubject("send_reminder", markIn(sheet, chase.id), sheet.details[chase.id]);
  assert.ok(stillArmed(read, read, false), "nothing moved: the gate stays armed");
  assert.ok((await actions.draftReminderAction(chase.id, "firm")).ok);
  sheet = books();
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
  sheet = books();
  const after = markIn(sheet, owed.id);
  assert.equal(stillArmed(paidOn, gateSubject("mark_paid", after, sheet.details[owed.id]), false), false);
  // Void it is refused once a credit is applied, and the row says so; an armed confirm must not outlive that.
  assert.equal(stillArmed(voidOn, voidOn, after.paidCents > 0), false, "a refused act cannot stay armed");
  assert.equal(stillArmed(null, paidOn, false), false, "unarmed is unarmed");
});

test("every gate on the card is armed through stillArmed, on the subject of its own act", () => {
  const gate = source("Gate.tsx");
  assert.match(gate, /stillArmed\(/, "Gate derives `armed` from what it was armed on");
  // Every act on the list that the class table gates names its own subject and question; the
  // set is read off TOOL_CLASSES, so reclassifying an act makes this ask for them.
  const decide = source("card/Decide.tsx");
  const listed = [...decide.matchAll(/tool: "(\w+)"/g)].map((m) => m[1] as keyof typeof TOOL_CLASSES);
  const gated = listed.filter((t) => !isAuto(TOOL_CLASSES[t])).sort();
  const bound = [...decide.matchAll(/subject: gateSubject\("(\w+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(gated, ["mark_paid", "send_reminder", "void_invoice"], "the three gated acts on the list");
  assert.deepEqual(bound, gated, "each gated act is armed on its own subject");
});

test("the decision list draws a Gate exactly where the class table says GATED, and nowhere else", () => {
  // The badge on each row was read from lib/tool-classes.ts, but the control beside it was typed
  // by hand per row - three <Gate>s and two <button>s - so a reclassified act would wear the Gated
  // badge over a button that fires on the first press (hitl-approval: the trigger predicate lives
  // in one place). One render branch, keyed on the same `isAuto` the badge reads.
  const decide = source("card/Decide.tsx");
  assert.equal(decide.match(/<Gate\b/g)?.length ?? 0, 1, "one Gate, in the render, not one per row");
  assert.match(decide, /const auto = isAuto\(TOOL_CLASSES\[act\.tool\]\);/);
  assert.match(decide, /const take = auto \?/, "the control is chosen by the class");
});

/* ------------------------------------------- the card offers what the books will take, and only that */

test("every act the decision list offers on an open invoice is one the books take, and every one it holds back they refuse", async () => {
  // Two statements of one rule: `card/Decide.tsx` enables a row, `app/actions.ts` decides whether
  // the act goes through. On the seed the list offered Draft it on both disputed invoices and Draft
  // it and Record it on the unsent draft LB-2026-0055 - four presses that could only come back as
  // an error toast. Each act runs for real on the scratch books and is rolled back.
  assert.deepEqual([...NOT_A_DEBT].sort(), [...COUNTED_OUT].sort(), "the card's copy of the books' COUNTED_OUT");

  const sheet = books();
  const open = sheet.lanes.flatMap((l) => l.marks).filter((m) => m.balanceCents > 0 || m.state === "disputed");
  assert.ok(open.length > 50, "the seed's open invoices");
  const newest = () => db().get<{ n: number }>("SELECT COALESCE(MAX(id), 0) AS n FROM activity")!.n;
  const disagree: string[] = [];
  for (const mark of open) {
    const detail = sheet.details[mark.id];
    const acts = {
      draft_reminder: () => actions.draftReminderAction(mark.id, "gentle"),
      mark_paid: () => actions.markPaidAction(mark.id, mark.balanceCents),
      send_reminder: () => actions.sendReminderAction(mark.id),
      void_invoice: () => actions.voidInvoiceAction(mark.id),
    };
    for (const [act, take] of Object.entries(acts)) {
      const before = newest();
      let answer: Promise<{ ok: boolean; message: string }> | undefined;
      try {
        db().withTx(() => {
          answer = take();
          throw new Error("roll back");
        });
      } catch (error) {
        if ((error as Error).message !== "roll back") throw error;
      }
      const result = await answer!;
      assert.equal(newest(), before, `${act} on ${mark.number} was rolled back`);
      const offered = actRefusal(act as keyof typeof acts, mark, detail) === null;
      if (offered !== result.ok) {
        disagree.push(`${mark.number} (${mark.state}) ${act}: card ${offered ? "offers" : "holds back"}, books ${result.ok ? "take it" : `refuse: ${result.message}`}`);
      }
    }
  }
  assert.deepEqual(disagree, []);
});

test("the decision list takes each row's enabled state and its blocked line from actRefusal", () => {
  const decide = source("card/Decide.tsx");
  const asked = [...decide.matchAll(/actRefusal\("(\w+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(asked, ["draft_reminder", "mark_paid", "send_reminder", "void_invoice"]);
});

/* --------------------------------------------- a row of peers keeps one tab stop as it shrinks */

test("a lane that loses the mark its tab stop was on still has exactly one tab stop", async () => {
  // L0 and L1 remember the tab stop as an INDEX into the lane's marks in due order. Open the
  // latest-due invoice in a lane (the stop moves to the last index), refile it from its card, and
  // the lane is one shorter: `index === roving` then matched no mark, and the lane - at L0 one
  // of six tab stops, at L1 the whole field - could no longer be reached with Tab.
  const inOrder = (sheet: Sheet, lane: string) =>
    [...(sheet.lanes.find((l) => l.id === lane)?.marks ?? [])].sort((a, b) => a.x - b.x);

  const before = books();
  let lost = 0;
  for (const lane of before.lanes) {
    const marks = inOrder(before, lane.id);
    const remembered = marks.length - 1;
    const elsewhere = CATEGORIES.find((c) => c !== lane.id)!;
    assert.ok((await actions.categorizeAction([marks[remembered]!.id], elsewhere)).ok);
    const now = inOrder(books(), lane.id);
    if (!now.some((_, index) => index === remembered)) lost += 1; // the rule as it was
    const stops = now.filter((_, index) => index === tabStop(remembered, now.length));
    assert.equal(stops.length, 1, `${lane.id}: ${stops.length} tab stops after refiling its last mark`);
    await actions.categorizeAction([marks[remembered]!.id], lane.id);
  }
  assert.equal(lost, before.lanes.length, "every lane lost its stop under the index-only rule");
  assert.equal(tabStop(undefined, 3), 0, "a lane nobody has walked starts at its first mark");
  assert.equal(tabStop(7, 0), -1, "an empty row has no stop");
});

test("both rows of peers, the swarm's lanes and the spread's field, pick their stop through tabStop", () => {
  for (const path of ["Spread.tsx", "swarm/Lane.tsx"]) {
    const code = source(path);
    assert.match(code, /tabStop\(/, `${path} asks tabStop`);
    assert.doesNotMatch(code, /index === \(?roving/, `${path} no longer compares the index to the remembered stop`);
  }
});

/* ------------------------------------------ the confirm carries the disclosure it is a yes to */

test("an armed gate's confirm is described by its own question, so a screen reader hears what it agrees to", () => {
  // The confirm takes focus the moment the gate arms (`autoFocus`), so its accessible name and
  // description are all a screen reader says: "Record it, button" without the sentence beside it
  // ("This writes $95,100.00 against the books and cannot be replayed backwards") is a yes to a
  // disclosure that was never read out. hitl-approval: the human decides on the real thing.
  const gate = source("Gate.tsx");
  const id = gate.match(/className="ln-gate-q"[^>]*\bid=\{(\w+)\}/)?.[1];
  assert.ok(id, "the question carries an id");
  const confirm = gate.match(/<button[^>]*data-kind="danger"[^>]*>/s)?.[0] ?? "";
  assert.match(confirm, new RegExp(`aria-describedby=\{${id}\}`), "the confirm is described by the question");
});

/* --------------------------------------------------- the conversation slot reads the presence */

test("the decision list's conversation slot says whether Athena is connected from the page's own reading, not in ink", async () => {
  // `presence.ts`: "Athena is not connected yet" in ink "is a sentence that cannot become false".
  // The footer's presence line reads `useAthenaPresence`; the decision list printed the sentence
  // as a literal, so with a bridge in the page the footer said connected and the dialog said not.
  const { talkSay } = await import("../components/lanes/card/read");
  assert.match(talkSay(false), /^Athena is not connected/);
  assert.match(talkSay(true), /^Athena is connected/);
  const decide = source("card/Decide.tsx");
  assert.match(decide, /useAthenaPresence\(\)/, "the dialog takes the page's reading");
  assert.match(decide, /talkSay\(presence\.bridged\)/, "and says the sentence for it");
  assert.doesNotMatch(decide, /Athena is not connected/, "no sentence in ink");
});

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
const { db, COUNTED_OUT, settlingCredits } = await import("../lib/db");
const { CATEGORIES } = await import("../lib/constants");
const { actRefusal, gateSubject, stillArmed, NOT_A_DEBT } = await import("../components/lanes/card/read");
const { tabStop } = await import("../components/lanes/swarm/marks");
const { TOOL_CLASSES } = await import("../lib/tool-classes");
const { isAuto } = await import("../lib/manifest");
const machine = await import("../components/lanes/card/acts");

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
  // One known gap, pinned exactly rather than tolerated: the books refuse to chase an invoice the
  // statement looks to have paid (lib/chase.ts, ADR 0197) and the card does not predict it yet -
  // the press comes back naming the credit to apply. When `actRefusal` learns it, this list empties.
  const awaitingCard: string[] = [];
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
      if (act === "draft_reminder" && offered && !result.ok && "settling_credit" in result) {
        awaitingCard.push(mark.id);
        continue;
      }
      if (offered !== result.ok) {
        disagree.push(`${mark.number} (${mark.state}) ${act}: card ${offered ? "offers" : "holds back"}, books ${result.ok ? "take it" : `refuse: ${result.message}`}`);
      }
    }
  }
  assert.deepEqual(disagree, []);
  const settled = settlingCredits();
  assert.deepEqual(awaitingCard.sort(), open.filter((m) => settled.has(m.id)).map((m) => m.id).sort());
});

/* ------------------------------ one act machine per card: one armed gate, one write in flight, one door */

type Spec = ReturnType<typeof machine.actSpecs>[number];
type CardTool = import("../components/lanes/card/acts").CardTool;
const LISTED = ["draft_reminder", "mark_paid", "send_reminder", "void_invoice"] as const;
const armedOn = (tool: CardTool, subject: string) => ({ ...machine.IDLE_ACTS, armed: { tool, subject } });
const issuingOf = (tool: CardTool, ticket = 1) => ({ ...machine.IDLE_ACTS, issuing: { tool, ticket }, ticket });
/** One invoice's specs with one act's fields replaced, as a re-render would bring them. */
const withAct = (specs: Spec[], tool: Spec["tool"], patch: Partial<Spec>): Spec[] =>
  specs.map((s) => (s.tool === tool ? { ...s, ...patch } : s));
const openMarks = (sheet: Sheet) =>
  sheet.lanes.flatMap((l) => l.marks).filter((m) => m.balanceCents > 0 || m.state === "disputed");

test("case 1: actSpecs gates exactly what the class table gates, and every listed act's blocked line is actRefusal's", () => {
  // Replaces three source regexes over Decide.tsx (one Gate where GATED, a subject per gated act,
  // an actRefusal per listed act): the list is data now, so its rules are pinned as behaviour.
  const sheet = books();
  const open = openMarks(sheet);
  assert.ok(open.length > 50, "the seed's open invoices");
  for (const mark of open) {
    const detail = sheet.details[mark.id];
    const specs = machine.actSpecs(mark, detail, "gentle", mark.category);
    assert.deepEqual(
      specs.map((s) => s.tool),
      ["draft_reminder", "categorize", "mark_paid", "send_reminder", "void_invoice"],
    );
    for (const spec of specs) {
      assert.equal(spec.gated, !isAuto(TOOL_CLASSES[spec.tool]), `${mark.number} ${spec.tool} gated`);
      assert.equal(spec.question !== null && spec.subject !== null, spec.gated, `${mark.number} ${spec.tool} asks only if gated`);
    }
    for (const tool of LISTED) {
      const spec = specs.find((s) => s.tool === tool)!;
      assert.equal(spec.blocked, actRefusal(tool, mark, detail), `${mark.number} ${tool} blocked line`);
      if (spec.blocked) assert.equal(spec.reaches, spec.blocked, "a refused row says why in place of what it reaches");
      if (tool !== "draft_reminder") assert.equal(spec.subject, gateSubject(tool, mark, detail), `${tool} subject`);
    }
    assert.ok(specs.find((s) => s.tool === "categorize")!.blocked, "refiling to where it already is is blocked");
  }
  const first = open[0]!;
  assert.deepEqual(
    machine.actSpecs(first, sheet.details[first.id], "gentle", first.category).filter((s) => s.gated).map((s) => s.tool),
    ["mark_paid", "send_reminder", "void_invoice"],
    "the three gated acts on the list",
  );
});

test("case 2: arming one act disarms any other, so the card never holds two armed confirms", () => {
  const { state, refused } = machine.reduceActs(armedOn("mark_paid", "S1"), {
    type: "arm",
    tool: "void_invoice",
    subject: "S2",
  });
  assert.equal(refused, null);
  assert.deepEqual(state.armed, { tool: "void_invoice", subject: "S2" });
});

test("case 3: nothing confirms or arms while another act on the invoice is in flight", () => {
  // The send over an unsettled redraft: the letter at the server may not be the one on screen.
  const busy = { ...issuingOf("draft_reminder"), armed: { tool: "send_reminder" as const, subject: "S" } };
  const confirm = machine.reduceActs(busy, { type: "confirm", tool: "send_reminder" });
  assert.equal(confirm.state, busy, "state unchanged");
  assert.match(confirm.refused ?? "", /an act on this invoice is still in flight/i);
  const idleBusy = issuingOf("draft_reminder");
  const arm = machine.reduceActs(idleBusy, { type: "arm", tool: "send_reminder", subject: "S" });
  assert.equal(arm.state, idleBusy, "state unchanged");
  assert.match(arm.refused ?? "", /an act on this invoice is still in flight/i);
});

test("case 4: a double click on the door issues once - the second press is refused before any render", () => {
  let issued = 0;
  const settles: ((result: { ok: boolean; message: string } | null) => void)[] = [];
  const published: unknown[] = [];
  const door = machine.createActDoor({
    // Recorded, never fed back: no render happens between the two presses.
    publish: (s) => published.push(s),
    transport: (issue, after) => {
      void issue();
      settles.push(after);
    },
  });
  const issue = async () => {
    issued += 1;
    return { ok: true, message: "Done." };
  };
  assert.equal(door.take("draft_reminder", issue), null);
  assert.match(door.take("draft_reminder", issue) ?? "", /still in flight/i);
  assert.equal(issued, 1, "take: issued exactly once");
  settles[0]!({ ok: true, message: "Done." });
  assert.equal(door.current().issuing, null, "the answer settles the door");

  assert.equal(door.arm("void_invoice", "S"), null);
  assert.equal(door.confirm("void_invoice", issue), null);
  assert.match(door.confirm("void_invoice", issue) ?? "", /still in flight/i);
  assert.equal(issued, 2, "confirm: issued exactly once more");
  assert.ok(published.length > 0, "the view is told");
});

test("case 5: an armed send closes when the letter under it changes, and focus goes back to its row", () => {
  const sheet = books();
  const mark = openMarks(sheet).find((m) => m.state === "overdue")!;
  const specs = machine.actSpecs(mark, sheet.details[mark.id], "gentle", mark.category);
  const moved = withAct(specs, "send_reminder", { subject: "S-prime", blocked: null });
  const { state } = machine.reduceActs(armedOn("send_reminder", "S"), { type: "observe", specs: moved });
  assert.equal(state.armed, null);
  assert.equal(state.focus, "row:send_reminder");
  // Nothing moved: it stays armed, and the step is a no-op.
  const still = armedOn("send_reminder", "S-prime");
  assert.equal(machine.reduceActs(still, { type: "observe", specs: moved }).state, still);
});

test("case 6: a stale answer is ignored, and a thrown act closes its gate and hands focus to its row", () => {
  const confirmed = machine.reduceActs(armedOn("mark_paid", "S"), { type: "confirm", tool: "mark_paid" }).state;
  const old = confirmed.issuing!.ticket;
  const settled = machine.reduceActs(confirmed, { type: "settle", ticket: old, result: { ok: true, message: "" } }).state;
  assert.equal(settled.armed, null);
  const newer = machine.reduceActs(settled, { type: "take", tool: "draft_reminder" }).state;
  assert.equal(machine.reduceActs(newer, { type: "settle", ticket: old, result: null }).state, newer, "stale: ignored");
  const threw = machine.reduceActs(newer, { type: "settle", ticket: newer.issuing!.ticket, result: null }).state;
  assert.equal(threw.issuing, null);
  assert.equal(threw.armed, null);
  assert.equal(threw.focus, "row:draft_reminder");
});

test("case 7: an armed void whose act becomes refused closes, and focus goes to the heading, not the disabled row", () => {
  const sheet = books();
  const mark = openMarks(sheet).find((m) => m.balanceCents > 0 && m.paidCents === 0)!;
  const specs = machine.actSpecs(mark, sheet.details[mark.id], "gentle", mark.category);
  const subject = specs.find((s) => s.tool === "void_invoice")!.subject!;
  const refused = withAct(specs, "void_invoice", {
    blocked: "Blocked: there are credits applied to this invoice. Unapply them first.",
  });
  const { state } = machine.reduceActs(armedOn("void_invoice", subject), { type: "observe", specs: refused });
  assert.equal(state.armed, null);
  assert.equal(state.focus, "heading");
});

test("case 8 (guard): stillArmed's truth table and the send subject's dependence on the draft body are unchanged", () => {
  for (const [armed, subject, disabled, expected] of [
    [null, "a", false, false],
    ["a", "a", false, true],
    ["a", "b", false, false],
    ["a", "a", true, false],
    ["a", "b", true, false],
  ] as const) {
    assert.equal(stillArmed(armed, subject, disabled), expected, `stillArmed(${armed}, ${subject}, ${disabled})`);
  }
  const sheet = books();
  const mark = openMarks(sheet).find((m) => m.state === "overdue" && sheet.details[m.id])!;
  const withDraft = (body: string) => ({ ...sheet.details[mark.id]!, draft: { tone: "gentle", body } });
  const one = gateSubject("send_reminder", mark, withDraft("one") as Sheet["details"][string]);
  const two = gateSubject("send_reminder", mark, withDraft("two") as Sheet["details"][string]);
  assert.notEqual(one, two, "a redrafted body is a new subject");
  assert.equal(one, gateSubject("send_reminder", mark, withDraft("one") as Sheet["details"][string]));
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

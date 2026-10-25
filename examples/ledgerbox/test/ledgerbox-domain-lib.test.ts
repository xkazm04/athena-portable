/**
 * The domain lib's own agreements, pinned (scan-sweep stabilize, 2026-10-16).
 *
 * Each test here stands for two statements of one rule that had drifted apart inside `lib/`: a
 * figure the close prints beside another it should add up with, a total the lanes print beside
 * the total the mast prints, an amount the gate reads differently from the person who typed it.
 * Each one was seen red on the tree before its fix.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { tempHome } from "./tmp-home";

// Own scratch cwd, own seeded copy: `openDb` resolves the file from `process.cwd()/data`.
tempHome("ledgerbox-domain-lib-");

const { PERIODS } = await import("../lib/constants");
const { db, getInvoiceDetail, lineSuggestions, listInvoices, summarize, unappliedCredits } =
  await import("../lib/db");
const actions = await import("../app/actions");
const { TOOL_CLASSES } = await import("../lib/tool-classes");
const { parseDollars } = await import("../lib/format");
const { composeReminder } = await import("../lib/reminder");
const { buildSheet } = await import("../lib/lanes");
const { scoreCandidate } = await import("../lib/match");
const { statusOf } = await import("../lib/lanes/read");
const { renderSummary, renderSummaryMarkdown } = await import("../lib/export");
const { statusOf: standingOf } = await import("../components/lanes/model");

test("on every period, what was invoiced is what was collected plus what is still owed", () => {
  // All three figures describe one set of invoices (issued in the period, drafts and voids out),
  // so the close cannot print an Invoiced line that the two under it do not add up to. Counting
  // only the payments that ALSO landed inside the period dropped every June invoice paid in July
  // from June's Collected without adding it back anywhere.
  for (const period of PERIODS) {
    const s = summarize(period);
    assert.equal(
      s.invoiced_cents,
      s.collected_cents + s.outstanding_cents,
      `${period}: invoiced ${s.invoiced_cents} vs collected ${s.collected_cents} + outstanding ${s.outstanding_cents}`,
    );
  }
});

test("an amount the gate cannot read one way only is refused, not read the other way", () => {
  // `mark_paid` is PERMANENT, and `parseDollars` is the reading it applies to what an agent or a
  // person typed. A separator in the wrong place is not noise: `1,25` is a decimal comma (1.25),
  // and stripping it recorded $125.00; `1.250,00` recorded $1.25 against a $1,250 intention.
  const refused = ["1,25", "1.250,00", "12,34,567", "1,2,3", "12.345", "1.005", ",250", "1 250,"];
  for (const ambiguous of refused) {
    assert.equal(parseDollars(ambiguous), null, `${JSON.stringify(ambiguous)} is refused`);
  }
  // A cent is the smallest thing the books hold; a fraction of one is a guess, from either side.
  assert.equal(parseDollars(1250.555), null, "a sub-cent number is refused");
  // What the app prints, and what a person writes in the usual groupings, still reads exactly.
  const reads: [string | number, number][] = [
    ["$1,250.00", 125_000],
    ["1,250", 125_000],
    [" 42.50 ", 4_250],
    ["1 250.00", 125_000],
    ["1 250.00", 125_000],
    ["12,345,678.9", 1_234_567_890],
    ["1'250.00", 125_000],
    ["$ 1,250", 125_000],
    [".5", 50],
    ["-42", -4_200],
    [1250.5, 125_050],
    [19.99, 1_999],
  ];
  for (const [input, cents] of reads) {
    assert.equal(parseDollars(input), cents, `${JSON.stringify(input)} reads as ${cents} cents`);
  }
});

test("a reminder letter states only what the books know: how late, never a made-up send date", () => {
  // The letter reaches a person (send_reminder). Its gentle opening said the invoice "went out N
  // days ago" with N = days PAST DUE, so a 30-day-terms invoice issued 91 days ago went out "70
  // days ago"; and an invoice still inside terms was "1 days past its due date" in both tones.
  const letter = (tone: "gentle" | "firm", daysOverdue: number) =>
    composeReminder({
      number: "LB-2026-0042",
      clientName: "Halcyon Works",
      contactName: "Ada Byrne",
      contactEmail: "ada@halcyon.example",
      tone,
      daysOverdue,
      balanceCents: 120_000,
      amountCents: 120_000,
    });

  for (const tone of ["gentle", "firm"] as const) {
    const within = letter(tone, 0);
    assert.doesNotMatch(within.body, /past its due date|days? ago/, `${tone}, inside terms: not late`);
    assert.doesNotMatch(within.subject, /past due/, `${tone}, inside terms: the subject says so too`);

    const one = letter(tone, 1);
    assert.match(one.body, /\b1 day past its due date/, `${tone}: one day, singular`);
    assert.match(one.subject, /, 1 day past due$/);

    const late = letter(tone, 21);
    assert.match(late.body, /\b21 days past its due date/, `${tone}: the lateness, stated as lateness`);
    assert.doesNotMatch(late.body, /went out/, `${tone}: no send date the books never gave it`);
  }
});


test("the lanes add up to the totals the mast prints beside them", () => {
  // `read_view` hands an agent both: each lane's invoiced and still-open, and the quarter's. A
  // draft was never sent, so nobody owes it (COUNTED_OUT); the lanes counted it anyway, and the
  // Unfiled lane's "open" figure carried a draft the quarter's Outstanding leaves out.
  const sheet = buildSheet();
  const sum = (pick: (l: (typeof sheet.lanes)[number]) => number) =>
    sheet.lanes.reduce((s, l) => s + pick(l), 0);
  assert.ok(
    sheet.lanes.some((l) => l.marks.some((m) => m.state === "draft")),
    "the seed's draft is on the sheet",
  );
  assert.equal(sum((l) => l.invoicedCents), sheet.totals.invoicedCents, "invoiced");
  assert.equal(sum((l) => l.owedCents), sheet.totals.outstandingCents, "still open");
  assert.equal(sum((l) => l.collectedCents), sheet.totals.collectedCents, "collected");
});

test("no credit is offered for an invoice it is larger than, because applying it is refused", () => {
  // `matchAction` refuses a line larger than the balance (a negative balance reads as paid and the
  // export's two figures stop agreeing). The scorer offered such a line anyway - "over by $10.00,
  // about a wire fee" - so the card's one-click match was a button that could only fail.
  const input = {
    invoice: { number: "LB-2026-0042", amount_cents: 100_000, due_at: "2026-08-10T23:59:00.000Z" },
    clientName: "Halcyon Works",
    balanceCents: 100_000,
  };
  const line = (amount_cents: number) => ({
    id: "bl_test",
    posted_at: "2026-08-12T10:00:00.000Z",
    memo: "HALCYON WORKS PAYMENT",
    amount_cents,
    direction: "in" as const,
    source_file: "statement-2026-08.csv",
  });
  for (const over of [100_001, 101_000, 102_500]) {
    assert.equal(scoreCandidate(input, line(over)), null, `${over} is more than the 100000 owed`);
  }
  // At or under the balance, it still scores, and says by how much it falls short.
  assert.equal(scoreCandidate(input, line(100_000))?.short_by_cents, undefined);
  const short = scoreCandidate(input, line(99_000));
  assert.equal(short?.short_by_cents, 1_000);
  assert.ok(short?.evidence.includes("short by $10.00, about a wire fee"));
});

test("a draft is offered no credit anywhere, the card included", () => {
  // Three readers ask "can a credit be applied here?" - the row's candidate count, the strip's
  // suggestions and the invoice card. The row and the strip said no for a draft (nobody has been
  // asked for the money); the card asked only whether a balance was left, and offered the credit.
  const draft = listInvoices().find((r) => r.state === "draft")!;
  assert.ok(draft, "the seed carries a draft invoice");
  const lineId = "bl_draft_probe";
  db().run(
    "INSERT INTO bank_lines (id, posted_at, memo, amount_cents, direction, source_file) VALUES (?, ?, ?, ?, 'in', ?)",
    [lineId, draft.due_at, `${draft.client_name.toUpperCase()} PAYMENT`, draft.balance_cents, "statement-probe.csv"],
  );
  try {
    assert.equal(listInvoices().find((r) => r.id === draft.id)!.candidate_count, 0, "the row: none");
    assert.ok(
      !(lineSuggestions()[lineId] ?? []).some((s) => s.invoice_id === draft.id),
      "the strip: not suggested",
    );
    assert.deepEqual(
      getInvoiceDetail(draft.id)!.candidates.map((c) => c.line.id),
      [],
      "the card: none either",
    );
  } finally {
    db().run("DELETE FROM bank_lines WHERE id = ?", [lineId]);
  }
});

test("one of something is said in the singular, on the sheet and in the close", () => {
  // Two seeded invoices sit one day past due, and a month's close can hold one overdue invoice:
  // "1 days past due." on the hover read-out and "across 1 invoices" in the export a person pastes.
  const oneDayLate = listInvoices().find((r) => r.days_overdue === 1 && r.candidate_count === 0)!;
  assert.ok(oneDayLate, "the seed leaves an invoice one day past due");
  assert.equal(statusOf(oneDayLate), "1 day past due.");
  assert.equal(statusOf({ ...oneDayLate, days_overdue: 2 }), "2 days past due.");

  const summary = { ...summarize("2026-08"), overdue_count: 1 };
  for (const render of [renderSummary, renderSummaryMarkdown]) {
    const text = render({ summary, outstanding: [] });
    assert.match(text, /across 1 invoice\b/, `${render.name}: singular`);
    assert.doesNotMatch(text, /across 1 invoices/, `${render.name}: not "1 invoices"`);
    assert.match(render({ summary: { ...summary, overdue_count: 4 }, outstanding: [] }), /across 4 invoices/);
  }
});

test("the sentence under a card's standing glyph leads with the same fact the glyph shows", () => {
  // The card prints the standing (`statusOf` in components/lanes/model/status.ts: disputed, then 45+ days late,
  // then a credit) beside `mark.status` from lib/lanes/read.ts, which put the credit first: three
  // seeded invoices 51-67 days late wore the "45+ days late" glyph over "1 unapplied credit could
  // belong here." - and `read_view` handed that sentence to an agent as what the invoice waits on.
  const marks = buildSheet().lanes.flatMap((l) => l.marks);
  const shouting = marks.filter((m) => standingOf(m) === "long-overdue");
  // Two, not three: the third (LB-2026-0057) only ever counted a credit that is plainly
  // LB-2026-0115's, which the one reconciliation table no longer offers it (lib/reconcile.ts).
  assert.ok(
    shouting.filter((m) => m.candidateCount > 0).length >= 2,
    "the seed has long-overdue invoices a credit might settle",
  );
  for (const m of shouting) {
    assert.match(m.status, new RegExp(`^${m.daysOverdue} days past due`), `${m.number}: lateness first`);
    if (m.candidateCount > 0) assert.match(m.status, /could belong here\.$/, `${m.number}: and the credit`);
  }
  for (const m of marks.filter((x) => standingOf(x) === "credit")) {
    assert.match(m.status, /could belong here\.$/, `${m.number}: a credit standing names the credit`);
  }
});

/* ------------------------------------------- the class each act declares, against what it does */

type Act = keyof typeof TOOL_CLASSES;
type Observed = { reversible: boolean; undoes: boolean };

/** The newest activity row an act wrote, then what `undoAction` makes of it. */
async function observe(action: Act): Promise<Observed> {
  const row = db().get<{ id: number; reversible: number; undo_json: string | null }>(
    "SELECT id, reversible, undo_json FROM activity WHERE action = ? ORDER BY id DESC LIMIT 1",
    [action],
  );
  assert.ok(row, `${action} wrote an activity row`);
  const undone = await actions.undoAction(row.id);
  return { reversible: row.reversible === 1 && row.undo_json !== null, undoes: undone.ok };
}

/**
 * Drives every act that is not a read through its server action once, against the seeded books,
 * and records the class the act gave ITSELF: whether its activity row is reversible with an undo
 * payload, and whether `undoAction` then reverses it.
 */
async function driveEveryAct(): Promise<Record<string, Observed>> {
  const rows = listInvoices();
  const chase = rows.find((r) => r.state === "overdue" && !r.has_draft_reminder)!;
  const voidable = rows.find((r) => r.state === "overdue" && r.paid_cents === 0 && r.id !== chase.id)!;
  const payable = rows.find((r) => r.state === "partial")!;
  const credit = unappliedCredits().find((c) => !c.ambiguous && c.suggestions.length > 0)!;
  const seeded = db().get<{ invoice_id: string; line_id: string }>(
    `SELECT m.invoice_id, m.line_id FROM matches m JOIN invoices i ON i.id = m.invoice_id
     WHERE i.status = 'sent' ORDER BY m.line_id LIMIT 1`,
  )!;
  assert.ok(chase && voidable && payable && credit && seeded, "the seed has a target for every act");

  const seen: Record<string, Observed> = {};
  const run = async (action: Act, act: () => Promise<{ ok: boolean; message: string }>) => {
    const result = await act();
    assert.equal(result.ok, true, `${action}: ${result.message}`);
    seen[action] = await observe(action);
  };
  await run("categorize", () => actions.categorizeAction([chase.id], "consulting"));
  await run("match_bank_line", () => actions.matchAction(credit.suggestions[0]!.invoice_id, credit.line.id));
  await run("unmatch", () => actions.unmatchAction(seeded.invoice_id, seeded.line_id));
  await run("draft_reminder", () => actions.draftReminderAction(chase.id, "gentle"));
  await run("export_summary", () => actions.exportSummaryAction("2026-08"));
  await run("mark_paid", () => actions.markPaidAction(payable.id, 100));
  await actions.draftReminderAction(chase.id, "firm");
  await run("send_reminder", () => actions.sendReminderAction(chase.id));
  await run("void_invoice", () => actions.voidInvoiceAction(voidable.id));
  return seen;
}

/** Every act whose observed class differs from the one the table declares for it. */
function disagreements(classes: Record<Act, { reversible: boolean }>, seen: Record<string, Observed>) {
  return Object.entries(seen)
    .filter(([name, o]) => {
      const declared = classes[name as Act].reversible;
      return o.reversible !== declared || o.undoes !== declared;
    })
    .map(([name]) => name);
}

test("every act is as reversible as its tool class says, by its own activity row and its undo", async () => {
  // `lib/tool-classes.ts` is what the gate reads: AUTO for a reversible data write, a card for the
  // rest. The other half of that claim lives in `app/actions.ts` - the `reversible` flag and undo
  // payload each act logs, and the `applyUndo` case that reverses it - and until now no test held
  // the two together. A table that called an irreversible act reversible would run it with no
  // card and no way back; an act that stopped logging its undo would leave an AUTO write that
  // cannot be taken back.
  const seen = await driveEveryAct();
  const writes = (Object.keys(TOOL_CLASSES) as Act[]).filter((n) => TOOL_CLASSES[n].sideEffects !== "none");
  assert.deepEqual(Object.keys(seen).sort(), [...writes].sort(), "every write in the table was driven");
  assert.deepEqual(disagreements(TOOL_CLASSES, seen), []);

  // The negative control: the same observations against a table that lies about one act.
  const lying = { ...TOOL_CLASSES, export_summary: { reversible: false, sideEffects: "data" as const } };
  assert.deepEqual(disagreements(lying, seen), ["export_summary"], "a flipped class is caught");
});

/* ------------------------------------------------------------- every export has a reader */

/*
 * tsc never calls an export unused and eslint-config-next tracks no cross-module reachability, so
 * the lib had grown readers' worth of API nobody reads: a reports view's `listExports`, a
 * statement view's `matchIndex` and `listBankLines`, an inbox's `countByFilter`, three date
 * helpers. This is the count neither gate takes (the same instrument hirelane's
 * `test/exports.test.ts` keeps). A reader is any mention outside comments, anywhere in the app's
 * source or tests, other than the declaration; a name used inside its own file has one.
 */
const APP_ROOT = fileURLToPath(new URL("../", import.meta.url));

/** Kept with no reader, on purpose: the studio-wide call on `athena:app-version` (see hirelane). */
const KEPT = new Set(["APP_VERSION"]);
const SKIP_DIRS = new Set(["node_modules", ".next", "data", "public"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(path);
  }
  return out;
}

const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const DECL = /^export\s+(?:async\s+)?(?:function|const|let|interface|type|class)\s+([A-Za-z_$][\w$]*)/gm;

function unreadExports(): { scanned: string[]; dead: string[] } {
  const sources = walk(APP_ROOT).map((path) => ({
    path: relative(APP_ROOT, path).replaceAll("\\", "/"),
    text: stripComments(readFileSync(path, "utf8")),
  }));
  const inScope = sources.filter((s) => /^lib\/(?:lanes\/)?[^/]+\.ts$/.test(s.path));
  const dead: string[] = [];
  for (const file of inScope) {
    for (const match of file.text.matchAll(DECL)) {
      const name = match[1]!;
      if (KEPT.has(name)) continue;
      const word = new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\b`, "g");
      const uses = sources.reduce((n, s) => n + (s.text.match(word)?.length ?? 0), 0);
      if (uses <= 1) dead.push(`${file.path}: ${name}`);
    }
  }
  return { scanned: inScope.map((s) => s.path), dead };
}

test("every export of the domain lib has a reader besides its own declaration", () => {
  const { scanned, dead } = unreadExports();
  assert.equal(scanned.length, 19, `the scan reaches the context's 19 files: ${scanned.join(", ")}`);
  assert.deepEqual(dead, []);
});

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
import { test } from "node:test";
import { tempHome } from "./tmp-home";

// Own scratch cwd, own seeded copy: `openDb` resolves the file from `process.cwd()/data`.
tempHome("ledgerbox-domain-lib-");

const { PERIODS } = await import("../lib/constants");
const { summarize } = await import("../lib/db");
const { parseDollars } = await import("../lib/format");
const { composeReminder } = await import("../lib/reminder");
const { buildSheet } = await import("../lib/lanes");

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

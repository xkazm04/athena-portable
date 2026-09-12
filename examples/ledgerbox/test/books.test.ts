/**
 * The money rules, pinned.
 *
 * Every assertion here stands for a defect that shipped past `tsc --noEmit` and `eslint .` - both
 * of which exit 0 on a tree where "Lift off" moves no money and a typed comma records a NULL
 * payment. None of them is a type error; they are arithmetic and naming agreements, so only a run
 * against the real books can see them. Each one was confirmed red by reverting the fix it guards.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// `openDb` resolves the file from `process.cwd()/data`, so a scratch cwd gives this run its own
// seeded copy and never touches the one committed under `data/`.
process.chdir(mkdtempSync(join(tmpdir(), "ledgerbox-test-")));

const { COUNTED_OUT, db, getInvoice, inPeriod, listInvoices, summarize, unappliedLines } =
  await import("../lib/db");
const { markPaidAction, matchAction, unmatchAction } = await import("../app/actions");
const { markPaidForm } = await import("../app/form-actions");
const { parseDollars } = await import("../lib/format");

const paymentCount = (invoiceId: string): number =>
  db().get<{ n: number }>("SELECT COUNT(*) AS n FROM payments WHERE invoice_id = ?", [invoiceId])!.n;

const paidCents = (invoiceId: string): number =>
  db().get<{ n: number }>(
    "SELECT COALESCE(SUM(amount_cents), 0) AS n FROM payments WHERE invoice_id = ?",
    [invoiceId],
  )!.n;

/** A seeded match and the bank line behind it. The seeder names its payments `pay_<suffix>_<n>`. */
const seededMatch = (): { invoice_id: string; line_id: string; amount_cents: number } =>
  db().get<{ invoice_id: string; line_id: string; amount_cents: number }>(
    `SELECT m.invoice_id, m.line_id, b.amount_cents
     FROM matches m JOIN bank_lines b ON b.id = m.line_id
     JOIN invoices i ON i.id = m.invoice_id
     WHERE i.status = 'sent' ORDER BY m.line_id LIMIT 1`,
  )!;

test("unmatch moves the money back, not just the match row", async () => {
  const match = seededMatch();
  assert.ok(match, "the seed reconciles bank lines against invoices");

  const before = getInvoice(match.invoice_id)!;
  const paymentsBefore = paymentCount(match.invoice_id);

  const result = await unmatchAction(match.invoice_id, match.line_id);
  assert.equal(result.ok, true, result.message);

  // The defect: the payment was deleted by `pay_match_<line_id>`, an id no seeded row carries, so
  // all 65 seeded matches unapplied nothing - the match row went, the balance did not move, and
  // the same credit could be applied a second time.
  const after = getInvoice(match.invoice_id)!;
  assert.equal(
    after.balance_cents,
    before.balance_cents + match.amount_cents,
    "the balance rises by the amount that was lifted off",
  );
  assert.equal(paidCents(match.invoice_id), before.paid_cents - match.amount_cents);
  assert.equal(paymentCount(match.invoice_id), paymentsBefore - 1, "exactly one payment row leaves");
});

test("a typed amount is parsed or refused, never passed on as NaN", async () => {
  // What the app itself prints has to be what the app accepts back.
  assert.equal(parseDollars("$1,250.00"), 125_000);
  assert.equal(parseDollars("1,250"), 125_000);
  assert.equal(parseDollars(" 42.50 "), 4_250);
  // And what only looks numeric is refused with `null`, not guessed at.
  for (const junk of ["1e3", "abc", "", "12.34.56", "-"]) {
    assert.equal(parseDollars(junk), null, `${JSON.stringify(junk)} is not an amount`);
  }

  const target = listInvoices().find((r) => r.balance_cents > 200_000 && r.state !== "void")!;
  assert.ok(target, "the seed leaves invoices with real balances owing");
  const before = paymentCount(target.id);

  // The defect, end to end: `$1,250.00` parsed to NaN, every guard in `markPaidAction` is false
  // against NaN, and the INSERT reached `amount_cents INTEGER NOT NULL` with it - a throw mid
  // action instead of an answer. The action must refuse a non-finite amount in its own words.
  const nan = await markPaidAction(target.id, Number.NaN);
  assert.equal(nan.ok, false);
  assert.equal(nan.message, "That is not an amount.");
  assert.equal(paymentCount(target.id), before, "nothing is written for an amount that is not one");

  const form = new FormData();
  form.set("id", target.id);
  form.set("amount", "$1,250.00");
  const ok = await markPaidForm({ ok: true, message: "", seq: 0 }, form);
  assert.equal(ok.ok, true, ok.message);
  assert.equal(paymentCount(target.id), before + 1);
  assert.equal(
    db().get<{ n: number }>(
      "SELECT amount_cents AS n FROM payments WHERE invoice_id = ? ORDER BY paid_at DESC LIMIT 1",
      [target.id],
    )!.n,
    125_000,
    "the formatted amount is recorded at its face value",
  );
});

test("a credit larger than the balance is refused, so no balance goes negative", async () => {
  const owed = listInvoices()
    .filter((r) => r.balance_cents > 0 && !COUNTED_OUT.includes(r.state))
    .sort((a, b) => a.balance_cents - b.balance_cents);
  const smallest = owed[0]!;
  const oversized = unappliedLines()
    .filter((l) => l.direction === "in" && l.amount_cents > smallest.balance_cents)
    .sort((a, b) => b.amount_cents - a.amount_cents)[0]!;
  assert.ok(smallest && oversized, "the seed leaves credits larger than the smallest balance owing");

  const before = paymentCount(smallest.id);
  const outstandingBefore = summarize("quarter").outstanding_cents;

  // The defect: any credit could be applied to any invoice. The balance went negative, `stateOf`
  // called the invoice paid, and `summarize` subtracted the overshoot from `outstanding_cents`
  // while the export's positive-balance table did not - two figures in one document disagreeing.
  const result = await matchAction(smallest.id, oversized.id);
  assert.equal(result.ok, false);
  assert.match(result.message, /is more than the/);

  assert.equal(getInvoice(smallest.id)!.balance_cents, smallest.balance_cents, "the balance stands");
  assert.ok(getInvoice(smallest.id)!.balance_cents > 0, "and never goes negative");
  assert.equal(paymentCount(smallest.id), before, "no payment is recorded");
  assert.equal(summarize("quarter").outstanding_cents, outstandingBefore);
  assert.equal(
    db().get<{ n: number }>("SELECT COUNT(*) AS n FROM matches WHERE line_id = ?", [oversized.id])!.n,
    0,
    "the bank line stays unapplied",
  );
});

test("a draft invoice is billed to nobody, so no total counts it", () => {
  const rows = listInvoices();
  const draft = rows.find((r) => r.state === "draft")!;
  assert.ok(draft, "the seed carries a draft invoice");
  assert.ok(draft.amount_cents > 0 && inPeriod(draft.issued_at, "quarter"));

  // Everything the quarter could count, drafts included - which is what `summarize` used to do,
  // COUNTED_OUT having named only `void`. A draft was then both invoiced and outstanding, so the
  // export reported money nobody had been asked for.
  const withDrafts = rows.filter((r) => inPeriod(r.issued_at, "quarter") && r.state !== "void");
  const summary = summarize("quarter");

  assert.equal(summary.invoice_count, withDrafts.length - 1, "the draft is not an issued invoice");
  assert.equal(
    summary.invoiced_cents,
    withDrafts.reduce((s, r) => s + r.amount_cents, 0) - draft.amount_cents,
  );
  assert.equal(
    summary.outstanding_cents,
    withDrafts.reduce((s, r) => s + r.balance_cents, 0) - draft.balance_cents,
  );
  assert.ok(COUNTED_OUT.includes("draft") && COUNTED_OUT.includes("void"));
});

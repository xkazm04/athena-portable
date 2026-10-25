/**
 * One invoice, one reading: the two server pipelines and every projection an agent reads agree.
 *
 * The page answers questions about an invoice from two builds of the same books - `buildBooks`
 * (the ledger: `InvoiceRow`) and `buildSheet` (the picture: `LnMark` plus `LnDetail`). Every
 * invoice-returning tool projects through `invoiceCore` over one small facts record, with an
 * adapter per pipeline. So the claim this file checks is the one a reviewer cannot: for every
 * seeded invoice, both adapters give the core the same facts, and the judgement the demo exists
 * to make (`isMostlyPaid`) reads the same in every projection, at its threshold.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { tempHome } from "./tmp-home";

tempHome("ledgerbox-invoice-read-");

const { buildBooks, buildSheet } = await import("../lib/lanes");
const { heatOf } = await import("../lib/lanes/heat");
// A namespace import, so a projection that does not exist yet fails its own case, not the file.
const read = (await import("../components/lanes/tools/read")) as Record<string, unknown> &
  typeof import("../components/lanes/tools/read");
const { searchLanes } = await import("../components/lanes/tools/search");

import type { LnDetail, LnMark, LnSheet } from "../components/lanes/model";
import type { InvoiceRow } from "../lib/types";

type Fn = (...a: unknown[]) => Record<string, unknown>;
const fn = (name: string): Fn => {
  const f = read[name];
  assert.equal(typeof f, "function", `read.ts exports ${name}`);
  return f as Fn;
};

test("both pipelines give the core the same facts for every seeded invoice", () => {
  const books = buildBooks();
  const sheet = buildSheet();
  const marks = new Map(sheet.lanes.flatMap((l) => l.marks).map((m) => [m.id, m]));
  assert.equal(books.rows.length, 125, "the seed's 125 invoices");
  assert.equal(marks.size, books.rows.length, "every invoice is drawn once");

  const invoiceCore = fn("invoiceCore");
  const factsOfRow = fn("factsOfRow");
  const factsOfMark = fn("factsOfMark");
  const disagree: string[] = [];
  for (const row of books.rows) {
    const mark = marks.get(row.id)!;
    const ledger = invoiceCore(factsOfRow(row));
    const picture = invoiceCore(factsOfMark(mark, sheet.details[row.id]));
    try {
      assert.deepStrictEqual(picture, ledger);
    } catch {
      disagree.push(row.number);
    }
    // The ratio the core states is the one the database states, to the cent.
    assert.equal(ledger.paid_ratio, row.paid_ratio, `${row.number}: paid_ratio`);
  }
  assert.deepEqual(disagree, [], "buildBooks and buildSheet say the same thing about every invoice");
});

/* -------------------------------------------------------------- fixtures for the guards */

const MARK = (over: Partial<LnMark> & Pick<LnMark, "id" | "number">): LnMark => {
  const base = {
    clientId: "cl_1",
    clientName: "Solstice Partners",
    category: "design" as const,
    issuedAt: "2026-06-01T00:00:00.000Z",
    dueAt: "2026-07-01T00:00:00.000Z",
    amountCents: 100_000,
    paidCents: 0,
    balanceCents: 100_000,
    state: "partial" as const,
    daysOverdue: 40,
    candidateCount: 0,
    remindersSent: 0,
    hasDraft: false,
    x: 0.4,
    weight: 0.6,
    row: 2,
    status: "Late.",
    ...over,
  };
  return { ...base, heat: heatOf(base.state, base.daysOverdue) };
};

const AT_69 = MARK({ id: "inv_a", number: "LB-2026-9001", paidCents: 69_000, balanceCents: 31_000 });
const AT_70 = MARK({ id: "inv_b", number: "LB-2026-9002", paidCents: 70_000, balanceCents: 30_000 });

const DETAIL = (mark: LnMark): LnDetail => ({
  invoiceId: mark.id,
  contact: "Tova Lindqvist",
  email: "tova.lindqvist@solstice-partners.example",
  address: "London",
  terms: 30,
  note: "",
  disputeNote: null,
  lines: [{ description: "Design", quantity: 1, amountCents: mark.amountCents }],
  linesHidden: 0,
  candidates: [],
  matched: [],
  draft: null,
  sentCount: 0,
  // Deliberately the WRONG answer: the projection must decide by isMostlyPaid, not copy a flag.
  mostlyPaid: mark.paidCents < 70_000,
  settling: null,
});

const SHEET: LnSheet = {
  lanes: [
    {
      id: "design",
      label: "Design",
      blurb: "Studio design work.",
      marks: [AT_69, AT_70],
      rows: 1,
      count: 2,
      invoicedCents: 200_000,
      collectedCents: 139_000,
      owedCents: 61_000,
      lateCents: 61_000,
      lateCount: 2,
      worstDays: 40,
      heat: "alert",
    },
  ],
  axis: { startIso: "2026-06-01T00:00:00.000Z", endIso: "2026-09-15T00:00:00.000Z", todayX: 0.8, months: [] },
  clients: [{ id: "cl_1", name: "Solstice Partners", count: 2 }],
  totals: {
    invoiceCount: 2,
    invoicedCents: 200_000,
    collectedCents: 139_000,
    outstandingCents: 61_000,
    overdueCents: 61_000,
    overdueCount: 2,
    disputedCount: 0,
    unmatchedCount: 0,
  },
  details: { inv_a: DETAIL(AT_69), inv_b: DETAIL(AT_70) },
};

/** The same two invoices as the ledger states them. */
const ROW = (mark: LnMark): InvoiceRow =>
  ({
    id: mark.id,
    number: mark.number,
    client_id: mark.clientId,
    client_name: mark.clientName,
    category: mark.category,
    issued_at: mark.issuedAt,
    due_at: mark.dueAt,
    amount_cents: mark.amountCents,
    paid_cents: mark.paidCents,
    balance_cents: mark.balanceCents,
    state: mark.state,
    days_overdue: mark.daysOverdue,
    matched_lines: 0,
    candidate_count: 0,
    reminders_sent: 0,
    has_draft_reminder: false,
    client_contact: "Tova Lindqvist",
    client_email: "tova.lindqvist@solstice-partners.example",
    client_bank_alias: null,
    paid_ratio: Math.round((mark.paidCents / mark.amountCents) * 100) / 100,
    last_payment_at: "2026-07-10T00:00:00.000Z",
    note: "",
    dispute_note: null,
  }) as unknown as InvoiceRow;

test("guard: the picture's reads carry no layout fact, and money is in units", () => {
  for (const out of [read.markRead(AT_70), read.detailRead(SHEET, AT_70)] as Record<string, unknown>[]) {
    for (const forbidden of ["x", "weight", "row"]) {
      assert.ok(!(forbidden in out), `${forbidden} is how a mark is drawn, not what it is`);
    }
    assert.equal(out.amount, 1_000, "units, not cents");
    assert.equal(out.balance, 300);
  }
});

test("guard: mostly_paid is isMostlyPaid's in every projection - 0.69 false, 0.70 true", () => {
  const rowRead = fn("rowRead");
  const found = searchLanes(SHEET, {}).items as unknown as Record<string, unknown>[];
  const byId = (id: string) => found.find((r) => r.id === id)!;
  for (const [mark, want] of [
    [AT_69, false],
    [AT_70, true],
  ] as const) {
    assert.strictEqual(rowRead(ROW(mark)).mostly_paid, want, `read_inbox's row for ${mark.number}`);
    assert.strictEqual(byId(mark.id).mostly_paid, want, `search_invoices for ${mark.number}`);
    assert.strictEqual(
      (read.detailRead(SHEET, mark) as Record<string, unknown>).mostly_paid,
      want,
      `the L2 detail for ${mark.number}`,
    );
  }
});

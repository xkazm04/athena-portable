import "server-only";
import type { Db } from "@athena/demo-kit/db";
import { createActivityTable, logActivity } from "@athena/demo-kit/activity";
import { STUDIO, companyByName, rngFor, type Rng } from "@athena/demo-kit/seed";

import {
  APP_ID,
  CATEGORIES,
  QUARTER_START_ISO as QUARTER_START,
  TODAY,
  type Category,
} from "./constants";
import { composeReminder } from "./reminder";
import { CLIENTS, EXPENSE_MEMOS, OTHER_CREDITS, WORK, dayFrom, memoFor } from "./seed-fixtures";

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, contact TEXT NOT NULL, email TEXT NOT NULL,
  address TEXT NOT NULL, prior_address TEXT, address_changed_at TEXT,
  terms_days INTEGER NOT NULL, note TEXT NOT NULL, bank_alias TEXT
);
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, client_id TEXT NOT NULL REFERENCES clients(id),
  issued_at TEXT NOT NULL, due_at TEXT NOT NULL, amount_cents INTEGER NOT NULL,
  category TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('draft','sent','disputed','void')),
  dispute_note TEXT, note TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invoice_lines (
  id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id),
  description TEXT NOT NULL, quantity REAL NOT NULL, unit_cents INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id),
  paid_at TEXT NOT NULL, amount_cents INTEGER NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('transfer','card','cash')), note TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bank_lines (
  id TEXT PRIMARY KEY, posted_at TEXT NOT NULL, memo TEXT NOT NULL,
  amount_cents INTEGER NOT NULL, direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  source_file TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS matches (
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  line_id TEXT NOT NULL REFERENCES bank_lines(id),
  matched_at TEXT NOT NULL, actor TEXT NOT NULL, evidence TEXT NOT NULL,
  PRIMARY KEY (invoice_id, line_id)
);
CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id),
  tone TEXT NOT NULL CHECK (tone IN ('gentle','firm')),
  recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
  created_at TEXT NOT NULL, sent_at TEXT
);
CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY, period TEXT NOT NULL, generated_at TEXT NOT NULL, body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS invoices_due ON invoices (due_at);
CREATE INDEX IF NOT EXISTS payments_invoice ON payments (invoice_id);
CREATE INDEX IF NOT EXISTS lines_invoice ON invoice_lines (invoice_id);
`;

/** What happens to an invoice by the time the books close on 1 September. */
type Fate = "settled" | "awaiting" | "partial" | "overdue" | "open" | "disputed" | "void" | "draft";

/** Fixed counts, then shuffled: the mix is identical on every machine, the order is not obvious. */
const FATES: [Fate, number][] = [
  ["settled", 52],
  ["awaiting", 14],
  ["partial", 12],
  ["overdue", 20],
  ["open", 17],
  ["disputed", 2],
  ["void", 2],
  ["draft", 1],
];

interface SeedClient {
  id: string;
  name: string;
  terms: number;
  alias?: string;
}

interface Ctx {
  db: Db;
  rng: Rng;
  counter: { n: number };
}

function issuedOffsetFor(rng: Rng, fate: Fate): number {
  if (fate === "open") return rng.int(73, 88);
  if (fate === "overdue") return rng.int(0, 34);
  return rng.int(0, 70);
}

function categoryFor(rng: Rng): Category {
  // Roughly one in seven arrives unfiled, so `categorize` has real work to do.
  return rng.bool(0.14) ? "uncategorized" : rng.pick(CATEGORIES.slice(1) as Category[]);
}

function statementFor(iso: string): string {
  return `statement-${iso.slice(0, 7)}.csv`;
}

function addBankLine(
  ctx: Ctx,
  posted: string,
  memo: string,
  cents: number,
  dir: "in" | "out",
): string {
  const id = ctx.rng.id("bl", ++ctx.counter.n, 5);
  ctx.db.run(
    "INSERT INTO bank_lines (id, posted_at, memo, amount_cents, direction, source_file) VALUES (?, ?, ?, ?, ?, ?)",
    [id, posted, memo, cents, dir, statementFor(posted)],
  );
  return id;
}

function seedClients(db: Db, rng: Rng): SeedClient[] {
  return CLIENTS.map((c, i) => {
    const id = rng.id("cl", i + 1, 2);
    // The billing contact is the registry's, verbatim - name and address alike. Generating one
    // here is what made the studio's three tabs disagree about who to write to: Ledgerbox chased
    // an invented `sami.whitlock@`, TidyCRM held the registry person, and a fact remembered in one
    // tab named nobody in the next. `companyByName` is non-null for every entry: the loop under
    // CLIENTS (seed-fixtures.ts) throws at import if it is not.
    const contact = companyByName(c.name)!.contact;
    db.run(
      `INSERT INTO clients (id, name, contact, email, address, prior_address, address_changed_at, terms_days, note, bank_alias)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        c.name,
        contact.name,
        contact.email,
        c.address,
        c.priorAddress ?? null,
        c.addressChangedAt ?? null,
        c.termsDays,
        c.note,
        c.bankAlias ?? null,
      ],
    );
    return { id, name: c.name, terms: c.termsDays, ...(c.bankAlias ? { alias: c.bankAlias } : {}) };
  });
}

/** Line items for one invoice; the total is their sum, never a separate random number. */
function seedLines(ctx: Ctx, invoiceId: string, category: Category, seq: number): number {
  const key = category === "uncategorized" ? "consulting" : category;
  const pool = WORK[key];
  const count = ctx.rng.int(1, 4);
  let total = 0;
  for (let i = 0; i < count; i++) {
    const quantity = ctx.rng.pick([1, 1, 1, 2, 3, 4, 6, 8]);
    const unit = ctx.rng.int(18, 240) * 2500;
    const amount = quantity * unit;
    total += amount;
    ctx.db.run(
      "INSERT INTO invoice_lines (id, invoice_id, description, quantity, unit_cents, amount_cents) VALUES (?, ?, ?, ?, ?, ?)",
      [ctx.rng.id("il", seq * 10 + i, 5), invoiceId, ctx.rng.pick(pool), quantity, unit, amount],
    );
  }
  return total;
}

interface FateInput {
  fate: Fate;
  id: string;
  number: string;
  client: SeedClient;
  due: string;
  total: number;
}

/** Record a payment and the bank line behind it, optionally already reconciled. */
function payFor(ctx: Ctx, inv: FateInput, cents: number, paidAt: string, matched: boolean): void {
  const rounded = Math.round(cents / 100) * 100;
  ctx.db.run(
    "INSERT INTO payments (id, invoice_id, paid_at, amount_cents, method, note) VALUES (?, ?, ?, ?, ?, ?)",
    [
      `pay_${inv.id.slice(4)}_${ctx.counter.n}`,
      inv.id,
      paidAt,
      rounded,
      ctx.rng.pickWeighted([
        ["transfer", 8],
        ["card", 2],
        ["cash", 1],
      ]),
      "Applied from the bank statement.",
    ],
  );
  const memo = memoFor(ctx.rng, inv.client.name, inv.number, inv.client.alias);
  const lineId = addBankLine(ctx, paidAt, memo, rounded, "in");
  if (matched) {
    ctx.db.run(
      "INSERT INTO matches (invoice_id, line_id, matched_at, actor, evidence) VALUES (?, ?, ?, ?, ?)",
      [inv.id, lineId, paidAt, "system", "exact amount; client name in the memo"],
    );
  }
}

/** Payments, bank lines and matches for one invoice, according to how its story ends. */
function applyFate(ctx: Ctx, inv: FateInput): void {
  const { rng } = ctx;
  if (inv.fate === "overdue" || inv.fate === "open" || inv.fate === "void" || inv.fate === "draft") {
    return;
  }

  if (inv.fate === "disputed") {
    // A disputed invoice still shows the part nobody argued with.
    payFor(ctx, inv, Math.round(inv.total * 0.4), dayFrom(inv.due, rng.int(-8, 2), 11), true);
    return;
  }

  const paidAt = dayFrom(inv.due, rng.int(-6, 9), rng.int(6, 20));
  if (Date.parse(paidAt) >= Date.parse(TODAY)) return;

  if (inv.fate === "settled") {
    payFor(ctx, inv, inv.total, paidAt, true);
    return;
  }
  if (inv.fate === "partial") {
    payFor(ctx, inv, Math.round(inv.total * rng.float(0.3, 0.65, 2)), paidAt, true);
    return;
  }
  // "awaiting": the money is on the statement, the books have not been told.
  addBankLine(ctx, paidAt, memoFor(rng, inv.client.name, inv.number, inv.client.alias), inv.total, "in");
}

/** Everything on a real statement that is not a customer payment. */
function seedNoise(ctx: Ctx): void {
  const rng = rngFor(APP_ID, "noise");
  const noise: Ctx = { db: ctx.db, rng, counter: ctx.counter };
  for (let i = 0; i < 38; i++) {
    const entry = EXPENSE_MEMOS[rng.int(0, EXPENSE_MEMOS.length - 1)]!;
    const [memo, lo, hi] = entry;
    addBankLine(noise, dayFrom(QUARTER_START, rng.int(0, 91), rng.int(0, 23)), memo, rng.int(lo, hi), "out");
  }
  for (const [memo, cents] of OTHER_CREDITS) {
    addBankLine(noise, dayFrom(QUARTER_START, rng.int(0, 91), rng.int(0, 23)), memo, cents, "in");
  }
}

function insertPlainInvoice(
  ctx: Ctx,
  row: { id: string; number: string; clientId: string; issued: string; terms: number; cents: number; category: Category; note: string },
): void {
  ctx.db.run(
    `INSERT INTO invoices (id, number, client_id, issued_at, due_at, amount_cents, category, status, dispute_note, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'sent', NULL, ?)`,
    [row.id, row.number, row.clientId, row.issued, dayFrom(row.issued, row.terms, 23, 59), row.cents, row.category, row.note],
  );
}

/**
 * The handful of cases that must NOT be unambiguous (design 4.6.1): two identical retainers against
 * one credit, a client who always pays short by the wire fee, and the client who paid 80%.
 */
function seedCrafted(ctx: Ctx, clients: SeedClient[]): void {
  const rng = rngFor(APP_ID, "crafted");
  const c: Ctx = { db: ctx.db, rng, counter: ctx.counter };
  const kestrel = clients[1]!;
  const solstice = clients[7]!;
  const quarry = clients[12]!;

  // Two Kestrel retainers, same month, same amount: one credit fits either equally well.
  for (const n of [900, 901]) {
    const id = `inv_0${n}`;
    const issued = dayFrom(QUARTER_START, 40 + (n - 900), 11, 0);
    insertPlainInvoice(c, {
      id,
      number: `LB-2026-0${n}`,
      clientId: kestrel.id,
      issued,
      terms: kestrel.terms,
      cents: 480000,
      category: "retainer",
      note: "Parallel retainer; the amount repeats every month.",
    });
    c.db.run(
      "INSERT INTO invoice_lines (id, invoice_id, description, quantity, unit_cents, amount_cents) VALUES (?, ?, ?, 1, 480000, 480000)",
      [`il_9${n}`, id, "Monthly retainer"],
    );
  }
  addBankLine(c, dayFrom(QUARTER_START, 70, 9), "TRANSFER FROM KESTREL LABS", 480000, "in");

  // Quarry House pays the same week and always short by the wire fee.
  const qIssued = dayFrom(QUARTER_START, 58, 10, 0);
  insertPlainInvoice(c, {
    id: "inv_0910",
    number: "LB-2026-0910",
    clientId: quarry.id,
    issued: qIssued,
    terms: quarry.terms,
    cents: 312500,
    category: "design",
    note: "Their bank deducts the wire fee from the amount sent.",
  });
  c.db.run(
    "INSERT INTO invoice_lines (id, invoice_id, description, quantity, unit_cents, amount_cents) VALUES ('il_9910', 'inv_0910', 'Poster series artwork', 1, 312500, 312500)",
  );
  addBankLine(c, dayFrom(QUARTER_START, 68, 14), "SEPA CR QUARRY HOUSE INV LB-2026-0910", 309000, "in");

  // Solstice paid 80% of the summer retainer and went quiet: the client to skip when chasing.
  const sIssued = dayFrom(QUARTER_START, 22, 9, 30);
  insertPlainInvoice(c, {
    id: "inv_0920",
    number: "LB-2026-0920",
    clientId: solstice.id,
    issued: sIssued,
    terms: solstice.terms,
    cents: 1250000,
    category: "retainer",
    note: "Paid 80% in two instalments, then stopped replying.",
  });
  c.db.run(
    "INSERT INTO invoice_lines (id, invoice_id, description, quantity, unit_cents, amount_cents) VALUES ('il_9920', 'inv_0920', 'Summer retainer, three months', 1, 1250000, 1250000)",
  );
  const instalments: [number, number, number][] = [
    [1, 625000, 55],
    [2, 375000, 74],
  ];
  for (const [seq, cents, offset] of instalments) {
    const paidAt = dayFrom(QUARTER_START, offset, 12, 0);
    c.db.run(
      "INSERT INTO payments (id, invoice_id, paid_at, amount_cents, method, note) VALUES (?, 'inv_0920', ?, ?, 'transfer', 'Instalment against the summer retainer.')",
      [`pay_solstice_${seq}`, paidAt, cents],
    );
    const lineId = addBankLine(c, paidAt, `SOLSTICE PARTNERS PAYMENT ${seq} OF 3`, cents, "in");
    c.db.run(
      "INSERT INTO matches (invoice_id, line_id, matched_at, actor, evidence) VALUES ('inv_0920', ?, ?, 'user', ?)",
      [lineId, paidAt, "exact instalment amount; client name in the memo"],
    );
  }
}

/**
 * Pinegrove Collective's August invoice, and the credit that settles it under their TRADING NAME.
 *
 * The bank prints `PINEGROVE COOP`, the books say `Pinegrove Collective`, and the studio has
 * re-derived that equivalence every month for a year. Every other Pinegrove credit in the seed is
 * already reconciled, so without this one the alias is a fact nobody in the demo ever has to
 * learn. This invoice is inside terms, so it belongs to the reconciliation beat and not to the
 * chase: the alias is the only thing about it that is not obvious.
 */
function seedAliasCredit(ctx: Ctx, clients: SeedClient[]): void {
  const rng = rngFor(APP_ID, "alias");
  const c: Ctx = { db: ctx.db, rng, counter: ctx.counter };
  const pinegrove = clients[3]!;
  const issued = dayFrom(QUARTER_START, 62, 10, 0);
  insertPlainInvoice(c, {
    id: "inv_0930",
    number: "LB-2026-0930",
    clientId: pinegrove.id,
    issued,
    terms: pinegrove.terms,
    cents: 742500,
    category: "development",
    note: "Their bank prints the trading name, not the name on the invoice.",
  });
  c.db.run(
    "INSERT INTO invoice_lines (id, invoice_id, description, quantity, unit_cents, amount_cents) VALUES ('il_9930', 'inv_0930', 'CMS migration', 1, 742500, 742500)",
  );
  addBankLine(c, dayFrom(QUARTER_START, 88, 9), `${pinegrove.alias ?? pinegrove.name.toUpperCase()} PAYMENT`, 742500, "in");
}

/** Two reminders already sent, one draft nobody has looked at. */
function seedReminders(ctx: Ctx): void {
  const rng = rngFor(APP_ID, "reminders");
  const overdue = ctx.db.all<{
    id: string;
    number: string;
    amount_cents: number;
    due_at: string;
    client_name: string;
    contact: string;
    email: string;
  }>(
    `SELECT i.id, i.number, i.amount_cents, i.due_at,
            c.name AS client_name, c.contact, c.email
     FROM invoices i JOIN clients c ON c.id = i.client_id
     WHERE i.status = 'sent' AND i.due_at < ?
       AND (SELECT COALESCE(SUM(amount_cents), 0) FROM payments p WHERE p.invoice_id = i.id) = 0
     ORDER BY i.due_at ASC LIMIT 3`,
    [TODAY],
  );
  overdue.forEach((inv, i) => {
    const created = dayFrom(TODAY, -12 + i * 3, 9, 15);
    const tone = i === 2 ? "firm" : "gentle";
    // The same composer `draft_reminder` runs, so a filed reminder and a fresh one are the same
    // document - addressed to the registry contact, from the studio inbox, with a subject.
    const draft = composeReminder({
      number: inv.number,
      clientName: inv.client_name,
      contactName: inv.contact,
      contactEmail: inv.email,
      tone,
      daysOverdue: Math.max(1, Math.floor((Date.parse(TODAY) - Date.parse(inv.due_at)) / 86_400_000)),
      balanceCents: inv.amount_cents,
      amountCents: inv.amount_cents,
    });
    ctx.db.run(
      "INSERT INTO reminders (id, invoice_id, tone, recipient, subject, body, created_at, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        rng.id("rem", i + 1, 3),
        inv.id,
        tone,
        draft.to,
        draft.subject,
        draft.body,
        created,
        i === 2 ? null : dayFrom(created, 0, 9, 30),
      ],
    );
  });
}

export function seed(db: Db): void {
  db.exec(SCHEMA);
  createActivityTable(db);

  const rng = rngFor(APP_ID, "books");
  const ctx: Ctx = { db, rng, counter: { n: 0 } };
  const clients = seedClients(db, rngFor(APP_ID, "clients"));
  const fates = rng.shuffle(FATES.flatMap(([f, n]) => Array.from({ length: n }, () => f)));

  for (let i = 0; i < fates.length; i++) {
    const fate = fates[i]!;
    const client = clients[rng.int(0, clients.length - 1)]!;
    const id = rng.id("inv", i + 1);
    const number = `LB-2026-${String(i + 1).padStart(4, "0")}`;
    const issued = dayFrom(QUARTER_START, issuedOffsetFor(rng, fate), rng.int(9, 17), rng.int(0, 59));
    const due = dayFrom(issued, client.terms, 23, 59);
    const category = fate === "draft" ? "uncategorized" : categoryFor(rng);
    const status =
      fate === "disputed" ? "disputed" : fate === "void" ? "void" : fate === "draft" ? "draft" : "sent";
    const disputeNote =
      fate === "disputed"
        ? rng.pick([
            "Client says the workshop day was never delivered.",
            "Rate on the second line does not match the signed estimate.",
          ])
        : null;

    db.run(
      `INSERT INTO invoices (id, number, client_id, issued_at, due_at, amount_cents, category, status, dispute_note, note)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      [
        id,
        number,
        client.id,
        issued,
        due,
        category,
        status,
        disputeNote,
        fate === "void" ? "Raised in error; replaced by a corrected invoice." : rng.sentence(),
      ],
    );

    const total = seedLines(ctx, id, category, i + 1);
    db.run("UPDATE invoices SET amount_cents = ? WHERE id = ?", [total, id]);
    applyFate(ctx, { fate, id, number, client, due, total });
  }

  seedNoise(ctx);
  seedCrafted(ctx, clients);
  seedAliasCredit(ctx, clients);
  seedReminders(ctx);

  logActivity(db, {
    actor: "system",
    action: "import_statement",
    target: "bank_lines",
    summary: `Imported three monthly statements and opened ${STUDIO.name}'s books for the quarter.`,
    reversible: false,
    ts: TODAY,
  });
}

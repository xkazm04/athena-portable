import "server-only";
import { cache } from "react";
import { openDb, type Db } from "@athena/demo-kit/db";

import { settlingCredit, type SettlingCredit } from "./chase";
import { APP_ID, DETAIL_CANDIDATES, LINE_SUGGESTIONS, TODAY, type Period } from "./constants";
import { inPeriodClient as inPeriod } from "./filter-period";
import { resolveInvoiceRef, type Resolved } from "./invoice-ref";
import {
  reconcile,
  type CreditReading,
  type Offer,
  type ReconcileInvoice,
  type Reconciliation,
} from "./reconcile";
import { seed } from "./seed";
import type {
  BankLine,
  ClaimedBy,
  Client,
  Invoice,
  InvoiceDetail,
  InvoiceLine,
  InvoiceRow,
  InvoiceState,
  Match,
  MatchCandidate,
  Payment,
  PeriodSummary,
  Reminder,
  Standing,
} from "./types";

export { APP_ID };

export function db(): Db {
  return openDb(APP_ID, { seed });
}

const ROW_SQL = `
SELECT i.*, c.name AS client_name, c.contact AS client_contact, c.email AS client_email,
       c.bank_alias AS client_bank_alias,
       (SELECT COALESCE(SUM(p.amount_cents), 0) FROM payments p WHERE p.invoice_id = i.id) AS paid_cents,
       (SELECT MAX(p.paid_at) FROM payments p WHERE p.invoice_id = i.id) AS last_payment_at,
       (SELECT COUNT(*) FROM matches m WHERE m.invoice_id = i.id) AS matched_lines,
       (SELECT COUNT(*) FROM reminders r WHERE r.invoice_id = i.id AND r.sent_at IS NOT NULL) AS reminders_sent,
       (SELECT COUNT(*) FROM reminders r WHERE r.invoice_id = i.id AND r.sent_at IS NULL) AS drafts
FROM invoices i JOIN clients c ON c.id = i.client_id
`;

interface RawRow extends Invoice {
  client_name: string;
  client_contact: string;
  client_email: string;
  client_bank_alias: string | null;
  paid_cents: number;
  last_payment_at: string | null;
  matched_lines: number;
  reminders_sent: number;
  drafts: number;
}

function stateOf(row: RawRow, balance: number, overdueDays: number): InvoiceState {
  if (row.status === "void") return "void";
  if (row.status === "draft") return "draft";
  if (row.status === "disputed") return "disputed";
  if (balance <= 0) return "paid";
  if (row.paid_cents > 0) return "partial";
  return overdueDays > 0 ? "overdue" : "open";
}

/**
 * Bank lines nobody has applied to an invoice yet - the pool every match is drawn from.
 *
 * Memoised for the life of one request. A Next layout and its page are separate server
 * components with no shared memo, so the shipped route asked for this pool - and for the full
 * scoring pass below - twice over, six reads each. `cache()` is scoped to the request, these are
 * synchronous side-effect-free reads of a per-request-consistent handle, and every server action
 * writes and returns without reading again, so memoising is behaviour-preserving. It also closes a
 * smaller gap: the books BooksTools registers on document.modelContext (`buildBooks`) and the
 * sheet the Lanes render (`buildSheet`) now come from one read of the database rather than two.
 */
export const unappliedLines = cache((): BankLine[] =>
  db().all<BankLine>(
    `SELECT * FROM bank_lines WHERE id NOT IN (SELECT line_id FROM matches)
     ORDER BY posted_at DESC`,
  ),
);

/** A row before the reconciliation has been asked how many credits it is offered. */
type BaseRow = Omit<InvoiceRow, "candidate_count">;

function toRow(raw: RawRow): BaseRow {
  const balance = raw.status === "void" ? 0 : raw.amount_cents - raw.paid_cents;
  // The AGE OF THE DEBT, not a chase flag. Gating this on `sent` meant a disputed invoice 72 days
  // past due reported 0, so the aging report filed it under "Within terms", the overdue filter
  // could not see it and overdue_cents excluded it. Whether to chase is a separate question, and
  // it is now asked where chasing happens (`draftReminderAction`) against `state`.
  const overdueDays =
    raw.status !== "void" && raw.status !== "draft" && balance > 0
      ? Math.max(0, daysPast(raw.due_at))
      : 0;
  const state = stateOf(raw, balance, overdueDays);
  return {
    ...raw,
    balance_cents: balance,
    state,
    days_overdue: overdueDays,
    has_draft_reminder: raw.drafts > 0,
    // Stated once, here, so the chase beat reads a number rather than dividing two of them. The
    // threshold that turns it into a judgement stays in `isMostlyPaid`; this is the raw signal.
    paid_ratio: Math.round((raw.paid_cents / Math.max(1, raw.amount_cents)) * 100) / 100,
  };
}

function daysPast(iso: string): number {
  return Math.floor((Date.parse(TODAY) - Date.parse(iso)) / 86_400_000);
}

/** Every invoice, enriched except for its credit count - the reconciliation's input. */
const baseRows = cache((): BaseRow[] =>
  db()
    .all<RawRow>(`${ROW_SQL} ORDER BY i.due_at ASC`)
    .map(toRow),
);

function scoreInput(row: BaseRow): ReconcileInvoice {
  return {
    id: row.id,
    invoice: row,
    clientName: row.client_name,
    balanceCents: row.balance_cents,
    alias: row.client_bank_alias,
  };
}

/**
 * The one reconciliation table for this request (`lib/reconcile.ts`): every invoice that takes a
 * credit against every unapplied credit, scored once. The row's `candidate_count`, the card's
 * candidates, `lineSuggestions` and `unappliedCredits` all read it, so no two of them can judge
 * the same credit differently. It is built from the rows BEFORE their count, which is what lets
 * the count read it without a cycle.
 */
export const reconciliation = cache((): Reconciliation =>
  reconcile(baseRows().filter(takesCredit).map(scoreInput), unappliedLines()),
);

/**
 * Every credit the table offers this invoice, each as the credit's whole reading - its other
 * contenders included - best first. What the chase verdict (`lib/chase.ts`) is asked against.
 */
export function chaseCredits(invoiceId: string): CreditReading[] {
  const table = reconciliation();
  return table.byInvoice(invoiceId).flatMap((o) => table.byCredit(o.line.id) ?? []);
}

/**
 * The invoices the statement looks to have paid: invoice id -> the strong, unambiguous credit whose
 * best fit it is. One pass over the table, for the sheet's status sentences; the actions ask
 * `chaseCredits` for the one invoice they act on, through the same `settlingCredit` rule.
 */
export const settlingCredits = cache((): Map<string, SettlingCredit> => {
  const byTop = new Map<string, CreditReading[]>();
  for (const reading of reconciliation().credits) {
    const top = reading.offers[0];
    if (!top) continue;
    byTop.set(top.invoice_id, [...(byTop.get(top.invoice_id) ?? []), reading]);
  }
  const out = new Map<string, SettlingCredit>();
  for (const [invoiceId, readings] of byTop) {
    const best = [...readings].sort((a, b) => (b.offers[0]?.score ?? 0) - (a.offers[0]?.score ?? 0));
    const credit = settlingCredit({ id: invoiceId }, best);
    if (credit) out.set(invoiceId, credit);
  }
  return out;
});

/** How many credits the table offers this invoice: its best fit, or a real contender, for each. */
function withCount(row: BaseRow): InvoiceRow {
  return { ...row, candidate_count: takesCredit(row) ? reconciliation().byInvoice(row.id).length : 0 };
}

/**
 * Every invoice, enriched. 120 rows: cheap enough to score matches for all of them at once - once
 * being the operative word, which is what the request-scoped memo enforces.
 */
export const listInvoices = cache((): InvoiceRow[] => baseRows().map(withCount));

/**
 * An invoice reference, id or number, resolved to the id. The one lookup every action goes through;
 * the rule itself is `resolveInvoiceRef`, shared with the page's own tools.
 */
export function resolveInvoice(ref: unknown): Resolved {
  return resolveInvoiceRef(ref, db().all<{ id: string; number: string }>("SELECT id, number FROM invoices"));
}

export function findInvoiceId(ref: unknown): string | undefined {
  const r = resolveInvoice(ref);
  return r.ok ? r.id : undefined;
}

export function getInvoice(id: string): InvoiceRow | undefined {
  const raw = db().get<RawRow>(`${ROW_SQL} WHERE i.id = ?`, [id]);
  return raw ? withCount(toRow(raw)) : undefined;
}

export function getInvoiceDetail(id: string): InvoiceDetail | undefined {
  const invoice = getInvoice(id);
  if (!invoice) return undefined;
  const handle = db();
  const client = handle.get<Client>("SELECT * FROM clients WHERE id = ?", [invoice.client_id]);
  if (!client) return undefined;

  const matches = handle
    .all<Match & BankLine>(
      `SELECT m.invoice_id, m.line_id, m.matched_at, m.actor, m.evidence,
              b.id, b.posted_at, b.memo, b.amount_cents, b.direction, b.source_file
       FROM matches m JOIN bank_lines b ON b.id = m.line_id
       WHERE m.invoice_id = ? ORDER BY b.posted_at ASC`,
      [id],
    )
    .map((r) => ({
      invoice_id: r.invoice_id,
      line_id: r.line_id,
      matched_at: r.matched_at,
      actor: r.actor,
      evidence: r.evidence,
      line: {
        id: r.id,
        posted_at: r.posted_at,
        memo: r.memo,
        amount_cents: r.amount_cents,
        direction: r.direction,
        source_file: r.source_file,
      },
    }));

  return {
    invoice,
    client,
    lines: handle.all<InvoiceLine>("SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY id", [id]),
    payments: handle.all<Payment>("SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_at", [id]),
    matches,
    candidates: takesCredit(invoice)
      ? reconciliation().byInvoice(id).slice(0, DETAIL_CANDIDATES).map(toCandidate)
      : [],
    reminders: handle.all<Reminder>(
      "SELECT * FROM reminders WHERE invoice_id = ? ORDER BY created_at DESC",
      [id],
    ),
  };
}

export const listClients = cache((): Client[] =>
  db().all<Client>("SELECT * FROM clients ORDER BY name"),
);

export { inPeriodClient as inPeriod } from "./filter-period";

/**
 * States that are not billings and not debts, so no total counts them. A void invoice was
 * withdrawn; a draft was never sent, so nobody has been asked for the money. One list, two
 * readers - `summarize` here and `exportSummaryAction`'s own outstanding table.
 */
export const COUNTED_OUT: InvoiceState[] = ["void", "draft"];

/**
 * Whether a credit may be offered against this invoice: something is owed, and it is a debt at
 * all. It decides which invoices enter the one reconciliation table, so the row's
 * `candidate_count`, `lineSuggestions` and the card's `getInvoiceDetail` all inherit it - the card
 * used to ask only about the balance and offered a draft the credit its own row said it had none
 * of.
 */
function takesCredit(row: { state: InvoiceState; balance_cents: number }): boolean {
  return row.balance_cents > 0 && !COUNTED_OUT.includes(row.state);
}

/**
 * The numbers `export_summary`, `read_books` and the mast's close readout all read from. Memoised
 * per period.
 *
 * All four figures are ACCRUAL and describe the same set of invoices: those issued in the period,
 * excluding COUNTED_OUT. `collected_cents` used to be the odd one - a cash-basis sum of every
 * payment that arrived in the window whatever it was for, with no join to invoices and neither
 * exclusion - so on a month it disagreed with its neighbours by most of its own value while the
 * four printed side by side under one heading in the export and the reports row. On the quarter the
 * two bases coincide, which is why the default view never showed it.
 *
 * So `collected_cents` is every payment recorded against those invoices, WHENEVER it arrived. It
 * used to keep a second filter on the payment's own date, which made it neither basis: a June
 * invoice paid in July left June's Collected and joined no other month's, and June's close printed
 * Invoiced $1,594,825 over Collected $40,357 and Outstanding $916,816 - $637,652 short of adding up.
 * Accrual means invoiced = collected + outstanding on every period, and the test pins exactly that.
 */
export const summarize = cache((period: Period): PeriodSummary => {
  const rows = listInvoices().filter((r) => inPeriod(r.issued_at, period) && !COUNTED_OUT.includes(r.state));
  const lines = unappliedLines().filter((l) => l.direction === "in" && inPeriod(l.posted_at, period));
  const overdue = rows.filter((r) => r.days_overdue > 0);
  const collected = db()
    .all<{ amount_cents: number; issued_at: string; status: Invoice["status"] }>(
      `SELECT p.amount_cents, i.issued_at, i.status
       FROM payments p JOIN invoices i ON i.id = p.invoice_id`,
    )
    .filter((p) => inPeriod(p.issued_at, period) && p.status !== "void" && p.status !== "draft")
    .reduce((sum, p) => sum + p.amount_cents, 0);

  return {
    period,
    invoice_count: rows.length,
    invoiced_cents: rows.reduce((s, r) => s + r.amount_cents, 0),
    collected_cents: collected,
    outstanding_cents: rows.reduce((s, r) => s + r.balance_cents, 0),
    overdue_cents: overdue.reduce((s, r) => s + r.balance_cents, 0),
    overdue_count: overdue.length,
    unmatched_lines: lines.length,
    unmatched_cents: lines.reduce((s, l) => s + l.amount_cents, 0),
    disputed_count: rows.filter((r) => r.state === "disputed").length,
  };
});

export interface LineSuggestion {
  invoice_id: string;
  number: string;
  client_name: string;
  score: number;
  confidence: "strong" | "likely" | "weak";
  evidence: string[];
  /** Cents this credit falls short of that invoice's balance. Absent when it covers it. */
  short_by_cents?: number;
  /** The trading name the memo used for that client, when it used one. */
  counterparty_alias?: string;
  /**
   * Where this invoice stands for the credit (`lib/reconcile.ts`). A `claimed_elsewhere` entry is
   * listed so a person can see what else the credit nearly fit; it is never offered on that
   * invoice's own side, and `claimed_by` names the invoice the credit plainly belongs to.
   */
  standing: Standing;
  claimed_by?: ClaimedBy;
}

/** A reconciled offer as the invoice's card holds it: the candidate, without the credit's side. */
function toCandidate(o: Offer): MatchCandidate {
  return {
    line: o.line,
    score: o.score,
    confidence: o.confidence,
    evidence: o.evidence,
    ...(o.short_by_cents !== undefined ? { short_by_cents: o.short_by_cents } : {}),
    ...(o.counterparty_alias !== undefined ? { counterparty_alias: o.counterparty_alias } : {}),
    standing: o.standing,
  };
}

function toSuggestion(o: Offer): LineSuggestion {
  return {
    invoice_id: o.invoice_id,
    number: o.number,
    client_name: o.client_name,
    score: o.score,
    confidence: o.confidence,
    evidence: o.evidence,
    ...(o.short_by_cents !== undefined ? { short_by_cents: o.short_by_cents } : {}),
    ...(o.counterparty_alias !== undefined ? { counterparty_alias: o.counterparty_alias } : {}),
    standing: o.standing,
    ...(o.claimed_by ? { claimed_by: o.claimed_by } : {}),
  };
}

/**
 * One unapplied credit as the reconciliation beat needs it (design 4.6.1): the line, the invoices
 * it could belong to, and the two things a caller must not have to infer - whether the top two
 * candidates are too close to choose between, and the trading name it arrived under.
 *
 * `ambiguous` is the app's judgement, not the agent's: `isAmbiguous` is one threshold in
 * `lib/match.ts` and it is applied here, so the strip's coin, the detail pane and `read_credits`
 * all stop and ask on the same credit rather than three different ones.
 */
export interface CreditView {
  line: BankLine;
  suggestions: LineSuggestion[];
  ambiguous: boolean;
  counterparty_alias: string | null;
  /** Shortfall against the best candidate, when there is one and it falls short. */
  short_by_cents: number | null;
}

/**
 * The credit's side of the one table: for every credit nobody has applied, which invoices could it
 * belong to? `read_credits` needs this to offer a match per credit, and it is where the
 * deliberately ambiguous seed rows show up - two open invoices tying for the same credit.
 *
 * Cut at LINE_SUGGESTIONS, but never below the invoices the credit is OFFERED to: a cut of 3 here
 * against 5 on the card meant a credit with four contenders was counted by a row whose
 * `read_invoice` could not see it.
 */
export const lineSuggestions = cache((): Record<string, LineSuggestion[]> => {
  const out: Record<string, LineSuggestion[]> = {};
  for (const { line, offers } of reconciliation().credits) {
    const offered = offers.filter((o) => o.standing !== "claimed_elsewhere").length;
    out[line.id] = offers.slice(0, Math.max(LINE_SUGGESTIONS, offered)).map(toSuggestion);
  }
  return out;
});

/**
 * Every unapplied incoming credit, with its candidates and the two judgements above. Newest first,
 * the order the statement lane shows them in.
 */
export const unappliedCredits = cache((): CreditView[] => {
  const suggestions = lineSuggestions();
  return reconciliation().credits.map(({ line, ambiguous }) => {
    const hits = suggestions[line.id] ?? [];
    const best = hits[0];
    return {
      line,
      suggestions: hits,
      ambiguous,
      counterparty_alias: best?.counterparty_alias ?? null,
      short_by_cents: best?.short_by_cents ?? null,
    };
  });
});

import "server-only";
import { cache } from "react";
import { openDb, type Db } from "@athena/demo-kit/db";

import { APP_ID, DETAIL_CANDIDATES, LINE_SUGGESTIONS, TODAY, type Period } from "./constants";
import { inPeriodClient as inPeriod } from "./filter-period";
import { candidatesFor, isAmbiguous, scoreCandidate } from "./match";
import { seed } from "./seed";
import type {
  BankLine,
  Client,
  Invoice,
  InvoiceDetail,
  InvoiceLine,
  InvoiceRow,
  InvoiceState,
  Match,
  Payment,
  PeriodSummary,
  Reminder,
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
 * smaller gap: the props StripTools registers on document.modelContext and the props EdgeHome
 * renders now come from one read of the database rather than two.
 */
export const unappliedLines = cache((): BankLine[] =>
  db().all<BankLine>(
    `SELECT * FROM bank_lines WHERE id NOT IN (SELECT line_id FROM matches)
     ORDER BY posted_at DESC`,
  ),
);

function toRow(raw: RawRow, pool: BankLine[]): InvoiceRow {
  const balance = raw.status === "void" ? 0 : raw.amount_cents - raw.paid_cents;
  // The AGE OF THE DEBT, not a chase flag. Gating this on `sent` meant a disputed invoice 72 days
  // past due reported 0, so the aging report filed it under "Within terms", the overdue filter
  // could not see it and overdue_cents excluded it. Whether to chase is a separate question, and
  // it is now asked where chasing happens (Chase.tsx, draftReminderAction) against `state`.
  const overdueDays =
    raw.status !== "void" && raw.status !== "draft" && balance > 0
      ? Math.max(0, daysPast(raw.due_at))
      : 0;
  const candidates =
    balance > 0 && raw.status !== "void" && raw.status !== "draft"
      ? candidatesFor(
          { invoice: raw, clientName: raw.client_name, balanceCents: balance, alias: raw.client_bank_alias },
          pool,
        )
      : [];
  return {
    ...raw,
    balance_cents: balance,
    state: stateOf(raw, balance, overdueDays),
    days_overdue: overdueDays,
    candidate_count: candidates.length,
    has_draft_reminder: raw.drafts > 0,
    // Stated once, here, so the chase beat reads a number rather than dividing two of them. The
    // threshold that turns it into a judgement stays in `isMostlyPaid`; this is the raw signal.
    paid_ratio: Math.round((raw.paid_cents / Math.max(1, raw.amount_cents)) * 100) / 100,
  };
}

function daysPast(iso: string): number {
  return Math.floor((Date.parse(TODAY) - Date.parse(iso)) / 86_400_000);
}

/**
 * Every invoice, enriched. 120 rows: cheap enough to score matches for all of them at once - once
 * being the operative word, which is what the request-scoped memo enforces.
 */
export const listInvoices = cache((): InvoiceRow[] => {
  const pool = unappliedLines();
  return db()
    .all<RawRow>(`${ROW_SQL} ORDER BY i.due_at ASC`)
    .map((raw) => toRow(raw, pool));
});

export function getInvoice(id: string): InvoiceRow | undefined {
  const raw = db().get<RawRow>(`${ROW_SQL} WHERE i.id = ?`, [id]);
  return raw ? toRow(raw, unappliedLines()) : undefined;
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
    candidates:
      invoice.balance_cents > 0
        ? candidatesFor(
            {
              invoice,
              clientName: invoice.client_name,
              balanceCents: invoice.balance_cents,
              alias: invoice.client_bank_alias,
            },
            unappliedLines(),
          ).slice(0, DETAIL_CANDIDATES)
        : [],
    reminders: handle.all<Reminder>(
      "SELECT * FROM reminders WHERE invoice_id = ? ORDER BY created_at DESC",
      [id],
    ),
  };
}

export function listBankLines(): BankLine[] {
  return db().all<BankLine>("SELECT * FROM bank_lines ORDER BY posted_at DESC");
}

/** Which invoice each bank line is applied to, for the statement view. */
export function matchIndex(): Record<string, { invoice_id: string; number: string }> {
  const rows = db().all<{ line_id: string; invoice_id: string; number: string }>(
    "SELECT m.line_id, m.invoice_id, i.number FROM matches m JOIN invoices i ON i.id = m.invoice_id",
  );
  const out: Record<string, { invoice_id: string; number: string }> = {};
  for (const r of rows) out[r.line_id] = { invoice_id: r.invoice_id, number: r.number };
  return out;
}

export function getClient(id: string): Client | undefined {
  return db().get<Client>("SELECT * FROM clients WHERE id = ?", [id]);
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
 * The numbers `export_summary` and the reports view both read from. Memoised per period.
 *
 * All four figures are ACCRUAL and describe the same set of invoices: those issued in the period,
 * excluding COUNTED_OUT. `collected_cents` used to be the odd one - a cash-basis sum of every
 * payment that arrived in the window whatever it was for, with no join to invoices and neither
 * exclusion - so on a month it disagreed with its neighbours by most of its own value while the
 * four printed side by side under one heading in the export and the reports row. On the quarter the
 * two bases coincide, which is why the default view never showed it.
 */
export const summarize = cache((period: Period): PeriodSummary => {
  const rows = listInvoices().filter((r) => inPeriod(r.issued_at, period) && !COUNTED_OUT.includes(r.state));
  const lines = unappliedLines().filter((l) => l.direction === "in" && inPeriod(l.posted_at, period));
  const overdue = rows.filter((r) => r.days_overdue > 0);
  const collected = db()
    .all<{ amount_cents: number; paid_at: string; issued_at: string; status: Invoice["status"] }>(
      `SELECT p.amount_cents, p.paid_at, i.issued_at, i.status
       FROM payments p JOIN invoices i ON i.id = p.invoice_id`,
    )
    .filter(
      (p) =>
        inPeriod(p.paid_at, period) &&
        inPeriod(p.issued_at, period) &&
        p.status !== "void" &&
        p.status !== "draft",
    )
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

export function listExports(): { id: string; period: Period; generated_at: string; body: string }[] {
  return db().all("SELECT * FROM exports ORDER BY generated_at DESC LIMIT 10");
}

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
 * The other direction of the same heuristic: for every credit nobody has applied, which invoices
 * could it belong to? The statement view needs this to offer a one-click match, and it is where the
 * deliberately ambiguous seed rows show up - two open invoices tying for the same credit.
 */
export const lineSuggestions = cache((): Record<string, LineSuggestion[]> => {
  const open = listInvoices().filter((r) => r.balance_cents > 0 && r.state !== "void" && r.state !== "draft");
  const out: Record<string, LineSuggestion[]> = {};
  for (const line of unappliedLines()) {
    if (line.direction !== "in") continue;
    const hits: LineSuggestion[] = [];
    for (const inv of open) {
      const scored = scoreCandidate(
        {
          invoice: inv,
          clientName: inv.client_name,
          balanceCents: inv.balance_cents,
          alias: inv.client_bank_alias,
        },
        line,
      );
      if (scored) {
        hits.push({
          invoice_id: inv.id,
          number: inv.number,
          client_name: inv.client_name,
          score: scored.score,
          confidence: scored.confidence,
          evidence: scored.evidence,
          ...(scored.short_by_cents !== undefined ? { short_by_cents: scored.short_by_cents } : {}),
          ...(scored.counterparty_alias !== undefined
            ? { counterparty_alias: scored.counterparty_alias }
            : {}),
        });
      }
    }
    out[line.id] = hits.sort((a, b) => b.score - a.score).slice(0, LINE_SUGGESTIONS);
  }
  return out;
});

/**
 * Every unapplied incoming credit, with its candidates and the two judgements above. Newest first,
 * the order the statement lane shows them in.
 */
export const unappliedCredits = cache((): CreditView[] => {
  const suggestions = lineSuggestions();
  return unappliedLines()
    .filter((l) => l.direction === "in")
    .map((line) => {
      const hits = suggestions[line.id] ?? [];
      const best = hits[0];
      return {
        line,
        suggestions: hits,
        ambiguous: isAmbiguous(hits),
        counterparty_alias: best?.counterparty_alias ?? null,
        short_by_cents: best?.short_by_cents ?? null,
      };
    });
});

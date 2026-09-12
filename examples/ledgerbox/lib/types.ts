/** Row shapes shared between server queries and client components. No server imports here. */
import type { Category, Filter, Period, Tone } from "./constants";

/** What the books say about an invoice once payments are applied. */
export type InvoiceState =
  | "draft"
  | "open"
  | "partial"
  | "paid"
  | "overdue"
  | "disputed"
  | "void";

export interface Client {
  id: string;
  name: string;
  contact: string;
  email: string;
  address: string;
  /** Set when the client moved mid-quarter; older invoices still carry the old address. */
  prior_address: string | null;
  address_changed_at: string | null;
  terms_days: number;
  note: string;
  /** The trading name this client's bank prints, when it is not the name on the invoice. */
  bank_alias: string | null;
}

export interface Invoice {
  id: string;
  number: string;
  client_id: string;
  issued_at: string;
  due_at: string;
  /** Minor units. Money is never a float in this app. */
  amount_cents: number;
  category: Category;
  status: "draft" | "sent" | "disputed" | "void";
  dispute_note: string | null;
  note: string;
}

export interface InvoiceLine {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_cents: number;
  amount_cents: number;
}

export interface Payment {
  id: string;
  invoice_id: string;
  paid_at: string;
  amount_cents: number;
  method: "transfer" | "card" | "cash";
  note: string;
}

export interface BankLine {
  id: string;
  posted_at: string;
  /** Verbatim from the imported statement, mangling and all. */
  memo: string;
  amount_cents: number;
  direction: "in" | "out";
  source_file: string;
}

export interface Match {
  invoice_id: string;
  line_id: string;
  matched_at: string;
  actor: "user" | "athena" | "system";
  evidence: string;
}

export interface Reminder {
  id: string;
  invoice_id: string;
  tone: Tone;
  /** Where the send goes. Stored, not re-derived, so a sent row records who it actually reached. */
  recipient: string;
  subject: string;
  body: string;
  created_at: string;
  sent_at: string | null;
}

export interface ExportRecord {
  id: string;
  period: Period;
  generated_at: string;
  body: string;
}

/** One inbox row: the invoice plus everything the list needs, computed once on the server. */
export interface InvoiceRow extends Invoice {
  client_name: string;
  paid_cents: number;
  balance_cents: number;
  state: InvoiceState;
  days_overdue: number;
  matched_lines: number;
  /** Unapplied bank lines that plausibly belong to this invoice. */
  candidate_count: number;
  reminders_sent: number;
  has_draft_reminder: boolean;
  /** The registry contact this invoice is addressed to - where a reminder would go. */
  client_contact: string;
  client_email: string;
  client_bank_alias: string | null;
  /** `paid_cents / amount_cents`, 0 to 1, two decimals. The partial-payment signal, stated. */
  paid_ratio: number;
  /** The last payment against this invoice, or null. "Paid most of it, then went quiet" needs both. */
  last_payment_at: string | null;
}

export interface InvoiceDetail {
  invoice: InvoiceRow;
  client: Client;
  lines: InvoiceLine[];
  payments: Payment[];
  matches: (Match & { line: BankLine })[];
  candidates: MatchCandidate[];
  reminders: Reminder[];
}

/** A suggested bank line for an invoice, with the reasoning shown to the user. */
export interface MatchCandidate {
  line: BankLine;
  score: number;
  confidence: "strong" | "likely" | "weak";
  /** One clause per signal, e.g. "exact amount". */
  evidence: string[];
  /** Cents the credit falls short of the balance. Absent when it covers it exactly, or over. */
  short_by_cents?: number;
  /** The trading name the memo used instead of the name on the invoice, when it did. */
  counterparty_alias?: string;
}

export interface PeriodSummary {
  period: Period;
  invoiced_cents: number;
  collected_cents: number;
  outstanding_cents: number;
  overdue_cents: number;
  overdue_count: number;
  unmatched_lines: number;
  unmatched_cents: number;
  disputed_count: number;
  invoice_count: number;
}

export interface FilterCounts {
  all: number;
  overdue: number;
  unmatched: number;
  disputed: number;
}

export type { Category, Filter, Period, Tone };

/** Every server action answers in this shape so the client can toast one way. */
export interface ActionResult {
  ok: boolean;
  message: string;
}

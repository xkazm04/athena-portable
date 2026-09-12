/** The props the surfaces receive. Route files read the books and build these. */
import type { ActivityEntry } from "@athena/demo-kit/activity";
import type { Period } from "@/lib/constants";
import type { LineSuggestion } from "@/lib/db";
import type {
  BankLine,
  ExportRecord,
  FilterCounts,
  InvoiceDetail,
  InvoiceRow,
  PeriodSummary,
} from "@/lib/types";

export interface ShellCounts {
  all: number;
  /** The period the two overdue figures below cover. The ticker states it. */
  period: Period;
  overdue: number;
  overdueCents: number;
  unmatched: number;
  disputed: number;
}

export interface InboxProps {
  rows: InvoiceRow[];
  counts: FilterCounts;
  summaries: Record<Period, PeriodSummary>;
  /** Incoming bank lines nobody has applied, newest first. */
  credits: BankLine[];
  /** Which open invoices each credit could belong to. */
  suggestions: Record<string, LineSuggestion[]>;
}

export interface InvoiceProps {
  detail: InvoiceDetail;
}

export interface BankProps {
  lines: BankLine[];
  applied: Record<string, { invoice_id: string; number: string }>;
  suggestions: Record<string, LineSuggestion[]>;
}

export interface ReportsProps {
  summaries: Record<Period, PeriodSummary>;
  rows: InvoiceRow[];
  exports: ExportRecord[];
}

export interface ActivityProps {
  entries: ActivityEntry[];
  onUndo: (id: number) => Promise<{ ok: boolean; reason?: string }>;
}

export type { LineSuggestion };

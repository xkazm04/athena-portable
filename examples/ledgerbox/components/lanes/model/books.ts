/**
 * What the books' own tool layer reads, computed once on the server and handed down beside the
 * sheet.
 *
 * The sheet is the PICTURE — lanes, marks, geometry. This is the LEDGER: the rows, the statement,
 * the client book and the period totals, in the same shapes `lib/db.ts` already returns them.
 * `BooksTools` needs both, because a tool that opens an invoice moves the picture and a tool that
 * reads the credits answers from the ledger.
 *
 * Client-safe: types only. `CreditView` and `LineSuggestion` are imported as types from `lib/db`,
 * which is a server module — the import is erased, and nothing here pulls the database into the
 * browser bundle.
 */
import type { CreditView, LineSuggestion } from "@/lib/db";
import type { Period } from "@/lib/constants";
import type { Client, InvoiceRow, PeriodSummary } from "@/lib/types";

export interface LnBooks {
  rows: InvoiceRow[];
  /** Unapplied incoming credits, each already carrying its candidates and the two judgements. */
  credits: CreditView[];
  /** Candidate invoices per bank line id. */
  suggestions: Record<string, LineSuggestion[]>;
  summaries: Record<Period, PeriodSummary>;
  clients: Client[];
}

/** The inbox filter predicates, client-safe, so the list and the readables never disagree. */
import type { Filter } from "./constants";
import type { FilterCounts, InvoiceRow } from "./types";

export function matchesFilterClient(row: InvoiceRow, filter: Filter): boolean {
  switch (filter) {
    case "overdue":
      return row.days_overdue > 0;
    case "unmatched":
      return row.balance_cents > 0 && row.candidate_count > 0;
    case "disputed":
      return row.state === "disputed";
    default:
      return true;
  }
}

/**
 * Paid most of it and went quiet. Chasing the remainder is the wrong move, and README.md names
 * that judgement as the one the demo exists to make - so it is one predicate with one threshold,
 * read by both designs and both tool layers rather than each deriving the ratio for itself.
 */
export const MOSTLY_PAID_RATIO = 0.7;

export function isMostlyPaid(row: { paid_cents: number; amount_cents: number }): boolean {
  return row.paid_cents > 0 && row.paid_cents / Math.max(1, row.amount_cents) >= MOSTLY_PAID_RATIO;
}

export function countByFilter(rows: InvoiceRow[]): FilterCounts {
  return {
    all: rows.length,
    overdue: rows.filter((r) => matchesFilterClient(r, "overdue")).length,
    unmatched: rows.filter((r) => matchesFilterClient(r, "unmatched")).length,
    disputed: rows.filter((r) => matchesFilterClient(r, "disputed")).length,
  };
}

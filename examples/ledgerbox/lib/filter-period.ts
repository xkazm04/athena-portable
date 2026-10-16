/** Period membership, client-safe. `db.ts` re-exports this one function as `inPeriod`. */
import { QUARTER_FIRST_MONTH, QUARTER_LAST_MONTH, type Period } from "./constants";

/*
 * The quarter bounds are DERIVED from `MONTHS`, not restated. The literals that used to sit here
 * were the load-bearing copy of the boundary: every period read runs through this one function
 * (`summarize`'s three filters in db.ts, and `exportSummaryAction`'s outstanding table), and every
 * one of them returns empty - with no exception raised - if these bounds and the seed disagree.
 */
export function inPeriodClient(iso: string, period: Period): boolean {
  return period === "quarter"
    ? iso >= QUARTER_FIRST_MONTH && iso.slice(0, 7) <= QUARTER_LAST_MONTH
    : iso.startsWith(period);
}

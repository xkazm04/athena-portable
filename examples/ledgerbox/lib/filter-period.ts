/** Period membership, client-safe. `db.ts` has the same rule for the server side of the books. */
import { QUARTER_FIRST_MONTH, QUARTER_LAST_MONTH, type Period } from "./constants";

/*
 * The quarter bounds are DERIVED from `MONTHS`, not restated. The literals that used to sit here
 * were the load-bearing copy of the boundary: six read paths run through this one function
 * (db.ts:6 and :189, summarize's three filters, app/actions.ts:364, aging.ts:24), and every one of
 * them returns empty - with no exception raised - if these bounds and the seed disagree.
 */
export function inPeriodClient(iso: string, period: Period): boolean {
  return period === "quarter"
    ? iso >= QUARTER_FIRST_MONTH && iso.slice(0, 7) <= QUARTER_LAST_MONTH
    : iso.startsWith(period);
}

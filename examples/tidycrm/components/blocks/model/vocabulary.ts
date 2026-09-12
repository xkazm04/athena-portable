/**
 * Finding a zone or a block by id, and what a passing check says.
 *
 * `CLEAR_CLAUSE` is the half of the check print that is easy to forget: a check
 * that only speaks when it fails cannot tell a reader the difference between
 * "clean" and "never looked at", so every one of the four states the clause it
 * satisfied.
 */

import type { DeviationKind } from "./deviations";
import type { BkTable } from "./tables";
import type { BkSheet, BkZone } from "./zones";

/* ------------------------------------------------------------- vocabulary */

/**
 * The three level names, L0 first.
 *
 * Declared once because two places print them: the level rail (`sheet/Bar.tsx`)
 * and `read_view`'s `level_name` (`tools/BlocksTools.tsx`, through the kit's
 * `levels` field). The kit asks for exactly that — "the same three words the
 * level rail prints, so an agent and a reader are talking about the same thing"
 * (demo-kit `webmcp/zoomTools.ts`) — and two declarations disagreed on the
 * third word, so a reader was told `One table` while an agent was told
 * `One block`. `table` is the model type's name (`BkTable`); `block` is the
 * reader's, everywhere.
 */
export const BK_LEVELS = ["The plate", "One zone", "One block"] as const;

/**
 * The tone an OUTSTANDING count is drawn in.
 *
 * A colour is a claim and a zero makes none, so an outstanding count is redline
 * above zero and graphite at it (`sheet/Head.tsx` states the rule). Green is
 * spent only where a check actually passed — blocks fully checked, a coverage
 * of 100% — and never on a nought, which read as "all clear" when it meant
 * "none". The figure is drawn at three levels and used to change colour between
 * them; one predicate is what stops that.
 */
export const outstandingTone = (n: number): "redline" | undefined =>
  n > 0 ? "redline" : undefined;

export function zoneOf(sheet: BkSheet, id: string | null): BkZone | undefined {
  return id ? sheet.zones.find((z) => z.id === id) : undefined;
}

export function tableOf(sheet: BkSheet, id: string | null): BkTable | undefined {
  if (!id) return undefined;
  for (const zone of sheet.zones) {
    const hit = zone.tables.find((t) => t.ident === id);
    if (hit) return hit;
  }
  return undefined;
}

/** What a check-print says when a check PASSES. */
export const CLEAR_CLAUSE: Record<DeviationKind, string> = {
  duplicate: "No unadjudicated identity pair touches this block",
  conflict: "Every record spells the company the same way",
  phone: "Every number is stored as +1XXXXXXXXXX",
  stale: "No record is stale and unflagged",
};

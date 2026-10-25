/**
 * The sheet as one queue, worst first, across every database. Client-safe and pure.
 *
 * The order is the one `search_blocks` has always ranked by: the tables a person is waiting on,
 * then the most outstanding deviations. It lived as a private comparator in `tools/search.ts`, so
 * only an agent could walk it; a person clearing the sheet had to close the dossier, jump database
 * and hunt among the cards for the next one. It lives here now, read by the search, by the
 * dossier's next/previous keys and by the agent's `next_table`, so the three cannot disagree.
 *
 * Ident breaks the last tie, so the list is a total order and does not depend on the order the
 * databases happen to be dealt in (table/sorting: a deterministic order).
 *
 * A step never wraps: the end of the list is something a person should be told, not a jump back
 * to a table they have already cleared. And a step from a table that has LEFT the list (a repair
 * just cleared it, and the server sent a fresh sheet) continues from the slot it held rather than
 * the head, so the walk goes on where the person was (hitl-approval/review-queues).
 */
import type { BkSheet } from "./databases";
import type { BkTable } from "./tables";

/** One table worth a person's attention, and the database it lives in. */
export interface WorkEntry {
  database: string;
  ident: string;
  attention: boolean;
  deviationTotal: number;
}

/** Where a walk stands: the table, and its one-based place in the list it was read from. */
export interface WorkPlace {
  ident: string;
  at: number;
}

/** The next focus a step lands on, and its place in the list. */
export interface WorkStep {
  group: string;
  item: string;
  /** One-based, of `of`. */
  at: number;
  of: number;
}

export type WorkDirection = "next" | "previous";

type Ranked = Pick<BkTable, "attention" | "deviationTotal" | "ident">;

/**
 * Worst first: the ones a person is waiting on, then the most deviations, then ident.
 *
 * Attention leads because it is the only queue on this sheet that no amount of automatic work
 * will shorten.
 */
export function worstFirst(a: Ranked, b: Ranked): number {
  if (a.attention !== b.attention) return a.attention ? -1 : 1;
  if (a.deviationTotal !== b.deviationTotal) return b.deviationTotal - a.deviationTotal;
  return a.ident < b.ident ? -1 : a.ident > b.ident ? 1 : 0;
}

/** Whether a table holds anything for a person to do. */
export function hasWork(t: Pick<BkTable, "attention" | "deviationTotal">): boolean {
  return t.attention || t.deviationTotal > 0;
}

/** Every table with work on it, worst first, across all the databases. */
export function worklistOf(sheet: Pick<BkSheet, "databases">): WorkEntry[] {
  return sheet.databases
    .flatMap((db) =>
      db.tables.filter(hasWork).map((t) => ({
        database: db.id,
        ident: t.ident,
        attention: t.attention,
        deviationTotal: t.deviationTotal,
      })),
    )
    .sort(worstFirst);
}

/**
 * Where a walk stands on `list`, given the open table and where it last stood.
 *
 * In the list: its own place. Gone from it (cleared): the place it was last seen at, so the next
 * step continues from that slot. Never seen: null, and a step starts at the head.
 */
export function placeOf(list: readonly WorkEntry[], ident: string | null, last: WorkPlace | null): WorkPlace | null {
  if (ident === null) return null;
  const at = list.findIndex((e) => e.ident === ident);
  if (at >= 0) return { ident, at: at + 1 };
  return last && last.ident === ident ? last : null;
}

/** One step along the list from `from`, or null at either end. Never wraps. */
export function stepWorklist(
  list: readonly WorkEntry[],
  from: WorkPlace | null,
  dir: WorkDirection,
): WorkStep | null {
  let index: number;
  if (from === null || from.at < 1) {
    index = 0;
  } else {
    const here = list.findIndex((e) => e.ident === from.ident);
    if (here >= 0) index = dir === "next" ? here + 1 : here - 1;
    // Cleared: its successor slid into the slot it held, and its predecessor is one before.
    else index = dir === "next" ? from.at - 1 : from.at - 2;
  }
  const entry = list[index];
  if (index < 0 || !entry) return null;
  return { group: entry.database, item: entry.ident, at: index + 1, of: list.length };
}

import "server-only";

/**
 * The whole print, in nine figures.
 *
 * The one that has to stay separate is `unadjudicated`: it counts open identity
 * pairs, not deviations, and adding the two together would tell a reader that
 * the sheet has one kind of problem when it has two — one a rule can repair and
 * one only a person may settle.
 */
import {
  DEVIATION_KINDS,
  type BkSheet,
  type BkTable,
  type BkZone,
  type DeviationKind,
} from "@/components/blocks/model";

export function sheetTotals(
  zones: BkZone[],
  tables: BkTable[],
  openPairs: { total: number; shown: number },
  revision: number,
): BkSheet {
  const byKind = Object.fromEntries(DEVIATION_KINDS.map((k) => [k, 0])) as Record<
    DeviationKind,
    number
  >;
  for (const table of tables) {
    for (const d of table.deviations) byKind[d.kind] += d.count;
  }

  const records = tables.reduce((n, t) => n + t.records, 0);
  const checked = tables.reduce((n, t) => n + t.checked, 0);

  return {
    zones,
    records,
    checked,
    coverage: records === 0 ? 1 : checked / records,
    unadjudicated: openPairs.total,
    unadjudicatedShown: openPairs.shown,
    deviationTotal: tables.reduce((n, t) => n + t.deviationTotal, 0),
    changed: tables.reduce((n, t) => n + t.changed, 0),
    byKind,
    clearTables: tables.filter((t) => t.deviationTotal === 0).length,
    tableCount: tables.length,
    revision,
  };
}

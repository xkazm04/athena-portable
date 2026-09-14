"use client";

/**
 * The sheet, as L0 needs it, and the sentence the caption prints.
 *
 * One place, because three pictures and one legend all draw the same nine
 * things, and a prototype that computed its own dot list would be a prototype
 * the comparison could not trust. `BkDatabase` carries more than a picture needs
 * — every table's rows, pairs and spellings — so this narrows it to the eight
 * figures and the dots, which is also what keeps the variants' props honest.
 */

import { RecordMark, type BkSheet, type BkTable } from "../model";
import type { L0Cell } from "./contract";

/**
 * The strongest claim on a whole table, as one dot.
 *
 * Gold outranks red, here as everywhere else in the direction: an unadjudicated
 * identity pair is the one thing on this sheet that no automatic act may
 * resolve, and a dot that said "redline" about it would be telling a reader a
 * rule could repair it. `Field.tsx` gives an L1 cell its inner edge by exactly
 * the same order, so the dot a reader chose and the cell they land on agree.
 *
 * WHAT THIS DOES NOT ANSWER, and what `L0Dot.weight` is for: in this seed 43 of
 * the 46 tables touch an open pair, so the colour alone is nearly uniform. HOW
 * MUCH is outstanding is carried by the dot's size instead.
 */
export function markOfTable(table: BkTable): RecordMark {
  if (table.attention) return RecordMark.Unadjudicated;
  if (table.deviationTotal > 0) return RecordMark.Deviates;
  return RecordMark.Clean;
}

export function cellsOf(sheet: BkSheet): L0Cell[] {
  const totals = sheet.databases.map((d) => d.deviationTotal).filter((n) => n > 0);
  /*
   * The wash's scale is the SPREAD between the databases that have outstanding
   * work, not the range from zero. Nine databases carrying 31 to 46 deviations
   * are all within a third of each other, so a share measured against the worst
   * alone puts every one of them between 0.67 and 1 and paints nine tiles the
   * same colour. Measured against the spread, the quietest is the quietest and
   * the worst is the worst, which is the comparison a reader is actually making.
   */
  const worst = totals.length === 0 ? 0 : Math.max(...totals);
  const best = totals.length === 0 ? 0 : Math.min(...totals);
  const worstTable = sheet.databases
    .flatMap((d) => d.tables)
    .reduce((n, t) => Math.max(n, t.deviationTotal), 0);
  return sheet.databases.map((db) => ({
    id: db.id,
    name: db.name,
    blurb: db.blurb,
    tables: db.tables.length,
    records: db.records,
    outstanding: db.deviationTotal,
    faulty: db.faulty,
    attention: db.attention,
    clear: db.clear,
    dots: db.tables.map((t) => ({
      ident: t.ident,
      name: t.name,
      mark: markOfTable(t),
      weight: worstTable === 0 ? 0 : t.deviationTotal / worstTable,
    })),
    share:
      db.deviationTotal === 0 || worst === best ? (db.deviationTotal === 0 ? 0 : 1) : (db.deviationTotal - best) / (worst - best),
  }));
}

/** What the caption says about one database. Pure, so it can be pinned. */
export function databaseSummary(cell: L0Cell): string {
  const tables = `${cell.tables} ${cell.tables === 1 ? "table" : "tables"}`;
  const fault =
    cell.faulty === 0
      ? "no table in fault"
      : `${cell.faulty} of them carrying an outstanding deviation`;
  const awaiting =
    cell.attention === 0
      ? ""
      : `, ${cell.attention} awaiting a person`;
  return `${cell.name} — ${tables}, ${cell.records} records, ${fault}${awaiting}. ${cell.outstanding} deviations outstanding.`;
}

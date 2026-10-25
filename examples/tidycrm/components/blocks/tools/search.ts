/**
 * Search the print, across every database and table at once.
 *
 * Two searches, not one, because this sheet holds two kinds of thing and
 * conflating them is the mistake that matters here. `searchBlocks` answers
 * "which block should I look at". `searchRecords` answers "where is this
 * person" — and it can only see the example rows each block carries, so it says
 * so rather than implying it has read all 800.
 *
 * `awaiting_a_person` is a filter of its own and is never rolled into a
 * deviation count. A rule may repair a deviation; nothing may resolve an
 * identity pair except somebody deciding.
 */
import { bounded } from "@athena/demo-kit/webmcp";

import { worstFirst, type BkDatabase, type BkSheet, type BkTable } from "../model";
import { percent, tableRead } from "./read";

/** Results returned before a search stops and says how many it left out. */
export const SEARCH_PAGE = 25;

export interface BlocksQuery {
  /** Matched against the table's id, its name, its domain and its why-clause. */
  text?: string;
  database?: string;
  /** Only blocks with at least this many outstanding deviations. */
  deviations_over?: number;
  /** Only blocks whose coverage is at or below this percentage. */
  coverage_under?: number;
  /** Only blocks holding an identity pair nobody has adjudicated. */
  awaiting_a_person?: boolean;
}

function hay(t: BkTable): string {
  return `${t.ident} ${t.name} ${t.domain} ${t.why}`.toLowerCase();
}

function hit(t: BkTable, q: BlocksQuery): boolean {
  if (q.text && !hay(t).includes(q.text.toLowerCase())) return false;
  if (q.deviations_over !== undefined && t.deviationTotal < q.deviations_over) return false;
  // The printed figure, not the raw fraction: see `percent`.
  if (q.coverage_under !== undefined && percent(t.coverage) > q.coverage_under) return false;
  if (q.awaiting_a_person && !t.attention) return false;
  return true;
}

function databasesOf(sheet: BkSheet, id: string | undefined): BkDatabase[] {
  return id && id !== "all" ? sheet.databases.filter((d) => d.id === id) : sheet.databases;
}

export function searchBlocks(sheet: BkSheet, q: BlocksQuery) {
  const databases = databasesOf(sheet, q.database);
  if (databases.length === 0) {
    return {
      ...bounded([], SEARCH_PAGE),
      error: `No database called ${q.database}.`,
      databases: sheet.databases.map((d) => d.id),
    };
  }

  const found = databases
    .flatMap((db) => db.tables.filter((t) => hit(t, q)).map((t) => ({ db, table: t })))
    .sort((a, b) => worstFirst(a.table, b.table)); // `../model/worklist.ts`, the dossier's walk

  return {
    ...bounded(found, SEARCH_PAGE, ({ db, table }) => ({
      ...tableRead(table),
      database: db.id,
    })),
  };
}

/**
 * Find a contact among the example rows the sheet carries.
 *
 * A block sends down a sample of its rows, not all of them, so this can only
 * search what is on the sheet. The result says exactly that, with the number it
 * could not see, rather than letting a caller conclude that a name is absent
 * from the database when it is merely absent from the sample.
 */
export function searchRecords(sheet: BkSheet, text: string, database?: string) {
  const needle = text.toLowerCase();
  const databases = databasesOf(sheet, database);
  const searched = databases.flatMap((d) => d.tables);
  const unseen = searched.reduce((n, t) => n + t.rowsHidden, 0);

  const found = databases.flatMap((d) =>
    d.tables.flatMap((t) =>
      t.rows
        .filter((r) =>
          `${r.name} ${r.email} ${r.company} ${r.title} ${r.city}`.toLowerCase().includes(needle),
        )
        .map((r) => ({
          id: r.id,
          name: r.name,
          email: r.email,
          company: r.company,
          city: r.city,
          in_open_pair: r.inOpenPair,
          table: t.ident,
          database: d.id,
        })),
    ),
  );

  return {
    ...bounded(found, SEARCH_PAGE),
    searched_rows: searched.reduce((n, t) => n + t.rows.length, 0),
    rows_not_on_the_sheet: unseen,
    note: "Each block sends a sample of its rows, so this searches what the sheet carries, not the whole database.",
  };
}

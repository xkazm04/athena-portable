/**
 * Search the print, across every zone and block at once.
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

import type { BkSheet, BkTable, BkZone } from "../model";
import { tableRead } from "./read";

/** Results returned before a search stops and says how many it left out. */
export const SEARCH_PAGE = 25;

export interface BlocksQuery {
  /** Matched against the block's id, its name, its domain and its why-clause. */
  text?: string;
  zone?: string;
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
  if (q.coverage_under !== undefined && t.coverage * 100 > q.coverage_under) return false;
  if (q.awaiting_a_person && !t.attention) return false;
  return true;
}

function zonesOf(sheet: BkSheet, id: string | undefined): BkZone[] {
  return id && id !== "all" ? sheet.zones.filter((z) => z.id === id) : sheet.zones;
}

/**
 * Worst first: the ones a person is waiting on, then the most deviations.
 *
 * Attention leads because it is the only queue on this sheet that no amount of
 * automatic work will shorten.
 */
function worstFirst(a: BkTable, b: BkTable): number {
  if (a.attention !== b.attention) return a.attention ? -1 : 1;
  return b.deviationTotal - a.deviationTotal;
}

export function searchBlocks(sheet: BkSheet, q: BlocksQuery) {
  const zones = zonesOf(sheet, q.zone);
  if (zones.length === 0) {
    return {
      ...bounded([], SEARCH_PAGE),
      error: `No zone called ${q.zone}.`,
      zones: sheet.zones.map((z) => z.id),
    };
  }

  const found = zones
    .flatMap((zone) => zone.tables.filter((t) => hit(t, q)).map((t) => ({ zone, table: t })))
    .sort((a, b) => worstFirst(a.table, b.table));

  return {
    ...bounded(found, SEARCH_PAGE, ({ zone, table }) => ({
      ...tableRead(table),
      zone: zone.id,
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
export function searchRecords(sheet: BkSheet, text: string, zone?: string) {
  const needle = text.toLowerCase();
  const zones = zonesOf(sheet, zone);
  const searched = zones.flatMap((z) => z.tables);
  const unseen = searched.reduce((n, t) => n + t.rowsHidden, 0);

  const found = zones.flatMap((z) =>
    z.tables.flatMap((t) =>
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
          block: t.ident,
          zone: z.id,
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

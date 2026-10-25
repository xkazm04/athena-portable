/**
 * The check print, as an agent reads it.
 *
 * The distinction this file exists to protect is the one the whole direction is
 * about: a **deviation** is something a rule can repair, and an **unadjudicated
 * pair** is something only a person may settle. They are drawn in two different
 * inks for that reason, and they are two different fields here for the same
 * one. An agent that flattens them into "problems" will eventually propose
 * merging two records, which destroys one of them.
 *
 * So `attention` is never folded into `deviations`, and every table that has it
 * says in words what it is waiting for.
 */
import {
  DEVIATION_LABEL,
  ROW_SAMPLE,
  remediesOf,
  type BkDatabase,
  type RemedyKind,
  type BkSheet,
  type BkTable,
} from "../model";

/**
 * A coverage fraction as the whole percentage every read prints.
 *
 * One function, because `search_blocks` filters on the figure a read prints: a filter that
 * compared the raw fraction dropped a table printed at 72 from `coverage_under: 72`.
 */
export const percent = (fraction: number): number => Number((fraction * 100).toFixed(0));

/** One table: what the cell prints, plus why it is marked. */
export function tableRead(table: BkTable) {
  return {
    id: table.ident,
    name: table.name,
    domain: table.domain,
    records: table.records,
    checked: table.checked,
    coverage: percent(table.coverage),
    changed: table.changed,
    deviations: table.deviationTotal,
    by_kind: table.deviations.map((d) => ({
      kind: d.kind,
      label: DEVIATION_LABEL[d.kind],
      count: d.count,
    })),
    // Kept apart from `deviations` on purpose. See the file header.
    awaiting_a_person: table.attention,
    why: table.why,
  };
}

/** One database: the tables it owns, and how much of its work is outstanding. */
export function databaseRead(db: BkDatabase) {
  return {
    id: db.id,
    holds: db.blurb,
    span: db.span,
    tables: db.tables.length,
    records: db.records,
    checked: db.checked,
    coverage: percent(db.coverage),
    changed: db.changed,
    deviations: db.deviationTotal,
    // What fills the cell red on the plate, and therefore what a reader saw
    // before they asked. Kept apart from `deviations`: one is a count of
    // findings, the other a count of tables carrying any.
    tables_in_fault: db.faulty,
    tables_awaiting_a_person: db.attention,
    tables_fully_checked: db.clear,
  };
}

/** The whole plate, which is what L0 is showing. */
export function sheetRead(sheet: BkSheet) {
  return {
    databases: sheet.databases.length,
    tables: sheet.tableCount,
    records: sheet.records,
    coverage: percent(sheet.coverage),
    deviations: sheet.deviationTotal,
    by_kind: Object.entries(sheet.byKind).map(([kind, count]) => ({
      kind,
      label: DEVIATION_LABEL[kind as keyof typeof DEVIATION_LABEL],
      count,
    })),
    records_awaiting_a_person: sheet.unadjudicated,
    // Capped, and therefore announced: the sheet attaches this many pairs to tables, and an
    // agent that adds up the per-table duplicate counts should be told when it will fall short.
    records_awaiting_a_person_shown: sheet.unadjudicatedShown,
    tables_fully_checked: sheet.clearTables,
    rows_changed: sheet.changed,
    revision: sheet.revision,
  };
}

/**
 * One table at full depth: the example rows and the identity pairs.
 *
 * Both are capped where the dossier caps them and both say how many they left
 * out, because a bounded output that does not announce its bound is how an
 * agent comes to believe a table has six records.
 */
export function dossierRead(table: BkTable) {
  return {
    ...tableRead(table),
    example_rows: table.rows.slice(0, ROW_SAMPLE).map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      company: r.company,
      title: r.title,
      city: r.city,
      last_activity: r.lastActivityAt.slice(0, 10),
      phone_well_formed: r.phoneOk,
      stale: r.isStale,
      stale_flagged: r.staleFlagged,
      company_conflict: r.conflict,
      in_open_pair: r.inOpenPair,
      field_changes: r.changed,
    })),
    rows_hidden: table.rowsHidden,
    spellings: table.spellings.map((s) => ({ company: s.company, records: s.n })),
    // Every one of these needs a person. None of them may be resolved by a rule.
    pairs_awaiting_a_person: table.pairs.map((p) => ({
      id: p.id,
      confidence: p.confidence,
      keep: p.keep.id,
      drop: p.drop.id,
      disagreements: p.conflicts.map((c) => ({ field: c.label, keep: c.keep, drop: c.drop })),
    })),
    pairs_hidden: table.pairsHidden,
    // Every target the dossier's buttons fire on, as the calls that carry them out (ADR 0174). The
    // sample above is for reading; these are for acting, and they are the buttons' own lists.
    remedies: remediesOf(table),
  };
}

/** The longest answer `plan_repairs` sends: the catalogue's result cap, under the door's own. */
export const PLAN_PAGE_CHARS = 12_000;
/** What the envelope around the items costs, reserved before any item is packed. */
const ENVELOPE_CHARS = 200;

export interface PlanQuery {
  database?: string;
  kind?: RemedyKind;
  page?: number;
}

/**
 * Every remedy on the sheet, one page at a time, worst work first only in the sense the sheet
 * orders it (database, then table). Pages are packed to `PLAN_PAGE_CHARS` rather than counted, so
 * a page of 500-id batches and a page of pair lists are both one whole JSON answer: a cut answer
 * no longer parses, and the ids an agent was promised go with the tail. The partition is a pure
 * function of the sheet, so page n is the same page on every call against the same sheet.
 */
export function planRepairs(sheet: BkSheet, q: PlanQuery = {}) {
  const all = sheet.databases
    .filter((db) => q.database === undefined || db.id === q.database)
    .flatMap((db) =>
      db.tables.flatMap((t) =>
        remediesOf(t)
          .filter((r) => q.kind === undefined || r.kind === q.kind)
          .map((r) => ({ table: t.ident, database: db.id, ...r })),
      ),
    );
  const pages: (typeof all)[] = [];
  let current: typeof all = [];
  let used = ENVELOPE_CHARS;
  for (const item of all) {
    const cost = JSON.stringify(item).length + 1;
    if (current.length > 0 && used + cost > PLAN_PAGE_CHARS) {
      pages.push(current);
      current = [];
      used = ENVELOPE_CHARS;
    }
    current.push(item);
    used += cost;
  }
  if (current.length > 0) pages.push(current);
  const at = Math.max(0, Math.floor(q.page ?? 0) || 0);
  const items = pages[at] ?? [];
  return {
    showing: items.length,
    of: all.length,
    page: at,
    pages: pages.length,
    next_page: at + 1 < pages.length ? at + 1 : null,
    items,
  };
}

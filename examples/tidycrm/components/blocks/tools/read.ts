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
  type BkDatabase,
  type BkSheet,
  type BkTable,
} from "../model";

/** One table: what the cell prints, plus why it is marked. */
export function tableRead(table: BkTable) {
  return {
    id: table.ident,
    name: table.name,
    domain: table.domain,
    records: table.records,
    checked: table.checked,
    coverage: Number((table.coverage * 100).toFixed(0)),
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
    coverage: Number((db.coverage * 100).toFixed(0)),
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
    coverage: Number((sheet.coverage * 100).toFixed(0)),
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
  };
}

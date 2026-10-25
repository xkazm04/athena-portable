/**
 * Row snapshot and restore for the four tables the write paths touch.
 *
 * A walk is isolated by putting the rows back, not by wrapping it in a transaction: the kit's
 * `withTx` is re-entrant and joins an enclosing one, so a walk inside an outer transaction would
 * see every write as one, and a refusal caught inside it would not roll back what it had written.
 * `sqlite_sequence` comes back too, so the activity and revision ids a replay hands to `undoWrite`
 * are the ids the original walk saw.
 */
import { createHash } from "node:crypto";

import type { Db, SqlValue } from "@athena/demo-kit/db";

export const TABLES = ["contacts", "merge_pairs", "revisions", "activity"] as const;
export type Table = (typeof TABLES)[number];

type Row = Record<string, SqlValue>;

export interface Snapshot {
  rows: Record<Table, Row[]>;
  sequences: { name: string; seq: number }[];
}

function rowsOf(handle: Db, table: Table): Row[] {
  return handle.all<Row>(`SELECT * FROM ${table} ORDER BY id`);
}

export function take(handle: Db): Snapshot {
  const rows = Object.fromEntries(TABLES.map((t) => [t, rowsOf(handle, t)])) as Record<Table, Row[]>;
  const sequences = handle.all<{ name: string; seq: number }>("SELECT name, seq FROM sqlite_sequence ORDER BY name");
  return { rows, sequences };
}

export function restore(handle: Db, snap: Snapshot): void {
  handle.withTx((tx) => {
    // `merged_into` points a contact at another contact; deferring lets the rows land in any order.
    tx.exec("PRAGMA defer_foreign_keys = ON");
    for (const t of ["revisions", "merge_pairs", "activity", "contacts"] as const) tx.run(`DELETE FROM ${t}`);
    for (const t of ["contacts", "merge_pairs", "revisions", "activity"] as const) {
      for (const row of snap.rows[t]) {
        const cols = Object.keys(row);
        tx.run(
          `INSERT INTO ${t} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
          cols.map((c) => row[c] ?? null),
        );
      }
    }
    tx.run("DELETE FROM sqlite_sequence");
    for (const s of snap.sequences) tx.run("INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)", [s.name, s.seq]);
  });
}

/** One table's rows, in id order, as a hash. Two equal digests are two equal tables. */
export function digest(handle: Db, table: Table): string {
  return createHash("sha256").update(JSON.stringify(rowsOf(handle, table))).digest("hex");
}

/** Row count and digest of every table: what "back to the seed" is compared on. */
export function fingerprint(handle: Db): Record<Table, { rows: number; digest: string }> {
  return Object.fromEntries(
    TABLES.map((t) => [
      t,
      { rows: handle.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)?.n ?? 0, digest: digest(handle, t) },
    ]),
  ) as Record<Table, { rows: number; digest: string }>;
}

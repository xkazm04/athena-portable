/**
 * `@athena/demo-kit/activity` - the activity log every host app shares (server-only).
 *
 * One table, identical in all four apps, so the demo can show the same provenance strip whichever
 * domain wins (design 4.6). Athena is already a first-class `actor` even though she has not been
 * onboarded yet - the column exists so Act 1 needs no migration.
 */
import "server-only";
import type { Db } from "../db";

export type { Actor, ActivityEntry, NewActivity } from "./types";
import type { ActivityEntry, NewActivity, Actor } from "./types";

export const ACTIVITY_SCHEMA = `
CREATE TABLE IF NOT EXISTS activity (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT    NOT NULL,
  actor      TEXT    NOT NULL CHECK (actor IN ('user','athena','system')),
  action     TEXT    NOT NULL,
  target     TEXT    NOT NULL,
  summary    TEXT    NOT NULL,
  reversible INTEGER NOT NULL DEFAULT 0 CHECK (reversible IN (0,1)),
  undo_json  TEXT,
  undone     INTEGER NOT NULL DEFAULT 0 CHECK (undone IN (0,1))
);
CREATE INDEX IF NOT EXISTS activity_ts ON activity (ts DESC);
`;

/** Create the shared table. Call this from the app's seed before inserting anything. */
export function createActivityTable(db: Db): void {
  db.exec(ACTIVITY_SCHEMA);
}

interface Row {
  id: number;
  ts: string;
  actor: Actor;
  action: string;
  target: string;
  summary: string;
  reversible: number;
  undo_json: string | null;
  undone: number;
}

function toEntry(row: Row): ActivityEntry {
  return {
    id: row.id,
    ts: row.ts,
    actor: row.actor,
    action: row.action,
    target: row.target,
    summary: row.summary,
    reversible: row.reversible === 1,
    undo: row.undo_json === null ? null : (JSON.parse(row.undo_json) as unknown),
    undone: row.undone === 1,
  };
}

/** Append one entry. Every mutating action in every app must call this. */
export function logActivity(db: Db, entry: NewActivity): ActivityEntry {
  const reversible = entry.reversible === true;
  const ts = entry.ts ?? new Date().toISOString();
  const { lastInsertRowid } = db.run(
    `INSERT INTO activity (ts, actor, action, target, summary, reversible, undo_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      ts,
      entry.actor,
      entry.action,
      entry.target,
      entry.summary,
      reversible ? 1 : 0,
      entry.undo === undefined ? null : JSON.stringify(entry.undo),
    ],
  );
  return {
    id: lastInsertRowid,
    ts,
    actor: entry.actor,
    action: entry.action,
    target: entry.target,
    summary: entry.summary,
    reversible,
    undo: entry.undo ?? null,
    undone: false,
  };
}

/** Newest first. */
export function listActivity(db: Db, limit = 50): ActivityEntry[] {
  return db
    .all<Row>("SELECT * FROM activity ORDER BY id DESC LIMIT ?", [limit])
    .map(toEntry);
}

export function getActivity(db: Db, id: number): ActivityEntry | undefined {
  const row = db.get<Row>("SELECT * FROM activity WHERE id = ?", [id]);
  return row ? toEntry(row) : undefined;
}

export interface UndoResult {
  ok: boolean;
  /** Present when `ok` is false: why the entry could not be undone. */
  reason?: string;
  entry?: ActivityEntry;
}

/**
 * Undo one entry: the app supplies `applyUndo`, which knows how to reverse its own domain writes
 * from the stored `undo` payload. The reversal, the `undone` flag and the compensating log line all
 * land in one transaction.
 */
export function undoActivity(
  db: Db,
  id: number,
  applyUndo: (db: Db, entry: ActivityEntry) => void,
): UndoResult {
  const entry = getActivity(db, id);
  if (!entry) return { ok: false, reason: `no activity #${id}` };
  if (!entry.reversible) return { ok: false, reason: `#${id} (${entry.action}) is not reversible` };
  if (entry.undone) return { ok: false, reason: `#${id} was already undone` };

  return db.withTx((tx) => {
    applyUndo(tx, entry);
    tx.run("UPDATE activity SET undone = 1 WHERE id = ?", [id]);
    logActivity(tx, {
      actor: "user",
      action: "undo",
      target: entry.target,
      summary: `Undid #${entry.id}: ${entry.summary}`,
      reversible: false,
    });
    return { ok: true, entry: { ...entry, undone: true } };
  });
}

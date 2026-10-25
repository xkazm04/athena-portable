/**
 * `@athena/demo-kit/activity` - the activity log every host app shares (server-only).
 *
 * One table, identical in all four apps, so the demo can show the same provenance strip whichever
 * domain wins (design 4.6). Athena is already a first-class `actor` even though she has not been
 * onboarded yet - the column exists so Act 1 needs no migration.
 */
import "server-only";
import type { Db } from "../db";

export type { Actor, ActivityEntry, NewActivity, UndoAnswer, UndoOptions, UndoVerdict } from "./types";
import type { ActivityEntry, NewActivity, Actor, UndoOptions, UndoVerdict } from "./types";

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
  /** With a refusal: the later row `applyUndo` named as standing in the way. */
  blockedBy?: number;
  /** With `ok`: what `applyUndo` could not put back (a partial undo). */
  partial?: string;
  entry?: ActivityEntry;
  /** With `{ through: true }`: the blocking rows undone before this one, in the order undone. */
  alsoUndone?: ActivityEntry[];
}

/** How many blockers `{ through: true }` follows before it stops and refuses. */
const THROUGH_LIMIT = 16;

let savepoints = 0;

/**
 * Run `fn` inside a savepoint and keep its writes only if it says so. A refused verdict must leave
 * nothing behind even when the undo runs inside a caller's transaction, where a thrown sentinel
 * would roll back the caller's work too (`withTx` has no partial inner rollback).
 */
function inSavepoint<T>(tx: Db, fn: () => { keep: boolean; value: T }): T {
  savepoints += 1;
  const name = `dk_undo_${savepoints}`;
  tx.exec(`SAVEPOINT ${name}`);
  let out: { keep: boolean; value: T };
  try {
    out = fn();
  } catch (err) {
    if (tx.raw.isTransaction) tx.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
    throw err;
  }
  tx.exec(out.keep ? `RELEASE ${name}` : `ROLLBACK TO ${name}; RELEASE ${name}`);
  return out.value;
}

function precheck(entry: ActivityEntry | undefined, id: number): UndoResult | null {
  if (!entry) return { ok: false, reason: `no activity #${id}` };
  if (!entry.reversible) return { ok: false, reason: `#${id} (${entry.action}) is not reversible` };
  if (entry.undone) return { ok: false, reason: `#${id} was already undone` };
  return null;
}

/**
 * Undo one entry: the app supplies `applyUndo`, which knows how to reverse its own domain writes
 * from the stored `undo` payload. The reversal, the `undone` flag and the compensating log line all
 * land in one transaction.
 *
 * `applyUndo` answers what it put back (`UndoVerdict`, ADR 0156): nothing returned is a clean undo
 * ("Undid #n"); `{ refused, blockedBy? }` rolls its writes back and leaves the row undoable with no
 * line logged; `{ partial }` marks the row undone with one "Partly undid #n: <partial>" line. With
 * `{ through: true }`, a refusal that names `blockedBy` undoes that row first (and its own blockers,
 * newest first) and then retries this one, all or nothing.
 */
export function undoActivity(
  db: Db,
  id: number,
  applyUndo: (db: Db, entry: ActivityEntry) => UndoVerdict,
  options: UndoOptions = {},
): UndoResult {
  const refused = precheck(getActivity(db, id), id);
  if (refused) return refused;

  return db.withTx((tx) => {
    const done: ActivityEntry[] = [];
    const visited = new Set<number>();

    const attempt = (target: number): UndoResult => {
      const entry = getActivity(tx, target);
      const bad = precheck(entry, target);
      if (bad || !entry) return bad ?? { ok: false, reason: `no activity #${target}` };
      visited.add(target);
      const verdict = inSavepoint(tx, () => {
        const v = applyUndo(tx, entry);
        return { keep: !(v && "refused" in v), value: v };
      });
      if (verdict && "refused" in verdict) {
        const blocker = verdict.blockedBy;
        const follow =
          options.through === true &&
          blocker !== undefined &&
          !visited.has(blocker) &&
          visited.size < THROUGH_LIMIT;
        if (!follow) {
          return { ok: false, reason: verdict.refused, ...(blocker !== undefined ? { blockedBy: blocker } : {}) };
        }
        const cleared = attempt(blocker);
        if (!cleared.ok) return cleared;
        visited.delete(target);
        return attempt(target);
      }
      const partial = verdict && "partial" in verdict ? verdict.partial : undefined;
      tx.run("UPDATE activity SET undone = 1 WHERE id = ?", [target]);
      logActivity(tx, {
        actor: "user",
        action: "undo",
        target: entry.target,
        summary:
          partial === undefined
            ? `Undid #${entry.id}: ${entry.summary}`
            : `Partly undid #${entry.id}: ${partial}`,
        reversible: false,
      });
      const undone = { ...entry, undone: true };
      done.push(undone);
      return { ok: true, entry: undone, ...(partial !== undefined ? { partial } : {}) };
    };

    // The whole chain sits in one savepoint, so a refusal anywhere in it takes back every undo
    // that ran before it, rows and compensating lines included.
    return inSavepoint(tx, () => {
      const result = attempt(id);
      if (!result.ok) return { keep: false, value: result };
      const before = done.slice(0, -1);
      return { keep: true, value: before.length > 0 ? { ...result, alsoUndone: before } : result };
    });
  });
}

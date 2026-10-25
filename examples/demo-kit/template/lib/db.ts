import "server-only";
import { openDb, type Db } from "@athena/demo-kit/db";
import {
  createActivityTable,
  logActivity,
  type ActivityEntry,
  type Actor,
  type UndoVerdict,
} from "@athena/demo-kit/activity";
import { rngFor } from "@athena/demo-kit/seed";

import {
  describeLeftAlone,
  isStatusUndo,
  MAX_ACT_IDS,
  planStatusChange,
  planStatusUndo,
  type StatusSkip,
  type StatusUndo,
} from "./acts";
import { APP_ID } from "./constants";
import { STATUSES, type Record_, type Status } from "./types";

export { APP_ID };

/** The records table. Its status CHECK is written from `STATUSES`, the one list of statuses. */
export const RECORDS_SCHEMA = `
CREATE TABLE IF NOT EXISTS records (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN (${STATUSES.map((s) => `'${s}'`).join(",")})),
  owner      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  note       TEXT NOT NULL
);
`;

/** Deterministic: same rows on every machine, every run. Replace with your domain's seed. */
export function seedRecords(db: Db): void {
  db.exec(RECORDS_SCHEMA);
  createActivityTable(db);

  const rng = rngFor(APP_ID, "records");
  const now = new Date("2026-09-01T00:00:00Z");
  for (let i = 1; i <= 24; i++) {
    const owner = rng.fullName();
    db.run(
      `INSERT INTO records (id, title, status, owner, updated_at, note) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        rng.id("rec", i),
        `${rng.company()} ${rng.pick(["review", "intake", "renewal", "follow-up"])}`,
        rng.pickWeighted([
          ["open", 4],
          ["archived", 1],
        ]),
        owner,
        rng.dateBefore(now, 60),
        rng.sentence(),
      ],
    );
  }

  logActivity(db, {
    actor: "system",
    action: "seed",
    target: "records",
    summary: "Seeded 24 records.",
    reversible: false,
    ts: now.toISOString(),
  });
}

export function db(): Db {
  return openDb(APP_ID, { seed: seedRecords });
}

export function listRecords(status?: Status): Record_[] {
  return status
    ? db().all<Record_>("SELECT * FROM records WHERE status = ? ORDER BY updated_at DESC", [status])
    : db().all<Record_>("SELECT * FROM records ORDER BY updated_at DESC");
}

export function getRecord(id: string): Record_ | undefined {
  return db().get<Record_>("SELECT * FROM records WHERE id = ?", [id]);
}

/** What a status act answers. `undoId` is the activity row `undoAction` takes (ADR 0111). */
export type StatusActResult =
  | { ok: true; summary: string; changed: number; skipped: StatusSkip[]; undoId: number }
  | { ok: false; error: string; skipped: StatusSkip[] };

/**
 * Apply `planStatusChange` and log it: the rows, the one reversible activity row and its undo
 * payload land in one transaction, or nothing does. A refused plan writes nothing at all.
 */
export function setRecordStatus(d: Db, ids: readonly string[], to: unknown, actor: Actor): StatusActResult {
  return d.withTx((tx) => {
    const unique = [...new Set(ids)];
    const rows =
      unique.length === 0 || unique.length > MAX_ACT_IDS
        ? []
        : tx.all<Pick<Record_, "id" | "status">>(
            `SELECT id, status FROM records WHERE id IN (${unique.map(() => "?").join(",")})`,
            unique,
          );
    const plan = planStatusChange(rows, ids, to);
    if (!plan.ok) return plan;
    const at = new Date().toISOString();
    for (const c of plan.changes) {
      tx.run("UPDATE records SET status = ?, updated_at = ? WHERE id = ?", [c.to, at, c.id]);
    }
    const undo: StatusUndo = { kind: "status", changes: plan.changes };
    const entry = logActivity(tx, {
      actor,
      action: "set_record_status",
      target: plan.changes.length === 1 ? `record:${plan.changes[0]!.id}` : `records:${plan.changes.length}`,
      summary: plan.summary,
      reversible: true,
      undo,
      ts: at,
    });
    return { ok: true, summary: plan.summary, changed: plan.changes.length, skipped: plan.skipped, undoId: entry.id };
  });
}

/** The latest live status act after `after` that moved one of `ids`: what would clear the way. */
function laterActOn(tx: Db, after: number, ids: readonly string[]): number | undefined {
  const later = tx.all<{ id: number; undo_json: string | null }>(
    "SELECT id, undo_json FROM activity WHERE id > ? AND action = 'set_record_status' AND undone = 0 ORDER BY id DESC",
    [after],
  );
  const wanted = new Set(ids);
  for (const row of later) {
    const undo: unknown = row.undo_json === null ? null : JSON.parse(row.undo_json);
    if (isStatusUndo(undo) && undo.changes.some((c) => wanted.has(c.id))) return row.id;
  }
  return undefined;
}

/**
 * Reverse a status act, guarded: a record goes back only if it still holds the status the act gave
 * it. Some left alone is a partial undo that names them; all left alone is a refusal naming the
 * later act whose undo would clear the way (`undoActivity(..., { through: true })` takes it).
 */
function undoStatus(tx: Db, entry: ActivityEntry, undo: StatusUndo): UndoVerdict {
  const ids = undo.changes.map((c) => c.id);
  const now = new Map(
    tx
      .all<Pick<Record_, "id" | "status">>(
        `SELECT id, status FROM records WHERE id IN (${ids.map(() => "?").join(",")})`,
        ids,
      )
      .map((r) => [r.id, r.status]),
  );
  const { restore, leftAlone } = planStatusUndo(now, undo.changes);
  if (restore.length === 0) {
    const blockedBy = laterActOn(tx, entry.id, ids);
    return {
      refused: `nothing to put back: a later act moved ${describeLeftAlone(leftAlone)}`,
      ...(blockedBy !== undefined ? { blockedBy } : {}),
    };
  }
  const at = new Date().toISOString();
  for (const r of restore) tx.run("UPDATE records SET status = ?, updated_at = ? WHERE id = ?", [r.to, at, r.id]);
  if (leftAlone.length === 0) return;
  return {
    partial: `put back ${restore.map((r) => r.id).join(", ")}; left ${describeLeftAlone(leftAlone)} alone, a later act moved it`,
  };
}

/**
 * Reverse one logged action. Only the app knows how to undo its own writes, so the reversal lives
 * here and `undoActivity` only handles the bookkeeping. Route on the payload's `kind`; a payload
 * this app does not know is a fault, never a silent success.
 */
export function applyUndo(tx: Db, entry: ActivityEntry): UndoVerdict {
  if (isStatusUndo(entry.undo)) return undoStatus(tx, entry, entry.undo);
  throw new Error(`no undo strategy for ${entry.action}`);
}

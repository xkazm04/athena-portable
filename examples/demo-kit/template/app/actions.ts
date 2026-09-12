"use server";

import { revalidatePath } from "next/cache";
import { undoActivity, type ActivityEntry } from "@athena/demo-kit/activity";
import type { Db } from "@athena/demo-kit/db";
import { db } from "@/lib/db";

/**
 * Reverse one logged action. Only the app knows how to undo its own writes, so the reversal lives
 * here and `undoActivity` only handles the bookkeeping.
 */
function applyUndo(tx: Db, entry: ActivityEntry): void {
  const undo = entry.undo as { table?: string; id?: string; status?: string } | null;
  if (undo?.table === "records" && undo.id && undo.status) {
    tx.run("UPDATE records SET status = ? WHERE id = ?", [undo.status, undo.id]);
    return;
  }
  throw new Error(`no undo strategy for ${entry.action}`);
}

export async function undoAction(id: number): Promise<{ ok: boolean; reason?: string }> {
  const result = undoActivity(db(), id, applyUndo);
  revalidatePath("/activity");
  revalidatePath("/");
  return { ok: result.ok, ...(result.reason ? { reason: result.reason } : {}) };
}

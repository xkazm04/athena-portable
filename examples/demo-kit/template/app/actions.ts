"use server";

import { revalidatePath } from "next/cache";
import { undoActivity, type UndoAnswer, type UndoOptions } from "@athena/demo-kit/activity";
import { applyUndo, db, setRecordStatus, type StatusActResult } from "@/lib/db";

function refresh(): void {
  revalidatePath("/activity");
  revalidatePath("/", "layout");
}

/**
 * Set the status of `ids`. The table's bulk bar, the detail page and the `set_record_status` tool
 * all land here, so a person and an agent take the same act, log the same row and get the same
 * `undoId` back. `actor` is who the activity row credits; anything but `athena` is the user.
 */
export async function setStatusAction(ids: string[], status: string, actor: string = "user"): Promise<StatusActResult> {
  const result = setRecordStatus(db(), Array.isArray(ids) ? ids.map(String) : [], status, actor === "athena" ? "athena" : "user");
  if (result.ok) refresh();
  return result;
}

/**
 * Reverse one logged action. The reversal itself is `applyUndo` in `lib/db.ts`, routed by the
 * payload's kind; `undoActivity` does the bookkeeping. The answer is the kit's `UndoAnswer`, so a
 * guarded undo that left a record alone says so, and a refusal names what stands in the way.
 */
export async function undoAction(id: number, options?: UndoOptions): Promise<UndoAnswer> {
  const result = undoActivity(db(), id, applyUndo, { through: options?.through === true });
  refresh();
  return {
    ok: result.ok,
    ...(result.reason ? { reason: result.reason } : {}),
    ...(result.blockedBy !== undefined ? { blockedBy: result.blockedBy } : {}),
    ...(result.partial !== undefined ? { partial: result.partial } : {}),
  };
}

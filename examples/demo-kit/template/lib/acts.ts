/**
 * The template's one reversible act: change the status of some records. Pure and client-safe -
 * the bulk bar counts its buttons from `planStatusChange`, the server applies the same plan
 * (`setRecordStatus` in `lib/db.ts`), and the `set_record_status` tool is declared here once.
 *
 * This is the shape every mutating capability in a copy should take: a plan that refuses out loud
 * (nothing to change, too many ids) instead of reporting an empty success, one activity row with
 * an `undo` payload, the row's id handed back as `undoId` so the surface that ran the act can offer
 * Undo on the spot, and an undo that restores a record only if it is still where the act left it.
 */
import type { WebMCPToolSpec } from "@athena/demo-kit/webmcp";
import { STATUSES, type Record_, type Status } from "./types";

/** Cap on the ids one act takes. The tool declares it as `maxItems`; the plan enforces it again. */
export const MAX_ACT_IDS = 50;

export interface StatusChange {
  id: string;
  from: Status;
  to: Status;
}

export interface StatusSkip {
  id: string;
  reason: string;
}

export type StatusPlan =
  | { ok: true; to: Status; changes: StatusChange[]; skipped: StatusSkip[]; summary: string }
  | { ok: false; error: string; skipped: StatusSkip[] };

/** The `undo` payload a status act logs; `applyUndo` routes on `kind`. */
export interface StatusUndo {
  kind: "status";
  changes: StatusChange[];
}

const PAST: Record<Status, string> = { open: "Reopened", archived: "Archived" };
const VERB: Record<Status, string> = { open: "Reopen", archived: "Archive" };

export function isStatus(value: unknown): value is Status {
  return (STATUSES as readonly unknown[]).includes(value);
}

const records = (n: number) => `${n} record${n === 1 ? "" : "s"}`;

/** The button for moving one record to `to`: "Archive", "Reopen". */
export function actVerb(to: Status): string {
  return VERB[to];
}

/** The button for moving `n` records to `to`: "Archive 3", "Reopen 1". */
export function actLabel(to: Status, n: number): string {
  return `${VERB[to]} ${n}`;
}

/**
 * What moving `ids` to `to` would do against `rows`: per-id changes, per-id skips with a reason,
 * and a refusal when the call is malformed or nothing would change.
 */
export function planStatusChange(
  rows: readonly Pick<Record_, "id" | "status">[],
  ids: readonly string[],
  to: unknown,
): StatusPlan {
  if (!isStatus(to)) {
    return { ok: false, error: `No status named ${String(to)}. Use one of: ${STATUSES.join(", ")}.`, skipped: [] };
  }
  const unique = [...new Set(ids)];
  if (unique.length === 0) return { ok: false, error: "No records given.", skipped: [] };
  if (unique.length > MAX_ACT_IDS) {
    return {
      ok: false,
      error: `At most ${MAX_ACT_IDS} records per act; ${unique.length} were given. Split the call.`,
      skipped: [],
    };
  }
  const byId = new Map(rows.map((r) => [r.id, r.status]));
  const changes: StatusChange[] = [];
  const skipped: StatusSkip[] = [];
  for (const id of unique) {
    const from = byId.get(id);
    if (from === undefined) skipped.push({ id, reason: `no record ${id}` });
    else if (from === to) skipped.push({ id, reason: `already ${to}` });
    else changes.push({ id, from, to });
  }
  if (changes.length === 0) {
    return {
      ok: false,
      error: `Nothing to change: ${skipped.map((s) => (s.reason.startsWith("no record") ? s.reason : `${s.id} is ${s.reason}`)).join("; ")}.`,
      skipped,
    };
  }
  const tail = skipped.length > 0 ? ` Skipped ${records(skipped.length)}.` : "";
  return { ok: true, to, changes, skipped, summary: `${PAST[to]} ${records(changes.length)}.${tail}` };
}

export function isStatusUndo(undo: unknown): undo is StatusUndo {
  const u = undo as Partial<StatusUndo> | null;
  return u !== null && typeof u === "object" && u.kind === "status" && Array.isArray(u.changes);
}

/**
 * The guarded reversal: restore a record only if it still holds the status the act gave it. A
 * record a later act moved (or that no longer exists) is left alone and named, never overwritten.
 */
export function planStatusUndo(
  now: ReadonlyMap<string, Status>,
  changes: readonly StatusChange[],
): { restore: StatusChange[]; leftAlone: { id: string; now: Status | undefined }[] } {
  const restore: StatusChange[] = [];
  const leftAlone: { id: string; now: Status | undefined }[] = [];
  for (const c of changes) {
    const current = now.get(c.id);
    if (current === c.to) restore.push({ id: c.id, from: c.to, to: c.from });
    else leftAlone.push({ id: c.id, now: current });
  }
  return { restore, leftAlone };
}

/** How an undo names what it left in place: "rec-0001 (now open)". */
export function describeLeftAlone(left: readonly { id: string; now: Status | undefined }[]): string {
  return left.map((l) => `${l.id} (${l.now === undefined ? "no longer exists" : `now ${l.now}`})`).join(", ");
}

/**
 * The `set_record_status` tool, minus its handler. Reversible and `data`: under the kit's rule an
 * AUTO tool, which is honest only because the act logs its undo and the undo is guarded.
 */
export const SET_STATUS_TOOL = {
  name: "set_record_status",
  description: `Set the status of up to ${MAX_ACT_IDS} records at once. Logged to the activity page and undoable; the answer carries undoId. Ids that already have the status are skipped and named.`,
  parameters: [
    {
      name: "ids",
      type: "string[]",
      required: true,
      maxItems: MAX_ACT_IDS,
      description: "Record ids, e.g. from read_selection.",
    },
    { name: "status", type: "string", enum: [...STATUSES], required: true, description: "The status to set." },
  ],
  reversible: true,
  sideEffects: "data",
} satisfies Omit<WebMCPToolSpec, "handler" | "deps">;

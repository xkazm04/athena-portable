/**
 * The way back from an act, as the board offers it. Client-safe and pure.
 *
 * The register in the foot and the reversible zone of the dossier both say every AUTO act writes
 * an undo. They did, and `undoAction` reversed them, but no surface called it: the /activity route
 * that once did was reviewed out, so the remedy for an act the agent ran unattended was a server
 * function nobody could reach. It is reached from two places now, and both are decided here:
 *
 *   - the toast for the act just taken carries an Undo (`toastFor`), and
 *   - the dossier's History band lists the person's acts, each with an Undo or a reason it has
 *     none (`historyRow`, `historyNote`).
 *
 * An act with no way back says why in words rather than drawing a disabled control, because a
 * dead button reads as "not yet" and these are "never".
 */
import type { BdHistoryRow } from "./model";

/** How many acts the History band shows. A band in a reading column, not a log. */
export const HISTORY_SHOWN = 8;

/** The reasons a row carries no Undo, one sentence each. */
export const NO_UNDO = {
  irreversible: "reached the person and cannot be taken back",
  undone: "undone",
  undo: "the undo of an earlier act",
} as const;

/** An activity row, as `lib/queries.ts` hands it over. */
export interface HistoryEntry {
  id: number;
  ts: string;
  action: string;
  summary: string;
  reversible: boolean;
  undone: boolean;
}

/** One row of the band: whether it may be undone, and if not, why not. */
export function historyRow(entry: HistoryEntry): BdHistoryRow {
  const base = {
    id: entry.id,
    ts: entry.ts,
    action: entry.action,
    summary: entry.summary,
    undone: entry.undone,
  };
  // An undo's own row is logged irreversible, but it did not reach anybody: name it for what it is.
  const why = entry.undone
    ? NO_UNDO.undone
    : entry.action === "undo"
      ? NO_UNDO.undo
      : !entry.reversible
        ? NO_UNDO.irreversible
        : null;
  return why ? { ...base, undoable: false, why } : { ...base, undoable: true };
}

/** The band's note when it is not showing everything, and nothing when it is. */
export function historyNote(meta: { history: readonly unknown[]; historyTotal: number }): string | undefined {
  return meta.historyTotal > meta.history.length
    ? `(showing ${meta.history.length} of ${meta.historyTotal})`
    : undefined;
}

export type ToastTone = "success" | "error";

/**
 * What the toast shows for a result: its words, its tone and, when there is one, its way back - the
 * act's Undo, or "Undo both" when a later act stands in front of the one being undone.
 */
export interface ToastSpec {
  text: string;
  tone: ToastTone;
  action?: { label: "Undo"; id: number } | { label: "Undo both"; id: number; through: true };
}

export function toastFor(result: { ok: boolean; message: string; undoId?: number }): ToastSpec {
  const spec: ToastSpec = { text: result.message, tone: result.ok ? "success" : "error" };
  return result.ok && result.undoId !== undefined ? { ...spec, action: { label: "Undo", id: result.undoId } } : spec;
}

/**
 * What the toast shows once an Undo has been pressed: what it put back, and only that (ADR 0156).
 *
 * A refusal says "Not undone" and, when the app named the later act in the way, offers "Undo both",
 * which undoes that act and then this one. A partial undo says "Partly undone" and what stayed.
 */
export function undoToastFor(result: {
  ok: boolean;
  id?: number;
  reason?: string;
  blockedBy?: number;
  partial?: string;
  summary?: string;
  alsoUndone?: number;
}): ToastSpec {
  if (!result.ok) {
    const spec: ToastSpec = { text: `Not undone: ${result.reason ?? "the act could not be reversed"}.`, tone: "error" };
    return result.blockedBy !== undefined && result.id !== undefined
      ? { ...spec, action: { label: "Undo both", id: result.id, through: true } }
      : spec;
  }
  if (result.partial) return { text: `Partly undone: ${result.partial}`, tone: "success" };
  const also = result.alsoUndone ? `, and the later act that stood in front of it` : "";
  return { text: result.summary ? `Undone: ${result.summary}${also}` : "Undone.", tone: "success" };
}

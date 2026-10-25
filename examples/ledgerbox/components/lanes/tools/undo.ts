/**
 * The way back from an act an agent ran on the books, as the page offers it (ADR 0191).
 *
 * Five writes run unasked because they can be taken back (`lib/tool-classes.ts`, design 5.1), and
 * each one already writes the undo row `undoAction` reverses. Nothing offered it, so the premise
 * the AUTO class rests on was a server function nobody could reach. The toast for the act now
 * carries its Undo; the agent's answer does not change and the agent gains no undo verb, because
 * this is the person's way back from what the agent did.
 *
 * WHICH toast earns an Undo is decided by the class table, not by the payload: a gated act whose
 * result happened to carry an id would otherwise grow a button the class says it cannot have.
 */
import type { ToastTone } from "@athena/demo-kit/ui";

import { undoAction } from "@/app/actions";
import { TOOL_CLASSES, type ToolClass } from "@/lib/tool-classes";
import type { ActionResult } from "@/lib/types";

/** The one control a kit toast may carry (`Toast.tsx`'s `ToastAction`, which the kit's ui index does not export). */
export interface ToastAction {
  label: string;
  onAction: () => void;
}

/** What the toast for one result shows: its words, its tone and, when the act earns one, its Undo. */
export interface ToastSpec {
  text: string;
  tone: Extract<ToastTone, "success" | "error">;
  action?: { label: "Undo"; id: number };
}

/** A reversible write to the books - the class that runs unasked because it can be taken back. */
export function earnsUndo(tool: string): boolean {
  const declared = (TOOL_CLASSES as Record<string, ToolClass>)[tool];
  return declared !== undefined && declared.reversible === true && declared.sideEffects === "data";
}

export function toastFor(tool: string, result: ActionResult): ToastSpec {
  const spec: ToastSpec = { text: result.message, tone: result.ok ? "success" : "error" };
  return result.ok && result.undoId !== undefined && earnsUndo(tool)
    ? { ...spec, action: { label: "Undo", id: result.undoId } }
    : spec;
}

/** The result as the agent reads it: everything the act answered except the person's undo id. */
export function agentCopy<T extends ActionResult>(result: T): Omit<T, "undoId"> {
  const copy: Omit<T, "undoId"> & { undoId?: number } = { ...result };
  delete copy.undoId;
  return copy;
}

/** What the page needs to answer a press: its toast and its router's refresh. */
export interface UndoSurface {
  toast: (text: string, tone?: ToastTone, action?: ToastAction) => void;
  refresh: () => void;
}

/** Said when the undo threw: it may have landed, so the toast claims neither way. */
export const UNDO_NO_ANSWER = "The undo failed before it could answer - check the books before trying again.";

/**
 * Press an Undo: take the act back, say what it put back, and redraw the sheet from the books. A
 * refusal (a draft since sent, a line applied elsewhere since) is toasted as its reason, in the
 * words hirelane's board uses (ADR 0156).
 */
export async function undoPress(id: number, page: UndoSurface): Promise<void> {
  try {
    const answer = await undoAction(id);
    if (!answer.ok) page.toast(`Not undone: ${answer.reason ?? "the act could not be reversed"}.`, "error");
    else if (answer.partial) page.toast(`Partly undone: ${answer.partial}`, "success");
    else page.toast("Undone.", "success");
  } catch {
    page.toast(UNDO_NO_ANSWER, "error");
  }
  page.refresh();
}

/** The toast's own control for a spec that carries an Undo, or nothing. */
export function undoControl(spec: ToastSpec, page: UndoSurface): ToastAction | undefined {
  const action = spec.action;
  if (!action) return undefined;
  return { label: action.label, onAction: () => undoPress(action.id, page) };
}

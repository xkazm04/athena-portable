"use client";

import { useCallback, useTransition } from "react";
import { useToast } from "@athena/demo-kit/ui";
import { setStatusAction, undoAction } from "@/app/actions";
import { actVerb } from "@/lib/acts";
import type { Status } from "@/lib/types";

/** The kit's `UndoAnswer`, read off the action so this client file imports nothing server-only. */
type UndoAnswer = Awaited<ReturnType<typeof undoAction>>;
type StatusActAnswer = Awaited<ReturnType<typeof setStatusAction>>;

/** The answer to an undo, as one toast: done, partly done (and what stayed), or not done and why. */
function undoToast(answer: UndoAnswer): { text: string; tone: "success" | "warn" | "error" } {
  if (!answer.ok) return { text: `Not undone: ${answer.reason ?? "no reason given"}.`, tone: "error" };
  if (answer.partial) return { text: `Partly undone: ${answer.partial}.`, tone: "warn" };
  return { text: "Undone.", tone: "success" };
}

/**
 * Run a status act and report it: the toast carries Undo for the row the act logged (ADR 0111),
 * and the Undo's own answer is toasted in turn - a refusal a later act caused offers "Undo both",
 * which takes that act back first. The activity page's Undo is the same `undoAction`.
 */
export function useStatusAct() {
  const [pending, start] = useTransition();
  const { toast } = useToast();

  const undo = useCallback(
    function undo(id: number, through?: boolean): void {
      start(async () => {
        const answer = await undoAction(id, through ? { through: true } : undefined).catch(
          (): UndoAnswer => ({ ok: false, reason: "the app did not answer" }),
        );
        const spec = undoToast(answer);
        const blocker = !answer.ok && answer.blockedBy !== undefined && !through;
        toast(spec.text, spec.tone, blocker ? { label: "Undo both", onAction: () => undo(id, true) } : undefined);
      });
    },
    [toast],
  );

  /** Toast an act's answer: its summary with Undo, or its refusal. True when the act landed. */
  const report = useCallback(
    (result: StatusActAnswer): boolean => {
      if (!result.ok) {
        toast(result.error, "error");
        return false;
      }
      toast(result.summary, "success", { label: "Undo", onAction: () => undo(result.undoId) });
      return true;
    },
    [toast, undo],
  );

  const act = useCallback(
    (ids: string[], to: Status, after?: () => void) =>
      start(async () => {
        const result = await setStatusAction(ids, to).catch(
          (): StatusActAnswer => ({ ok: false, error: "The app did not answer.", skipped: [] }),
        );
        if (report(result)) after?.();
      }),
    [report],
  );

  return { pending, act, report };
}

/** The detail page's single-record act: one button that moves the record to its other status. */
export function StatusAction({ id, status }: { id: string; status: Status }) {
  const { pending, act } = useStatusAct();
  const to: Status = status === "open" ? "archived" : "open";
  return (
    <div className="dk-act-bar">
      <button type="button" className="dk-btn" disabled={pending} onClick={() => act([id], to)}>
        {actVerb(to)}
      </button>
    </div>
  );
}

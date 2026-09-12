"use client";

/**
 * Every mutating action in this direction answers the same way: run it inside a
 * transition, toast the message the server action returned, and let that action's
 * own `revalidatePath` refresh the tree.
 *
 * It is the card's path. The tool layer in `tools/BooksTools.tsx` runs the same
 * actions through its own two lines, because a tool has to hand its CALLER the
 * whole result — the draft, the send, the close — and a transition returns
 * nothing. The toast and the refresh are the same either way, so a click and a
 * call leave the surface in the same state.
 */
import { useCallback, useTransition } from "react";
import { useToast } from "@athena/demo-kit/ui";
import type { ActionResult } from "@/lib/types";

export function useRun() {
  const [pending, start] = useTransition();
  const { toast } = useToast();

  const run = useCallback(
    <R extends ActionResult>(fn: () => Promise<R>, after?: (result: R) => void) =>
      start(async () => {
        const result = await fn();
        toast(result.message, result.ok ? "success" : "error");
        after?.(result);
      }),
    [toast],
  );

  return { pending, run };
}

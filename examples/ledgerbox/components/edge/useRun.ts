"use client";

/**
 * Every mutating action answers the same way: run it in a transition, toast the message, let the
 * server action's `revalidatePath` refresh the tree. One hook, so no surface invents its own
 * error handling.
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

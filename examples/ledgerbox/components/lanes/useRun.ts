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
 *
 * THAT INCLUDES THE THROW. An action that throws instead of answering — a locked
 * database, a dropped connection — never reaches its own `revalidatePath`, and
 * whether it wrote anything first is not known here. So the person is told in
 * words that claim neither, the sheet is re-read so what it shows is the books
 * as they now are, and `after` still runs with `null`: a gate that was armed over
 * the act closes, and is armed again only by a person who has looked. The tool
 * path's `settle` does the same three things for an agent's call.
 */
import { useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@athena/demo-kit/ui";
import type { ActionResult } from "@/lib/types";

/** Said when an act throws. The same sentence `tools/BooksTools.tsx` toasts. */
export const ACT_THREW = "That act failed before it could answer - check the invoice before trying again.";

export function useRun() {
  const [pending, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const run = useCallback(
    <R extends ActionResult>(fn: () => Promise<R>, after?: (result: R | null) => void) =>
      start(async () => {
        let result: R;
        try {
          result = await fn();
        } catch (error) {
          // Kept for whoever opens the console; the person gets the toast.
          console.error(error);
          toast(ACT_THREW, "error");
          router.refresh();
          after?.(null);
          return;
        }
        toast(result.message, result.ok ? "success" : "error");
        after?.(result);
      }),
    [router, toast],
  );

  return { pending, run };
}

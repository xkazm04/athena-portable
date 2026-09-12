"use client";

/**
 * Running a mutation, and arming an irreversible one.
 *
 * Every write in this app answers with a `MutationResult`, so there is one place
 * that toasts it and one place that decides what "armed" means.
 *
 * The disarm timeout is the part that matters. A control left armed while you
 * read something else is a control you can fire by accident a minute later,
 * which is the exact failure a gate exists to prevent — and the two acts behind
 * this gate destroy identity, so there is no undo to fall back on.
 */
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useToast } from "@athena/demo-kit/ui";

import type { MutationResult } from "@/lib/mutations";

const DISARM_MS = 8000;

export function useRun() {
  const [pending, start] = useTransition();
  const { toast } = useToast();

  const run = useCallback(
    (fn: () => Promise<MutationResult>, after?: (result: MutationResult) => void) =>
      start(async () => {
        const result = await fn();
        toast(result.error ?? result.summary, result.ok ? "success" : "error");
        after?.(result);
      }),
    [toast],
  );

  return { pending, run };
}

/** One armed act at a time: two irreversible acts can never both be one click away. */
export function useArm() {
  const [armed, setArmed] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const disarm = useCallback(() => {
    clear();
    setArmed(null);
  }, [clear]);

  const arm = useCallback(
    (key: string) => {
      clear();
      setArmed(key);
      timer.current = window.setTimeout(() => setArmed(null), DISARM_MS);
    },
    [clear],
  );

  useEffect(() => clear, [clear]);

  return { armed, arm, disarm };
}

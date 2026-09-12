"use client";

/**
 * Running a server action, and arming a gated one.
 *
 * DESIGN-LAW §7.2 names `useArm()` in this file as the implementation of the
 * gate contract. It used to name `components/shared/useVariantAction.ts`, which
 * went with the directions that were reviewed out; the behaviour is
 * reimplemented here, inside this direction, with the clause it was specified
 * by:
 *
 *   two deliberate acts, and it disarms itself on a timeout.
 *
 * The timeout matters. A control that stays armed while you read something else
 * is a control you can fire by accident later, which is the failure a gate
 * exists to prevent.
 */
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useToast } from "@athena/demo-kit/ui";

import type { ActionResult } from "@/app/actions";

/** How long an armed gate stays armed. */
const DISARM_MS = 8000;

export function useRun() {
  const [pending, start] = useTransition();
  const { toast } = useToast();

  /*
   * The toast reports the OUTCOME, and only the outcome.
   *
   * Every gated and every auto act in the direction comes through this one call, so whatever the
   * two tones are painted in is painted on all thirteen results. That makes the tones the wrong
   * place to say AUTO or GATED: the three gated actions succeed, and `Write something first.`
   * fails. The class is carried by the two dossier panels and by the register in the foot, where
   * it is a property of the act rather than of how the act went, and base/tokens.css keeps the
   * two locked hues off this path deliberately (§4.2).
   */
  const run = useCallback(
    (fn: () => Promise<ActionResult>, after?: (result: ActionResult) => void) =>
      start(async () => {
        const result = await fn();
        toast(result.message, result.ok ? "success" : "error");
        after?.(result);
      }),
    [toast],
  );

  return { pending, run };
}

/**
 * One armed gate at a time, keyed by whatever the caller wants to distinguish
 * its gated acts by. Arming a second disarms the first, so two irreversible
 * acts can never both be one click away.
 */
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

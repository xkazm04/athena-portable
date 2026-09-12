"use client";

/**
 * A GATED action's second question.
 *
 * Two visually distinct states of ONE control rather than two buttons, asked in
 * the action panel where the click landed. Arming is reversible and the escape
 * is always visible. Nothing here decides whether an action is gated: that is
 * the `reversible && sideEffects !== "external"` rule on the manifest, and the
 * card passes the answer in.
 */
import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";

import type { ActionResult } from "@/lib/types";
import { fade } from "./motion";
import { useRun } from "./useRun";

export function Gate({
  label,
  confirmLabel,
  question,
  onConfirm,
  disabled,
}: {
  label: ReactNode;
  confirmLabel: string;
  question: string;
  onConfirm: () => Promise<ActionResult>;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const { pending, run } = useRun();

  return (
    <AnimatePresence mode="wait" initial={false}>
      {armed ? (
        <motion.span
          key="armed"
          className="ln-gate"
          role="group"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={fade}
        >
          <span className="ln-gate-q">{question}</span>
          <button
            type="button"
            className="ln-btn"
            data-kind="danger"
            autoFocus
            disabled={pending}
            onClick={() => run(onConfirm, () => setArmed(false))}
          >
            {pending ? "Working…" : confirmLabel}
          </button>
          <button type="button" className="ln-btn" data-kind="ghost" onClick={() => setArmed(false)}>
            Cancel
          </button>
        </motion.span>
      ) : (
        <motion.button
          key="idle"
          type="button"
          className="ln-btn"
          data-kind="gate"
          disabled={disabled || pending}
          onClick={() => setArmed(true)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={fade}
        >
          {label}
        </motion.button>
      )}
    </AnimatePresence>
  );
}

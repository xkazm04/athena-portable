"use client";

/** A GATED action's second question, asked where the click landed. */
import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { ActionResult } from "@/lib/types";
import { useRun } from "./useRun";
import { fade } from "./motion";

export function Gate({
  label,
  confirmLabel,
  question,
  onConfirm,
  disabled,
  kind = "gate",
}: {
  label: ReactNode;
  confirmLabel: string;
  question: string;
  onConfirm: () => Promise<ActionResult>;
  disabled?: boolean;
  kind?: "gate" | "primary";
}) {
  const [armed, setArmed] = useState(false);
  const { pending, run } = useRun();
  return (
    <AnimatePresence mode="wait" initial={false}>
      {armed ? (
        <motion.span key="armed" className="ed-gate" role="group" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade}>
          <span className="ed-gate-q">{question}</span>
          <button type="button" className="ed-btn" data-kind="danger" autoFocus disabled={pending} onClick={() => run(onConfirm, () => setArmed(false))}>
            {pending ? "Working…" : confirmLabel}
          </button>
          <button type="button" className="ed-btn" data-kind="ghost" onClick={() => setArmed(false)}>Keep it</button>
        </motion.span>
      ) : (
        <motion.button key="idle" type="button" className="ed-btn" data-kind={kind} disabled={disabled || pending} onClick={() => setArmed(true)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade}>
          {label}
        </motion.button>
      )}
    </AnimatePresence>
  );
}

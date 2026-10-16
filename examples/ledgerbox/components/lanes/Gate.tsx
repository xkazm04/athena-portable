"use client";

/**
 * A GATED action's second question.
 *
 * Two visually distinct states of ONE control rather than two buttons, asked in
 * the action panel where the click landed. Arming is reversible and the escape
 * is always visible. Nothing here decides whether an action is gated: that is
 * the `reversible && sideEffects !== "external"` rule on the manifest, and the
 * card passes the answer in.
 *
 * ARMED ON A SUBJECT, NOT ON A ROW. Arming records `subject` - what the confirm is
 * a decision about (`card/read.ts` gateSubject) - and the confirm is offered only
 * while the subject is unchanged and the act is not disabled. A letter redrafted,
 * a balance moved or a credit applied under an armed gate closes it, and the
 * person arms again on what is now there.
 */
import { useId, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";

import type { ActionResult } from "@/lib/types";
import { stillArmed } from "./card/read";
import { fade } from "./motion";
import { useRun } from "./useRun";

export function Gate({
  label,
  confirmLabel,
  question,
  onConfirm,
  subject,
  disabled = false,
}: {
  label: ReactNode;
  confirmLabel: string;
  question: string;
  onConfirm: () => Promise<ActionResult>;
  /** What the confirm is a decision about; arming holds it, and a new one closes the gate. */
  subject: string;
  disabled?: boolean;
}) {
  const [armedOn, setArmedOn] = useState<string | null>(null);
  /* The confirm takes focus as the gate arms, so the question is its description:
     otherwise a screen reader says "Record it, button" and never the sentence that
     says what the yes writes. */
  const questionId = useId();
  const { pending, run } = useRun();
  const armed = stillArmed(armedOn, subject, disabled);
  // Forget a subject that has moved on, so the same text coming back later (an undo)
  // does not re-open a confirm nobody pressed. React's adjust-state-during-render form.
  if (armedOn !== null && !armed) setArmedOn(null);

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
          transition={fade()}
        >
          <span className="ln-gate-q" id={questionId}>
            {question}
          </span>
          <button
            type="button"
            className="ln-btn"
            data-kind="danger"
            aria-describedby={questionId}
            autoFocus
            disabled={pending}
            onClick={() => run(onConfirm, () => setArmedOn(null))}
          >
            {pending ? "Working…" : confirmLabel}
          </button>
          <button type="button" className="ln-btn" data-kind="ghost" onClick={() => setArmedOn(null)}>
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
          onClick={() => setArmedOn(subject)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={fade()}
        >
          {label}
        </motion.button>
      )}
    </AnimatePresence>
  );
}

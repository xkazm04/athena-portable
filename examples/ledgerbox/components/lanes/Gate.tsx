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
 * A CONTROLLED VIEW OF THE CARD'S ACT MACHINE (`card/acts.ts`, ADR 0155). It holds no armed
 * state and runs no write of its own: whether it is armed, whether a write is in flight anywhere on
 * the card, and where focus goes when it closes are all the card's, so two gates cannot be armed at
 * once and none can be confirmed over another act still in flight. Arming records the act's
 * subject (`card/read.ts` gateSubject) in the machine, and a subject that moves under an armed gate
 * - a letter redrafted, a balance moved, a credit applied - closes it there.
 */
import { useId, type ReactNode, type Ref } from "react";
import { AnimatePresence, motion } from "motion/react";

import { fade } from "./motion";

export function Gate({
  label,
  confirmLabel,
  question,
  armed,
  busy,
  disabled = false,
  onArm,
  onCancel,
  onConfirm,
  idleRef,
}: {
  label: ReactNode;
  confirmLabel: string;
  question: string;
  /** This act is the card's one armed act. */
  armed: boolean;
  /** A write is in flight on this card - this act's confirm, or any other. */
  busy: boolean;
  /** The books would refuse the act now. */
  disabled?: boolean;
  onArm: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  /** Where the card hands focus back to this row after a cancel or an answer. */
  idleRef?: Ref<HTMLButtonElement>;
}) {
  /* The confirm takes focus as the gate arms, so the question is its description:
     otherwise a screen reader says "Record it, button" and never the sentence that
     says what the yes writes. */
  const questionId = useId();

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
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
          <button type="button" className="ln-btn" data-kind="ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </motion.span>
      ) : (
        <motion.button
          key="idle"
          type="button"
          className="ln-btn"
          data-kind="gate"
          ref={idleRef}
          disabled={disabled || busy}
          onClick={onArm}
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

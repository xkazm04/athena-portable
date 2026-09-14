"use client";

/**
 * L2 — one invoice, lifted off the sheet.
 *
 * ONE OBJECT IN TWO STATES, not two components. The card carries the same
 * `layoutId` as the node you clicked, and so do the three pieces of content
 * they share: the number, the amount and the client name. motion matches each
 * pair across the level change, so the box grows out of the node's exact
 * position while the number slides up into the eyebrow, the client name grows
 * into the headline and the amount travels into the stat row. Nothing
 * cross-fades, which is what stops the drill reading as a modal appearing.
 *
 * The lean lives on an inner wrapper. motion owns the transform of the card
 * itself while it is morphing, so a pointer-driven `rotate` on the same element
 * would be overwritten every frame.
 *
 * Everything below the head is evidence, and the action panel is the footer.
 * The three GATED acts sit behind `Gate`: the manifest's own
 * `reversible && sideEffects !== "external"` rule decides which those are, and
 * this file only renders the answer.
 */
import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

import { matchAction, unmatchAction } from "@/app/actions";
import { type Category, type Tone } from "@/lib/constants";
import type { LnDetail, LnMark } from "./model";
import { lift } from "./motion";
import { useRun } from "./useRun";
import { CardAside } from "./card/Aside";
import { CardEvidence } from "./card/Evidence";
import { CardHead } from "./card/Head";
import { figuresFor, hasEvidenceFor } from "./card/read";
import { CardFoot } from "./card/Foot";
import { usePointerTilt } from "./card/tilt";

export function Card({
  mark,
  detail,
  laneLabel,
  onClose,
}: {
  mark: LnMark;
  detail: LnDetail | undefined;
  laneLabel: string;
  onClose: () => void;
}) {
  const reduced = useReducedMotion();
  const tiltRef = useRef<HTMLDivElement | null>(null);
  const tilt = usePointerTilt(tiltRef, !reduced);
  const { pending, run } = useRun();
  const [tone, setTone] = useState<Tone>("gentle");
  const [category, setCategory] = useState<Category>(mark.category);
  const closeRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  /** The node at L1 or the mark at L0 that opened this card. See the effect. */
  const openerRef = useRef<HTMLElement | null>(null);

  const owed = mark.balanceCents > 0;
  const actionable = owed || mark.state === "disputed";

  // Body scroll is locked while the card is up, and focus lands on the way out
  // rather than on the first action: the card is a place you are reading, and
  // the way back should never need a hunt.
  //
  // AND IT IS HANDED BACK. Moving focus into an overlay without returning it is
  // half a job: Escape used to leave the reader at the top of the document,
  // with the mark they had been looking at three hundred pixels down and no way
  // back to it but the mouse.
  //
  // The opener is read at the TOP of this effect, which is the last moment it is
  // still true: mounting a card moves nothing, so whatever held focus when the
  // card appeared is the node at L1 or the mark at L0 that opened it, and the
  // next line is what takes focus away. It is re-checked on the way out rather
  // than trusted — a mark at L0 is not on the page any more once its level has
  // left — and the crumb's back button is the fallback, which is the one control
  // always present at every level this card can close into.
  useEffect(() => {
    // Recorded once and never overwritten from inside the card: StrictMode runs
    // this effect, its cleanup and this effect again, and on the second pass
    // focus is already on the close button below — so an unguarded read would
    // record a control that is about to be unmounted with the card and hand
    // focus back to nothing.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && !active.closest(".ln-card")) {
      openerRef.current = active;
    }
    const opener = openerRef.current;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      // Next frame, not this one: React is still committing the unmount, and
      // the level underneath has not been painted for the back button to exist
      // in yet.
      requestAnimationFrame(() => {
        // ...which also means this can run against a card that never went
        // away: StrictMode mounts, tears down and re-mounts every effect in
        // development, and a cleanup that moves focus unconditionally would
        // yank it straight back out of the card it had just put it in. Only a
        // card that is really gone hands focus back.
        if (document.querySelector(".ln-card")) return;
        const target =
          opener?.isConnected && opener.offsetParent !== null
            ? opener
            : document.querySelector<HTMLElement>(".ln-back");
        target?.focus();
      });
    };
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    /*
     * THE CARD OWNS ESCAPE, and it has to: the kit's window listener declines
     * any Escape raised inside a modal subtree (`zoom/escape.ts`), which is
     * right — a dialog's dismiss is the dialog's business — but this one then
     * answered to nothing at all while the footer went on advertising the key.
     * `preventDefault` is what the kit checks first, so the nav stays out of it
     * and one press leaves one level rather than two.
     */
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = cardRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };
  const figures = figuresFor(mark);
  const hasEvidence = hasEvidenceFor(detail);

  return (
    <div
      className="ln-card-layer"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.div
        layoutId={mark.id}
        transition={lift}
        className="ln-card"
        data-heat={mark.heat}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ln-card-title"
        ref={cardRef}
        /* On the dialog itself rather than on the lean wrapper inside it, so a
           key pressed with focus anywhere in the card — including on the dialog
           box, which is where focus lands if a control unmounts under it —
           reaches the same handler. */
        onKeyDown={onKeyDown}
      >
        <div
          className="ln-card-tilt"
          ref={tiltRef}
          onPointerMove={tilt.onPointerMove}
          onPointerLeave={tilt.onPointerLeave}
        >
          <CardHead
            mark={mark}
            laneLabel={laneLabel}
            owed={owed}
            figures={figures}
            closeRef={closeRef}
            onClose={onClose}
          />

          <div className="ln-card-body">
            <CardEvidence
              mark={mark}
              detail={detail}
              owed={owed}
              hasEvidence={hasEvidence}
              pending={pending}
              onMatch={(lineId) => run(() => matchAction(mark.id, lineId))}
              onUnmatch={(lineId) => run(() => unmatchAction(mark.id, lineId))}
            />

            {/* The invoice's own facts, in a lean panel rather than in the
                scroll. They are what you check against, not what you read
                through, so they stay put while the evidence moves. */}
            {/*
             * Only the rows that have an answer. A settled invoice has no
             * detail record, and six rows of em-dash is not a lean panel of
             * facts — it is a form nobody filled in. Issued, due and the count
             * of reminders come off the mark itself and are therefore always
             * true; the rest arrive with the detail or not at all.
             */}
            <CardAside mark={mark} detail={detail} />
          </div>

          <CardFoot
            mark={mark}
            detail={detail}
            actionable={actionable}
            owed={owed}
            tone={tone}
            setTone={setTone}
            category={category}
            setCategory={setCategory}
            pending={pending}
            run={run}
          />
        </div>
      </motion.div>
    </div>
  );
}

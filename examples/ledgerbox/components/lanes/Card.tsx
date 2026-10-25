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
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useOverlayEscape } from "@athena/demo-kit/zoom";

import { matchAction, unmatchAction } from "@/app/actions";
import { type Category, type Tone } from "@/lib/constants";
import type { LnDetail, LnMark } from "./model";
import { lift } from "./motion";
import { useRun } from "./useRun";
import { CardAside } from "./card/Aside";
import { CardEvidence } from "./card/Evidence";
import { CardHead } from "./card/Head";
import { figuresFor, hasEvidenceFor } from "./card/read";
import { actSpecs, createActDoor, IDLE_ACTS, type ActSpec, type ActState } from "./card/acts";
import { CardFoot } from "./card/Foot";
import { usePointerTilt } from "./card/tilt";

/**
 * THE CARD'S ONE ACT MACHINE (`card/acts.ts`, ADR 0155): one armed gate, one write in flight and
 * one door for every write the card issues - the decision list's five acts and Evidence's apply
 * and unapply. `useRun` is the door's transport (the toast, the refresh, the throw path); the door
 * holds the state ahead of any render, so a second press in the same tick is refused, not sent.
 */
function useActs(specs: readonly ActSpec[]) {
  const { run } = useRun();
  const [state, setState] = useState<ActState>(IDLE_ACTS);
  const [door] = useState(() => createActDoor({ publish: setState, transport: run }));
  useEffect(() => door.setTransport(run), [door, run]);
  // Each new reading of the invoice is checked against what is armed: a subject that moved, or
  // an act the books now refuse, closes the gate (`observe`).
  useEffect(() => door.observe(specs), [door, specs]);
  return { acts: state, door };
}

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
  const [tone, setTone] = useState<Tone>("gentle");
  const [category, setCategory] = useState<Category>(mark.category);
  const specs = useMemo(() => actSpecs(mark, detail, tone, category), [mark, detail, tone, category]);
  const { acts, door } = useActs(specs);
  const closeRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const owed = mark.balanceCents > 0;
  const actionable = owed || mark.state === "disputed";

  /**
   * ESCAPE AND THE WAY BACK ARE THE KIT'S — formula §1 rule 5, as one hook.
   *
   * It replaces about fifty lines here: the Escape branch, the opener ref read
   * at the top of a mount effect, the StrictMode guard that had to look for
   * `.ln-card` in the document to tell a real close from React taking the effect
   * apart and putting it back, and the next-frame restore. All three round-1
   * apps wrote the same four things; the kit's version is pinned pure
   * (`overlay.ts`) and cancels its own pending restore instead of needing a
   * selector to recognise itself by.
   *
   * `preventDefault` IS the protocol, and the hook does it: the kit's window
   * listener checks it first, so one press leaves one level rather than two —
   * and the decision dialog nested inside this card gets to speak first for the
   * same reason, because `escapeClosesOverlay` declines an event another overlay
   * has already claimed.
   *
   * The fallback is looked up at unmount rather than captured: a mark at L0 is
   * not on the page any more once its level has left, and the crumb's back
   * button is the one control present at every level this card can close into.
   */
  const overlay = useOverlayEscape({
    onClose,
    returnFocusTo: () => document.querySelector<HTMLElement>(".ln-back"),
  });

  // Body scroll is locked while the card is up, and focus lands on the way out
  // rather than on the first action: the card is a place you are reading, and
  // the way back should never need a hunt. Both are the pane's own business —
  // the hook deliberately neither locks scroll nor decides where focus goes IN,
  // because those differ per surface.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    overlay.onKeyDown(event);
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
              pending={acts.issuing !== null}
              onMatch={(lineId) => door.take("match_bank_line", () => matchAction(mark.id, lineId))}
              onUnmatch={(lineId) => door.take("unmatch", () => unmatchAction(mark.id, lineId))}
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
            actionable={actionable}
            tone={tone}
            setTone={setTone}
            category={category}
            setCategory={setCategory}
            specs={specs}
            acts={acts}
            door={door}
          />
        </div>
      </motion.div>
    </div>
  );
}

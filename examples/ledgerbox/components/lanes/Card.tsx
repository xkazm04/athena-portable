"use client";

/**
 * The closest band — one invoice, lifted off the map.
 *
 * IT GROWS OUT OF THE CARD IN THE WORLD, AND NOT THROUGH A `layoutId` ANY MORE. Round 2 matched
 * this pane to the L1 node by shared id and let motion morph between them. That is the right
 * answer when both ends are in the same untransformed coordinate system, and the wrong one now:
 * the source is a card inside the scene, which carries the camera's own `translate … scale`.
 * Layout projection measures boxes in viewport space, so a shared-element morph across that
 * boundary is a morph between a scaled plane and an unscaled one — which is exactly the trap
 * rule 1 exists to keep a level change out of.
 *
 * So the pane is grown from a MEASURED ORIGIN instead: a layout effect reads the screen centre
 * of the world card this invoice already is, writes it as this element's `transform-origin`, and
 * the stylesheet's one keyframe scales the BOX up from there. The INK — head, evidence, actions —
 * arrives a beat later on its own animation, which is rule 3 said in CSS rather than in a
 * component. Both are removed outright under reduced motion by the sheet's own branch, so the
 * card lands on its final state at frame zero.
 *
 * The lean lives on an inner wrapper, so a pointer-driven `rotate` and the grow do not share an
 * element's transform.
 *
 * Everything below the head is evidence, and the action panel is the footer.
 * The three GATED acts sit behind `Gate`: the manifest's own
 * `reversible && sideEffects !== "external"` rule decides which those are, and
 * this file only renders the answer.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { useOverlayEscape } from "@athena/demo-kit/zoom";

import { matchAction, unmatchAction } from "@/app/actions";
import { type Category, type Tone } from "@/lib/constants";
import type { LnDetail, LnMark } from "./model";
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

  /**
   * WHERE THE BOX GROWS FROM: the invoice's own card in the world, measured in the frame before
   * this one paints.
   *
   * It is a `useLayoutEffect` and not an effect because the keyframe begins on the element's
   * first painted frame; a transform-origin written afterwards would arrive one frame into the
   * grow, and the box would jump. The world card is always on the page — nothing in the map is
   * ever unmounted — so the measurement cannot come back empty because a level left.
   */
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const source = document.querySelector<HTMLElement>(
      `.ln-wmark[data-mark="${CSS.escape(mark.id)}"]`,
    );
    if (!source) return;
    const from = source.getBoundingClientRect();
    const box = card.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    card.style.setProperty("--ln-grow-x", `${from.left + from.width / 2 - box.left}px`);
    card.style.setProperty("--ln-grow-y", `${from.top + from.height / 2 - box.top}px`);
  }, [mark.id]);

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
      <div
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
      </div>
    </div>
  );
}

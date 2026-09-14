"use client";

/**
 * L2 — one candidate, and the evidence behind every number on them.
 *
 * LAID OUT LIKE THE PEER-COMPARISON BENCH in the sibling hiring product: a
 * verdict band across the top, the evidence in ruled sections down one column,
 * and the rest of the field ranked in a sticky rail beside it. A score is not a
 * decision — 2.6 means nothing until you know whether the other nine are above
 * or below it — so the bench is not a nicety, it is what makes the number
 * usable.
 *
 * The four regions live in `dossier/`. What stays here is what cannot leave the
 * shell: the focus trap, which has to see every control in the card at once,
 * and the bench ranking, which the rail and nothing else needs.
 */
import { useEffect, useMemo, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useOverlayEscape, useSharedIdentity } from "@athena/demo-kit/zoom";

import { comparisonOrder, type BdCandidate, type BdColumn, type BdRole } from "./model";
import { DOSSIER_STILL, useBoardMotion } from "./motion";
import { DossierActs } from "./dossier/Acts";
import { DossierBench } from "./dossier/Bench";
import { DossierEvidence } from "./dossier/Evidence";
import { DossierGate } from "./dossier/Gate";
import { DossierVerdict } from "./dossier/Verdict";

export function Dossier({
  role,
  column,
  candidate,
  openSlots,
  onFocus,
  onClose,
}: {
  role: BdRole;
  column: BdColumn;
  candidate: BdCandidate;
  openSlots: { id: string; interviewer: string; startTs: string; minutes: number }[];
  onFocus: (id: string) => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const reduced = useReducedMotion();
  const m = useBoardMotion();
  /* One claimant per shared id, both halves from the kit: the dossier holds
     `candidate-<id>` for as long as it is open, and the key flips with that so the
     handover to and from the carousel card is an unmount and a mount in one commit. */
  const box = useSharedIdentity(`candidate-${candidate.id}`, true);

  /*
   * ESCAPE, AND THE FOCUS IT OWES ITS OPENER — the kit's `useOverlayEscape`.
   *
   * Both halves used to be written out here, and the second half was not even here:
   * `Board.tsx` restored focus for every level change including this one, from a
   * selector it built in a layout effect. Two places restoring focus after one close
   * is one of them winning a race, so the overlay owns it now and the board keeps
   * only L1 → L0 (formula §1 rule 5).
   *
   * `returnFocusTo` is the fallback, and it is the one that normally fires: the card
   * that opened this pane gave its identity up when the pane took it, so by the time
   * focus goes back the opener is a detached button and the kit falls through to the
   * card that has taken its place.
   */
  const overlay = useOverlayEscape({
    onClose,
    returnFocusTo: () =>
      document.querySelector<HTMLElement>(
        `[data-candidate="${typeof CSS !== "undefined" && CSS.escape ? CSS.escape(candidate.id) : candidate.id}"]`,
      ),
  });

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  /**
   * THE TAB TRAP, which the kit deliberately does not hold.
   *
   * Escape is `useOverlayEscape` above; what stays here is the trap, and it is the
   * reason this component was not split further. It has to reach every control in the
   * card, which means it has to own the element the regions render into. Threading a
   * ref through four components to reassemble one tab order would be worse than the
   * file being longer. The kit's note says the same thing from the other side: a trap,
   * a scroll lock and a scrim differ per pane, so the pane keeps them.
   *
   * Escape goes to the kit's handler FIRST, because that is the protocol: it calls
   * `preventDefault()`, the nav's window listener checks `defaultPrevented` before it
   * checks anything else, and one press therefore leaves one level. The old local
   * branch also called `stopPropagation()`, which was belt and braces over a rule that
   * was already sufficient.
   */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    overlay.onKeyDown(event);
    if (event.key !== "Tab") return;
    const focusable = paneRef.current?.querySelectorAll<HTMLElement>(
      "button:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href]",
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

  /**
   * The bench: this group, ranked, unscored last.
   *
   * The second clause is the whole point. Sorting an unscored applicant by a
   * coerced zero would rank somebody nobody has read below somebody who was
   * read and found wanting, which is a claim the database cannot support.
   */
  const bench = useMemo(
    () =>
      comparisonOrder(column)
        .slice()
        .sort((a, b) => {
          if (a.scored !== b.scored) return a.scored ? -1 : 1;
          return b.overall - a.overall;
        }),
    [column],
  );

  return (
    <div
      className="bd-dossier-layer"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {/*
       * TWO BEATS, NOT ONE FADE.
       *
       * The box morphs out of the carousel card it came from — one identity,
       * `candidate-<id>`, held by exactly one element at a time — while the scrim
       * darkens beside it in `Board.tsx`. Only once the box has LANDED does what
       * is written in it arrive, region by region, on `--hl-stagger`. See
       * `dossierShell` in ./motion.ts for the measurement that moved it: a single
       * 180ms fade over a still-travelling box left six frames in which the
       * dossier's prose and the card underneath were both legible through the
       * blur, which reads as a flash rather than as a thing growing.
       *
       * Reduced motion takes the same two beats collapsed onto the final state —
       * no delay, no rise, no fade (DESIGN-LAW §1.3, §9.16).
       */}
      <motion.div
        key={box.key}
        layoutId={box.layoutId}
        className="bd-dossier"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bd-dossier-title"
        ref={paneRef}
        onKeyDown={onKeyDown}
        transition={m.lift}
        variants={reduced ? DOSSIER_STILL : m.dossierShell}
        initial={reduced ? false : "hidden"}
        animate="shown"
      >
        <DossierVerdict
          role={role}
          candidate={candidate}
          closeRef={closeRef}
          onClose={onClose}
          variants={reduced ? DOSSIER_STILL : m.dossierPart}
        />

        <motion.div
          className="bd-dossier-body"
          variants={reduced ? DOSSIER_STILL : m.dossierPart}
        >
          <DossierEvidence role={role} candidate={candidate} />
          <DossierBench
            bench={bench}
            stage={column.label}
            candidate={candidate}
            onFocus={onFocus}
          />
        </motion.div>

        {/*
         * ONE BAR, TWO ZONES. `design/ui-pass-brief.md` §3 has the measurement that moved them:
         * as two stacked panels these were 230px of an 828px modal - 27.8% - while the reading
         * column beneath the head was showing 406px of its own 1401px, which is 29% of the
         * evidence this direction exists to put in front of a reader.
         *
         * They are not merged into one row of six buttons, and that is DESIGN-LAW §7.1 rather
         * than taste: the class has to survive the page going greyscale, and six identical
         * controls fail that immediately. The reversible half sits on the glass; the irreversible
         * half is the one light surface in the room, at the only 3px rule in the direction, now
         * beside its neighbour instead of beneath it. Arming takes the whole bar - see Gate.tsx.
         *
         * Keyed by the candidate, and that is load-bearing rather than tidy.
         *
         * The dossier itself is mounted under a constant key so the morph reads as one pane, and
         * the bench rail changes `candidate` without leaving level 2 - so React would reconcile
         * these two zones across a change of person and every piece of state in them would
         * survive it. For the gate that means an ARMED irreversible act, still one click away,
         * now naming somebody nobody consented for. Consent is void the moment the thing it
         * approved is not the thing about to happen, so the zones remount and arming starts over.
         * The note draft does not follow the reader to the next person either.
         */}
        <motion.div
          className="bd-actbar"
          variants={reduced ? DOSSIER_STILL : m.dossierPart}
        >
          <DossierActs key={`auto:${candidate.id}`} candidate={candidate} />
          <DossierGate key={`gate:${candidate.id}`} candidate={candidate} openSlots={openSlots} />
        </motion.div>
      </motion.div>
    </div>
  );
}

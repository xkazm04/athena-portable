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
import { motion } from "motion/react";

import { comparisonOrder, type BdCandidate, type BdColumn, type BdRole } from "./model";
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

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  /**
   * The focus trap, and the reason this component was not split further.
   *
   * It has to reach every control in the card, which means it has to own the
   * element the regions render into. Threading a ref through four components to
   * reassemble one tab order would be worse than the file being longer.
   */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
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
      <motion.div
        layoutId={`candidate-${candidate.id}`}
        className="bd-dossier"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bd-dossier-title"
        ref={paneRef}
        onKeyDown={onKeyDown}
      >
        <DossierVerdict
          role={role}
          candidate={candidate}
          closeRef={closeRef}
          onClose={onClose}
        />

        <div className="bd-dossier-body">
          <DossierEvidence role={role} candidate={candidate} />
          <DossierBench
            bench={bench}
            stage={column.label}
            candidate={candidate}
            onFocus={onFocus}
          />
        </div>

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
        <div className="bd-actbar">
          <DossierActs key={`auto:${candidate.id}`} candidate={candidate} />
          <DossierGate key={`gate:${candidate.id}`} candidate={candidate} openSlots={openSlots} />
        </div>
      </motion.div>
    </div>
  );
}

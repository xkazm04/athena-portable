"use client";

/**
 * L2 — one block, marked up.
 *
 * REBUILT AFTER THE REVIEW, which said the previous version was impossible to
 * read at a glance: type of inconsistent size floating in white space with no
 * structure to hang it on. Three things changed, and they are the same three
 * that worked in the other two directions.
 *
 * 1. IT GROWS OUT OF THE CELL. Matched `layoutId`s on the box and on the block
 *    name, so the dossier is the cell enlarged rather than a modal that
 *    appeared over it.
 * 2. A HEADER THAT ANSWERS THE QUESTION. The four figures the cell carried are
 *    restated at poster size on arrival — rows, changed, outstanding, checked —
 *    so the first line of the card is the verdict, not a heading.
 * 3. EVERY REGION IS RULED AND LABELLED. Section bands down one column, the
 *    identity pair in its own bordered panel beside them, and nothing set in a
 *    size that is not on the scale.
 *
 * WHAT THIS FILE IS NOW. The four regions live in `dossier/`, because a
 * five-hundred-line component is one where nobody can find the part they came
 * to change. What stays here is what cannot be moved out of the shell: the
 * focus trap, which has to see every control in the sheet at once, and the two
 * pieces of state the gate arms against.
 */
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";

import type { BkTable } from "./model";
import { DossierChecks } from "./dossier/Checks";
import { DossierGate } from "./dossier/Gate";
import { DossierHead } from "./dossier/Head";
import { DossierPair } from "./dossier/Pair";
import { useArm, useRun } from "./useRun";

export function Dossier({ table, onClose }: { table: BkTable; onClose: () => void }) {
  const { pending, run } = useRun();
  const { armed, arm, disarm } = useArm();
  const [pairId, setPairId] = useState(table.pairs[0]?.id ?? "");
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    /*
     * The CARD takes focus, not the close button.
     *
     * Focusing the close button on arrival was correct for the keyboard and wrong on screen: the
     * focus ring is a three-pixel redline frame, so every dossier opened wearing a heavy red box
     * around its one destructive-looking control, which is the loudest thing on a sheet whose red
     * means "deviates from the specification". The dialog itself is the standard target anyway —
     * a screen reader reads the card, Tab then lands on close, and the ring appears when someone
     * has actually reached for it.
     */
    sheetRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  /**
   * The focus trap, and the reason this component was not split further.
   *
   * It has to reach every control in the sheet, which means it has to own the
   * element the regions render into. Passing a ref down through four
   * components to reassemble one tab order would be worse than the file being
   * a little longer.
   */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const focusable = sheetRef.current?.querySelectorAll<HTMLElement>(
      "button:not(:disabled), select:not(:disabled), [href]",
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

  const failed = new Map(table.deviations.map((d) => [d.kind, d]));
  const pair = table.pairs.find((p) => p.id === pairId) ?? table.pairs[0];

  return (
    <div
      className="bk-dossier-layer"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.div
        layoutId={`table-${table.ident}`}
        className="bk-dossier"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bk-dossier-title"
        ref={sheetRef}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <DossierHead table={table} closeRef={closeRef} onClose={onClose} />

        <div className="bk-dossier-body">
          <DossierChecks table={table} failed={failed} />
          {pair ? <DossierPair table={table} pair={pair} onPickPair={setPairId} /> : null}
        </div>

        <DossierGate
          table={table}
          pair={pair}
          pending={pending}
          run={run}
          armed={armed}
          arm={arm}
          disarm={disarm}
        />
      </motion.div>
    </div>
  );
}

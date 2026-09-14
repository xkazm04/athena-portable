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
 * focus trap, which has to see every control in the sheet at once, the two
 * pieces of state the gate arms against, and the two halves of "how do I get out
 * of this" below.
 *
 * THE DOSSIER OWNS ESCAPE, and it did not. `aria-modal="true"` is a promise: the
 * kit's window listener reads it and stands down (`zoom/escape.ts`), correctly,
 * because a modal owns its own dismiss — and then nothing here dismissed it. The
 * key was declined by the nav and caught by nobody, so L2 could be left only by
 * the ✕ or by clicking the scrim, and a keyboard reader who had tabbed into the
 * card was inside a box with no keyboard way out. `onKeyDown` below is the other
 * half of the promise.
 *
 * AND IT GIVES FOCUS BACK. Opening moved focus into the card; closing used to
 * drop it on `<body>`, which means the next Tab starts at the top of the
 * document and the reader's place in the zone is gone. It returns to whatever
 * had focus when the card opened, and — for a card an agent opened, where
 * nothing on the sheet had focus at all — to the cell the block lives in.
 */
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";

import type { MotionTokens } from "./motion-tokens";
import type { BkTable } from "./model";
import { DossierChecks } from "./dossier/Checks";
import { DossierGate } from "./dossier/Gate";
import { DossierHead } from "./dossier/Head";
import { DossierPair } from "./dossier/Pair";
import { useArm, useRun } from "./useRun";

/**
 * Where focus goes when the card closes, best answer first.
 *
 * The opener is preferred because it is where the reader actually was. It may be
 * gone (an agent opened the card, or the grid re-rendered under it), so the
 * block's own cell is the fallback — the same object the card grew out of, which
 * is where a reader watching the move would expect to be put down — and the back
 * control is the last resort, because it is the one thing on the sheet that is
 * always there at L1.
 */
function returnFocusTo(opener: Element | null, ident: string): HTMLElement | null {
  if (opener instanceof HTMLElement && opener.isConnected && opener !== document.body) return opener;
  return (
    document.querySelector<HTMLElement>(`.bk-cell[data-ident="${ident}"]`) ??
    document.querySelector<HTMLElement>(".bk-back")
  );
}

export function Dossier({
  table,
  onClose,
  motion: tokens,
}: {
  table: BkTable;
  onClose: () => void;
  /** The direction's durations and easing, read out of the cascade. See
   *  `motion-tokens.ts`; `null` only before the wrapper exists. */
  motion: MotionTokens | null;
}) {
  const { pending, run } = useRun();
  const { armed, arm, disarm } = useArm();
  const [pairId, setPairId] = useState(table.pairs[0]?.id ?? "");
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const ident = table.ident;
  useEffect(() => {
    const opener = document.activeElement;
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
      returnFocusTo(opener, ident)?.focus();
    };
  }, [ident]);

  /**
   * The focus trap, Escape, and the reason this component was not split further.
   *
   * The trap has to reach every control in the sheet, which means it has to own
   * the element the regions render into. Passing a ref down through four
   * components to reassemble one tab order would be worse than the file being a
   * little longer.
   *
   * Escape is answered here rather than through `nav.holdEscape()`. A hold is
   * for an overlay that listens on `window` itself and therefore cannot be
   * reached by either of the kit's cheaper checks; this card is a real
   * `aria-modal` subtree with a React handler on it, so it is already covered
   * twice over — the kit declines the key on the modal check, and
   * `preventDefault` below declines it again for anything that reads the event
   * afterwards. Taking a hold as well would be a third claim on a key already
   * settled, and one more thing to release correctly on unmount.
   */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
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
      {/* The scrim is `Blocks.tsx`'s, not this card's — see the note there. */}
      <motion.div
        layoutId={`table-${table.ident}`}
        /* Stated here as well as on the `MotionConfig`, because this is the one
           element whose travel the whole level change is read by: the box the
           reader watches leave the grid. `--bk-dur-4` on `--bk-ease`. */
        transition={tokens?.morph}
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

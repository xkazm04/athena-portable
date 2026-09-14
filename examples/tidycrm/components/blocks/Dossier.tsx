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
 * card was inside a box with no keyboard way out.
 *
 * AND IT GIVES FOCUS BACK. Opening moved focus into the card; closing used to
 * drop it on `<body>`, which means the next Tab starts at the top of the
 * document and the reader's place in the database is gone. It returns to
 * whatever had focus when the card opened, and — for a card an agent opened,
 * where nothing on the sheet had focus at all — to the cell the table lives in.
 *
 * BOTH OF THOSE ARE `useOverlayEscape` NOW (formula §1 rule 5). All three
 * round-1 apps wrote the same two answers by hand, including the two guards on
 * recording the opener that StrictMode's double mount makes necessary. What is
 * still this card's, because it differs per pane, is everything the kit
 * deliberately leaves alone: the Tab trap, the scroll lock, and the decision
 * that the CARD takes focus rather than its close button.
 */
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { useOverlayEscape } from "@athena/demo-kit/zoom";

import type { MotionTokens } from "./motion-tokens";
import type { BkTable } from "./model";
import { DossierChecks } from "./dossier/Checks";
import { DossierGate } from "./dossier/Gate";
import { DossierHead } from "./dossier/Head";
import { DossierPair } from "./dossier/Pair";
import { useArm, useRun } from "./useRun";

/**
 * Where focus goes when the card closes and the opener is gone.
 *
 * The kit prefers the opener — it is where the reader actually was — and asks
 * for this only when that element has left with the level it belonged to, or
 * when an agent opened the card and nothing on the sheet had focus at all. The
 * table's own cell is the answer, because it is the object the card grew out of
 * and where a reader watching the move would expect to be put down; the back
 * control is the last resort, being the one thing always present at L1.
 */
function cellFor(ident: string): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>(`.bk-cell[data-ident="${ident}"]`) ??
    document.querySelector<HTMLElement>(".bk-back")
  );
}

/** How wide the card will be, which is `l2-dossier.css`'s `min(1180px, 100%)`. */
const CARD_W = 1180;

/**
 * Where the card comes from: the cell's own projected box, as a transform.
 *
 * Measured rather than guessed, and measured ONCE — during the render that opens
 * the card, before the cell's ink leaves and before anything moves. Scale is the
 * cell's width over the card's, which is what makes the two boxes the same size
 * at the first frame; `x` and `y` carry the cell's centre against the card's,
 * which is the middle of the viewport. If the cell cannot be found — an agent
 * opened the card from a level where it is not drawn — the card rises from the
 * middle, slightly small, which is the same move with nowhere particular to come
 * from.
 */
function riseFrom(ident: string): { opacity: number; scale: number; x: number; y: number } {
  const cell = typeof document === "undefined" ? null : cellFor(ident);
  const box = cell?.getBoundingClientRect();
  if (!box || box.width === 0) return { opacity: 0, scale: 0.94, x: 0, y: 0 };
  const w = Math.min(CARD_W, window.innerWidth);
  return {
    opacity: 0,
    scale: Math.max(0.05, box.width / w),
    x: box.left + box.width / 2 - window.innerWidth / 2,
    y: box.top + box.height / 2 - window.innerHeight / 2,
  };
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
  /* Where the card grows from, read ONCE on the frame it opens: a later read
     would measure a cell whose ink has already left, or a camera that has
     moved. The card is keyed by the table in `Blocks.tsx`, so a change of table
     is a new card and gets its own measurement. */
  const [rise] = useState(() => riseFrom(table.ident));
  /* Escape, and the focus this card owes whoever opened it. The kit's, because
     all three apps had written the same thing. */
  /*
   * `prefer: "origin"`, which closes round 2's own gap in this app's list — "the
   * kit always prefers the opener; a pane that grew out of a card wants the card
   * to win". Round 3 made the case unanswerable rather than merely untidy: the
   * element the reader was on when they opened a dossier is often the CAMERA
   * FRAME (it takes focus on a drag, and it is where an agent's `open_item`
   * leaves focus), and putting them back on the frame hands the arrow keys to
   * the camera instead of to the grid they were just reading. The table's own
   * cell is the object the card grew out of and where a reader watching the move
   * expects to be put down.
   */
  const overlay = useOverlayEscape({ onClose, prefer: "origin", returnFocusTo: () => cellFor(ident) });

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
   * The Tab trap, and the reason this component was not split further.
   *
   * The trap has to reach every control in the sheet, which means it has to own
   * the element the regions render into. Passing a ref down through four
   * components to reassemble one tab order would be worse than the file being a
   * little longer. It stays here because it is the one part of "an overlay"
   * that is genuinely per-pane; Escape is `overlay.onKeyDown`, called first
   * below, and it takes no `nav.holdEscape()` — a hold is for an overlay that
   * listens on `window` itself, and this is a real `aria-modal` subtree with a
   * React handler on it.
   */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    overlay.onKeyDown(event);
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
        /*
         * IT RISES OUT OF THE CELL, and round 3 changed how.
         *
         * Rounds 1 and 2 matched a `layoutId` on this box and on the cell, so
         * the cell physically became the card. That cannot survive a camera. The
         * cell is positioned by a projection this app writes onto an ancestor
         * every frame the pose changes, and `motion`'s shared-layout system owns
         * the transform of the elements it morphs and measures their ancestors
         * once: after a single orbit at L1 the card opened frozen at the cell's
         * own size, at zero opacity, and never animated out of it. It is not a
         * bug in either library. Two systems cannot own one element's transform.
         *
         * So the card is measured out of the cell instead — `riseFrom` reads the
         * cell's box on the frame it opens, before the ink leaves it — and grows
         * from there on this sheet's own token. The reader sees the same move,
         * it reverses the same way, and nothing has to agree about who owns a
         * transform. Formula §1 rule 3: the box travels first and
         * `l2-dossier.css` holds the card's body back until it has landed.
         */
        initial={rise}
        animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
        exit={rise}
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

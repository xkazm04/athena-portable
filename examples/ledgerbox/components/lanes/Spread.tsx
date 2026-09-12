"use client";

/**
 * L1 — one lane, spread across the whole sheet.
 *
 * WHY THIS IS A GRID AND NOT A TIME AXIS ANY MORE. The first cut kept L0's
 * absolute date positioning and packed the cards into rows greedily, so a card
 * went to whichever row its neighbours left free. That IS a rule, but it is an
 * invisible one: the review asked what decided the number of rows, which is the
 * question a layout should never provoke. The rule now is the one everybody
 * already knows how to read — the cards run in the order they fall due, left to
 * right and then down, and the number of rows is however many that takes. It is
 * stated on the surface as well, under the spread.
 *
 * The date has not been lost, only demoted: it is on every card, and the lane's
 * own chronology is the reading order.
 *
 * TWO READINGS, one dataset. `flat` is the honest 2D one. `raised` tilts the
 * field and stands every card up by what it still owes, so the lane reads as a
 * terrace. 2D compares dates, raised compares amounts.
 *
 * THE CONTENT TRAVELS. The card carries a `layoutId` for its box and one for
 * each of the two things the L2 card also shows, so the amount and the client
 * name fly to their new positions instead of cross-fading.
 */
import { useMemo, type CSSProperties } from "react";
import { AnimatePresence, motion } from "motion/react";

import { formatMoneyShort } from "@/lib/format";
import { chronological, matches, type LnFilter, type LnLane, type LnSheet } from "./model";
import { fade, lift, zoom } from "./motion";
import { SpreadHead } from "./spread/Head";

export type SpreadMode = "flat" | "raised";

/** `LB-2026-0058` -> `0058`. Every invoice shares the prefix, so it carries no
 *  information at this width and costs the digits that do. */
function shortNumber(number: string): string {
  const parts = number.split("-");
  return parts[parts.length - 1] ?? number;
}

export function Spread({
  sheet,
  lane,
  filter,
  picked,
  mode,
  onOpenItem,
  onOpenLane,
}: {
  sheet: LnSheet;
  lane: LnLane;
  filter: LnFilter;
  /** Ticked invoices, ringed at this level too. */
  picked: ReadonlySet<string>;
  mode: SpreadMode;
  onOpenItem: (id: string) => void;
  onOpenLane: (laneId: string) => void;
}) {
  const ordered = useMemo(() => chronological(lane), [lane]);
  // The tallest bar in THIS lane, so a lane of small invoices still has relief
  // rather than lying flat because another lane holds the studio's whale.
  const maxBalance = useMemo(
    () => ordered.reduce((m, x) => Math.max(m, x.balanceCents), 0),
    [ordered],
  );
  const shown = ordered.filter((m) => matches(m, filter)).length;

  return (
    <div className="ln-spread">
      <SpreadHead sheet={sheet} lane={lane} onOpenLane={onOpenLane} />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={lane.id}
          className="ln-field"
          data-mode={mode}
          /*
           * NINE DEGREES, NOT THIRTEEN, and a much longer perspective.
           *
           * At 13deg against a 1800px perspective the cards at either end of a
           * six-column row sheared hard enough to push the leftmost one off the
           * stage's own clip, and the lifted top row climbed into the rails
           * above it. A terrace should read as a terrace: the tilt is the
           * smallest one that still gives the plinths somewhere to stand.
           */
          animate={{ rotateX: mode === "raised" ? 9 : 0, transformPerspective: 2600 }}
          transition={zoom}
        >
          {ordered.map((mark) => {
            const dim = !matches(mark, filter);
            // How far this card stands up in `raised` mode: its share of the
            // largest balance in the lane.
            const standing = maxBalance > 0 ? Math.max(0, mark.balanceCents) / maxBalance : 0;
            return (
              <motion.button
                key={mark.id}
                type="button"
                layoutId={mark.id}
                className="ln-node"
                data-heat={mark.heat}
                data-dim={dim}
                data-picked={picked.has(mark.id)}
                style={{ "--lift": standing } as CSSProperties}
                animate={{
                  opacity: dim ? 0.22 : 1,
                  y: mode === "raised" ? -standing * 26 : 0,
                }}
                transition={lift}
                onClick={() => onOpenItem(mark.id)}
                aria-label={`Open ${mark.number}, ${mark.clientName}. ${mark.status}${
                  picked.has(mark.id) ? " Ticked." : ""
                }`}
              >
                <span className="ln-node-top">
                  <span className="ln-node-no">#{shortNumber(mark.number)}</span>
                  <motion.span layoutId={`money-${mark.id}`} className="ln-node-money">
                    {formatMoneyShort(
                      mark.balanceCents > 0 ? mark.balanceCents : mark.amountCents,
                    )}
                  </motion.span>
                </span>
                <motion.span layoutId={`client-${mark.id}`} className="ln-node-client">
                  {mark.clientName}
                </motion.span>
                <span className="ln-node-status">{mark.status}</span>
                {/*
                 * The balance, as a length, against the largest balance in this
                 * lane. Twelve boxes of identical size cannot be compared by
                 * eye, and reading twelve figures one at a time is not
                 * comparing — it is arithmetic. The `3D amounts` reading now
                 * exists in the flat one too, and the tilt adds the physical
                 * version of the same fact rather than being the only way to
                 * get it.
                 */}
                <span className="ln-node-meter" aria-hidden />
              </motion.button>
            );
          })}
        </motion.div>
      </AnimatePresence>

      {/* Only when the filter has actually narrowed the lane. The count and the
          ordering rule are in the readout above; repeating them under the grid
          was two statements of one fact, and it left nothing to say in the one
          case that genuinely needs saying. */}
      {shown === ordered.length ? null : (
        <motion.p
          className="ln-count ln-spread-narrowed"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={fade}
        >
          showing {shown} of {ordered.length} — the rest are dimmed, not removed
        </motion.p>
      )}
    </div>
  );
}

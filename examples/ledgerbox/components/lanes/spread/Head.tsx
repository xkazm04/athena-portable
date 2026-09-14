"use client";

/**
 * The head of L1: the lane's name and figures on the left, the lane's own clock
 * on the right.
 *
 * WHAT WENT, AND WHY. This used to be four stacked bands — title, blurb, three
 * figures, and then five RAILS, one per lane you are not in, each redrawing
 * every mark of that lane. The review's note was "use of spacing in top area is
 * inefficient — swimlanes do not belong on L1", and the measurement agreed: the
 * rails were 130px of the frame and roughly a hundred marks of a hundred and
 * twenty-four drawn for lanes the reader had just left. They are gone. Moving
 * sideways between areas is Escape and a click, which is one press more and a
 * hundred marks less.
 *
 * WHAT ARRIVED IN THEIR PLACE. The open lane's OWN timeline, in the right half
 * of the head. The one thing L1 genuinely lost when it stopped being a time axis
 * is where in the quarter this lane's money sits, and the cards below say it
 * only as a date on each. The clock says it as a shape, in the same encoding L0
 * uses — position is the due date, width is the balance, colour is the state,
 * and the now-line is in the same place — so the reader keeps the picture they
 * zoomed out of while the cards do the reading.
 *
 * It does not take the pointer. Every mark on it is a card two inches below it,
 * and a second way to open the same twelve invoices is a second thing to learn.
 */
import { motion, useReducedMotion } from "motion/react";
import { sharedIdentity } from "@athena/demo-kit/zoom";
import type { CSSProperties } from "react";

import { formatMoneyShort } from "@/lib/format";
import { markPresence, type LnFilter, type LnLane, type LnSheet } from "../model";
import { instant, move } from "../motion";
import { markVars } from "../swarm/marks";

export function SpreadHead({
  sheet,
  lane,
  live,
  filter,
}: {
  sheet: LnSheet;
  lane: LnLane;
  /** True while L1/L2 is the level being read; false on the way back out to L0,
   *  where the id belongs to the lane name arriving in the gutter. */
  live: boolean;
  /** The clock dims with the same rule the cards do — one filter, one reading. */
  filter: LnFilter;
}) {
  const reduced = useReducedMotion();
  const { todayX, months } = sheet.axis;
  const title = sharedIdentity(`lane-name-${lane.id}`, live);

  return (
    <div className="ln-spread-head">
      <div className="ln-spread-claim">
        {/* The same element as the lane's name in the L0 gutter: motion matches
            them by id, so the label travels and grows rather than one fading
            out while another fades in somewhere else. THE MASTHEAD DOES NOT MOVE
            UNDER IT — `chrome/mast.css` takes the headline down to its crumb size
            in the frame the level changes and settles it with a transform, so the
            box this name is flying to is already where it will end up. */}
        {/* The other end of the L0 gutter's `lane-name` id, through the kit's
            one-claimant helper: exactly one of the two levels holds it in any
            frame, and the key flip is what makes the hand-over a remount, which
            is the only event motion reads a `layoutId` on. */}
        <motion.h2
          key={title.key}
          layoutId={title.layoutId}
          className="ln-spread-title"
          /* The flight is tokenised like every other duration in the direction.
             Left to motion's default this one spring was the slowest thing on the
             screen — still creeping the last six pixels half a second after the
             level had otherwise finished. */
          transition={reduced ? instant : move()}
        >
          {lane.label}
        </motion.h2>
        <p className="ln-spread-blurb">{lane.blurb}</p>
        {/*
         * THE LANE'S OWN CLAIM, in the masthead's own device.
         *
         * L0 opens on three poster figures and L1 opened on nothing — the only
         * count on the screen was the toolbar's, which went on reporting all 124
         * invoices in the books while you stood inside a lane of twelve. The lane
         * gets the same treatment its parent does, and the two read as one system
         * because they are literally the same class.
         */}
        <div className="ln-readout ln-spread-figures">
          <div data-tone={lane.lateCents > 0 ? "alert" : undefined}>
            <b>{formatMoneyShort(lane.lateCents)}</b>
            <span>{lane.lateCount} late</span>
          </div>
          <div>
            <b>{formatMoneyShort(lane.owedCents)}</b>
            <span>still open</span>
          </div>
          <div>
            <b>{lane.count}</b>
            <span>invoices, in due order</span>
          </div>
        </div>
      </div>

      {/*
       * The lane's clock. A reading, not a control: it is announced as a figure
       * with a caption and takes no pointer, because every mark on it is one of
       * the cards underneath.
       */}
      <figure
        className="ln-clock"
        style={{ "--rows": lane.rows, "--todayX": todayX } as CSSProperties}
      >
        <div className="ln-clock-axis" aria-hidden>
          {months.map((m) => (
            <span key={`${m.label}-${m.x}`} style={{ "--x": m.x } as CSSProperties}>
              {m.label}
            </span>
          ))}
        </div>
        <div className="ln-clock-track" aria-hidden>
          {lane.marks.map((mark) => (
            <i
              key={mark.id}
              data-heat={mark.heat}
              data-presence={markPresence(mark, filter)}
              style={markVars(mark, todayX)}
            />
          ))}
          <span className="ln-clock-now" />
        </div>
        <figcaption>
          The same {lane.count} invoices on the sheet&apos;s clock: position is the due date,
          width is the balance.
        </figcaption>
      </figure>
    </div>
  );
}

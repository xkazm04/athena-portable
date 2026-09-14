"use client";

/**
 * One area of the practice, as a chronological swimlane.
 *
 * A mark's width IS what it is worth and its tail IS how late it is, so the
 * lane can be read as a picture before any of it is read as text. Three amounts
 * per lane are printed and the few marks asking for something carry a glyph;
 * everything else answers on hover, because 124 labels is not a swarm, it is a
 * table drawn badly.
 *
 * The spine is the LATE SHARE, not the lane's heat. Every lane has at least one
 * long-overdue invoice, so heat made all six the same red and the rule carried
 * no information at all. The share does: 51% in Design and 97% in Reimbursable,
 * and that difference is the whole reason to open one lane before the other.
 */
import { motion, useReducedMotion } from "motion/react";
import { sharedIdentity } from "@athena/demo-kit/zoom";
import type { CSSProperties } from "react";

import { formatMoney, formatMoneyShort } from "@/lib/format";
import {
  PRESENCE_OPACITY,
  matches,
  markPresence,
  type LnFilter,
  type LnLane,
  type LnMark,
} from "../model";
import { instant, move } from "../motion";
import { flagOf, labelledIn, markVars } from "./marks";

/**
 * What the swarm owns and lends to every lane.
 *
 * The read-out and the roving tab stop are one thing across all six lanes —
 * only one mark is hovered and only one is tabbable at a time — so they stay
 * with the swarm and a lane is handed the handles it needs.
 */
export interface Deck {
  /** The lane's marks in due order, which is the order arrow keys walk. */
  byDate: Map<string, LnMark[]>;
  enter: (mark: LnMark, lane: LnLane, el: HTMLElement) => void;
  /** Which mark the read-out is currently on, so its own mark can say so. */
  hoveredId: string | null;
  leave: () => void;
  rove: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  roving: Record<string, number>;
  setRoving: (next: (prev: Record<string, number>) => Record<string, number>) => void;
}

export function Lane({
  lane,
  index,
  live,
  presence,
  traveling,
  filter,
  picked,
  todayX,
  deck,
  onOpenLane,
  onOpenMark,
}: {
  lane: LnLane;
  index: number;
  /**
   * True while L0 is the level being read.
   *
   * A lane keeps its `layoutId`s only while it is live. On the frames it is
   * still mounted on its way out it renders the same markup as plain elements,
   * which deregisters every id in the same commit the arriving level claims
   * them — two live claimants on one id animates neither, and that is the whole
   * reason the two levels could not overlap before.
   */
  live: boolean;
  /** 1 fully there, 0 gone — the kit's `emphasis()`, never re-derived here. */
  presence: number;
  /** This lane's name is the element flying to the spread's head. */
  traveling: boolean;
  filter: LnFilter;
  /** Ticked invoices, ringed at this level. */
  picked: ReadonlySet<string>;
  todayX: number;
  deck: Deck;
  onOpenLane: (id: string) => void;
  onOpenMark: (laneId: string, markId: string) => void;
}) {
  const reduced = useReducedMotion();
  /* Reduced motion lands on the final presence rather than fading to it: the
     lane is simply as present as `emphasis()` says it is, on the frame the
     level changed. */
  const travel = reduced ? instant : move();
  const { byDate, enter, leave, rove, roving, setRoving, hoveredId } = deck;
  const labelled = labelledIn(lane);
  /* The lane's name travels to the spread's head; the lane owns the id only
     while L0 is the level being read. */
  const name = sharedIdentity(`lane-name-${lane.id}`, live);
  const shown = lane.marks.filter((m) => matches(m, filter)).length;
  const lateShare = lane.owedCents > 0 ? lane.lateCents / lane.owedCents : 0;

  return (
  <motion.div
    key={lane.id}
    className="ln-lane"
    data-lane={lane.id}
    data-heat={lane.heat}
    animate={{ opacity: presence }}
    transition={travel}
    style={
      {
        "--i": index,
        "--rows": lane.rows,
        "--todayX": todayX,
        "--late": lateShare,
      } as CSSProperties
    }
  >
    <button
      type="button"
      className="ln-lane-head"
      onClick={() => onOpenLane(lane.id)}
      aria-label={`Open the ${lane.label} lane, ${lane.count} invoices, ${formatMoneyShort(lane.owedCents)} outstanding`}
    >
      {/*
        ONE CLAIMANT PER SHARED ID, as the kit's two props rather than as two
        spellings of the element. `sharedIdentity` hands back the `layoutId` only
        while this lane owns it and a `key` that FLIPS with ownership — which is
        the half that is easy to get wrong: motion reads `layoutId` at mount and
        never again, so dropping the id has to be a remount or the deregistration
        never happens. The branch this replaces did that by rendering a different
        element type, with a comment asking the two spellings not to drift.
      */}
      <motion.span
        key={name.key}
        layoutId={name.layoutId}
        className="ln-lane-name"
        data-traveling={(!live && traveling) || undefined}
        transition={travel}
      >
        {lane.label}
      </motion.span>
      <span className="ln-lane-figures num">
        {shown === lane.count ? lane.count : `${shown}/${lane.count}`} ·{" "}
        {formatMoneyShort(lane.owedCents)}
      </span>
      {lane.lateCount > 0 ? (
        <span className="ln-lane-figures ln-lane-late num">
          {lane.lateCount} late · {formatMoneyShort(lane.lateCents)}
        </span>
      ) : (
        <span className="ln-lane-figures">nothing late</span>
      )}
      {/*
        WHAT THIS LINE IS — the lane's own blurb, which is the only part of the
        answer that differs between lanes.
        The first cut of this printed the ENCODING here — "by due date, Jun→Oct ·
        colour is the state" — six times, identically, in six gutters: a key
        repeated once per row is not a key, it is noise with a definition in it.
        The encoding is stated once now, where it belongs to the whole sheet: the
        axis says it is a due date, and the footer's own line says width is the
        balance and the tail is how late. What is left here is the sentence only
        this lane can say, and it comes from the books rather than from a
        template.
      */}
      <span className="ln-lane-reading">{lane.blurb}</span>
    </button>
    {/*
     * The track is a GROUP, not a button. It used to carry
     * `role="button"` so that clicking the empty background could
     * open the lane, which put a hundred-odd real buttons inside a
     * button — invalid, and the reason L0 had 148 tab stops. The
     * keyboard path to opening a lane is the head button beside it,
     * which is a real button and always was; the click here is a
     * pointer convenience and needs no role at all.
     */}
    <div
      className="ln-track"
      role="group"
      aria-label={`${lane.label}, ${lane.count} invoices on the time axis. Use the arrow keys to move between them.`}
      onClick={() => onOpenLane(lane.id)}
      onKeyDown={rove}
    >
      {(byDate.get(lane.id) ?? lane.marks).map((mark, index) => {
        /*
         * HOW PRESENT THIS MARK IS — one reading, decided in `model/attention.ts`
         * and drawn as one `opacity`. `lit` is an invoice asking for a decision,
         * `quiet` is one with nothing outstanding, `dim` is one the filter has
         * put away. It replaces the boolean `data-dim` the filter used to set on
         * its own: the filter is still half of the answer, and "does this want
         * anything" is the other half, and a surface with two dimming systems
         * has neither.
         */
        const presence = markPresence(mark, filter);
        const late = mark.daysOverdue > 0 && mark.balanceCents > 0;
        const flag = flagOf(mark);
        const open = hoveredId === mark.id;
        /*
         * THE MARK'S OWN OPACITY HAS TO BE A NUMBER HERE, not the token.
         *
         * A `layoutId` element is projected by motion, which writes an inline
         * `opacity` on it every commit — so the stylesheet's `[data-presence]`
         * rule was overruled on all 124 marks and the whole attention pass was
         * invisible, at opacity 1, in the first capture. The tail, the amount
         * and the glyph are plain spans and still read the token; these are the
         * same three values, and `test/lanes.test.ts` asserts the two spellings
         * agree.
         *
         * Hover and the read-out lift it back to full, which is the promise
         * receding by default has to make.
         */
        const opacity = open || picked.has(mark.id) ? 1 : PRESENCE_OPACITY[presence];
        const ident = sharedIdentity(mark.id, live);
        /* Everything about a mark except who owns its `layoutId`. Written once
           so the live and the receding spelling cannot drift apart. */
        const markProps = {
          type: "button" as const,
          className: "ln-mark",
          "data-heat": mark.heat,
          "data-presence": presence,
          "data-open": open,
          "data-picked": picked.has(mark.id),
          tabIndex: index === (roving[lane.id] ?? 0) ? 0 : -1,
          style: { ...markVars(mark, todayX), opacity },
          onMouseEnter: (event: React.MouseEvent<HTMLButtonElement>) =>
            enter(mark, lane, event.currentTarget),
          onFocus: (event: React.FocusEvent<HTMLButtonElement>) => {
            enter(mark, lane, event.currentTarget);
            setRoving((r) => (r[lane.id] === index ? r : { ...r, [lane.id]: index }));
          },
          onMouseLeave: leave,
          onBlur: leave,
          onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
            event.stopPropagation();
            onOpenMark(lane.id, mark.id);
          },
          "aria-label": `${mark.number}, ${mark.clientName}, ${formatMoney(
            mark.balanceCents > 0 ? mark.balanceCents : mark.amountCents,
          )}. ${mark.status}${picked.has(mark.id) ? " Ticked." : ""}`,
        };
        return (
          <span key={mark.id}>
            {late ? (
              <span
                className="ln-tail"
                data-heat={mark.heat}
                data-presence={presence}
                style={markVars(mark, todayX)}
                aria-hidden
              />
            ) : null}
            {labelled.has(mark.id) && presence !== "dim" ? (
              <span
                className="ln-mark-amount"
                data-presence={presence}
                style={markVars(mark, todayX)}
                aria-hidden
              >
                {formatMoneyShort(
                  mark.balanceCents > 0 ? mark.balanceCents : mark.amountCents,
                )}
              </span>
            ) : null}
            {flag ? (
              <span
                className="ln-mark-flag"
                data-heat={mark.heat}
                data-presence={presence}
                style={markVars(mark, todayX)}
                aria-hidden
              >
                {flag}
              </span>
            ) : null}
            {/* Same rule, same helper: the mark holds the id it will become a
                card under only while this level is live. `initial={false}` lands
                the remount that the key flip causes on the value it already had,
                so a hand-over is not an entrance. */}
            <motion.button
              key={ident.key}
              layoutId={ident.layoutId}
              {...markProps}
              initial={false}
              animate={{ opacity }}
              whileHover={{ opacity: 1 }}
              whileFocus={{ opacity: 1 }}
              transition={live ? travel : instant}
            />
          </span>
        );
      })}
      <span className="ln-now" style={{ "--todayX": todayX } as CSSProperties} />
    </div>
  </motion.div>
  );
}

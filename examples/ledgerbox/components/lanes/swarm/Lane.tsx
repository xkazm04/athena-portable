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
import { motion } from "motion/react";
import type { CSSProperties } from "react";

import { formatMoney, formatMoneyShort } from "@/lib/format";
import { matches, type LnFilter, type LnLane, type LnMark } from "../model";
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
  filter,
  picked,
  todayX,
  deck,
  onOpenLane,
  onOpenMark,
}: {
  lane: LnLane;
  index: number;
  filter: LnFilter;
  /** Ticked invoices, ringed at this level. */
  picked: ReadonlySet<string>;
  todayX: number;
  deck: Deck;
  onOpenLane: (id: string) => void;
  onOpenMark: (laneId: string, markId: string) => void;
}) {
  const { byDate, enter, leave, rove, roving, setRoving, hoveredId } = deck;
  const labelled = labelledIn(lane);
  const shown = lane.marks.filter((m) => matches(m, filter)).length;
  const lateShare = lane.owedCents > 0 ? lane.lateCents / lane.owedCents : 0;

  return (
  <div
    key={lane.id}
    className="ln-lane"
    data-lane={lane.id}
    data-heat={lane.heat}
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
      <motion.span layoutId={`lane-name-${lane.id}`} className="ln-lane-name">
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
        const dim = !matches(mark, filter);
        const late = mark.daysOverdue > 0 && mark.balanceCents > 0;
        const flag = flagOf(mark);
        const open = hoveredId === mark.id;
        return (
          <span key={mark.id}>
            {late ? (
              <span
                className="ln-tail"
                data-heat={mark.heat}
                data-dim={dim}
                style={markVars(mark, todayX)}
                aria-hidden
              />
            ) : null}
            {labelled.has(mark.id) && !dim ? (
              <span
                className="ln-mark-amount"
                data-dim={dim}
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
                data-dim={dim}
                style={markVars(mark, todayX)}
                aria-hidden
              >
                {flag}
              </span>
            ) : null}
            <motion.button
              type="button"
              layoutId={mark.id}
              className="ln-mark"
              data-heat={mark.heat}
              data-dim={dim}
              data-open={open}
              data-picked={picked.has(mark.id)}
              tabIndex={index === (roving[lane.id] ?? 0) ? 0 : -1}
              style={markVars(mark, todayX)}
              onMouseEnter={(event) => enter(mark, lane, event.currentTarget)}
              onFocus={(event) => {
                enter(mark, lane, event.currentTarget);
                setRoving((r) => (r[lane.id] === index ? r : { ...r, [lane.id]: index }));
              }}
              onMouseLeave={leave}
              onBlur={leave}
              onClick={(event) => {
                event.stopPropagation();
                onOpenMark(lane.id, mark.id);
              }}
              aria-label={`${mark.number}, ${mark.clientName}, ${formatMoney(
                mark.balanceCents > 0 ? mark.balanceCents : mark.amountCents,
              )}. ${mark.status}${picked.has(mark.id) ? " Ticked." : ""}`}
            />
          </span>
        );
      })}
      <span className="ln-now" style={{ "--todayX": todayX } as CSSProperties} />
    </div>
  </div>
  );
}

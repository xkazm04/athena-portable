"use client";

/**
 * The lane's name, its blurb, its own three figures, and the rails beside it.
 *
 * THE FIGURES ARE NOT DECORATION. L0 opens on three poster numbers and L1 used
 * to open on none — the only count on the screen was the toolbar's, which went
 * on reporting all 124 invoices in the books while a reader stood inside a lane
 * of twelve. The lane gets the same treatment its parent does.
 *
 * The rails are the lanes you are NOT in, collapsed. They stay clickable, so
 * moving sideways between areas never goes back through L0, and each says the
 * one thing that decides whether you would rather be in it: how much of its
 * money is late.
 */
import { motion } from "motion/react";
import type { CSSProperties } from "react";

import { formatMoneyShort } from "@/lib/format";
import type { LnLane, LnSheet } from "../model";

export function SpreadHead({
  sheet,
  lane,
  onOpenLane,
}: {
  sheet: LnSheet;
  lane: LnLane;
  onOpenLane: (id: string) => void;
}) {
  const others = sheet.lanes.filter((l) => l.id !== lane.id);
  return (
    <>
  <div className="ln-spread-head">
    {/* The same element as the lane's name in the L0 gutter: motion matches
        them by id, so the label travels and grows rather than one fading
        out while another fades in somewhere else. */}
    <motion.h2 layoutId={`lane-name-${lane.id}`} className="ln-spread-title">
      {lane.label}
    </motion.h2>
    <p className="ln-spread-blurb">{lane.blurb}</p>
  </div>
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
  {/*
   * The lanes you are not in collapse to rails. They stay clickable, so
   * moving sideways between areas never goes back through L0.
   *
   * They used to be a name beside a 4px hairline carrying 3px dots, which
   * at that scale is a texture rather than a reading — five rows of noise
   * for 130px of the frame. Each rail now says the one thing that decides
   * whether you would rather be in it: how much of its money is late, as a
   * figure and as the red share of its own bar. The marks stay, drawn
   * legibly, because "the lane keeps its shape" is why these are rails and
   * not a menu.
   */}
  <div className="ln-rails">
    {others.map((other) => {
      const share = other.owedCents > 0 ? other.lateCents / other.owedCents : 0;
      return (
        <button
          key={other.id}
          type="button"
          className="ln-rail-strip"
          data-heat={other.heat}
          style={{ "--late": share } as CSSProperties}
          onClick={() => onOpenLane(other.id)}
          aria-label={`Open the ${other.label} lane instead: ${other.count} invoices, ${other.lateCount} of them late, ${formatMoneyShort(other.lateCents)} overdue`}
        >
          <span className="ln-rail-name">{other.label}</span>
          <span className="ln-rail-bar">
            {other.marks.map((m) => (
              <i key={m.id} data-heat={m.heat} style={{ "--x": m.x } as CSSProperties} />
            ))}
          </span>
          <span className="ln-rail-figure num">
            {other.lateCount > 0 ? `${formatMoneyShort(other.lateCents)} late` : "nothing late"}
          </span>
        </button>
      );
    })}
  </div>
  {/*
   * Keyed on the lane, so switching lanes from a rail is a real change of
   * content rather than a silent swap of props: the outgoing cards leave and
   * the incoming ones arrive. Without the key motion sees the same nodes in
   * the same places and animates nothing, which is exactly what the review
   * saw.
   */}
    </>
  );
}

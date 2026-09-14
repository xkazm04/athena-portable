"use client";

/**
 * What a database looks like to the picture — the model and the inks.
 *
 * ROUND 2 PUT THREE PROTOTYPES ON THE PAGE behind a switcher (a CSS plate, a
 * WebGL slab, a WebGL cube of octants) because which drawing of nine databases
 * is right is a judgement about the picture and not about the data. THE OWNER
 * CHOSE THE OCTANTS. The plate and the slab are deleted, the switcher with
 * them, and what is left of this file is the part that was never about which
 * drawing was in the frame: the shape of a cell, the shape of a table's dot,
 * and the four inks a `three` material has to be handed as numbers because it
 * cannot read a custom property.
 *
 * The geometry that used to be here (`POSES`, and the arithmetic of where a
 * cell sits) is `space/camera.ts` and `space/geometry.ts` now: round 3 made L0
 * and L1 one scene, so the geometry is the scene's and not L0's.
 */

import { RecordMark } from "../model";

/* ---------------------------------------------------------------- the model */

/**
 * One table, as the picture draws it: a single dot, carrying two facts.
 *
 * `mark` is WHAT KIND of claim stands on the table, in the direction's own
 * three inks. `weight` is HOW MUCH, against the worst table on the sheet, and it
 * is drawn as the dot's size.
 *
 * Both are needed, and the review is why. One dot per table answers "how many
 * tables" for free; it answers "which table" only if the dots differ. In this
 * seed 43 of the 46 tables touch an open identity pair and all 46 carry
 * something outstanding, so the colour alone paints 46 near-identical dots and
 * the reader is back to reading numbers. The size is what makes a database's
 * shape legible: two heavy dots and three light ones is a different problem from
 * five middling ones, and it is the same fact the L1 slabs print as figures.
 */
export interface L0Dot {
  ident: string;
  name: string;
  /** The same three states the record dots used, asked of a whole table. */
  mark: RecordMark;
  /** This table's outstanding deviations against the worst table's, in [0,1]. */
  weight: number;
}

/** How large a table's dot is drawn, given its weight. Never zero: a table that
 *  carries nothing is still a table, and the count is the other thing L0 says. */
export function dotScale(weight: number): number {
  return 0.62 + 0.68 * weight;
}

/**
 * One database, as a picture needs it.
 *
 * `faulty` is what fills the cell. The review asked for "discoloured when no
 * error, subtle red if error inside", and the honest reading of "error inside"
 * on this sheet is an OUTSTANDING DEVIATION in one of the tables — something a
 * rule could repair and nobody has. A table awaiting a person is counted apart,
 * in gold, for the reason the whole direction is built on: merging destroys a
 * record, so it is not an error a rule may clear.
 */
export interface L0Cell {
  id: string;
  name: string;
  blurb: string;
  tables: number;
  records: number;
  /** Deviations outstanding across the database. The figure the cell prints. */
  outstanding: number;
  /** Tables carrying at least one outstanding deviation. What reddens the fill. */
  faulty: number;
  /** Tables holding an unadjudicated identity pair. */
  attention: number;
  /** Tables carrying nothing outstanding. */
  clear: number;
  /** One dot per table, worst first — the order the slabs are laid out in. */
  dots: L0Dot[];
  /**
   * This database's outstanding work against the worst database's, in [0,1].
   *
   * THE REVIEW ASKED FOR A BINARY WASH — "discoloured when no error, subtle red
   * if error inside" — and the seed does not support one: every one of the nine
   * databases has at least one table in fault, so a binary wash paints nine
   * identical cells and answers nothing. The state is still binary (`fillOf`
   * below, and a database with nothing outstanding really does carry no red at
   * all); what this adds is the STRENGTH of the red, so nine unequal reds rank
   * the nine the way nine unequal numbers would, without the reader having to
   * read nine numbers.
   */
  share: number;
}

/**
 * The fill a cell wears, as the one word the drawing branches on.
 *
 * `quiet` is the review's "discoloured when no error": the cell is still there
 * and still legible, it just makes no claim. `fault` is its "subtle red if error
 * inside" — subtle because on this sheet redline is a mark on a record, and a
 * whole database drawn in full redline would drown the dots that carry the
 * actual finding.
 */
export type L0Fill = "quiet" | "fault";

export function fillOf(cell: L0Cell): L0Fill {
  return cell.faulty > 0 ? "fault" : "quiet";
}

/* ----------------------------------------------------------------- the inks */

/**
 * The inks the scene draws with.
 *
 * The same values `base/tokens.css` declares, restated here because a `three`
 * material takes a colour and cannot read a custom property. This is the only
 * place in the direction where a colour is written twice, it is the same
 * exception round 1's `cube/palette.ts` carried, and the palette itself is not
 * renegotiated: graphite on vellum, redline for a deviation, gold for what only
 * a person may settle.
 */
export const INK = {
  graphite: "#1d1c1a",
  rule: "#c6c1b4",
  redline: "#b3261e",
  greenline: "#2e6b40",
  goldline: "#8a6a12",
  sheet: "#f4f1e9",
  vellum: "#e7e2d6",
} as const;

/** How solid a cell's wash is: enough to read as a fill, never enough to drown a dot. */
export const FILL_QUIET = 0.13;
/** The fault wash, floor and range. See `L0Cell.share` for why it is not flat. */
export const FILL_FAULT = { base: 0.08, span: 0.2 } as const;

/** How solid one cell's wash is. */
export function fillOpacity(cell: L0Cell): number {
  return fillOf(cell) === "quiet" ? FILL_QUIET : FILL_FAULT.base + FILL_FAULT.span * cell.share;
}

/**
 * What ink a cell's wash is, and why `quiet` is GREENLINE rather than an absence.
 *
 * The review asked for "discoloured when no error, subtle red if error inside",
 * and the first cut read the quiet half as an absence: graphite, i.e. a cell that
 * simply makes no claim. That is the wrong claim to make no claim about. A
 * database with nothing outstanding in any of its tables is not unexamined — it
 * is every check on it PASSED, which is exactly what greenline means on this
 * sheet and the one thing the direction reserves it for (`vocabulary.ts` states
 * the rule: green is spent where a check actually passed and never on a nought
 * that means "none"). A reader scanning nine cells for the ones in fault gets a
 * hue difference rather than a saturation difference, which is the difference
 * they can make at a glance.
 *
 * NOTHING IN THIS SEED REACHES IT. All 46 tables carry at least one outstanding
 * deviation, so every one of the nine databases is in fault and the quiet wash
 * has no live data to appear over. It is pinned by `test/l0-fill.test.ts` rather
 * than by a screenshot.
 */
export function fillInk(cell: L0Cell): string {
  return fillOf(cell) === "quiet" ? INK.greenline : INK.redline;
}

/** A frame-rate-independent approach factor, with a ceiling for a stalled frame. */
export const approach = (delta: number, rate: number) => Math.min(0.3, delta * rate);

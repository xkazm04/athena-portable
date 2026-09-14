"use client";

/**
 * The one thing the three L0 prototypes share.
 *
 * WHY THERE ARE THREE. The product owner's review of round 1 said the WebGL cube
 * was hard to manipulate with a mouse drag and that four cells was the wrong
 * model: they want nine databases, each cell filled by state, one dot per table
 * rather than per record, and a reader who can find a database in fault at a
 * glance. There is more than one honest drawing of that, and which one is right
 * is a judgement about the picture, not about the data — so all three are built
 * and all three are on the page behind a switcher, and two of them will be
 * deleted once the owner has chosen.
 *
 *   plate     nine tiles on one 2.5D CSS plate. The pointer tilts it a few
 *             degrees; nothing is draggable. Cheapest by a wide margin.
 *   slab      three.js, nine cells as a 3x3x1 slab. Rotation snaps to four
 *             poses from buttons or the arrow keys; no free drag.
 *   octants   the round-1 cube kept, split 2x2x2 with a centre core for the
 *             ninth. Same snap rotation; the free drag is gone.
 *
 * THE RULE OF THE FOLDERS. Each variant lives in `l0/<variant>/` and imports
 * nothing from any other variant. This file is the only thing all three share,
 * and it holds exactly two kinds of thing: the props the host hands down, and
 * the pure arithmetic more than one drawing of nine cells would otherwise copy.
 * The legend, the caption and the switcher are the HOST's (`l0/L0.tsx`), because
 * they are the same instrument whichever picture is in the frame.
 *
 * THE PLANE IS PUBLISHED, NOT DERIVED. Every variant renders one inert
 * `.bk-l0-plane` box at the rectangle its picture flattens into, and
 * `field/useLanding.ts` measures that box whichever variant is mounted. That is
 * what lets the same four-beat arrival run from a CSS plate and from two WebGL
 * scenes without the L1 side knowing which.
 */

import { RecordMark } from "../model";

/* ------------------------------------------------------------- the variants */

export const L0_VARIANTS = ["plate", "slab", "octants"] as const;
export type L0Variant = (typeof L0_VARIANTS)[number];

export const L0_VARIANT_LABEL: Record<L0Variant, string> = {
  plate: "plate",
  slab: "slab",
  octants: "octants",
};

/** What each prototype is, in the one line the switcher can carry as a title. */
export const L0_VARIANT_NOTE: Record<L0Variant, string> = {
  plate: "Nine tiles on one plate. The pointer tilts it; nothing drags.",
  slab: "Nine cells as a slab, in WebGL. Rotation snaps to four poses.",
  octants: "The cube, split into eight octants and a core. Snap rotation.",
};

export function isL0Variant(value: unknown): value is L0Variant {
  return typeof value === "string" && (L0_VARIANTS as readonly string[]).includes(value);
}

/* ---------------------------------------------------------------- the model */

/**
 * One table, as L0 draws it: a single dot, carrying two facts.
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
 * five middling ones, and it is the same fact the L1 cells will print as figures.
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
  /** One dot per table, worst first — the order L1 lays its cells out in. */
  dots: L0Dot[];
  /**
   * This database's outstanding work against the worst database's, in [0,1].
   *
   * THE REVIEW ASKED FOR A BINARY WASH — "discoloured when no error, subtle red
   * if error inside" — and the seed does not support one: every one of the nine
   * databases has at least one table in fault, so a binary wash paints nine
   * identical tiles and answers nothing. The state is still binary (`fillOf`
   * below, and a database with nothing outstanding really does carry no red at
   * all); what this adds is the STRENGTH of the red, so nine unequal reds rank
   * the nine the way nine unequal numbers would, without the reader having to
   * read nine numbers.
   */
  share: number;
}

/** The props every variant takes, and the only ones it may take. */
export interface L0Props {
  cells: L0Cell[];
  /** The database under the pointer or the focus ring, from the host. */
  hovered: string | null;
  onHover: (id: string | null) => void;
  onOpen: (id: string) => void;
  /** The database whose tables are mid-flight, or null at rest. */
  opening: string | null;
  /**
   * The picture has handed over: the level is L1 and the hold is fading. The
   * variant stays MOUNTED — the cells are standing on the pose it left — but it
   * has nothing more to say, so a WebGL variant stops rendering here.
   */
  out: boolean;
  /** The flatten has finished. The host changes the level on this. */
  onFlattened: () => void;
  reduced: boolean;
}

/* ------------------------------------------------------------- the geometry */

/**
 * The four poses the two WebGL variants snap between, in radians.
 *
 * Four rather than free rotation, and this is the review's finding rather than a
 * simplification: "3D canvas is tough to manipulate with mouse drags". A drag
 * gives a reader an infinity of poses, all but four of which are worse than the
 * one they started from, and no way back to a known one. Four named poses are
 * reachable by button, by arrow key and by a caption that can say which one is
 * on screen.
 */
export interface Pose {
  id: string;
  label: string;
  x: number;
  y: number;
}

export const POSES: readonly Pose[] = [
  { id: "front", label: "front", x: 0.16, y: -0.42 },
  { id: "right", label: "right", x: 0.16, y: -1.15 },
  { id: "top", label: "top", x: 0.92, y: -0.42 },
  { id: "left", label: "left", x: 0.16, y: 0.32 },
];

/**
 * The fill a cell wears, as the one word three drawings all branch on.
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

/**
 * How strongly a cell is drawn, given what the reader is pointing at.
 *
 * One function rather than three copies of the same ternary, because all three
 * pictures owe the reader the same answer: the cell being read is solid, its
 * neighbours step back but stay legible enough to choose, and at rest they are
 * all alike.
 */
export function weightOf(id: string, hovered: string | null, opening: string | null): number {
  if (opening !== null) return opening === id ? 1 : 0;
  if (hovered === null) return 1;
  return hovered === id ? 1 : 0.28;
}

/* ----------------------------------------------------------------- the inks */

/**
 * The inks the WebGL prototypes draw with.
 *
 * The same values `base/tokens.css` declares, restated here because a
 * `three` material takes a colour and cannot read a custom property. This is the
 * only place in the direction where a colour is written twice, it is the same
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

/** How solid one cell's wash is, in the two WebGL prototypes. */
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
 * than by a screenshot, and the shot that shows it is forced.
 */
export function fillInk(cell: L0Cell): string {
  return fillOf(cell) === "quiet" ? INK.greenline : INK.redline;
}

/** Ease out, so everything decelerates onto its target rather than stopping. */
export const ease = (t: number) => 1 - Math.pow(1 - t, 3);

/** A frame-rate-independent approach factor, with a ceiling for a stalled frame. */
export const approach = (delta: number, rate: number) => Math.min(0.3, delta * rate);

/** Near enough to the target pose to be put ON it, in radians: 0.4 of a degree. */
export const SETTLED = 0.007;

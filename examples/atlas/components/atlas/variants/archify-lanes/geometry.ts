/**
 * THE GRID — lanes, columns, phases, and the corridors between them. Archify study §3, Part 2 §4.
 *
 * FOUR NUMBERS DECIDE THIS DRAWING and every other length is derived from them: a node is 130×56
 * (archify's fixed workflow node, study Part 2 §2 — `defaultW 120, defaultH 60`, never fitted to
 * its content), a column is one node plus a 52-unit gap, a lane is one node plus room above and
 * below for a corridor, and the authored world is 1170×578 so that it FITS THE READING COLUMN AT
 * SCALE 1 on a 1440×900 screen with the title band above it and the cards below. Round 5's home pose was a 0.16 zoom-out, which is the single ratio
 * behind every complaint in the owner's verdict: thin lines, a moiré grid, unreadable labels. Here
 * home is 1, the grid is 40 units at home exactly as archify draws it, and `poses.ts` DISABLES
 * ZOOM-OUT BELOW HOME, which is `viewer-camera.js`'s own rule.
 *
 * THE CORRIDORS ARE A PROPERTY OF THE GRID, NOT A SEARCH. On a ragged sheet a router has to find
 * its own lanes (round 5 needed a Dijkstra over a lattice to guarantee it). On a lane diagram the
 * free space is already named: the midline of each column gap, the strip just inside a lane above
 * and below its nodes, the gap between two lanes, and one channel outside each side. Fourteen
 * edges thread eleven of them, `routing.ts` resolves the names, and the test re-checks every
 * result against the same hard predicate rather than trusting the naming.
 *
 * ONE PLAN PER OPEN PHASE. L1 opens a phase, and archify's compiler answers a crowded rank by
 * WIDENING IT (the difference-constraint system, study §3) rather than by shrinking type. So there
 * are four plans — the closed grid and one per phase — and opening a phase adds `GROW` to each gap
 * it touches, which is what makes room for the edge labels L1 reveals. Every plan is built by the
 * same pure function, so the widened plans are as tested as the closed one.
 */
import { LANES, NODES, PHASES, type Channel, type Side, type XRef, type YRef } from "./workflow";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export const centreOf = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
export const contains = (r: Rect, p: Point): boolean =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
export const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/* ------------------------------------------ the numbers -------------------------------------- */

/** Archify's fixed workflow node. Never fitted to its text; the text shrinks to fit IT. */
export const NODE_W = 130;
export const NODE_H = 56;

/** The band every lane is drawn as, and the label strip at its left. */
export const BAND_X = 8;
export const BAND_W = 1154;
export const GUTTER_W = 68;

/** The first column's left edge, and the pitch. */
export const COL_X0 = 100;
export const COL_GAP = 52;
export const COL_PITCH = NODE_W + COL_GAP;

/** How much a gap grows when its phase is open. Enough for the longest suppressed label. */
export const GROW = 46;

export const LANE_TOP0 = 46;
export const LANE_H = 108;
export const LANE_GAP = 14;
/** Where a node sits inside its lane: centred, leaving 26 above and below for the corridors. */
export const NODE_DY = (LANE_H - NODE_H) / 2;

/** How far inside a lane the two horizontal corridors run. */
export const CORRIDOR_IN = 14;
export const CORRIDOR_OUT = 10;

export const HEADER_Y = 8;
export const HEADER_H = 28;
export const LEGEND_GAP = 14;
export const LEGEND_H = 38;

/** The background grid, in world units — archify's 40×40 (study §2). At home it is 40 screen px. */
export const GRID = 40;

/* ------------------------------------------- the plan ---------------------------------------- */

export interface LaneBand extends Rect {
  id: string;
  ord: string;
  label: string;
  note: string;
  variant: "normal" | "exception";
  /** The label strip at the band's left. */
  gutter: Rect;
}

export interface PhaseBand extends Rect {
  id: string;
  label: string;
  note: string;
  variant: "default" | "emphasis" | "dashed";
  /** The header strip above the lanes. */
  header: Rect;
}

export interface NodeBox extends Rect {
  id: string;
  lane: string;
  col: number;
  phase: string;
}

export interface Plan {
  /** The phase this plan has open, or `null` for the closed grid. */
  open: string | null;
  world: Rect;
  /** The drawn extent of the lane stack — what the camera frames at L0. */
  bounds: Rect;
  lanes: readonly LaneBand[];
  phases: readonly PhaseBand[];
  nodes: readonly NodeBox[];
  byId: ReadonlyMap<string, NodeBox>;
  legend: Rect;
  /** Corridor resolution, bound to this plan's own column positions. */
  colLeft: (i: number) => number;
  colCentre: (i: number) => number;
  colRight: (i: number) => number;
  x: (ref: XRef) => number;
  y: (ref: YRef) => number;
}

/**
 * Where column `i` starts, with the open phase's gaps grown.
 *
 * A phase covering `a..b` grows the gap BEFORE it, the gaps INSIDE it, and therefore everything to
 * its right shifts by the total — which is the whole of archify's "adjacent-rank baseline before
 * document-specific constraints", stated as one closed form because there is only one constraint.
 */
function shiftFor(open: string | null, i: number): number {
  const phase = PHASES.find((p) => p.id === open);
  if (!phase) return 0;
  const steps = Math.min(Math.max(i - phase.fromCol + 1, 0), phase.toCol - phase.fromCol + 2);
  return steps * GROW;
}

export function planFor(open: string | null): Plan {
  const colLeft = (i: number) => COL_X0 + i * COL_PITCH + shiftFor(open, i);
  const colCentre = (i: number) => colLeft(i) + NODE_W / 2;
  const colRight = (i: number) => colLeft(i) + NODE_W;

  const laneTop = (index: number) => LANE_TOP0 + index * (LANE_H + LANE_GAP);
  const laneIndex = (id: string) => LANES.findIndex((l) => l.id === id);

  const bandW = colRight(5) + 22 - BAND_X;
  const worldW = Math.max(BAND_W, bandW) + BAND_X + 8;
  const stackBottom = laneTop(LANES.length - 1) + LANE_H;
  const legend: Rect = {
    x: BAND_X,
    y: stackBottom + LEGEND_GAP,
    w: bandW,
    h: LEGEND_H,
  };
  const worldH = legend.y + legend.h + 6;

  const lanes: LaneBand[] = LANES.map((l, i) => ({
    ...l,
    x: BAND_X,
    y: laneTop(i),
    w: bandW,
    h: LANE_H,
    gutter: { x: BAND_X + 8, y: laneTop(i) + 8, w: GUTTER_W - 8, h: LANE_H - 16 },
  }));

  const phases: PhaseBand[] = PHASES.map((p) => {
    const x = colLeft(p.fromCol) - 18;
    const w = colRight(p.toCol) + 18 - x;
    return {
      ...p,
      x,
      y: HEADER_Y,
      w,
      h: stackBottom - HEADER_Y,
      header: { x, y: HEADER_Y, w, h: HEADER_H },
    };
  });

  const nodes: NodeBox[] = NODES.map((n) => ({
    id: n.id,
    lane: n.lane,
    col: n.col,
    phase: PHASES.find((p) => n.col >= p.fromCol && n.col <= p.toCol)!.id,
    x: colLeft(n.col),
    y: laneTop(laneIndex(n.lane)) + NODE_DY,
    w: NODE_W,
    h: NODE_H,
  }));

  const x = (ref: XRef): number => {
    if ("col" in ref) return colCentre(ref.col);
    if ("colGap" in ref) return (colRight(ref.colGap) + colLeft(ref.colGap + 1)) / 2;
    return ref.outside === "left" ? (BAND_X + GUTTER_W + COL_X0) / 2 : colRight(5) + 14;
  };

  const y = (ref: YRef): number => {
    if ("lane" in ref) return laneTop(laneIndex(ref.lane)) + LANE_H / 2;
    if ("laneAbove" in ref) return laneTop(laneIndex(ref.laneAbove)) + CORRIDOR_IN;
    if ("laneBelow" in ref)
      return laneTop(laneIndex(ref.laneBelow)) + LANE_H - CORRIDOR_OUT;
    return laneTop(ref.laneGap) + LANE_H + LANE_GAP / 2;
  };

  return {
    open,
    world: { x: 0, y: 0, w: worldW, h: worldH },
    bounds: { x: BAND_X, y: HEADER_Y, w: bandW, h: legend.y + legend.h - HEADER_Y },
    lanes,
    phases,
    nodes,
    byId: new Map(nodes.map((n) => [n.id, n])),
    legend,
    colLeft,
    colCentre,
    colRight,
    x,
    y,
  };
}

/** The four plans, built once. `null` is the closed grid; the rest are the three phases open. */
export const PLANS: Record<string, Plan> = Object.fromEntries([
  ["closed", planFor(null)],
  ...PHASES.map((p) => [p.id, planFor(p.id)] as const),
]);

export const planOf = (open: string | null): Plan => PLANS[open ?? "closed"] ?? PLANS.closed!;

/** The port on a node's side, displaced by the edge's authored offset. */
export function portOf(r: Rect, side: Side, off = 0): Point {
  switch (side) {
    case "top":
      return { x: r.x + r.w / 2 + off, y: r.y };
    case "bottom":
      return { x: r.x + r.w / 2 + off, y: r.y + r.h };
    case "left":
      return { x: r.x, y: r.y + r.h / 2 + off };
    default:
      return { x: r.x + r.w, y: r.y + r.h / 2 + off };
  }
}

export const isVerticalSide = (side: Side): boolean => side === "top" || side === "bottom";

/** Resolve one authored channel against a plan. */
export const channelValue = (plan: Plan, c: Channel): { axis: "x" | "y"; at: number } =>
  "x" in c ? { axis: "x", at: plan.x(c.x) } : { axis: "y", at: plan.y(c.y) };

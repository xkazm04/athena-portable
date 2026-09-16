/**
 * OBSTACLE-AWARE ORTHOGONAL ROUTING: candidate families, a hard feasibility filter, and a
 * lexicographic cost vector with a stable tiebreak.
 *
 * ROUND 4 ROUTED BY FORMULA. `routeOrtho` took two rectangles and a rank and emitted a Z: leave
 * the facing side, travel the corridor between the two, enter the facing side. It is three lines
 * of arithmetic and it is right about nine tenths of the time — and the tenth is what the round-4
 * capture shows, because a formula that cannot see anything but its own two rectangles draws a run
 * straight through a region's heading and through the title bar of a block it has nothing to do
 * with. The drawing then has lines a reader cannot follow across text they cannot read.
 *
 * ROUND 5 ROUTES BY SEARCH, which is the archify study §3 practice adapted to this sheet:
 *
 *   1. GENERATE a set of candidate polylines from nine families, each parameterised by a corridor
 *      offset — not one answer, a space of answers.
 *   2. FILTER by a HARD predicate. Orthogonal; endpoint sides honoured; no segment under the
 *      rhythm floor; and — the part this round is for — no segment crossing an obstacle that
 *      carries TEXT: a region's heading, a block's title bar, or a run label already placed.
 *      A drawing may put a line across a rectangle; it may not put a line across a word.
 *   3. RANK what survives by a lexicographic cost vector, so that the ordering between two
 *      criteria is a decision made once and written down rather than a weight somebody tuned:
 *
 *        crossings → block intrusions → label clearance → shared corridor → bends → length →
 *        port displacement → ordinal
 *
 *      Crossings first because a crossing is the one defect a reader cannot recover from by
 *      looking harder; length almost last because a longer run that stays in a clear corridor is
 *      easier to follow than a short one that threads between two titles. The final ordinal is the
 *      candidate's own index, which makes the output byte-deterministic: the same model always
 *      produces the same sheet, and `test/route.test.ts` can assert on the geometry.
 *
 * ROUTES ARE PLACED IN ORDER AND BECOME OBSTACLES THEMSELVES — first their labels, then their
 * corridors as a shared-corridor cost. So the heaviest system edge is routed first and gets the
 * clean corridor, and the tenth edge across the same gap knows where the first nine went. The
 * order is the caller's (weight descending, then id), never the model's iteration order.
 *
 * Pure, total, no React and no DOM: `test/route.test.ts` pins feasibility and determinism.
 */
import {
  DIM,
  overlaps,
  portOf,
  routeOrtho,
  type Point,
  type Rect,
  type Run,
  type Side,
} from "./geometry";

/* --------------------------------------- what is in the way --------------------------------------- */

/**
 * WHAT COUNTS AS AN OBSTACLE, and the distinction is the whole design.
 *
 *   `text`  a rectangle a run may NOT cross at any cost: a region's heading, a block's title bar,
 *           a label already placed. All of them carry words.
 *   `body`  a rectangle a run SHOULD not cross: the body of a block it is not connected to.
 *           Crossing one is a cost, not a refusal, because a sheet packed to the density this
 *           model has cannot always be routed without one and a missing run is worse than a run
 *           over a rectangle.
 */
export type ObstacleKind = "text" | "body";

export interface Obstacle extends Rect {
  id: string;
  kind: ObstacleKind;
}

/** The minimum a segment may be, so a run reads as corners rather than as a stair. */
const MIN_SEG = DIM.stub;
/** How far a label must stand off a run that is not its own. */
const LABEL_CLEAR = DIM.lane;

/* ----------------------------------------- the arithmetic ----------------------------------------- */

interface Seg {
  a: Point;
  b: Point;
  /** True when the segment runs along x. */
  h: boolean;
  lo: number;
  hi: number;
  /** The constant coordinate: y for a horizontal segment, x for a vertical one. */
  at: number;
}

function segmentsOf(points: readonly Point[]): Seg[] {
  const out: Seg[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (a.x === b.x && a.y === b.y) continue;
    const h = a.y === b.y;
    out.push({
      a,
      b,
      h,
      lo: h ? Math.min(a.x, b.x) : Math.min(a.y, b.y),
      hi: h ? Math.max(a.x, b.x) : Math.max(a.y, b.y),
      at: h ? a.y : a.x,
    });
  }
  return out;
}

const len = (s: Seg) => s.hi - s.lo;

/** Does an axis-aligned segment pass through the interior of a rectangle? Touching is not crossing. */
function segmentHits(s: Seg, r: Rect): boolean {
  const x0 = r.x;
  const x1 = r.x + r.w;
  const y0 = r.y;
  const y1 = r.y + r.h;
  if (s.h) {
    if (s.at <= y0 || s.at >= y1) return false;
    return s.hi > x0 && s.lo < x1;
  }
  if (s.at <= x0 || s.at >= x1) return false;
  return s.hi > y0 && s.lo < y1;
}

/** A proper crossing: two perpendicular segments meeting at a point interior to both. */
function crosses(a: Seg, b: Seg): boolean {
  if (a.h === b.h) return false;
  const h = a.h ? a : b;
  const v = a.h ? b : a;
  return v.at > h.lo && v.at < h.hi && h.at > v.lo && h.at < v.hi;
}

/** How much two same-axis segments share a corridor: collinear-ish overlap, in world units. */
function shared(a: Seg, b: Seg): number {
  if (a.h !== b.h) return 0;
  if (Math.abs(a.at - b.at) > DIM.lane) return 0;
  return Math.max(0, Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo));
}

/** The shortest distance from a point to a segment, for label clearance. */
function distanceToSeg(s: Seg, p: Point): number {
  if (s.h) {
    const dx = p.x < s.lo ? s.lo - p.x : p.x > s.hi ? p.x - s.hi : 0;
    return Math.hypot(dx, p.y - s.at);
  }
  const dy = p.y < s.lo ? s.lo - p.y : p.y > s.hi ? p.y - s.hi : 0;
  return Math.hypot(p.x - s.at, dy);
}

/* ------------------------------------------ the candidates ------------------------------------------ */

/** The two clear columns beside the whole drawing, so a route always exists. */
export interface Channels {
  left: number;
  right: number;
}

/**
 * THE CLEAR CORRIDORS THE ARRANGEMENT ALREADY LEFT — the study's `column-gap-corridor` and
 * `lane-gap-corridor` (§3), and the family that keeps this drawing from hugging its own margins.
 *
 * `packRows` puts a gap between every two blocks in a row and between every two rows; those gaps
 * are, by construction, free of blocks, titles and headings. Handing the router the middle of each
 * one turns "find a way through" into "pick a corridor", and the difference is visible: without
 * them two thirds of the layers view's runs went out to the edge of the sheet and came back,
 * because the only routes that cleared every word were the outside channels.
 */
export interface Corridors {
  /** Vertical corridors: x positions with no block on them. */
  xs: readonly number[];
  /** Horizontal corridors: y positions in the band between two rows. */
  ys: readonly number[];
}

export type Family =
  | "column-gap"
  | "lane-gap"
  | "facing-straight"
  | "mid-vertical"
  | "mid-horizontal"
  | "h-then-v"
  | "v-then-h"
  | "outside-left"
  | "outside-right"
  | "top-corridor"
  | "bottom-corridor";

interface Candidate {
  points: Point[];
  from: Side;
  to: Side;
  family: Family;
  /** How far the ports were moved off the centre of their side. */
  displaced: number;
  ordinal: number;
}

const LANES = [0, 1, -1, 2, -2, 3, -3];

/** Where a run leaves a side, allowed to slide along it so two runs do not share one port. */
function port(r: Rect, side: Side, slide: number): Point {
  const p = portOf(r, side);
  const room = (side === "top" || side === "bottom" ? r.w : r.h) / 2 - DIM.stub;
  const off = Math.max(-room, Math.min(room, slide));
  return side === "top" || side === "bottom" ? { x: p.x + off, y: p.y } : { x: p.x, y: p.y + off };
}

/** The four facing relations, decided by the rectangles and never by the caller. */
function facing(a: Rect, b: Rect): { v: boolean; down: boolean; rightward: boolean } {
  const v = b.y >= a.y + a.h || a.y >= b.y + b.h;
  return { v, down: b.y >= a.y + a.h, rightward: b.x + b.w / 2 >= a.x + a.w / 2 };
}

function build(a: Rect, b: Rect, escape: Channels | null, corridors: Corridors | null): Candidate[] {
  const out: Candidate[] = [];
  const { v, down, rightward } = facing(a, b);
  const push = (c: Omit<Candidate, "ordinal">) => {
    out.push({ ...c, ordinal: out.length });
  };

  const vFrom: Side = down ? "bottom" : "top";
  const vTo: Side = down ? "top" : "bottom";
  const hFrom: Side = rightward ? "right" : "left";
  const hTo: Side = rightward ? "left" : "right";

  /* 1. Straight, when the two are already lined up on one axis. Nothing beats no corners. */
  const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (v && overlapX > DIM.stub * 2) {
    const x = (Math.max(a.x, b.x) + Math.min(a.x + a.w, b.x + b.w)) / 2;
    push({
      points: [
        { x, y: down ? a.y + a.h : a.y },
        { x, y: down ? b.y : b.y + b.h },
      ],
      from: vFrom,
      to: vTo,
      family: "facing-straight",
      displaced: Math.abs(x - (a.x + a.w / 2)) + Math.abs(x - (b.x + b.w / 2)),
    });
  }
  if (!v && overlapY > DIM.stub * 2) {
    const y = (Math.max(a.y, b.y) + Math.min(a.y + a.h, b.y + b.h)) / 2;
    push({
      points: [
        { x: rightward ? a.x + a.w : a.x, y },
        { x: rightward ? b.x : b.x + b.w, y },
      ],
      from: hFrom,
      to: hTo,
      family: "facing-straight",
      displaced: Math.abs(y - (a.y + a.h / 2)) + Math.abs(y - (b.y + b.h / 2)),
    });
  }

  /* 2. The round-4 Z, now one family among nine: a corridor in the gap, at several offsets. */
  for (const lane of LANES) {
    const slide = lane * DIM.lane * 2;
    {
      const p0 = port(a, vFrom, slide);
      const p3 = port(b, vTo, -slide);
      const mid = (p0.y + p3.y) / 2 + lane * DIM.lane;
      push({
        points: [p0, { x: p0.x, y: mid }, { x: p3.x, y: mid }, p3],
        from: vFrom,
        to: vTo,
        family: "mid-vertical",
        displaced: Math.abs(slide) * 2,
      });
    }
    {
      const p0 = port(a, hFrom, slide);
      const p3 = port(b, hTo, -slide);
      const gap = rightward ? b.x - (a.x + a.w) : a.x - (b.x + b.w);
      const mid =
        gap > DIM.elbow * 2
          ? (p0.x + p3.x) / 2 + lane * DIM.lane
          : (rightward ? p0.x + DIM.elbow : p0.x - DIM.elbow) + lane * DIM.lane;
      push({
        points: [p0, { x: mid, y: p0.y }, { x: mid, y: p3.y }, p3],
        from: hFrom,
        to: hTo,
        family: "mid-horizontal",
        displaced: Math.abs(slide) * 2,
      });
    }
  }

  /* 3. The two L's. One corner, which is the cheapest shape after a straight line. */
  for (const lane of [0, 1, -1]) {
    const slide = lane * DIM.lane * 2;
    const p0 = port(a, hFrom, slide);
    const x = b.x + b.w / 2 + slide;
    push({
      points: [p0, { x, y: p0.y }, { x, y: down ? b.y : b.y + b.h }],
      from: hFrom,
      to: vTo,
      family: "h-then-v",
      displaced: Math.abs(slide) * 2,
    });
    const q0 = port(a, vFrom, slide);
    const y = b.y + b.h / 2 + slide;
    push({
      points: [q0, { x: q0.x, y }, { x: rightward ? b.x : b.x + b.w, y }],
      from: vFrom,
      to: hTo,
      family: "v-then-h",
      displaced: Math.abs(slide) * 2,
    });
  }

  /* 4. The outside channels: leave sideways, run a clear column past everything, come back. A run
        that cannot find a corridor between the blocks takes the margin, which is what a draughtsman
        does and what archify calls `outside-left` / `outside-right`. */
  for (const step of [1, 2, 3]) {
    const reach = DIM.elbow * 2 * step + DIM.gapX / 2;
    {
      const x = Math.min(a.x, b.x) - reach;
      push({
        points: [
          portOf(a, "left"),
          { x, y: a.y + a.h / 2 },
          { x, y: b.y + b.h / 2 },
          portOf(b, "left"),
        ],
        from: "left",
        to: "left",
        family: "outside-left",
        displaced: 0,
      });
    }
    {
      const x = Math.max(a.x + a.w, b.x + b.w) + reach;
      push({
        points: [
          portOf(a, "right"),
          { x, y: a.y + a.h / 2 },
          { x, y: b.y + b.h / 2 },
          portOf(b, "right"),
        ],
        from: "right",
        to: "right",
        family: "outside-right",
        displaced: 0,
      });
    }
    {
      const y = Math.min(a.y, b.y) - reach;
      push({
        points: [
          portOf(a, "top"),
          { x: a.x + a.w / 2, y },
          { x: b.x + b.w / 2, y },
          portOf(b, "top"),
        ],
        from: "top",
        to: "top",
        family: "top-corridor",
        displaced: 0,
      });
    }
    {
      const y = Math.max(a.y + a.h, b.y + b.h) + reach;
      push({
        points: [
          portOf(a, "bottom"),
          { x: a.x + a.w / 2, y },
          { x: b.x + b.w / 2, y },
          portOf(b, "bottom"),
        ],
        from: "bottom",
        to: "bottom",
        family: "bottom-corridor",
        displaced: 0,
      });
    }
  }

  /* 4b. THE GAPS THE ARRANGEMENT ALREADY LEFT. Out into the row gap, along a clear column, back
        into the target's row gap, and in — every segment in space that has no block in it. The
        four nearest columns and the four nearest rows to the pair, so the run takes the corridor
        beside it rather than the one on the other side of the sheet. */
  if (corridors) {
    const midX = (a.x + a.w / 2 + b.x + b.w / 2) / 2;
    const midY = (a.y + a.h / 2 + b.y + b.h / 2) / 2;
    const downward = b.y + b.h / 2 >= a.y + a.h / 2;
    const aSide: Side = downward ? "bottom" : "top";
    const bSide: Side = downward ? "top" : "bottom";
    const aY = downward ? a.y + a.h + DIM.elbow : a.y - DIM.elbow;
    const bY = downward ? b.y - DIM.elbow : b.y + b.h + DIM.elbow;

    const nearest = (all: readonly number[], to: number, n: number) =>
      [...all].sort((p, q) => Math.abs(p - to) - Math.abs(q - to)).slice(0, n);

    for (const x of nearest(corridors.xs, midX, 6)) {
      push({
        points: [
          portOf(a, aSide),
          { x: a.x + a.w / 2, y: aY },
          { x, y: aY },
          { x, y: bY },
          { x: b.x + b.w / 2, y: bY },
          portOf(b, bSide),
        ],
        from: aSide,
        to: bSide,
        family: "column-gap",
        displaced: 0,
      });
    }

    const rightward2 = b.x + b.w / 2 >= a.x + a.w / 2;
    const hA: Side = rightward2 ? "right" : "left";
    const hB: Side = rightward2 ? "left" : "right";
    const aX = rightward2 ? a.x + a.w + DIM.elbow : a.x - DIM.elbow;
    const bX = rightward2 ? b.x - DIM.elbow : b.x + b.w + DIM.elbow;
    for (const y of nearest(corridors.ys, midY, 6)) {
      push({
        points: [
          portOf(a, hA),
          { x: aX, y: a.y + a.h / 2 },
          { x: aX, y },
          { x: bX, y },
          { x: bX, y: b.y + b.h / 2 },
          portOf(b, hB),
        ],
        from: hA,
        to: hB,
        family: "lane-gap",
        displaced: 0,
      });
    }
  }

  /* 5. THE GUARANTEE, and it is the family that makes the search total.
   *
   * Leave into the GAP beside the block — the clear band `packRows` leaves between two rows, which
   * no block, no title and no heading is ever in — run out to the margin past the edge of the whole
   * drawing, come back in the gap beside the target, and enter it perpendicular. Five segments,
   * every one of them in space that is clear by construction, which is why `test/route.test.ts` can
   * assert that no edge ever falls back to round 4's formula rather than "not many do".
   */
  if (escape) {
    const downward = b.y + b.h / 2 >= a.y + a.h / 2;
    const aSide: Side = downward ? "bottom" : "top";
    const bSide: Side = downward ? "top" : "bottom";
    const aY = downward ? a.y + a.h + DIM.elbow : a.y - DIM.elbow;
    const bY = downward ? b.y - DIM.elbow : b.y + b.h + DIM.elbow;
    for (const side of ["left", "right"] as const) {
      const x = side === "left" ? escape.left : escape.right;
      push({
        points: [
          portOf(a, aSide),
          { x: a.x + a.w / 2, y: aY },
          { x, y: aY },
          { x, y: bY },
          { x: b.x + b.w / 2, y: bY },
          portOf(b, bSide),
        ],
        from: aSide,
        to: bSide,
        family: side === "left" ? "outside-left" : "outside-right",
        displaced: 0,
      });
    }
  }

  if (escape) {
    push({
      points: [
        portOf(a, "left"),
        { x: escape.left, y: a.y + a.h / 2 },
        { x: escape.left, y: b.y + b.h / 2 },
        portOf(b, "left"),
      ],
      from: "left",
      to: "left",
      family: "outside-left",
      displaced: 0,
    });
    push({
      points: [
        portOf(a, "right"),
        { x: escape.right, y: a.y + a.h / 2 },
        { x: escape.right, y: b.y + b.h / 2 },
        portOf(b, "right"),
      ],
      from: "right",
      to: "right",
      family: "outside-right",
      displaced: 0,
    });
  }

  return out;
}

/* ------------------------------------------ feasibility ------------------------------------------ */

/** The endpoints' own rectangles, which a run is allowed to touch because it is attached to them. */
interface Ends {
  a: Rect;
  b: Rect;
}

function feasible(segs: Seg[], candidate: Candidate, walls: readonly Obstacle[], ends: Ends): boolean {
  if (segs.length === 0) return false;

  /* The rhythm floor (study §1: archify rejects a segment under eight pixels or an interior turn under sixteen). A first or
     last segment shorter than a stub is a run that leaves its port sideways. */
  for (const s of segs) if (len(s) < MIN_SEG) return false;

  /* The endpoint-side contract: the first segment leaves perpendicular to the side it left by, and
     the last enters perpendicular to the side it entered by. */
  const first = segs[0]!;
  const last = segs[segs.length - 1]!;
  const perpendicular = (s: Seg, side: Side) =>
    side === "top" || side === "bottom" ? !s.h : s.h;
  if (!perpendicular(first, candidate.from)) return false;
  if (!perpendicular(last, candidate.to)) return false;

  /* THE HARD RULE OF THE ROUND: no line across a word. */
  for (const s of segs) {
    for (const w of walls) {
      if (w.kind !== "text") continue;
      if (segmentHits(s, w)) return false;
    }
  }

  /* A run may pass over a block it is not connected to (at a cost, below) but never START inside
     one that is not its own: that is a run with no visible origin. */
  for (const w of walls) {
    if (w.kind !== "body") continue;
    if (overlaps(ends.a, w) || overlaps(ends.b, w)) continue;
    const p = segs[0]!.a;
    if (p.x > w.x && p.x < w.x + w.w && p.y > w.y && p.y < w.y + w.h) return false;
  }

  return true;
}

/* -------------------------------------------- the cost -------------------------------------------- */

/**
 * The cost vector, most significant first. Compared lexicographically and never summed: a weighted
 * sum is a set of exchange rates nobody wrote down, and the first time two of them are within a
 * factor of each other the ranking becomes an accident.
 */
export type Cost = readonly [
  crossings: number,
  intrusions: number,
  labelDeficit: number,
  sharedCorridor: number,
  length: number,
  bends: number,
  displaced: number,
  ordinal: number,
];

export const compareCost = (a: Cost, b: Cost): number => {
  for (let i = 0; i < a.length; i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
};

function costOf(
  segs: Seg[],
  candidate: Candidate,
  walls: readonly Obstacle[],
  placed: readonly Seg[][],
  labels: readonly Point[],
  ends: Ends,
): Cost {
  let crossings = 0;
  let sharedPx = 0;
  for (const other of placed) {
    for (const s of segs) {
      for (const o of other) {
        if (crosses(s, o)) crossings += 1;
        sharedPx += shared(s, o);
      }
    }
  }

  let intrusions = 0;
  for (const w of walls) {
    if (w.kind !== "body") continue;
    if (overlaps(ends.a, w) || overlaps(ends.b, w)) continue;
    for (const s of segs) if (segmentHits(s, w)) intrusions += 1;
  }

  let deficit = 0;
  for (const p of labels) {
    let near = Infinity;
    for (const s of segs) near = Math.min(near, distanceToSeg(s, p));
    if (near < LABEL_CLEAR) deficit += LABEL_CLEAR - near;
  }

  let length = 0;
  for (const s of segs) length += len(s);

  return [
    crossings,
    intrusions,
    Math.round(deficit),
    Math.round(sharedPx),
    /* LENGTH BEFORE BENDS, and it is the one ordering that was decided by looking rather than by
       argument. Bends-first is the obvious reading of "a run is read by following corners", and it
       produced a sheet where two thirds of the runs went out to the margin and back: a three-bend
       route round the outside of the drawing beats a five-bend route through the gap beside it on
       bend count, and loses to it badly on every other measure a reader has. Archify ranks forward
       px first for the same reason (study §3). Bends still break the tie between two routes of
       similar length, which is where they belong. */
    Math.round(length),
    segs.length - 1,
    Math.round(candidate.displaced),
    candidate.ordinal,
  ];
}

/* --------------------------------------------- the API --------------------------------------------- */

export interface Routed extends Run {
  family: Family;
  cost: Cost;
  /** Where this run's label sits, with its own opaque mask. Null when the run carries none. */
  labelAt: Point | null;
  /** True when no candidate was feasible and the round-4 formula answered instead. */
  fallback: boolean;
  /** True when the run had to be routed ignoring the labels already placed (see `route`). */
  relaxed: boolean;
}

/**
 * Where a label can go on a run: the middle of the longest segment, and if that is over a word or a
 * title, the next place along, and then the next segment.
 *
 * ARCHIFY'S REPAIR ORDER (study §3) is "move the label → adjust the route → shorten the wording,
 * never delete a label". This does the first, declines the second (the route was chosen on harder
 * criteria than where its label lands), and answers `null` rather than putting two characters on
 * top of a name — which is the one outcome a mask cannot rescue, because the mask would hide the
 * name instead.
 */
function placeLabel(segs: readonly Seg[], size: { w: number; h: number }, walls: readonly Obstacle[]): Point | null {
  const order = [...segs].sort((x, y) => len(y) - len(x));
  for (const s of order) {
    if (len(s) < size.h) continue;
    for (const t of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.15, 0.85]) {
      const along = s.lo + (s.hi - s.lo) * t;
      const at: Point = s.h ? { x: along, y: s.at } : { x: s.at, y: along };
      const box: Rect = { x: at.x - size.w / 2, y: at.y - size.h / 2, w: size.w, h: size.h };
      let clear = true;
      for (const w of walls) {
        if (w.kind !== "text") continue;
        if (overlaps(box, w)) {
          clear = false;
          break;
        }
      }
      if (clear) return at;
    }
  }
  return null;
}

/** A router that remembers what it has already drawn. One per plan; used in a deterministic order. */
export class Router {
  private walls: Obstacle[];
  private placed: Seg[][] = [];
  private labels: Point[] = [];
  private escape: Channels | null;
  private corridors: Corridors | null;

  constructor(
    walls: readonly Obstacle[],
    escape: Channels | null = null,
    corridors: Corridors | null = null,
  ) {
    this.walls = [...walls];
    this.escape = escape;
    /**
     * A CORRIDOR THAT RUNS THROUGH A HEADING IS NOT A CORRIDOR, so it is struck off once, here,
     * rather than generated and rejected for every one of the forty edges.
     *
     * A region's heading claims the left 45% of its top edge (`HEAD_SHARE`), which means every
     * vertical corridor under it is blocked for the whole height of the sheet — and the four
     * nearest corridors to a pair of blocks on the left of the drawing were all of them. That is
     * why the first version of this family never won: it was not worse, it was infeasible, and the
     * search was spending its candidates finding that out.
     */
    const clear = (v: number, lo: (w: Obstacle) => number, hi: (w: Obstacle) => number) =>
      walls.every((w) => w.kind !== "text" || v <= lo(w) || v >= hi(w));
    this.corridors = corridors
      ? {
          xs: corridors.xs.filter((x) => clear(x, (w) => w.x, (w) => w.x + w.w)),
          ys: corridors.ys.filter((y) => clear(y, (w) => w.y, (w) => w.y + w.h)),
        }
      : null;
  }

  /**
   * Route one edge, place its label, and remember both.
   *
   * `labelSize` is the world-unit box the label will occupy; passing `null` routes an unlabelled
   * run. The label goes at the middle of the run's LONGEST segment, which is the one place on a
   * polyline where a word has room on both sides, and is then added to the wall list — so the next
   * run cannot cross it. That is the study's "labels are obstacles for later routes" (§7.7), and it
   * is the difference between a drawing that stays legible as it fills up and one that does not.
   */
  route(a: Rect, b: Rect, labelSize: { w: number; h: number } | null): Routed {
    const ends: Ends = { a, b };
    const candidates = build(a, b, this.escape, this.corridors);

    /**
     * TWO PASSES, AND THE DIFFERENCE BETWEEN THEM IS A DESIGN DECISION ABOUT MASKS.
     *
     * Pass one routes against everything, labels included — the study's "labels are obstacles for
     * later routes". Pass two, reached only when pass one has no answer at all, drops the LABELS
     * and keeps the structure. That is not a compromise of the rule, it is the rule stated
     * precisely: a run that passes behind a label is hidden by that label's own opaque mask and the
     * reader sees neither a crossing nor a broken word, while a run across a region's heading has
     * no mask to hide behind and is exactly the defect round 4 shipped. So headings and title bars
     * are absolute and labels are best-effort, and `relaxed` counts how often it mattered.
     */
    const structural = this.walls.filter((w) => !w.id.startsWith("label:"));

    const search = (walls: readonly Obstacle[]) => {
      let best: { c: Candidate; segs: Seg[]; cost: Cost } | null = null;
      for (const c of candidates) {
        const segs = segmentsOf(c.points);
        if (!feasible(segs, c, walls, ends)) continue;
        const cost = costOf(segs, c, this.walls, this.placed, this.labels, ends);
        if (!best || compareCost(cost, best.cost) < 0) best = { c, segs, cost };
      }
      return best;
    };

    let relaxed = false;
    let best = search(this.walls);
    if (!best) {
      relaxed = true;
      best = search(structural);
    }

    if (!best) {
      /* Nothing was feasible. Rather than drop the edge — a missing run is a lie about the model —
         fall back to round 4's formula and MARK it, so the test can count how often the search
         fails and the number can be argued about instead of hidden. */
      const run = routeOrtho(a, b, 0);
      const segs = segmentsOf(run.points);
      this.placed.push(segs);
      return {
        ...run,
        family: "mid-vertical",
        cost: [9, 9, 9, 9, 9, 9, 9, 9],
        labelAt: null,
        fallback: true,
        relaxed,
      };
    }

    const { c, segs, cost } = best;
    const at: Point | null = labelSize ? placeLabel(segs, labelSize, this.walls) : null;

    this.placed.push(segs);
    if (at && labelSize) {
      this.labels.push(at);
      this.walls.push({
        id: `label:${this.walls.length}`,
        kind: "text",
        x: at.x - labelSize.w / 2,
        y: at.y - labelSize.h / 2,
        w: labelSize.w,
        h: labelSize.h,
      });
    }

    const points = c.points;
    return {
      points,
      from: c.from,
      to: c.to,
      down: (points[points.length - 1]?.y ?? 0) > (points[0]?.y ?? 0),
      family: c.family,
      cost,
      labelAt: at,
      fallback: false,
      relaxed,
    };
  }

  /** Every wall the router is routing against, including the labels it has placed. For the tests. */
  get obstacles(): readonly Obstacle[] {
    return this.walls;
  }
}

/** Does any segment of a run cross this rectangle? The predicate `test/route.test.ts` asserts with. */
export function runHits(points: readonly Point[], r: Rect): boolean {
  return segmentsOf(points).some((s) => segmentHits(s, r));
}

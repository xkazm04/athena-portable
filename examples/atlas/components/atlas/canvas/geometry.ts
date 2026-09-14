/**
 * THE DRAWING BOARD, IN WORLD UNITS. One geometry, four arrangements, no pixels.
 *
 * Round 4 throws the machine away. The owner's verdict on round 3 is the premise of this file:
 * *"designing app architecture as a 'building' is not the right direction; looking at it as a 2D
 * diagram of components in a canvas with switchable views in blueprint structure would fit much
 * better."* So there is no depth axis, no plane, no riser and no pipe — there is a **sheet**, and
 * on it rectangles, ports and orthogonal runs, which is what an architecture drawing has been
 * made of since long before anybody had a GPU.
 *
 * THE AXES, once, so no call site guesses:
 *
 *   +X  across the sheet, left to right
 *   +Y  DOWN the sheet. A dependency runs down; a reach runs up. That is the same sign convention
 *       round 3 used (README §3.1 prints surfaces first), now expressed in the axis a reader's eye
 *       actually travels rather than in a camera-relative "up".
 *
 * WORLD UNITS, NOT PIXELS. `design/check-tokens.mjs` bans a raw `px` outside the token file and it
 * is right to: a pixel is a design decision. Everything here is a dimensionless world unit and the
 * camera decides what one costs — `zoom` is units→pixels and nothing else.
 *
 * ONE SIZE PER BLOCK, IN EVERY VIEW. A view switch is a *layout transition of the same elements*
 * (DESIGN.md §3), which is only true if a block is the same rectangle in all four arrangements and
 * only its position moves. So `sizeOf` depends on the model and never on the view, and every view
 * builder below may choose a block's x and y and nothing else about it.
 *
 * Pure, total, no React and no DOM: `test/plan.test.ts` pins every consequence under `node --test`.
 */

export interface Point {
  x: number;
  y: number;
}

/** Top-left origin, because a sheet is read from its corner. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const centreOf = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export const contains = (r: Rect, p: Point): boolean =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

export const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The smallest rectangle holding all of them. An empty list has no bounds and answers a point. */
export function boundsOf(rects: readonly Rect[]): Rect {
  if (rects.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    if (r.x < x0) x0 = r.x;
    if (r.y < y0) y0 = r.y;
    if (r.x + r.w > x1) x1 = r.x + r.w;
    if (r.y + r.h > y1) y1 = r.y + r.h;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/* ------------------------------------- the dimensions ------------------------------------- */

/**
 * Every number the drawing is made of, in one block, so the sheet can be tuned in one place and
 * the tests can assert the consequences rather than the constants.
 *
 * The two that were chosen by looking rather than by arithmetic are `cols` and `partCols`, and
 * both are rule 15 ("a place needs a floor size"). FIVE blocks across puts the layers sheet at
 * 1788 x 1370 world units, which is near enough the stage's own aspect that the whole drawing
 * lands at a zoom where a block is about 150 screen pixels wide on a laptop and 215 on a 2560
 * display — wide enough for the longest system name in the model ("The composition root") to be
 * read at L0 without truncation, which is the test the number was chosen against. THREE part
 * columns is what keeps the eight-module systems from making the surfaces band twice as tall as
 * every other band; at L1's zoom a part is still ~115 pixels wide.
 */
export const DIM = {
  /** A block is always this wide, in every view. */
  blockW: 300,
  /** Its title bar: the part number, the name, the count. */
  headH: 40,
  /** Inside the title bar, before and after the parts. */
  pad: 10,
  /** One part — a component — and the gap below it. */
  partH: 24,
  partGap: 6,
  /** Parts are laid out in three columns inside the block. */
  partCols: 3,
  /** Clear space between two blocks. */
  gapX: 44,
  gapY: 30,
  /** The most blocks a region puts in one row before it wraps. */
  cols: 5,
  /** A region's own frame: its heading strip, and the margin inside its rule. */
  regionHead: 30,
  regionPad: 16,
  /** Clear space between two regions. */
  regionGap: 30,
  /** How far a port stub stands out of a block's edge. */
  stub: 9,
  /** How far an orthogonal run stands off a block before it turns. */
  elbow: 18,
  /** Two runs that would share a corridor are offset by this much per rank. */
  lane: 9,
  /** The margin of blank sheet around the whole drawing. */
  margin: 40,
} as const;

/** How tall a block with `n` parts stands. The one sizing rule, and it ignores the view. */
export function blockHeight(parts: number): number {
  const rows = Math.ceil(Math.max(0, parts) / DIM.partCols);
  if (rows === 0) return DIM.headH + DIM.pad * 2;
  return DIM.headH + DIM.pad * 2 + rows * DIM.partH + (rows - 1) * DIM.partGap;
}

/** Where part `i` sits inside a block whose top-left is the origin. */
export function partRect(i: number): Rect {
  const col = i % DIM.partCols;
  const row = Math.floor(i / DIM.partCols);
  const inner = DIM.blockW - DIM.pad * 2;
  const w = (inner - DIM.partGap * (DIM.partCols - 1)) / DIM.partCols;
  return {
    x: DIM.pad + col * (w + DIM.partGap),
    y: DIM.headH + DIM.pad + row * (DIM.partH + DIM.partGap),
    w,
    h: DIM.partH,
  };
}

/* --------------------------------------- packing --------------------------------------- */

export interface Packed {
  /** Offsets, in the order the items were given. */
  at: Point[];
  w: number;
  h: number;
}

/**
 * Rows of at most `cols` items, left to right, each row as tall as its tallest member.
 *
 * Items are CENTRED in their row, so a band of two blocks under a band of four reads as a
 * drawing rather than as a ragged left margin. The returned width is the width of the widest
 * row, which is what a region sizes itself to.
 */
export function packRows(
  sizes: readonly { w: number; h: number }[],
  cols: number = DIM.cols,
  gapX: number = DIM.gapX,
  gapY: number = DIM.gapY,
): Packed {
  const n = sizes.length;
  if (n === 0) return { at: [], w: 0, h: 0 };
  const perRow = Math.max(1, Math.trunc(cols));
  const rows: number[][] = [];
  for (let i = 0; i < n; i += perRow) {
    rows.push(Array.from({ length: Math.min(perRow, n - i) }, (_, k) => i + k));
  }
  const widths = rows.map(
    (row) => row.reduce((w, i) => w + (sizes[i]?.w ?? 0), 0) + gapX * (row.length - 1),
  );
  const full = Math.max(...widths);

  const at: Point[] = new Array(n);
  let y = 0;
  rows.forEach((row, r) => {
    const rowH = Math.max(...row.map((i) => sizes[i]?.h ?? 0));
    let x = (full - (widths[r] ?? 0)) / 2;
    for (const i of row) {
      at[i] = { x, y };
      x += (sizes[i]?.w ?? 0) + gapX;
    }
    y += rowH + gapY;
  });

  return { at, w: full, h: y - gapY };
}

/* --------------------------------------- routing --------------------------------------- */

/** Which side of a block a run leaves or enters by. */
export type Side = "top" | "bottom" | "left" | "right";

export function portOf(r: Rect, side: Side): Point {
  switch (side) {
    case "top":
      return { x: r.x + r.w / 2, y: r.y };
    case "bottom":
      return { x: r.x + r.w / 2, y: r.y + r.h };
    case "left":
      return { x: r.x, y: r.y + r.h / 2 };
    default:
      return { x: r.x + r.w, y: r.y + r.h / 2 };
  }
}

export interface Run {
  points: Point[];
  from: Side;
  to: Side;
  /** True when the run travels down the sheet — a dependency. */
  down: boolean;
}

/**
 * An orthogonal run from one rectangle to another, in five points at most.
 *
 * THE RULE, and it is the whole of the drawing's legibility: a run leaves the side that FACES its
 * target, stands off by an elbow, travels the long axis in the corridor between the two, and
 * enters the facing side of the target. Never a diagonal, never a curve, and never a segment that
 * is neither horizontal nor vertical — a blueprint's runs are read by following corners.
 *
 * `rank` offsets the corridor so that two runs sharing one do not draw on top of each other. It is
 * the caller's index among the runs that share a pair of sides, not a global counter: two runs
 * between different pairs of blocks can share a rank without colliding, and a global one would
 * push the last run of a busy drawing a long way off its own blocks.
 */
export function routeOrtho(a: Rect, b: Rect, rank = 0): Run {
  const off = rank * DIM.lane;
  const vertical = b.y >= a.y + a.h || a.y >= b.y + b.h;

  if (vertical) {
    const down = b.y >= a.y + a.h;
    const from: Side = down ? "bottom" : "top";
    const to: Side = down ? "top" : "bottom";
    const p0 = portOf(a, from);
    const p3 = portOf(b, to);
    const mid = (p0.y + p3.y) / 2 + off;
    return {
      points: [p0, { x: p0.x, y: mid }, { x: p3.x, y: mid }, p3],
      from,
      to,
      down,
    };
  }

  const rightward = b.x >= a.x;
  const from: Side = rightward ? "right" : "left";
  const to: Side = rightward ? "left" : "right";
  const p0 = portOf(a, from);
  const p3 = portOf(b, to);
  /* Side by side and overlapping vertically: the corridor is between the two, unless they are so
     close that the corridor is inside one of them, in which case stand off by an elbow. */
  const gap = rightward ? b.x - (a.x + a.w) : a.x - (b.x + b.w);
  const mid =
    gap > DIM.elbow * 2
      ? (p0.x + p3.x) / 2 + off
      : (rightward ? p0.x + DIM.elbow : p0.x - DIM.elbow) + off;
  return {
    points: [p0, { x: mid, y: p0.y }, { x: mid, y: p3.y }, p3],
    from,
    to,
    down: b.y > a.y,
  };
}

/** A run out of a rectangle to nowhere — the stub that says "this edge leaves the drawing". */
export function routeStub(r: Rect, side: Side, length = DIM.elbow * 2): Run {
  const p = portOf(r, side);
  const d: Point =
    side === "top"
      ? { x: 0, y: -length }
      : side === "bottom"
        ? { x: 0, y: length }
        : side === "left"
          ? { x: -length, y: 0 }
          : { x: length, y: 0 };
  return {
    points: [p, { x: p.x + d.x, y: p.y + d.y }],
    from: side,
    to: side,
    down: side === "bottom",
  };
}

/** An SVG path `d` for a run, as straight segments. Rounded corners are the stylesheet's job. */
export function pathOf(points: readonly Point[]): string {
  if (points.length === 0) return "";
  const round = (n: number) => Math.round(n * 100) / 100;
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${round(p.x)} ${round(p.y)}`)
    .join(" ");
}

/**
 * THE RUNS: orthogonal, generated-and-ranked, with a lexicographic cost. Archify study §3, §7.5,
 * §7.7.
 *
 * COPIED FROM THE BASELINE VARIANT, UNCHANGED EXCEPT FOR ONE IMPORT. `variants/contract.ts` forbids
 * reaching into a sibling's folder; the router is the one part of the study that cannot be
 * approximated by taste, and a second, subtly different router would make the two drawings
 * incomparable. TWO EDITS, both named here:
 *
 *   1. `Rect` comes from `./sheet` rather than from the baseline's `layout`.
 *   2. `LABEL_ADVANCE` / `LABEL_H` are the metrics of a NINE-unit run label rather than an
 *      eight-unit one. Archify draws edge labels at 8 px and gets away with it because its camera
 *      sits a hair above 1; this variant's bar (study part 2 §5) is that nothing is ever under 9 px
 *      on screen, and at the home scale a world unit IS a pixel. The router reserves what is drawn,
 *      so the mask a later route was told to avoid is exactly the mask a reader sees.
 *
 * Everything below — the candidate families, the hard feasibility predicate, the lexicographic cost
 * vector, the complete Dijkstra lattice fallback and the label placement — is the baseline's, and is
 * what lets `test/density.routing.test.ts` assert with no exceptions that no run crosses a node.
 *
 * Archify's workflow compiler is the real solver in that repository, and its shape is the one thing
 * from the study that cannot be approximated by taste: **generate a small family of candidate
 * routes, throw away the ones a hard predicate rejects, and rank what survives by a cost VECTOR
 * compared lexicographically, with a stable ordinal at the end so the output is deterministic.**
 * A router that scores with a weighted sum has to be re-tuned every time the drawing changes,
 * because a weight is a claim that two incomparable defects trade off at a fixed rate. They do not:
 * a line crossing a box is never worth saving a bend for.
 *
 * THE COST VECTOR, in order, most significant first:
 *
 *   0  reversePx      world units travelled AGAINST the run's own direction. A dependency runs
 *                     down the stack (`data/edges.ts`); a route that climbs to get there reads as
 *                     an up-edge, which in this model is a finding rather than a line.
 *   1  crossings      proper crossings with runs already placed.
 *   2  corridorPx     units shared with an already-placed collinear segment — two runs in one
 *                     corridor are ambiguous even when neither crosses anything (study §1).
 *   3  clearDeficit   units by which the tightest clearance falls short of COMFORT.
 *   4  bends
 *   5  lengthPx
 *   6  portOffset     displacement of the endpoints from the middle of their side.
 *   7  family         the declaration order of the candidate family: the stable tiebreak that
 *                     makes two identical-cost routes resolve the same way on every run.
 *
 * THE FEASIBILITY PREDICATE IS HARD, not a penalty: orthogonal, leaves and enters perpendicular to
 * the declared side, no segment under MIN_SEG, no interior turn under MIN_TURN, clears every
 * unrelated node by CLEAR and every label already placed by CLEAR. A candidate that fails is gone;
 * it cannot buy its way back in with a low length.
 *
 * LABELS ARE OBSTACLES (study §7.7). Every run carries a short label with an opaque mask under it,
 * and the moment it is placed it joins the obstacle set for every route after it. The repair order
 * archify states — move the label, then adjust the route, then shorten the wording, never delete
 * the label — is why `labelFor` picks the longest segment rather than the middle of the path.
 *
 * THE FAMILIES ARE NOT COMPLETE, AND THAT IS THE ROUND-5 FINDING. Archify's nine families are
 * enough for a workflow: a lane diagram is shallow and its edges are short. This sheet is six rows
 * deep and a dependency runs from `surfaces` to `contracts` past four rows of boxes, so on the
 * first run **27 of 52 system runs had no feasible family** and fell back to an outside channel
 * that then crossed the nodes between the box and the channel. A generate-and-rank router with a
 * finite candidate list has no answer for "and if none of them fit"; the honest fix is a fallback
 * that is COMPLETE rather than a wider list that is merely longer.
 *
 * So the last resort is a **lattice route**: a Dijkstra with a bend penalty over the free lanes of
 * the drawing — the midline of every gap between two columns, the midline of every gap between two
 * rows, and each box's own centre lines — with an edge of the lattice passable only when it clears
 * every node except the two the run connects. A route exists on the lattice whenever one exists at
 * all, which is what lets `test/archify.routing.test.ts` assert, with no exceptions, that no run
 * crosses a node. The families still run first and still win most of the short hops, because a
 * hand-shaped candidate is prettier than a shortest path; the lattice is what makes the guarantee
 * a guarantee instead of a hope.
 */
import type { EdgeKind, Status } from "@/data";

import type { Rect } from "./sheet";

export interface Point {
  x: number;
  y: number;
}

export type Side = "top" | "right" | "bottom" | "left";

/** Archify's four connection variants (study §2). One style per meaning, and only four. */
export type RunStyle = "default" | "emphasis" | "security" | "dashed";

export interface RunLabel extends Rect {
  text: string;
}

export interface Run {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  style: RunStyle;
  points: Point[];
  label: RunLabel;
  /** Which family won, for the test and for a reader of the DOM. */
  family: string;
  sides: [Side, Side];
}

/* --------------------------------------- the rhythm floors ----------------------------------- */

/** How far a run must travel straight out of the box it leaves before it may turn. */
export const STUB = 14;
/** No segment shorter than this (study §1: "no segment under 8 px"). */
export const MIN_SEG = 9;
/** No interior turn tighter than this (study §1: "no interior turn under 16 px"). */
export const MIN_TURN = 17;
/** Hard clearance from an unrelated node or a placed label. Below this a candidate is infeasible. */
export const CLEAR = 11;
/** The clearance a route is not penalised for. Above CLEAR: comfort, not correctness. */
export const COMFORT = 28;
/** Two segments on the same line within this are in one corridor. */
export const CORRIDOR_EPS = 2.5;

/** 9-unit monospace: 0.577 em of advance, on a 15-unit mask. See the two edits at the top. */
export const LABEL_ADVANCE = 5.2;
export const LABEL_H = 15;
export const LABEL_PAD = 5;

/* ------------------------------------------ geometry ----------------------------------------- */

const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);

export function portOf(r: Rect, side: Side, offset = 0): Point {
  switch (side) {
    case "top":
      return { x: r.x + r.w / 2 + offset, y: r.y };
    case "bottom":
      return { x: r.x + r.w / 2 + offset, y: r.y + r.h };
    case "left":
      return { x: r.x, y: r.y + r.h / 2 + offset };
    default:
      return { x: r.x + r.w, y: r.y + r.h / 2 + offset };
  }
}

/** Distance from an axis-aligned segment to a rectangle. 0 when they touch or overlap. */
export function segRectDistance(a: Point, b: Point, r: Rect): number {
  const sx0 = Math.min(a.x, b.x);
  const sx1 = Math.max(a.x, b.x);
  const sy0 = Math.min(a.y, b.y);
  const sy1 = Math.max(a.y, b.y);
  const dx = Math.max(r.x - sx1, sx0 - (r.x + r.w), 0);
  const dy = Math.max(r.y - sy1, sy0 - (r.y + r.h), 0);
  return Math.hypot(dx, dy);
}

interface Seg {
  a: Point;
  b: Point;
  horizontal: boolean;
  length: number;
}

export function segmentsOf(points: readonly Point[]): Seg[] {
  const out: Seg[] = [];
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1e-6) continue;
    out.push({ a, b, horizontal: Math.abs(a.y - b.y) < 1e-6, length });
  }
  return out;
}

/** A proper crossing: two perpendicular segments meeting away from either one's endpoints. */
function crosses(p: Seg, q: Seg): boolean {
  if (p.horizontal === q.horizontal) return false;
  const h = p.horizontal ? p : q;
  const v = p.horizontal ? q : p;
  const hy = h.a.y;
  const vx = v.a.x;
  const hx0 = Math.min(h.a.x, h.b.x);
  const hx1 = Math.max(h.a.x, h.b.x);
  const vy0 = Math.min(v.a.y, v.b.y);
  const vy1 = Math.max(v.a.y, v.b.y);
  const inX = vx > hx0 + CORRIDOR_EPS && vx < hx1 - CORRIDOR_EPS;
  const inY = hy > vy0 + CORRIDOR_EPS && hy < vy1 - CORRIDOR_EPS;
  return inX && inY;
}

/** Units two collinear segments share. The ambiguous-corridor measurement of study §1. */
function corridorOverlap(p: Seg, q: Seg): number {
  if (p.horizontal !== q.horizontal) return 0;
  if (p.horizontal) {
    if (Math.abs(p.a.y - q.a.y) > CORRIDOR_EPS) return 0;
    const lo = Math.max(Math.min(p.a.x, p.b.x), Math.min(q.a.x, q.b.x));
    const hi = Math.min(Math.max(p.a.x, p.b.x), Math.max(q.a.x, q.b.x));
    return Math.max(0, hi - lo);
  }
  if (Math.abs(p.a.x - q.a.x) > CORRIDOR_EPS) return 0;
  const lo = Math.max(Math.min(p.a.y, p.b.y), Math.min(q.a.y, q.b.y));
  const hi = Math.min(Math.max(p.a.y, p.b.y), Math.max(q.a.y, q.b.y));
  return Math.max(0, hi - lo);
}

/* ---------------------------------------- the candidates ------------------------------------- */

interface Candidate {
  points: Point[];
  sides: [Side, Side];
  family: string;
}

const vSide = (dy: number): [Side, Side] => (dy >= 0 ? ["bottom", "top"] : ["top", "bottom"]);
const hSide = (dx: number): [Side, Side] => (dx >= 0 ? ["right", "left"] : ["left", "right"]);

/**
 * The families, in declaration order — which is also the stable tiebreak (cost slot 7).
 *
 * Archify declares nine; these are the seven a layer/kind grid can actually use, with the two
 * lane-specific ones dropped because this sheet has no lanes.
 */
function candidates(a: Rect, b: Rect, channel: { left: number; right: number }): Candidate[] {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const dx = bc.x - ac.x;
  const dy = bc.y - ac.y;
  const out: Candidate[] = [];

  /* 0 facing-straight, vertical: the two boxes share a column of space. */
  const xLo = Math.max(a.x, b.x);
  const xHi = Math.min(a.x + a.w, b.x + b.w);
  if (xHi - xLo > MIN_SEG) {
    const x = clamp(ac.x, xLo + MIN_SEG / 2, xHi - MIN_SEG / 2);
    const sides = vSide(dy);
    out.push({
      points: [portOf(a, sides[0], x - ac.x), portOf(b, sides[1], x - bc.x)],
      sides,
      family: "facing-straight-v",
    });
  }

  /* 1 facing-straight, horizontal. */
  const yLo = Math.max(a.y, b.y);
  const yHi = Math.min(a.y + a.h, b.y + b.h);
  if (yHi - yLo > MIN_SEG) {
    const y = clamp(ac.y, yLo + MIN_SEG / 2, yHi - MIN_SEG / 2);
    const sides = hSide(dx);
    out.push({
      points: [portOf(a, sides[0], y - ac.y), portOf(b, sides[1], y - bc.y)],
      sides,
      family: "facing-straight-h",
    });
  }

  /* 2 vertical-then-horizontal. */
  {
    const sides: [Side, Side] = [dy >= 0 ? "bottom" : "top", dx >= 0 ? "left" : "right"];
    const s = portOf(a, sides[0]);
    const e = portOf(b, sides[1]);
    out.push({ points: [s, { x: s.x, y: e.y }, e], sides, family: "vertical-then-horizontal" });
  }

  /* 3 horizontal-then-vertical. */
  {
    const sides: [Side, Side] = [dx >= 0 ? "right" : "left", dy >= 0 ? "top" : "bottom"];
    const s = portOf(a, sides[0]);
    const e = portOf(b, sides[1]);
    out.push({ points: [s, { x: e.x, y: s.y }, e], sides, family: "horizontal-then-vertical" });
  }

  /* 4 row-gap corridor: out of the bottom, across the gap between two rows, into the top. */
  {
    const sides = vSide(dy);
    const s = portOf(a, sides[0]);
    const e = portOf(b, sides[1]);
    const my = (s.y + e.y) / 2;
    out.push({
      points: [s, { x: s.x, y: my }, { x: e.x, y: my }, e],
      sides,
      family: "row-gap-corridor",
    });
  }

  /* 5 column-gap corridor: out of the side, down the gap between two columns, into the side. */
  {
    const sides = hSide(dx);
    const s = portOf(a, sides[0]);
    const e = portOf(b, sides[1]);
    const mx = (s.x + e.x) / 2;
    out.push({
      points: [s, { x: mx, y: s.y }, { x: mx, y: e.y }, e],
      sides,
      family: "column-gap-corridor",
    });
  }

  /* 6 / 7 the outside channels. Always available, never crossing a node. */
  for (const [name, x] of [
    ["outside-left", channel.left],
    ["outside-right", channel.right],
  ] as const) {
    const side: Side = name === "outside-left" ? "left" : "right";
    const s = portOf(a, side);
    const e = portOf(b, side);
    out.push({ points: [s, { x, y: s.y }, { x, y: e.y }, e], sides: [side, side], family: name });
  }

  return out;
}

/* ------------------------------------- feasibility and cost ---------------------------------- */

const outward: Record<Side, Point> = {
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

function feasible(points: readonly Point[], sides: [Side, Side], obstacles: readonly Rect[]): boolean {
  const segs = segmentsOf(points);
  if (segs.length === 0) return false;

  const first = segs[0]!;
  const last = segs[segs.length - 1]!;
  const out0 = outward[sides[0]];
  const out1 = outward[sides[1]];
  /* Endpoint-side contract (study §1): the first segment leaves perpendicular to the declared
     side and OUTWARD, the last arrives perpendicular to its side and inward. */
  if ((first.b.x - first.a.x) * out0.x + (first.b.y - first.a.y) * out0.y < STUB - 1e-6) return false;
  if ((last.a.x - last.b.x) * out1.x + (last.a.y - last.b.y) * out1.y < STUB - 1e-6) return false;

  for (let i = 0; i < segs.length; i += 1) {
    const s = segs[i]!;
    if (s.length < MIN_SEG - 1e-6) return false;
    /* Route rhythm: an interior turn shorter than MIN_TURN reads as a kink, not a corner. */
    if (i > 0 && i < segs.length - 1 && s.length < MIN_TURN - 1e-6) return false;
    for (const r of obstacles) {
      if (segRectDistance(s.a, s.b, r) < CLEAR) return false;
    }
  }
  return true;
}

export type Cost = readonly number[];

/** Lexicographic: the first slot that differs decides, and no slot trades against another. */
export function cheaper(a: Cost, b: Cost): boolean {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (Math.abs(x - y) > 1e-6) return x < y;
  }
  return false;
}

function costOf(
  points: readonly Point[],
  want: Point,
  obstacles: readonly Rect[],
  placed: readonly Seg[],
  familyIndex: number,
): Cost {
  const segs = segmentsOf(points);
  let reverse = 0;
  let crossings = 0;
  let corridor = 0;
  let deficit = 0;
  let length = 0;

  for (const s of segs) {
    length += s.length;
    const vx = s.b.x - s.a.x;
    const vy = s.b.y - s.a.y;
    if (want.x !== 0 && Math.sign(vx) === -Math.sign(want.x)) reverse += Math.abs(vx);
    if (want.y !== 0 && Math.sign(vy) === -Math.sign(want.y)) reverse += Math.abs(vy);

    let nearest = Infinity;
    for (const r of obstacles) nearest = Math.min(nearest, segRectDistance(s.a, s.b, r));
    if (Number.isFinite(nearest)) deficit += Math.max(0, COMFORT - nearest);

    for (const q of placed) {
      if (crosses(s, q)) crossings += 1;
      corridor += corridorOverlap(s, q);
    }
  }

  return [reverse, crossings, corridor, deficit, segs.length - 1, length, 0, familyIndex];
}

/* -------------------------------------- the lattice router ----------------------------------- */

/**
 * The free lanes of one axis: the midline of every gap between two boxes, plus one lane outside
 * each end. A lane is where a run may travel without being near anything.
 */
function laneMidlines(spans: readonly (readonly [number, number])[], pad: number): number[] {
  if (spans.length === 0) return [];
  const merged: [number, number][] = [];
  for (const [lo, hi] of [...spans].sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1];
    if (last && lo - pad <= last[1]) last[1] = Math.max(last[1], hi + pad);
    else merged.push([lo - pad, hi + pad]);
  }
  const out = [merged[0]![0] - pad * 2];
  for (let i = 0; i + 1 < merged.length; i += 1) out.push((merged[i]![1] + merged[i + 1]![0]) / 2);
  out.push(merged[merged.length - 1]![1] + pad * 2);
  return out;
}

interface Lattice {
  xs: number[];
  ys: number[];
  /** `h[yi][xi]` — who blocks the horizontal edge from (xi,yi) to (xi+1,yi). Empty means clear. */
  h: number[][][];
  v: number[][][];
  rects: Rect[];
  ids: string[];
}

/** Built once per band and cached by the caller: the clearance sweep is the expensive half. */
export function buildLattice(boxes: ReadonlyMap<string, Rect>): Lattice {
  const ids = [...boxes.keys()];
  const rects = [...boxes.values()];

  /* Two lanes closer together than MIN_SEG would put a segment shorter than the rhythm floor into
     a route that is otherwise perfectly good, so they are thinned here rather than repaired later.
     Centre lines are kept in preference to gap midlines: a route has to be able to reach a box. */
  const thin = (centres: readonly number[], gaps: readonly number[]): number[] => {
    const out: number[] = [];
    for (const v of [...new Set([...centres, ...gaps])].sort((a, b) => a - b)) {
      const last = out[out.length - 1];
      if (last !== undefined && v - last < MIN_SEG) {
        if (centres.includes(v) && !centres.includes(last)) out[out.length - 1] = v;
        continue;
      }
      out.push(v);
    }
    return out;
  };

  const xs = thin(
    rects.map((r) => r.x + r.w / 2),
    laneMidlines(rects.map((r) => [r.x, r.x + r.w] as const), CLEAR + 2),
  );
  const ys = thin(
    rects.map((r) => r.y + r.h / 2),
    laneMidlines(rects.map((r) => [r.y, r.y + r.h] as const), CLEAR + 2),
  );

  const blockers = (a: Point, b: Point): number[] => {
    const out: number[] = [];
    for (let i = 0; i < rects.length; i += 1) {
      if (segRectDistance(a, b, rects[i]!) < CLEAR) out.push(i);
      if (out.length > 2) break;
    }
    return out;
  };

  const h: number[][][] = [];
  for (let yi = 0; yi < ys.length; yi += 1) {
    const row: number[][] = [];
    for (let xi = 0; xi + 1 < xs.length; xi += 1) {
      row.push(blockers({ x: xs[xi]!, y: ys[yi]! }, { x: xs[xi + 1]!, y: ys[yi]! }));
    }
    h.push(row);
  }
  const v: number[][][] = [];
  for (let yi = 0; yi + 1 < ys.length; yi += 1) {
    const row: number[][] = [];
    for (let xi = 0; xi < xs.length; xi += 1) {
      row.push(blockers({ x: xs[xi]!, y: ys[yi]! }, { x: xs[xi]!, y: ys[yi + 1]! }));
    }
    v.push(row);
  }

  return { xs, ys, h, v, rects, ids };
}

/** How much a turn costs relative to a world unit of travel. A route that bends less reads better. */
export const BEND_COST = 34;

const nearest = (values: readonly number[], to: number): number => {
  let best = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (Math.abs(values[i]! - to) < Math.abs(values[best]! - to)) best = i;
  }
  return best;
};

/**
 * Dijkstra over the lattice, with the state carrying the direction of travel so a bend can be
 * charged for. Deterministic: ties are broken by the state's own index, which is a function of the
 * sorted lane arrays and therefore of the layout alone.
 */
export function latticeRoute(
  lat: Lattice,
  fromId: string,
  toId: string,
  a: Rect,
  b: Rect,
): { points: Point[]; sides: [Side, Side] } | null {
  const ai = lat.ids.indexOf(fromId);
  const bi = lat.ids.indexOf(toId);
  const free = (blocked: readonly number[]): boolean =>
    blocked.every((i) => i === ai || i === bi);

  const sx = nearest(lat.xs, a.x + a.w / 2);
  const sy = nearest(lat.ys, a.y + a.h / 2);
  const tx = nearest(lat.xs, b.x + b.w / 2);
  const ty = nearest(lat.ys, b.y + b.h / 2);

  const W = lat.xs.length;
  const H = lat.ys.length;
  const DIRS = 4; // 0 right, 1 left, 2 down, 3 up
  const N = W * H * DIRS;
  const dist = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const seen = new Uint8Array(N);
  const key = (x: number, y: number, d: number) => (y * W + x) * DIRS + d;

  /* A simple binary heap: the lattice is small enough that a sorted insert would also do, and a
     heap keeps the worst case honest when a layer opens and the box count triples. */
  const heap: number[] = [];
  const push = (state: number) => {
    heap.push(state);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (dist[heap[p]!]! <= dist[heap[i]!]!) break;
      [heap[p], heap[i]] = [heap[i]!, heap[p]!];
      i = p;
    }
  };
  const pop = (): number => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && dist[heap[l]!]! < dist[heap[m]!]!) m = l;
        if (r < heap.length && dist[heap[r]!]! < dist[heap[m]!]!) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i]!, heap[m]!];
        i = m;
      }
    }
    return top;
  };

  for (let d = 0; d < DIRS; d += 1) {
    const s = key(sx, sy, d);
    dist[s] = 0;
    push(s);
  }

  let goal = -1;
  while (heap.length > 0) {
    const here = pop();
    if (seen[here]) continue;
    seen[here] = 1;
    const d = here % DIRS;
    const cell = (here - d) / DIRS;
    const x = cell % W;
    const y = (cell - x) / W;
    if (x === tx && y === ty) {
      goal = here;
      break;
    }
    const steps: [number, number, number, number][] = [
      [1, 0, 0, x + 1 < W ? (free(lat.h[y]![x]!) ? lat.xs[x + 1]! - lat.xs[x]! : -1) : -1],
      [-1, 0, 1, x > 0 ? (free(lat.h[y]![x - 1]!) ? lat.xs[x]! - lat.xs[x - 1]! : -1) : -1],
      [0, 1, 2, y + 1 < H ? (free(lat.v[y]![x]!) ? lat.ys[y + 1]! - lat.ys[y]! : -1) : -1],
      [0, -1, 3, y > 0 ? (free(lat.v[y - 1]![x]!) ? lat.ys[y]! - lat.ys[y - 1]! : -1) : -1],
    ];
    for (const [dx, dy, nd, cost] of steps) {
      if (cost < 0) continue;
      const next = key(x + dx, y + dy, nd);
      const total = dist[here]! + cost + (nd === d ? 0 : BEND_COST);
      if (total < dist[next]! - 1e-9) {
        dist[next] = total;
        prev[next] = here;
        push(next);
      }
    }
  }

  if (goal < 0) return null;

  const cells: Point[] = [];
  for (let walk = goal; walk >= 0; walk = prev[walk]!) {
    const d = walk % DIRS;
    const cell = (walk - d) / DIRS;
    const x = cell % W;
    const y = (cell - x) / W;
    cells.unshift({ x: lat.xs[x]!, y: lat.ys[y]! });
    if (dist[walk] === 0) break;
  }

  /* Collapse the run of lattice points into corners, then trim the two ends back to the boxes'
     own edges so the route leaves and enters a real port rather than a centre. */
  const corners: Point[] = [];
  for (const p of cells) {
    const n = corners.length;
    if (n >= 2) {
      const a2 = corners[n - 2]!;
      const b2 = corners[n - 1]!;
      const collinear =
        (Math.abs(a2.x - b2.x) < 1e-6 && Math.abs(b2.x - p.x) < 1e-6) ||
        (Math.abs(a2.y - b2.y) < 1e-6 && Math.abs(b2.y - p.y) < 1e-6);
      if (collinear) {
        corners[n - 1] = p;
        continue;
      }
    }
    if (n >= 1 && Math.abs(corners[n - 1]!.x - p.x) < 1e-6 && Math.abs(corners[n - 1]!.y - p.y) < 1e-6) {
      continue;
    }
    corners.push(p);
  }
  if (corners.length < 2) return null;

  const trim = (box: Rect, inner: Point, outer: Point): { point: Point; side: Side } => {
    if (Math.abs(inner.x - outer.x) < 1e-6) {
      return outer.y > inner.y
        ? { point: { x: inner.x, y: box.y + box.h }, side: "bottom" }
        : { point: { x: inner.x, y: box.y }, side: "top" };
    }
    return outer.x > inner.x
      ? { point: { x: box.x + box.w, y: inner.y }, side: "right" }
      : { point: { x: box.x, y: inner.y }, side: "left" };
  };

  const start = trim(a, corners[0]!, corners[1]!);
  const end = trim(b, corners[corners.length - 1]!, corners[corners.length - 2]!);
  const points = [start.point, ...corners.slice(1, -1), end.point];

  /* Two lattice corners may now be inside the box we trimmed to; drop any leading or trailing
     point the trim has swallowed, and collapse what that leaves collinear. */
  const cleaned: Point[] = [];
  for (const p of points) {
    const n = cleaned.length;
    if (n >= 2) {
      const a2 = cleaned[n - 2]!;
      const b2 = cleaned[n - 1]!;
      if (
        (Math.abs(a2.x - b2.x) < 1e-6 && Math.abs(b2.x - p.x) < 1e-6) ||
        (Math.abs(a2.y - b2.y) < 1e-6 && Math.abs(b2.y - p.y) < 1e-6)
      ) {
        cleaned[n - 1] = p;
        continue;
      }
    }
    if (n >= 1 && Math.hypot(cleaned[n - 1]!.x - p.x, cleaned[n - 1]!.y - p.y) < 1e-6) continue;
    cleaned.push(p);
  }

  if (cleaned.length < 2) return null;
  lengthenEnds(cleaned, lat.rects, ai, bi);
  return { points: cleaned, sides: [start.side, end.side] };
}

/**
 * The stub repair. A lattice corner can land a few units from the box it is approaching — the
 * approach travels along the box's CENTRE line and the trim cuts it back to the edge, which turns a
 * 25-unit segment into an 8-unit one. The route is fine; the rhythm is not (study §1: "no segment
 * under 8 px", and `MIN_SEG` is this drawing's floor).
 *
 * So the corner is pushed outward until the stub is long enough, taking the corner that shares its
 * coordinate with it so the polyline stays orthogonal — and the move is committed only if the
 * result still clears every box it is not attached to. A repair that can make the drawing wrong is
 * not a repair.
 */
function lengthenEnds(points: Point[], rects: readonly Rect[], ai: number, bi: number): void {
  const clear = (a: Point, b: Point): boolean =>
    rects.every((r, i) => i === ai || i === bi || segRectDistance(a, b, r) >= CLEAR);

  for (const end of [0, 1] as const) {
    if (points.length < 3) return;
    const tip = end === 0 ? 0 : points.length - 1;
    const near = end === 0 ? 1 : points.length - 2;
    const far = end === 0 ? 2 : points.length - 3;
    const p = points[tip]!;
    const q = points[near]!;
    const length = Math.hypot(q.x - p.x, q.y - p.y);
    if (length >= STUB) continue;

    const vertical = Math.abs(p.x - q.x) < 1e-6;
    const delta = (STUB - length) * (vertical ? Math.sign(q.y - p.y) || 1 : Math.sign(q.x - p.x) || 1);
    const moved: Point = vertical ? { x: q.x, y: q.y + delta } : { x: q.x + delta, y: q.y };
    const partner = points[far];
    const movedPartner: Point | undefined = partner
      ? vertical
        ? { x: partner.x, y: partner.y + delta }
        : { x: partner.x + delta, y: partner.y }
      : undefined;

    const beyond = points[end === 0 ? 3 : points.length - 4];
    const ok =
      clear(p, moved) &&
      (!movedPartner || clear(moved, movedPartner)) &&
      (!beyond || !movedPartner || clear(movedPartner, beyond));
    if (!ok) continue;
    points[near] = moved;
    if (movedPartner) points[far] = movedPartner;
  }
}

/* ------------------------------------------ the label ---------------------------------------- */

/**
 * Where a run's label goes: the middle of its LONGEST segment, offset to the side that is emptier.
 *
 * The longest segment, because that is the one with room — which is archify's repair order stated
 * as a placement rule instead of a repair (move the label before you move the route).
 */
export function labelFor(
  text: string,
  points: readonly Point[],
  taken: readonly Rect[] = [],
): RunLabel {
  const segs = segmentsOf(points);
  const w = text.length * LABEL_ADVANCE + LABEL_PAD * 2;
  const h = LABEL_H;
  let best = segs[0];
  for (const s of segs) if (!best || s.length > best.length) best = s;
  if (!best) return { text, x: 0, y: 0, w, h };

  const at = (t: number): RunLabel => {
    const p = { x: best!.a.x + (best!.b.x - best!.a.x) * t, y: best!.a.y + (best!.b.y - best!.a.y) * t };
    /* On a horizontal run the label sits above the line; on a vertical run, to its right. */
    return best!.horizontal
      ? { text, x: p.x - w / 2, y: p.y - h - 2, w, h }
      : { text, x: p.x + 4, y: p.y - h / 2, w, h };
  };

  /* MOVE THE LABEL BEFORE YOU MOVE THE ROUTE (study §3). Slide along the longest segment, from the
     middle outward, and take the first position nothing else has claimed — an earlier label OR a
     node, because a label the drawing paints a box over is a label that was never placed. */
  const room = Math.max(0.05, Math.min(0.44, (best.length - (best.horizontal ? w : h)) / (2 * best.length)));
  for (const t of [0.5, 0.5 - room, 0.5 + room, 0.5 - room / 2, 0.5 + room / 2, 0.5 - room * 0.75, 0.5 + room * 0.75]) {
    const box = at(t);
    if (!taken.some((r) => overlapsRect(r, box))) return box;
  }
  return at(0.5);
}

const overlapsRect = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/* -------------------------------------------- the pass --------------------------------------- */

export interface RouteInput {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  label: string;
  /** `planned` at either end makes the run dashed, whatever its kind. */
  status: Status;
}

/** Archify's four variants, one per meaning (study §2). */
export function styleOf(kind: EdgeKind, status: Status): RunStyle {
  if (status !== "built") return "dashed";
  if (kind === "gates") return "security";
  if (kind === "streams") return "emphasis";
  return "default";
}

export interface RouteResult {
  runs: Run[];
  /** Runs no candidate family could carry, which the lattice routed instead. */
  latticed: number;
  /** Runs nothing could carry. Must be zero; the test says so. */
  dropped: string[];
}

/**
 * Route every edge, in a deterministic order, each one seeing everything placed before it.
 *
 * The order is the edge list's own (which is authored, and therefore stable), so the output is
 * byte-deterministic — the property archify's stable ordinal exists to guarantee.
 */
export function routeAll(
  boxes: ReadonlyMap<string, Rect>,
  edges: readonly RouteInput[],
  frame: Rect,
): RouteResult {
  const nodeRects = [...boxes.values()];
  const lattice = buildLattice(boxes);
  const placed: Seg[] = [];
  const labels: Rect[] = [];
  const runs: Run[] = [];
  const dropped: string[] = [];
  let latticed = 0;
  let channelSlot = 0;

  for (const e of edges) {
    const a = boxes.get(e.from);
    const b = boxes.get(e.to);
    if (!a || !b) continue;

    /* A unique pair of channels per run, so two candidate channels can never share a corridor. */
    channelSlot += 1;
    const channel = {
      left: frame.x - STUB - channelSlot * (LABEL_H + CLEAR),
      right: frame.x + frame.w + STUB + channelSlot * (LABEL_H + CLEAR),
    };

    const obstacles = [
      ...nodeRects.filter((r) => r !== a && r !== b),
      ...labels,
    ];
    const want = {
      x: Math.sign(b.x + b.w / 2 - (a.x + a.w / 2)),
      y: Math.sign(b.y + b.h / 2 - (a.y + a.h / 2)),
    };

    const family = candidates(a, b, channel);
    let winner: { c: Candidate; cost: Cost } | null = null;
    for (let i = 0; i < family.length; i += 1) {
      const c = family[i]!;
      if (!feasible(c.points, c.sides, obstacles)) continue;
      const cost = costOf(c.points, want, obstacles, placed, i);
      if (!winner || cheaper(cost, winner.cost)) winner = { c, cost };
    }

    if (!winner) {
      /* The last resort: complete, and therefore the reason the no-crossing test has no exceptions.
         Node clearance is guaranteed by the lattice; a label may still be in the way, so the route
         is kept either way and the LABEL moves — archify's repair order, exactly (study §3). */
      const lane = latticeRoute(lattice, e.from, e.to, a, b);
      if (!lane) {
        dropped.push(e.id);
        continue;
      }
      latticed += 1;
      winner = {
        c: { points: lane.points, sides: lane.sides, family: "lattice" },
        cost: costOf(lane.points, want, obstacles, placed, family.length),
      };
    }

    const label = labelFor(e.label, winner.c.points, [...labels, ...obstacles]);
    runs.push({
      id: e.id,
      from: e.from,
      to: e.to,
      kind: e.kind,
      style: styleOf(e.kind, e.status),
      points: winner.c.points,
      label,
      family: winner.c.family,
      sides: winner.c.sides,
    });
    placed.push(...segmentsOf(winner.c.points));
    labels.push(label);
  }

  return { runs, latticed, dropped };
}

/** The `d` of a run, with quadratic fillets at the corners — archify's corner treatment (§3). */
export function runPath(points: readonly Point[], radius = 7): string {
  if (points.length < 2) return "";
  const first = points[0]!;
  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1]!;
    const here = points[i]!;
    const next = points[i + 1]!;
    const inLen = Math.hypot(here.x - prev.x, here.y - prev.y);
    const outLen = Math.hypot(next.x - here.x, next.y - here.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const a = {
      x: here.x + ((prev.x - here.x) / (inLen || 1)) * r,
      y: here.y + ((prev.y - here.y) / (inLen || 1)) * r,
    };
    const c = {
      x: here.x + ((next.x - here.x) / (outLen || 1)) * r,
      y: here.y + ((next.y - here.y) / (outLen || 1)) * r,
    };
    d += ` L ${a.x} ${a.y} Q ${here.x} ${here.y} ${c.x} ${c.y}`;
  }
  const last = points[points.length - 1]!;
  d += ` L ${last.x} ${last.y}`;
  return d;
}

/** Everything the test needs to re-check a placed run without re-deriving the router. */
export const INTERNALS = { segmentsOf, crosses, corridorOverlap, feasible, candidates };

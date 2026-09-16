/**
 * THE RUNS — orthogonal, corridor-threaded, checked against archify's own hard predicate.
 * Study §3 ("routing is orthogonal only… filtered by a hard feasibility predicate"), §7.5, §7.7.
 *
 * WHY THIS IS NOT ROUND 5'S ROUTER. The archify variant's `routing.ts` is a generate-and-rank
 * solver with nine candidate families, a lexicographic cost vector and a Dijkstra fallback over a
 * lattice — because its sheet is six rows deep, its runs are long, and nothing in the drawing
 * names a free lane. A LANE DIAGRAM NAMES THEM ALL. The midline of a column gap, the strip inside
 * a lane above or below its nodes, the gap between two lanes and the two outside channels are not
 * discovered, they are the grid; archify's v2 schema says as much by letting an author pin
 * `route`, `fromSide`, `toSide`, `channelX` and `channelY` as HARD constraints the compiler may
 * not move. So fourteen edges name their corridors in `workflow.ts`, this module resolves those
 * names against whichever plan is current, and the search that is left is the one thing an author
 * should not do by hand: where the label goes.
 *
 * WHAT IS STILL CHECKED, because an authored route that is wrong is worse than a solved one that
 * is ugly. Every run is re-measured here against the same floors archify validates on
 * (`geometry.mjs`): orthogonal, leaves and enters perpendicular to its declared side, no segment
 * under MIN_SEG, no interior turn under MIN_TURN, clears every unrelated node by CLEAR, and no
 * `main` run crosses an `error` run. `test/lanes.routing.test.ts` asserts all of it for all four
 * plans, so a widened phase cannot quietly break a corridor.
 *
 * LABELS ARE OBSTACLES AND ARE NEVER DELETED AS A SPACING REPAIR (study §3, §7.7). The repair
 * order is archify's: move the label along its segment, then take the authored segment, then —
 * and only then — let the label stand down at THIS plan and be revealed at the plan where its
 * phase is open and the column has room. That last step is this variant's answer to the one thing
 * a fixed 1180-unit world cannot have: a 52-unit column gap will not hold a twenty-character mask,
 * and archify's own answer ("repair overflow by removing content, never with overflow hidden, a
 * scroller or smaller type") has a third option when the reader owns a camera.
 */
import {
  CLEAR,
  MIN_SEG,
  MIN_TURN,
  runPath,
  segRectDistance,
  segmentsOf,
  INTERNALS,
} from "../archify/routing";

import {
  channelValue,
  isVerticalSide,
  portOf,
  type NodeBox,
  type Plan,
  type Point,
  type Rect,
} from "./geometry";
import { EDGES, type Role, type Side, type WEdge } from "./workflow";

export { runPath };

/** A label may sit this close to a node. Lower than archify's 8 because a 52-unit gap is the grid. */
export const LABEL_CLEAR = 4;

/**
 * THE RUN LABEL IS 9 UNITS, NOT ARCHIFY'S 8 — the one place this variant overrules the study.
 *
 * Archify's edge labels are 8 px text on a 14 px mask, which is legible in its own artifact because
 * that artifact is a still. This drawing is read at home scale 1 on a 1440-wide screen, and the
 * round-6 brief measures "labels under 9 px" on the live DOM, so an 8-unit run label would be
 * thirteen of them. Nine units it is, and the mask grows with the advance rather than beside it:
 * `LABEL_ADVANCE` is the monospace advance AT NINE (0.6 x 9 = 5.4), so what the router reserves is
 * exactly what the reader sees, which is the property archify's own "one footprint measurement"
 * rule exists to protect.
 */
export const LABEL_ADVANCE = 5.4;
export const LABEL_PAD = 5;
export const LABEL_H = 14;

export interface RunLabel extends Rect {
  text: string;
  /** False when no position on any segment cleared everything; the plan that widens it shows it. */
  shown: boolean;
}

export interface Run {
  id: string;
  from: string;
  to: string;
  role: Role;
  points: readonly Point[];
  sides: readonly [Side, Side];
  label: RunLabel;
  d: string;
}

/* ------------------------------------------ the polyline ------------------------------------- */

const same = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** Drop the points a straight run passes through, so `segmentsOf` sees real segments. */
function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && same(last.x, p.x) && same(last.y, p.y)) continue;
    out.push(p);
  }
  for (let i = 1; i < out.length - 1; ) {
    const a = out[i - 1]!;
    const b = out[i]!;
    const c = out[i + 1]!;
    if ((same(a.x, b.x) && same(b.x, c.x)) || (same(a.y, b.y) && same(b.y, c.y))) out.splice(i, 1);
    else i += 1;
  }
  return out;
}

/**
 * Thread one edge through its authored corridors.
 *
 * The rule is mechanical and therefore testable: start at the port, move along each named corridor
 * in turn, and finish by arriving perpendicular to the far port's declared side. A corridor named
 * `x` is a vertical line, so reaching it is a horizontal move; a corridor named `y` is horizontal,
 * so reaching it is a vertical move. Nothing is inferred and nothing is searched.
 */
export function threadEdge(plan: Plan, edge: WEdge): { points: Point[]; sides: [Side, Side] } {
  const from = plan.byId.get(edge.from);
  const to = plan.byId.get(edge.to);
  if (!from || !to) return { points: [], sides: [edge.fromPort.side, edge.toPort.side] };

  const a = portOf(from, edge.fromPort.side, edge.fromPort.off ?? 0);
  const b = portOf(to, edge.toPort.side, edge.toPort.off ?? 0);

  const points: Point[] = [a];
  let at = a;
  const step = (next: Point) => {
    points.push(next);
    at = next;
  };

  for (const c of edge.via ?? []) {
    const { axis, at: value } = channelValue(plan, c);
    if (axis === "x") step({ x: value, y: at.y });
    else step({ x: at.x, y: value });
  }

  /* Arrive perpendicular to the declared side: a vertical side is entered vertically. */
  if (isVerticalSide(edge.toPort.side)) {
    step({ x: b.x, y: at.y });
    step(b);
  } else {
    step({ x: at.x, y: b.y });
    step(b);
  }

  return { points: simplify(points), sides: [edge.fromPort.side, edge.toPort.side] };
}

/* -------------------------------------------- the label -------------------------------------- */

const overlapsRect = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const grow = (r: Rect, by: number): Rect => ({
  x: r.x - by,
  y: r.y - by,
  w: r.w + by * 2,
  h: r.h + by * 2,
});

/**
 * Where a run's label goes, and whether it goes at all.
 *
 * Archify's repair order, in order: the label slides along its segment from the middle outward;
 * the authored `labelSegment` overrides which segment it slides on; a label that clears nothing
 * anywhere stands down at this plan rather than being painted over a node. Nothing is shortened
 * here — the wording is a claim and `workflow.ts` owns it.
 */
export function placeLabel(
  text: string,
  points: readonly Point[],
  taken: readonly Rect[],
  preferred?: number,
): RunLabel {
  const segs = segmentsOf(points);
  const w = text.length * LABEL_ADVANCE + LABEL_PAD * 2;
  const h = LABEL_H;
  if (segs.length === 0) return { text, x: 0, y: 0, w, h, shown: false };

  const order =
    preferred !== undefined && segs[preferred]
      ? [preferred, ...segs.map((_, i) => i).filter((i) => i !== preferred)]
      : segs
          .map((_, i) => i)
          .sort((i, j) => segs[j]!.length - segs[i]!.length);

  const at = (index: number, t: number): RunLabel => {
    const s = segs[index]!;
    const p = { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t };
    return s.horizontal
      ? { text, x: p.x - w / 2, y: p.y - h - 2, w, h, shown: true }
      : { text, x: p.x + 4, y: p.y - h / 2, w, h, shown: true };
  };

  for (const index of order) {
    const s = segs[index]!;
    const span = s.horizontal ? w : h;
    const room = Math.max(0, Math.min(0.42, (s.length - span) / (2 * s.length)));
    const slots = [0.5, 0.5 - room, 0.5 + room, 0.5 - room / 2, 0.5 + room / 2];
    for (const t of slots) {
      const box = at(index, t);
      if (!taken.some((r) => overlapsRect(r, box))) return box;
    }
  }
  const fallback = at(order[0]!, 0.5);
  return { ...fallback, shown: false };
}

/* --------------------------------------------- the pass -------------------------------------- */

export interface RouteResult {
  runs: Run[];
  /** Labels that could not be placed at this plan; L1 widens their phase and reveals them. */
  suppressed: string[];
}

/**
 * Route every edge for one plan.
 *
 * ORDER IS DECLARATION ORDER, which is the stable tiebreak: the main path is authored first, so it
 * claims the corridors and the label positions, and a branch repairs around it rather than the
 * other way round. That is the same property archify buys with its ordinal cost slot, for free,
 * because nothing here is searching.
 */
export function routeAll(plan: Plan): RouteResult {
  const runs: Run[] = [];
  const suppressed: string[] = [];
  const obstacles: Rect[] = plan.nodes.map((n) => grow(n, LABEL_CLEAR));

  for (const edge of EDGES) {
    const { points, sides } = threadEdge(plan, edge);
    const label = placeLabel(edge.label, points, obstacles, edge.labelSegment);
    if (label.shown) obstacles.push(grow(label, LABEL_CLEAR));
    else suppressed.push(edge.id);
    runs.push({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      role: edge.role,
      points,
      sides,
      label,
      d: runPath(points),
    });
  }

  return { runs, suppressed };
}

/** One pass per plan, computed once: twelve nodes and fourteen edges is not worth a second pass. */
const CACHE = new Map<string, RouteResult>();

export function routesFor(plan: Plan): RouteResult {
  const key = plan.open ?? "closed";
  const had = CACHE.get(key);
  if (had) return had;
  const made = routeAll(plan);
  CACHE.set(key, made);
  return made;
}

/* ---------------------------------------- the hard predicate --------------------------------- */

export interface Defect {
  run: string;
  why: string;
}

const outward: Record<Side, Point> = {
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/**
 * Archify's feasibility predicate, applied to an authored route instead of a generated one.
 *
 * Every clause is a hard fail and none of them trades off against another: a run that crosses a
 * node is never worth the bend it saves. The test calls this for all four plans.
 */
export function defectsOf(plan: Plan, runs: readonly Run[]): Defect[] {
  const out: Defect[] = [];
  const nodes: readonly NodeBox[] = plan.nodes;

  for (const run of runs) {
    const segs = segmentsOf(run.points);
    if (segs.length === 0) {
      out.push({ run: run.id, why: "no route" });
      continue;
    }
    for (const s of segs) {
      if (!s.horizontal && !same(s.a.x, s.b.x)) out.push({ run: run.id, why: "not orthogonal" });
      if (s.length < MIN_SEG) {
        out.push({ run: run.id, why: `segment ${s.length.toFixed(1)} < ${MIN_SEG}` });
      }
    }
    for (let i = 1; i < segs.length - 1; i += 1) {
      if (segs[i]!.length < MIN_TURN) {
        out.push({ run: run.id, why: `interior turn ${segs[i]!.length.toFixed(1)} < ${MIN_TURN}` });
      }
    }

    /* The first and last segment leave and enter perpendicular to the declared side. */
    const first = segs[0]!;
    const last = segs[segs.length - 1]!;
    const dirOut = outward[run.sides[0]];
    const dirIn = outward[run.sides[1]];
    const goesOut =
      Math.sign(first.b.x - first.a.x) === dirOut.x && Math.sign(first.b.y - first.a.y) === dirOut.y;
    const comesIn =
      Math.sign(last.a.x - last.b.x) === dirIn.x && Math.sign(last.a.y - last.b.y) === dirIn.y;
    if (!goesOut) out.push({ run: run.id, why: `leaves ${run.sides[0]} the wrong way` });
    if (!comesIn) out.push({ run: run.id, why: `enters ${run.sides[1]} the wrong way` });

    /* Clears every node it does not connect. */
    for (const node of nodes) {
      if (node.id === run.from || node.id === run.to) continue;
      for (const s of segs) {
        if (segRectDistance(s.a, s.b, node) < CLEAR) {
          out.push({ run: run.id, why: `passes within ${CLEAR} of ${node.id}` });
          break;
        }
      }
    }

    /* Its label clears every node, when it is shown. */
    if (run.label.shown) {
      for (const node of nodes) {
        if (overlapsRect(grow(node, LABEL_CLEAR), run.label)) {
          out.push({ run: run.id, why: `label over ${node.id}` });
        }
      }
    }
  }

  return out;
}

/** Proper crossings between two runs, using archify's own definition. */
export function crossingsBetween(a: Run, b: Run): number {
  const sa = segmentsOf(a.points);
  const sb = segmentsOf(b.points);
  let n = 0;
  for (const p of sa) for (const q of sb) if (INTERNALS.crosses(p, q)) n += 1;
  return n;
}

/**
 * The success criterion of study Part 2 §5, proposal B, counted: **zero crossings between a `main`
 * run and the one `error` run.** A reader must be able to state the happy path and the exception
 * without tracing a line over another line.
 */
export function mainErrorCrossings(runs: readonly Run[]): number {
  const main = runs.filter((r) => r.role === "main");
  const error = runs.filter((r) => r.role === "error");
  let n = 0;
  for (const m of main) for (const e of error) n += crossingsBetween(m, e);
  return n;
}

/** Every crossing in the drawing, for the receipt. */
export function allCrossings(runs: readonly Run[]): number {
  let n = 0;
  for (let i = 0; i < runs.length; i += 1) {
    for (let j = i + 1; j < runs.length; j += 1) n += crossingsBetween(runs[i]!, runs[j]!);
  }
  return n;
}

/** A derived hop the model does not carry: an elbow, drawn dotted by the Story Trail. */
export function elbow(a: Point, b: Point): string {
  const midY = (a.y + b.y) / 2;
  return `M ${a.x} ${a.y} L ${a.x} ${midY} L ${b.x} ${midY} L ${b.x} ${b.y}`;
}

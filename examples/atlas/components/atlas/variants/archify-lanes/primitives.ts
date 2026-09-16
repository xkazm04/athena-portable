/**
 * THE ROUTING PRIMITIVES — the rhythm floors, the segment algebra and the corner fillet.
 * Archify study §1 ("no segment under 8 px, no interior turn under 16 px"), §3, §7.5.
 *
 * THESE MOVED HERE WHEN `variants/archify/**` WAS DELETED after the round-6 verdict. They were the
 * bottom of `archify/routing.ts`, which this variant's own `routing.ts` imported across the folder
 * boundary — a thing `variants/contract.ts` forbids and only tolerated while both drawings were on
 * the table. The lanes variant is the one drawing left, so its measurements live inside its stage.
 *
 * WHAT CAME AND WHAT DID NOT, because a copy that does not say what it left behind is a fork.
 * Archify's `routing.ts` was a generate-and-rank SOLVER — nine candidate families, a lexicographic
 * cost vector, a Dijkstra fallback over a lattice of free lanes — written for a six-row sheet whose
 * long dependencies named no corridors. A LANE DIAGRAM NAMES THEM ALL (see `./routing.ts`), so the
 * solver had no caller here and its only test was the deleted sheet's. It is gone with the sheet.
 * What is carried is everything the lanes router actually measures against, unchanged line for
 * line: the three floors, the distance from a segment to a rectangle, the segment decomposition,
 * the proper-crossing predicate, and the `d` of a run. The floors keep archify's values so that an
 * authored corridor is validated against the same numbers the study states.
 */
import type { Point, Rect } from "./geometry";

/* --------------------------------------- the rhythm floors ----------------------------------- */

/** No segment shorter than this (study §1: "no segment under 8 px"). */
export const MIN_SEG = 9;
/** No interior turn tighter than this (study §1: "no interior turn under 16 px"). */
export const MIN_TURN = 17;
/** Hard clearance from an unrelated node or a placed label. Below this a route is infeasible. */
export const CLEAR = 11;
/** Two segments on the same line within this are in one corridor. */
export const CORRIDOR_EPS = 2.5;

/* ------------------------------------------ geometry ----------------------------------------- */

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

export interface Seg {
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
export function crosses(p: Seg, q: Seg): boolean {
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

/* ------------------------------------------ the path ----------------------------------------- */

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
